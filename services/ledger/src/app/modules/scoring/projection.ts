import { PilotState, roundResult, confirmationHeight } from '../pilot/policy';
import { Frame, assess, policy, recover } from './engine';

/** Replay canonical round outcomes; reads do not manufacture new history or reset it per version. */
export function projectScore(
	s: PilotState,
	repository: string,
	version: string,
	at: number,
	finalizedHeight: number,
	confirmed: boolean,
) {
	const rounds = s.community.rounds.filter(
		r => s.escrows[r.id].repository === repository.toLowerCase(),
	);
	const byVersion = new Map<string, Frame>();
	const history: Frame[] = [];
	const historyIndex = new Map<string, number>();
	const record = (frame: Frame, release: string) => {
		const key = JSON.stringify([release, frame.at]);
		const index = historyIndex.get(key);
		// A block's simultaneous metric updates form one assessment, not transient partial scores.
		if (index !== undefined)
			history[index] = { ...frame, correction: [frame.correction, history[index].correction].includes(true) };
		else {
			historyIndex.set(key, history.length);
			history.push(frame);
		}
	};
	const latestFinal = new Map<string, boolean>();
	for (const r of [...rounds].sort(
		(a, b) =>
			(confirmed
				? s.escrows[a.id].closedAt ?? a.openedAt
				: a.observations.slice(-1)[0]?.receivedAt ?? a.openedAt) -
			(confirmed
				? s.escrows[b.id].closedAt ?? b.openedAt
				: b.observations.slice(-1)[0]?.receivedAt ?? b.openedAt),
	)) {
		const escrow = s.escrows[r.id];
		if (!policy.features.some(f => f.metric === r.metric) && r.metric !== policy.securityMetric)
			continue;
		const state = byVersion.get(escrow.version) ?? { at: r.openedAt, facts: [] };
		const result = roundResult(s, r);
		const finalHeight = confirmationHeight(s, r);
		const final = r.closed && finalHeight !== null && finalHeight <= finalizedHeight;
		let value: number | null = r.observations.slice(-1)[0]?.value ?? null;
		if (confirmed) value = result.status === 'verified' && final ? result.value : null;
		const observation = confirmed
			? r.observations.find(o => result.supporters.includes(o.id))
			: r.observations.slice(-1)[0];
		const timestamp = confirmed
			? escrow.closedAt ?? r.openedAt
			: observation?.receivedAt ?? r.openedAt;
		if (timestamp > at) continue;
		state.at = timestamp;
		if (r.metric === policy.securityMetric) {
			state.security = value !== null ? observation?.security : undefined;
			state.securityAt = observation?.observedAt;
		} else {
			state.facts = state.facts.filter(f => f.metric !== r.metric);
			if (value !== null && observation)
				state.facts.push({ metric: r.metric, value, at: observation.observedAt });
		}
		state.correction = false;
		byVersion.set(escrow.version, state);
		if (!confirmed || final) record({ ...state, facts: [...state.facts] }, escrow.version);
		if (escrow.version === version && confirmed) latestFinal.set(r.metric, !!final);
		if (
			final &&
			escrow.scoreCorrection &&
			escrow.scoreCorrection.height <= finalizedHeight &&
			escrow.scoreCorrection.at <= at
		) {
			record(
				{
					...state,
					facts: [...state.facts],
					at: escrow.scoreCorrection.at,
					correction: true,
				},
				escrow.version,
			);
		}
	}
	const current = byVersion.get(version) ?? { at, facts: [] };
	const finalFrame = {
		...current,
		at,
		correction: false,
		blocked: [...latestFinal.values()].some(final => !final),
	};
	history.sort((a, b) => a.at - b.at);
	history.push(finalFrame);
	const result = recover(history);
	return {
		...result,
		...assess(finalFrame),
		score: result.score,
		status: result.status,
		repository,
		version,
		basis: confirmed ? 'community-confirmed' : 'local-provisional',
		historyBasis: 'project-wide across version labels',
		warnings:
			finalFrame.security?.advisories.map(
				v => `${v.id}: ${v.kev ? 'known exploitation; ' : ''}${v.severity}`,
			) ?? [],
	};
}
