import { createPublicKey, verify } from 'crypto';
import { AVAILABILITY_VERSION, LEASE_SECONDS, Lease, BeaconAssignment, availableMembers, createBeaconAssignment, acceptBeacon, advanceReserves, canSubmit, assignmentPhase } from './availability';
import { Assignment, ASSIGNMENT_VERSION, createAssignment, contribute } from './assignment';
import {
	applyEvent,
	CommunityState,
	initialState,
	evaluate,
	Round,
	standing,
} from '../community/policy';

// Additive collector support: existing GitHub round validation and outcomes are unchanged.
export const METRICS: Record<string, { absolute: number; relativeBps: number }> = {
	gh_owner_stargazer_count: { absolute: 5, relativeBps: 200 },
	gh_contributor_count: { absolute: 1, relativeBps: 100 },
	lib_contributor_count: { absolute: 1, relativeBps: 100 },
	lib_dependency_count: { absolute: 0, relativeBps: 0 },
	lib_dependent_count: { absolute: 1, relativeBps: 100 },
	lib_first_release_date: { absolute: 0, relativeBps: 0 },
	lib_latest_release_date: { absolute: 0, relativeBps: 0 },
	lib_release_count: { absolute: 1, relativeBps: 0 },
	lib_release_frequency: { absolute: 0, relativeBps: 0 },
	lib_sourcerank: { absolute: 0, relativeBps: 0 },
	gh_open_issues_count: { absolute: 1, relativeBps: 100 },
	gh_yearly_commit_count: { absolute: 2, relativeBps: 200 },
};
export const DELAY = 86400;
export interface Escrow {
	refreshOf?: string;
	failures?: Record<string, {reason: string; at: number}>;
	assignment?: Assignment | BeaconAssignment;
	packagePlatform?: string;
	packageName?: string;
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
	collectionVersion?: 'scheduled-v1';
	reviewHeights?: Record<string, number>;
	assignmentVersion?: typeof ASSIGNMENT_VERSION | typeof AVAILABILITY_VERSION;
	availability?: Record<string, Lease>;
	community: CommunityState;
	network: string;
	supply: string;
	balances: Record<string, string>;
	escrows: Record<string, Escrow>;
	payouts: Payment[];
	revoked: string[];
}
/** Preserve historical genesis/replay. Production opts in through the signed activation event. */
export function freshPilot(governor: string, network: string, mode: 'legacy-v1' | typeof ASSIGNMENT_VERSION | typeof AVAILABILITY_VERSION = 'legacy-v1'): PilotState {
	return {
		...(mode !== 'legacy-v1' ? { assignmentVersion: mode } : {}),
		...(mode === AVAILABILITY_VERSION ? { availability: {} } : {}),
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
export const roundResult = (s: PilotState, r: Round) => {
	const assignment = s.escrows[r.id]?.assignment;
	const evaluated = assignment ? { ...r, observations: r.observations.filter(o => assignment.committee.includes(o.member)) } : r;
	return evaluate(evaluated, s.community, METRICS[r.metric]);
};
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
		packagePlatform: string;
		packageName: string;
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
		contribution: string;
		observedAt: number;
		until: number;
		beaconRound: number;
		beaconSignature: string;
		duration: number;
		refreshOf: string;
	};
	requireThat(e && typeof e === 'object' && e.network === previous.network, 'Wrong network');
	requireThat(!previous.revoked.includes(e.actor), 'Signing key revoked');
	const s = JSON.parse(JSON.stringify(previous)) as PilotState;
	if (s.assignmentVersion === AVAILABILITY_VERSION) {
		for (const r of s.community.rounds) {
			const a = s.escrows[r.id]?.assignment;
			if (a?.version === AVAILABILITY_VERSION) s.escrows[r.id].assignment = advanceReserves(a, r, at);
		}
	}
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
			own(METRICS, e.metric) &&
				((e.metric === 'lib_contributor_count' &&
					e.source === 'Libraries.io REST' &&
					e.method === 'libraries-repository-v1') ||
					(e.metric.startsWith('lib_') &&
						e.metric !== 'lib_contributor_count' &&
						e.source === 'Libraries.io REST' &&
						e.method === 'libraries-project-v1') ||
					(!e.metric.startsWith('lib_') &&
						e.source === 'GitHub REST' &&
						e.method === 'github-rest-v1')),
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
		if (e.metric.startsWith('lib_') && e.metric !== 'lib_contributor_count') {
			requireThat(
				typeof e.packagePlatform === 'string' &&
					/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(e.packagePlatform) &&
					typeof e.packageName === 'string' &&
					e.packageName.length > 0 &&
					e.packageName.length <= 200 &&
					!/[\s?#\\]/.test(e.packageName) &&
					e.packageName.split('/').every(p => p && p !== '.' && p !== '..') &&
					e.version !== 'latest',
				'Explicit registry package and exact version required',
			);
			requireThat(
				!Object.values(s.escrows).some(
					x =>
						x.repository === e.repository.toLowerCase() &&
						x.version === e.version &&
						x.packagePlatform &&
						(x.packagePlatform !== e.packagePlatform || x.packageName !== e.packageName),
				),
				'Conflicting registry mapping for repository/version',
			);
		}
		if (s.assignmentVersion) {
			const prior = s.community.rounds.filter(r => r.metric === e.metric && s.escrows[r.id]?.repository === e.repository.toLowerCase() && s.escrows[r.id]?.version === e.version).slice(-1)[0];
			if (s.collectionVersion) {
				requireThat(!prior ? e.refreshOf === undefined : prior.closed && e.refreshOf === prior.id && at >= prior.openedAt + 86400, 'Refresh requires the latest round and a 24-hour interval, regardless of outcome');
				requireThat(s.community.rounds.filter(r => !r.closed).length < 12, 'Active round capacity reached');
			} else requireThat(!prior, 'Fact already attempted; assignment redraws are forbidden');
			if (s.assignmentVersion === AVAILABILITY_VERSION) createBeaconAssignment(s.network, e.round, [e.repository.toLowerCase(), e.version, e.metric], s.community.members, s.revoked, s.availability ?? {}, at, height, e.duration);
			else createAssignment(s.network, e.round, [e.repository.toLowerCase(), e.version, e.metric], s.community.members, s.revoked, at, height);
		}
		const bounty = money(e.bounty);
		requireThat(bounty >= BigInt(3), 'Bounty must fund at least three contributors');
		requireThat(BigInt(s.balances[e.actor] ?? '0') >= bounty, 'Insufficient TrustCOIN balance');
	}
	if (e.kind === 'observe') {
		const assignment = s.escrows[e.round]?.assignment;
		if (assignment) {
			requireThat(assignment.committee.includes(e.actor), 'Observer is not assigned to this round');
			if (assignment.version === AVAILABILITY_VERSION) requireThat(canSubmit(assignment, e.actor, e.observedAt, at), 'Observer slot is not active');
			else requireThat(at >= assignment.revealUntil && e.observedAt >= assignment.revealUntil, 'Measurement window has not started');
			requireThat(!s.community.members.find(m => m.id === e.actor)?.suspended, 'Assigned observer is suspended');
		}
	}
	if (['transfer', 'revoke', 'activate-assignment', 'activate-availability', 'activate-collection', 'unavailable', 'availability', 'assignment-beacon', 'entropy-commit', 'entropy-reveal'].includes(e.kind)) {
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
		requireThat(e.kind === 'activate-collection' || s.community.audit.length < 10000, 'Event capacity reached');
		if (e.kind === 'activate-collection') {
			requireThat(e.actor === 'governor' && s.assignmentVersion === AVAILABILITY_VERSION && !s.collectionVersion, 'Governor may activate collection once after availability');
			requireThat(s.community.rounds.every(r => r.closed), 'Close existing rounds before activation');
			s.collectionVersion = 'scheduled-v1';
		} else if (e.kind === 'unavailable') {
			const r = s.community.rounds.find(x => x.id === e.round);
			const escrow = s.escrows[e.round];
			requireThat(s.collectionVersion && r && !r.closed && escrow?.assignment?.version === AVAILABILITY_VERSION, 'Active collection required');
			requireThat(canSubmit(escrow.assignment, e.actor, at, at), 'Only the active observer may report unavailability');
			requireThat(!escrow.failures?.[e.actor] && !r.observations.some(o => o.member === e.actor), 'Collector status already reported');
			requireThat(['credentials-missing', 'rate-limited', 'access-denied', 'source-unavailable', 'source-incomplete'].includes(e.reason), 'Recognized source failure required');
			escrow.failures = {...escrow.failures, [e.actor]: {reason:e.reason, at}};
		} else if (e.kind === 'activate-availability') {
			requireThat(e.actor === 'governor' && s.assignmentVersion !== AVAILABILITY_VERSION, 'Governor may activate availability once');
			requireThat(s.community.rounds.every(r => r.closed), 'Close existing rounds before activation');
			s.assignmentVersion = AVAILABILITY_VERSION; s.availability = {};
		} else if (e.kind === 'availability') {
			requireThat(s.assignmentVersion === AVAILABILITY_VERSION, 'Availability policy is not active');
			requireThat(s.community.members.some(m => m.id === e.actor && !m.suspended), 'Active contributor required');
			requireThat(Number.isSafeInteger(e.until) && (e.until === 0 || (e.until > at && e.until <= at + LEASE_SECONDS)), 'Invalid availability expiry');
			s.availability = s.availability ?? {}; s.availability[e.actor] = {until: e.until, height};
		} else if (e.kind === 'assignment-beacon') {
			requireThat(s.community.members.some(m => m.id === e.actor && !m.suspended), 'Active contributor required');
			const r = s.community.rounds.find(x => x.id === e.round);
			const escrow = s.escrows[e.round];
			requireThat(r && !r.closed && escrow?.assignment?.version === AVAILABILITY_VERSION, 'Beacon assignment required');
			escrow.assignment = acceptBeacon(escrow.assignment, e.beaconRound, e.beaconSignature, at, height);
			r.closesAt = at + escrow.assignment.window * (escrow.assignment.pool.length - 2);
		} else if (e.kind === 'activate-assignment') {
			requireThat(e.actor === 'governor' && !s.assignmentVersion, 'Governor may activate assignment once');
			requireThat(Object.values(s.escrows).every(escrow => escrow.settled), 'Settle all legacy escrows before activation');
			s.assignmentVersion = ASSIGNMENT_VERSION;
		} else if (e.kind === 'entropy-commit' || e.kind === 'entropy-reveal') {
			const round = s.community.rounds.find(r => r.id === e.round);
			const assignment = s.escrows[e.round]?.assignment;
			requireThat(round && !round.closed && assignment?.version === ASSIGNMENT_VERSION, 'Assigned round required');
			// Frozen participants may finish entropy after suspension; revocation still rejects their signatures.
			s.escrows[e.round].assignment = contribute(assignment, e.actor, e.kind, e.contribution, at, height);
		} else if (e.kind === 'transfer') {
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
			let assignment: Assignment | BeaconAssignment | undefined;
			if (s.assignmentVersion === AVAILABILITY_VERSION) assignment = createBeaconAssignment(s.network, e.round, [e.repository.toLowerCase(), e.version, e.metric], s.community.members, s.revoked, s.availability ?? {}, at, height, e.duration);
			else if (s.assignmentVersion) assignment = createAssignment(s.network, e.round, [e.repository.toLowerCase(), e.version, e.metric], s.community.members, s.revoked, at, height);
			if (assignment) {
				const opened = s.community.rounds.find(r => r.id === e.round);
				requireThat(opened, 'Round missing');
				if (assignment.version === AVAILABILITY_VERSION) opened.closesAt = assignment.beaconDeadline;
				else opened.closesAt += assignment.revealUntil - at;
			}
			const bounty = money(e.bounty);
			s.balances[e.actor] = (BigInt(s.balances[e.actor]) - bounty).toString();
			s.escrows[e.round] = {
				...(assignment ? { assignment } : {}),
				...(s.collectionVersion && e.refreshOf ? {refreshOf:e.refreshOf} : {}),
				sponsor: e.actor,
				bounty: e.bounty,
				repository: e.repository.toLowerCase(),
				version: e.version,
				...(e.method === 'libraries-project-v1'
					? { packagePlatform: e.packagePlatform, packageName: e.packageName }
					: {}),
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
	if (s.collectionVersion) s.reviewHeights = Object.fromEntries(memberReviewHeights(s));
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
		if (escrow.assignment?.version === AVAILABILITY_VERSION) {
			escrow.assignment = advanceReserves(escrow.assignment, round, at);
		}
		const assignmentComplete = escrow.assignment?.version === AVAILABILITY_VERSION && escrow.assignment.seed !== null && (round.observations.length === 3 || escrow.assignment.committee.length < 3);
		// Automatic closure preserves the planned deadline and records actual closure in escrow.
		if (!round.closed && (at > round.closesAt || assignmentComplete)) {
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
						.sort((a, b) => {
							if (a === b) return 0;
							return a < b ? -1 : 1;
						})
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
// Reviews can change a contributor's eligibility across rounds. Index them once so
// unrelated mining and transfers do not invalidate an already finalized result.
function memberReviewHeights(s: PilotState): Map<string, number> {
	const incidents = new Map(s.community.incidents.map(i => [i.id, i]));
	const heights = new Map<string, number>(Object.entries(s.reviewHeights ?? {}));
	for (const audit of s.community.audit) {
		let member: string | undefined;
		if (audit.kind === 'substantiate') member = incidents.get(audit.id)?.member;
		else if (audit.kind === 'overturn') {
			const event = JSON.parse(audit.payload) as { incident: string };
			member = incidents.get(event.incident)?.member;
		} else if (audit.kind === 'reinstate' || audit.kind === 'revoke') {
			const event = JSON.parse(audit.payload) as { member: string };
			member = event.member;
		}
		if (member) heights.set(member, Math.max(heights.get(member) ?? 0, audit.height));
	}
	return heights;
}
function confirmationHeight(s: PilotState, r: Round, reviews: Map<string, number>): number | null {
	const closedHeight = s.escrows[r.id]?.closedHeight;
	if (!r.closed || closedHeight == null) return null;
	// Include every observer: reinstating a former non-supporter can change agreement.
	return r.observations.reduce((height, o) => Math.max(height, reviews.get(o.member) ?? 0), closedHeight);
}
export function pilotView(s: PilotState, at: number) {
	let version = s.assignmentVersion ? 'pilot-assignment-v2' : 'pilot-v1';
	if (s.assignmentVersion === AVAILABILITY_VERSION) version = 'pilot-availability-v3';
	const reviews = memberReviewHeights(s);
	return {
		network: s.network,
		policy: { version, ...(s.collectionVersion ? {collection:s.collectionVersion, refreshSeconds:86400} : {}), assignment: s.assignmentVersion ?? 'self-selected-legacy', contributors: 3, delaySeconds: DELAY, tolerances: METRICS },
		...(s.assignmentVersion === AVAILABILITY_VERSION ? { availability: s.availability, availableContributors: availableMembers(s.community.members, s.revoked, s.availability ?? {}, at).length } : {}),
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
			confirmationHeight: confirmationHeight(s, r, reviews),
			assignment: s.escrows[r.id]?.assignment,
			...(s.escrows[r.id]?.assignment?.version === AVAILABILITY_VERSION ? { assignmentPhase: assignmentPhase(s.escrows[r.id].assignment as BeaconAssignment, r, at) } : {}),
			escrow: s.escrows[r.id],
		})),
		audit: s.community.audit,
		...(s.collectionVersion ? {auditOffset:s.community.auditOffset ?? 0, auditCount:(s.community.auditOffset ?? 0)+s.community.audit.length} : {}),
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
	const reviews = memberReviewHeights(s);
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
		if (!previous || r.openedAt > previous.openedAt) latest.set(r.metric, r);
	}
	return [...latest.values()].flatMap(r => {
		const height = confirmationHeight(s, r, reviews);
		if (height === null || height > finalizedHeight) return [];
		const v = roundResult(s, r);
		return v.status === 'verified'
			? [{ fact: r.metric, factData: String(v.value), round: r.id }]
			: [];
	});
}
