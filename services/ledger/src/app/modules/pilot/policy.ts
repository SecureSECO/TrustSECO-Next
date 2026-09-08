import { createPublicKey, verify } from 'crypto';
import {
	applyEvent,
	CommunityState,
	initialState,
	evaluate,
	Round,
	standing,
} from '../community/policy';

export const METRICS: Record<string, { absolute: number; relativeBps: number }> = {
	gh_owner_stargazer_count: { absolute: 5, relativeBps: 200 },
	gh_contributor_count: { absolute: 1, relativeBps: 100 },
	gh_open_issues_count: { absolute: 1, relativeBps: 100 },
	gh_yearly_commit_count: { absolute: 2, relativeBps: 200 },
};
export const DELAY = 86400;
export interface Escrow {
	sponsor: string;
	bounty: string;
	repository: string;
	version: string;
	closedAt: number | null;
	closedHeight: number | null;
	settled: boolean;
}
export interface Payment {
	id: string;
	uid: string;
	amount: string;
	round: string;
	package: string;
	version: string;
	height: number;
	timestamp: number;
	kind: 'reward' | 'refund';
}
export interface PilotState {
	community: CommunityState;
	network: string;
	supply: string;
	balances: Record<string, string>;
	escrows: Record<string, Escrow>;
	payouts: Payment[];
	revoked: string[];
}
export function freshPilot(governor: string, network: string): PilotState {
	return {
		community: initialState(governor),
		network,
		supply: '1000000',
		balances: { governor: '1000000' },
		escrows: {},
		payouts: [],
		revoked: [],
	};
}
function requireThat(ok: unknown, message: string): asserts ok {
	if (!ok) throw new Error(message);
}
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const money = (value: unknown): bigint => {
	requireThat(
		typeof value === 'string' && /^[1-9][0-9]{0,15}$/.test(value),
		'Positive integer TrustCOIN amount required',
	);
	return BigInt(value);
};
export const roundResult = (s: PilotState, r: Round) => evaluate(r, s.community, METRICS[r.metric]);
export function joinProof(
	payload: string,
	signature: string,
	key: string,
	network: string,
	member: string,
	at: number,
): void {
	requireThat(Buffer.byteLength(payload) <= 4000, 'Join proof too large');
	const p = JSON.parse(payload) as {
		network: string;
		login: string;
		publicKey: string;
		expiresAt: number;
		nonce: string;
	};
	requireThat(
		p.network === network &&
			p.login === member &&
			typeof p.nonce === 'string' &&
			p.nonce.length >= 16,
		'Join identity mismatch',
	);
	requireThat(
		Number.isSafeInteger(p.expiresAt) && p.expiresAt >= at && p.expiresAt <= at + 86400,
		'Join proof expired or too far in future',
	);
	const pub = createPublicKey(key);
	requireThat(pub.asymmetricKeyType === 'ed25519', 'Ed25519 required');
	requireThat(
		createPublicKey(p.publicKey).export({ type: 'spki', format: 'pem' }) ===
			pub.export({ type: 'spki', format: 'pem' }),
		'Join key mismatch',
	);
	requireThat(
		verify(
			null,
			Buffer.from(`TrustSECO-join-v1\n${payload}`),
			pub,
			Buffer.from(signature, 'base64'),
		),
		'Invalid join proof',
	);
}
export function applyPilot(
	previous: PilotState,
	payload: string,
	signature: string,
	at: number,
	height: number,
): PilotState {
	requireThat(Buffer.byteLength(payload) <= 12000, 'Event too large');
	const e = JSON.parse(payload) as {
		id: string;
		actor: string;
		kind: string;
		network: string;
		member: string;
		key: string;
		githubId: string;
		joinPayload: string;
		joinSignature: string;
		repository: string;
		version: string;
		round: string;
		bounty: string;
		amount: string;
		recipient: string;
		metric: string;
		source: string;
		method: string;
		reason: string;
	};
	requireThat(e && typeof e === 'object' && e.network === previous.network, 'Wrong network');
	requireThat(!previous.revoked.includes(e.actor), 'Signing key revoked');
	const s = JSON.parse(JSON.stringify(previous)) as PilotState;
	if (e.kind === 'enrol') {
		requireThat(
			/^[a-z0-9][a-z0-9-]{0,38}$/.test(e.member) &&
				e.member !== 'governor' &&
				e.member !== 'constructor' &&
				e.member !== 'prototype',
			'Invalid GitHub login',
		);
		requireThat(/^[1-9][0-9]{0,19}$/.test(e.githubId), 'Stable numeric GitHub ID required');
		joinProof(e.joinPayload, e.joinSignature, e.key, s.network, e.member, at);
	}
	if (e.kind === 'open') {
		requireThat(
			typeof e.round === 'string' &&
				/^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/.test(e.round) &&
				!['constructor', 'prototype'].includes(e.round),
			'Invalid round ID',
		);
		requireThat(
			typeof e.repository === 'string' && /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(e.repository),
			'Repository must be owner/name',
		);
		requireThat(
			typeof e.version === 'string' && e.version.length > 0 && e.version.length <= 100,
			'Version required',
		);
		requireThat(
			e.source === 'GitHub REST' && e.method === 'github-rest-v1' && own(METRICS, e.metric),
			'Unsupported live collector',
		);
		requireThat(
			!s.community.rounds.some(
				r =>
					!r.closed &&
					s.escrows[r.id]?.repository === e.repository.toLowerCase() &&
					s.escrows[r.id]?.version === e.version &&
					r.metric === e.metric,
			),
			'Matching round already open',
		);
		const bounty = money(e.bounty);
		requireThat(bounty >= BigInt(3), 'Bounty must fund at least three contributors');
		requireThat(BigInt(s.balances[e.actor] ?? '0') >= bounty, 'Insufficient TrustCOIN balance');
	}
	if (e.kind === 'transfer' || e.kind === 'revoke') {
		const key =
			e.actor === 'governor'
				? s.community.governor
				: s.community.members.find(m => m.id === e.actor)?.key;
		requireThat(
			key &&
				typeof e.id === 'string' &&
				e.id.length > 0 &&
				e.id.length <= 2000 &&
				!s.community.audit.some(a => a.id === e.id),
			'Unknown signer or replay',
		);
		requireThat(
			verify(
				null,
				Buffer.from(`TrustSECO-community-v1\n${payload}`),
				createPublicKey(key),
				Buffer.from(signature, 'base64'),
			),
			'Invalid signature',
		);
		requireThat(s.community.audit.length < 10000, 'Event capacity reached');
		if (e.kind === 'transfer') {
			const amount = money(e.amount);
			requireThat(own(s.balances, e.recipient), 'Unknown recipient');
			requireThat(BigInt(s.balances[e.actor] ?? '0') >= amount, 'Insufficient TrustCOIN balance');
			s.balances[e.actor] = (BigInt(s.balances[e.actor]) - amount).toString();
			s.balances[e.recipient] = (BigInt(s.balances[e.recipient]) + amount).toString();
		} else {
			requireThat(
				e.actor === 'governor' &&
					s.community.members.some(m => m.id === e.member) &&
					typeof e.reason === 'string' &&
					e.reason.trim().length > 0,
				'Governor and revocation reason required',
			);
			requireThat(!s.revoked.includes(e.member), 'Already revoked');
			s.revoked.push(e.member);
			const m = s.community.members.find(x => x.id === e.member);
			if (m) m.suspended = true;
		}
		s.community.audit.push({
			id: e.id,
			actor: e.actor,
			kind: e.kind,
			at,
			height,
			payload,
			signature,
		});
	} else {
		// The legacy signature and admission checks remain shared; this chain explicitly permits these collector metrics.
		s.community = applyEvent(s.community, payload, signature, at, height, Object.keys(METRICS));
		if (e.kind === 'enrol') s.balances[e.member] = '0';
		if (e.kind === 'reinstate')
			requireThat(!s.revoked.includes(e.member), 'Revoked keys cannot be reinstated');
		if (e.kind === 'open') {
			const bounty = money(e.bounty);
			s.balances[e.actor] = (BigInt(s.balances[e.actor]) - bounty).toString();
			s.escrows[e.round] = {
				sponsor: e.actor,
				bounty: e.bounty,
				repository: e.repository.toLowerCase(),
				version: e.version,
				closedAt: null,
				closedHeight: null,
				settled: false,
			};
		}
		if (e.kind === 'close') {
			const r = s.community.rounds.find(x => x.id === e.round);
			requireThat(r, 'Round missing');
			r.result = roundResult(s, r);
			s.escrows[e.round].closedAt = at;
			s.escrows[e.round].closedHeight = height;
		}
	}
	requireThat(conserved(s), 'TrustCOIN conservation failed');
	return s;
}
export function conserved(s: PilotState): boolean {
	const balances = Object.values(s.balances).reduce((n, b) => n + BigInt(b), BigInt(0));
	const escrow = Object.values(s.escrows)
		.filter(e => !e.settled)
		.reduce((n, e) => n + BigInt(e.bounty), BigInt(0));
	return (
		Object.values(s.balances).every(b => BigInt(b) >= BigInt(0)) &&
		balances + escrow === BigInt(s.supply)
	);
}
/** All effects are canonical chain state; a payout is final only when its block is finalized. */
export function settlePilot(previous: PilotState, at: number, height: number): PilotState {
	const s = JSON.parse(JSON.stringify(previous)) as PilotState;
	for (const round of s.community.rounds) {
		const escrow = s.escrows[round.id];
		if (!escrow || escrow.settled) continue;
		// Automatic closure prevents an absent coordinator from indefinitely trapping the bounty.
		if (!round.closed && at > round.closesAt) {
			round.closed = true;
			round.result = roundResult(s, round);
			escrow.closedAt = at;
			escrow.closedHeight = height;
		}
		if (escrow.closedAt === null || at < escrow.closedAt + DELAY) continue;
		const result = roundResult(s, round);
		const recipients =
			result.status === 'verified'
				? round.observations
						.filter(o => result.supporters.includes(o.id))
						.map(o => o.member)
						.sort((a, b) => { if (a === b) return 0; return a < b ? -1 : 1; })
				: [];
		const bounty = BigInt(escrow.bounty);
		const share = recipients.length ? bounty / BigInt(recipients.length) : BigInt(0);
		const pay = (uid: string, amount: bigint, kind: Payment['kind']) => {
			if (amount <= BigInt(0)) return;
			s.balances[uid] = (BigInt(s.balances[uid]) + amount).toString();
			s.payouts.push({
				id: String(s.payouts.length + 1),
				uid,
				amount: amount.toString(),
				round: round.id,
				package: escrow.repository,
				version: escrow.version,
				height,
				timestamp: at,
				kind,
			});
		};
		for (const uid of recipients) pay(uid, share, 'reward');
		pay(escrow.sponsor, bounty - share * BigInt(recipients.length), 'refund');
		escrow.settled = true;
	}
	requireThat(conserved(s), 'TrustCOIN conservation failed');
	return s;
}
export function pilotView(s: PilotState, at: number) {
	return {
		network: s.network,
		policy: { version: 'pilot-v1', contributors: 3, delaySeconds: DELAY, tolerances: METRICS },
		governorKey: s.community.governor,
		members: s.community.members.map(m => ({
			...m,
			standing: standing(s.community, m.id, at),
			revoked: s.revoked.includes(m.id),
			balance: s.balances[m.id],
		})),
		treasury: s.balances.governor,
		supply: s.supply,
		rounds: s.community.rounds.map(r => ({
			...r,
			result: roundResult(s, r),
			escrow: s.escrows[r.id],
		})),
		audit: s.community.audit,
		incidents: s.community.incidents,
		at,
	};
}
export function verifiedInputs(
	s: PilotState,
	repository: string,
	version: string,
	finalizedHeight: number,
) {
	if (s.community.audit.some(e => e.height > finalizedHeight)) return [];
	const latest = new Map<string, Round>();
	for (const r of s.community.rounds) {
		const e = s.escrows[r.id];
		if (
			e.repository !== repository.toLowerCase() ||
			e.version !== version ||
			!r.closed ||
			e.closedHeight === null ||
			e.closedHeight > finalizedHeight
		)
			continue;
		const previous = latest.get(r.metric);
		if (!previous || r.openedAt > previous.openedAt)
			latest.set(r.metric, r);
	}
	return [...latest.values()].flatMap(r => {
		const v = roundResult(s, r);
		return v.status === 'verified'
			? [{ fact: r.metric, factData: String(v.value), round: r.id }]
			: [];
	});
}
