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
	const releases = new Map<Frame, string>();
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
		releases.set(history[index ?? history.length - 1], release);
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
		if (!policy.features.some(f => f.metric === r.metric) && r.metric !== policy.securityMetric && r.metric !== 'vs_virus_ratio')
			continue;
		const state = byVersion.get(escrow.version) ?? { at: r.openedAt, facts: [] };
		const result = roundResult(s, r);
		const finalHeight = confirmationHeight(s, r);
		const final = r.closed && finalHeight !== null && finalHeight <= finalizedHeight;
		let value: number | null = r.observations.slice(-1)[0]?.value ?? null;
		if (confirmed) value = result.status === 'verified' && final ? result.value : null;
		let observation = confirmed
			? r.observations.find(o => result.supporters.includes(o.id))
			: r.observations.slice(-1)[0];
        if (!confirmed && [policy.securityMetric,'vs_virus_ratio'].includes(r.metric)) {
            if (final && result.status === 'verified') observation = r.observations.find(o=>result.supporters.includes(o.id));
            else if (r.metric === 'vs_virus_ratio') observation = r.observations.find(o=>o.observedAt<=at && o.receivedAt<=at && o.malware && o.malware.infected>0) ?? observation;
            value = observation?.value ?? null;
        }
		const timestamp = confirmed
			? escrow.closedAt ?? r.openedAt
			: observation?.receivedAt ?? r.openedAt;
		if (timestamp > at) continue;
		if (!confirmed && (!observation || observation.observedAt > at || observation.receivedAt > at)) continue;
		state.at = timestamp;
		if (r.metric === 'vs_virus_ratio') {
			// A pending, failed or stale refresh must never erase a known detection.
			if (value !== null && observation?.malware && (confirmed || observation.malware.infected > 0 || !state.malware?.infected || (final && result.status === 'verified'))) state.malware = observation.malware;
		} else if (r.metric === policy.securityMetric) {
			if (!confirmed && observation?.security && state.security && !(final && result.status === 'verified')) {
                // An unconfirmed clean response cannot erase previously observed risks.
                const advisories = new Map(observation.security.advisories.map(v=>[v.id,v]));
                for (const v of state.security.advisories) {
                    const fresh = advisories.get(v.id);
                    if (!fresh || (v.score ?? -1) >= (fresh.score ?? -1) || v.kev) advisories.set(v.id,v);
                }
                state.security = {...observation.security,advisories:[...advisories.values()]};
            } else state.security = value !== null ? observation?.security : undefined;
			state.securityAt = observation?.observedAt;
		} else {
			state.facts = state.facts.filter(f => f.metric !== r.metric);
			if (value !== null && observation)
				state.facts.push({ metric: r.metric, value, at: observation.observedAt });
		}
		state.correction = false;
		byVersion.set(escrow.version, state);
		if (!confirmed || final) record({ ...state, facts: [...state.facts] }, escrow.version);
		if (escrow.version === version && confirmed && r.metric !== 'vs_virus_ratio') latestFinal.set(r.metric, !!final);
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
    const assessment = assess(finalFrame,!confirmed);
    let lastConfirmed: {score: number; assessedAt: number; policyVersion: string} | null = null;
    const result = confirmed ? recover(history, (frame, score) => {
        // Only recorded, finalized assessments for this exact release qualify.
        // The synthetic current-time frame must not advance the historical date.
        if (releases.get(frame) === version) lastConfirmed = {score, assessedAt: frame.at, policyVersion: policy.version};
    }) : {score:assessment.target,status:assessment.target===null?'no-evidence':'provisional'};
    const sourceRanks = rounds.filter(r=>r.metric==='lib_sourcerank' && s.escrows[r.id].version===version).flatMap(r=>{
        const agreement = roundResult(s,r); const height = confirmationHeight(s,r);
        const final = r.closed && agreement.status==='verified' && height!==null && height<=finalizedHeight;
        if (confirmed && !final) return [];
        const observations = r.observations.filter(o=>o.observedAt<=at && o.receivedAt<=at && (!confirmed || agreement.supporters.includes(o.id)));
        const observation = observations.slice(-1)[0];
        return observation ? [{value:confirmed?agreement.value:observation.value,observedAt:observation.observedAt,confirmed:final && agreement.supporters.includes(observation.id),source:'Libraries.io'}] : [];
    }).sort((a,b)=>a.observedAt-b.observedAt);
	return {
		...result,
		...assessment,
		score: result.score,
		...(confirmed ? {lastConfirmed} : {}),
		status: result.status,
		repository,
		version,
		sourceRank:sourceRanks.slice(-1)[0] ?? null,
		basis: confirmed ? 'community-confirmed' : 'local-provisional',
		historyBasis: 'project-wide across version labels',
		warnings:
			finalFrame.security?.advisories.map(
				v => `${v.id}: ${v.kev ? 'known exploitation; ' : ''}${v.severity}`,
			) ?? [],
	};
}
