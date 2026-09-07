import { verify, createPublicKey } from 'crypto';

export const POLICY = { version: 'prototype-v1', contributors: 3, absolute: 5, relativeBps: 200, window: 30 * 86400, flag: 3, suspend: 5 };
export interface Member { id: string; key: string; operator: string; githubId: string; suspended: boolean; reinstatedAt: number }
export interface Observation { id: string; member: string; value: number; observedAt: number; receivedAt: number; eligible: boolean }
export interface Round { id: string; package: string; metric: string; source: string; method: string; openedAt: number; closesAt: number; closed: boolean; observations: Observation[]; result?: Result }
export interface Result { status: 'pending' | 'verified' | 'disputed' | 'expired'; supporters: string[]; conflicts: string[]; value: number | null }
export interface Incident { id: string; member: string; round: string; observation: string; cause: string; evidence: string; reason: string; at: number; overturned: boolean }
export interface Audit { id: string; kind: string; actor: string; at: number; height: number; payload: string; signature: string }
export interface CommunityState { governor: string; members: Member[]; rounds: Round[]; incidents: Incident[]; audit: Audit[] }
export const initialState = (governor: string): CommunityState => ({ governor, members: [], rounds: [], incidents: [], audit: [] });
function fail(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 2000;
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
export function incidentCount(s: CommunityState, id: string, at: number): number {
    const member = s.members.find(m => m.id === id);
    const incidents = s.incidents.filter(i => i.member === id && !i.overturned && i.at >= at - POLICY.window && i.at > (member?.reinstatedAt ?? -1));
    // A collector failure and a verification round can each contribute at most one incident.
    const causes = new Set<string>(); const rounds = new Set<string>(); let count = 0;
    for (const i of incidents) if (!causes.has(i.cause) && !rounds.has(i.round)) { causes.add(i.cause); rounds.add(i.round); count += 1; }
    return count;
}
export function standing(s: CommunityState, id: string, at: number): string {
    if (s.members.find(m => m.id === id)?.suspended) return 'suspended';
    return incidentCount(s, id, at) >= POLICY.flag ? 'review' : 'active';
}
const compatible = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(POLICY.absolute, Math.floor(Math.max(a, b) * POLICY.relativeBps / 10000));
export function evaluate(round: Round, state: CommunityState): Result {
    const eligible = round.observations.filter(o => o.eligible && !state.members.find(m => m.id === o.member)?.suspended && !state.incidents.some(i => i.observation === o.id && !i.overturned));
    const sorted = [...eligible].sort((a, b) => {
        if (a.value !== b.value) return a.value - b.value;
        if (a.id === b.id) return 0;
        return a.id < b.id ? -1 : 1;
    });
    const groups: Observation[][] = [];
    for (let i = 0; i < sorted.length; i += 1) {
        const group: Observation[] = [];
        for (let j = i; j < sorted.length; j += 1) {
            if (!group.every(o => compatible(o.value, sorted[j].value))) break;
            group.push(sorted[j]);
        }
        if (group.length >= POLICY.contributors) groups.push(group);
    }
    // Overlapping but different quorums are ambiguous too: never choose one by arrival order.
    const maximal = groups.filter(g => !groups.some(h => h.length > g.length && g.every(o => h.includes(o))));
    if (maximal.length !== 1) {
        let status: Result['status'] = round.closed ? 'expired' : 'pending';
        if (maximal.length > 1 || eligible.length >= POLICY.contributors) status = 'disputed';
        return { status, supporters: [], conflicts: eligible.map(o => o.id), value: null };
    }
    const g = maximal[0];
    return { status: 'verified', supporters: g.map(o => o.id), conflicts: eligible.filter(o => !g.includes(o)).map(o => o.id), value: g[Math.floor(g.length / 2)].value };
}

/** Signed events use exact UTF-8 payload bytes, domain separated from other protocols. */
export function applyEvent(original: CommunityState, payload: string, signature: string, at: number, height = 0): CommunityState {
    fail(Buffer.byteLength(payload) <= 12000, 'Event too large');
    fail(original.audit.length < 10000, 'Prototype event capacity reached');
    const e = JSON.parse(payload) as { id: string; kind: string; actor: string; member: string; key: string; operator: string; githubId: string; accountCreatedAt: number; evidence: string; round: string; package: string; metric: string; source: string; method: string; duration: number; value: number; observedAt: number; observation: string; cause: string; reason: string; incident: string };
    fail(e && typeof e === 'object' && !Array.isArray(e), 'Event object required');
    fail(text(e.id) && text(e.kind) && text(e.actor), 'Missing event identity');
    fail(!original.audit.some(a => a.id === e.id), 'Duplicate event');
    const admin = e.actor === 'governor';
    const member = original.members.find(m => m.id === e.actor);
    const key = admin ? original.governor : member?.key;
    fail(key, 'Unknown signing identity');
    fail(verify(null, Buffer.from(`TrustSECO-community-v1\n${payload}`), createPublicKey(key), Buffer.from(signature, 'base64')), 'Invalid signature');
    const s = JSON.parse(JSON.stringify(original)) as CommunityState;
    const requireAdmin = () => fail(admin, 'Review authority required');
    if (e.kind === 'enrol') {
        requireAdmin();
        fail(text(e.member) && e.member !== 'governor' && text(e.key) && text(e.operator) && text(e.githubId), 'Invalid enrolment');
        fail(integer(e.accountCreatedAt) && e.accountCreatedAt <= at - 180 * 86400, 'Account must be at least 180 days old');
        fail(text(e.evidence), 'Admission evidence required');
        fail(createPublicKey(e.key).asymmetricKeyType === 'ed25519', 'Ed25519 key required');
        const canonicalKey = createPublicKey(e.key).export({type: 'spki', format: 'pem'}).toString();
        fail(!s.members.some(m => m.id === e.member || m.key === canonicalKey || m.operator === e.operator || m.githubId === e.githubId), 'Identity or operator already enrolled');
        s.members.push({ id: e.member, key: canonicalKey, operator: e.operator, githubId: e.githubId, suspended: false, reinstatedAt: -1 });
    } else if (e.kind === 'open') {
        requireAdmin();
        fail(text(e.round) && text(e.package) && e.metric === 'github_stars' && text(e.source) && text(e.method), 'Invalid stars round');
        fail(integer(e.duration) && e.duration >= 10 && e.duration <= 3600, 'Window must be 10–3600 seconds');
        fail(!s.rounds.some(r => r.id === e.round), 'Round already exists');
        s.rounds.push({ id: e.round, package: e.package, metric: e.metric, source: e.source, method: e.method, openedAt: at, closesAt: at + e.duration, closed: false, observations: [] });
    } else if (e.kind === 'observe') {
        fail(member, 'Enrolled contributor required');
        const r = s.rounds.find(x => x.id === e.round);
        fail(r && !r.closed && at <= r.closesAt, 'Round closed or unknown');
        fail(integer(e.value) && e.value <= 1000000000, 'Invalid star count');
        fail(integer(e.observedAt) && e.observedAt >= r.openedAt && e.observedAt <= at, 'Observation outside round or in future');
        fail(e.source === r.source && e.method === r.method, 'Incomparable source or method');
        fail(!r.observations.some(o => o.member === e.actor), 'Contributor already observed this round');
        r.observations.push({ id: e.id, member: e.actor, value: e.value, observedAt: e.observedAt, receivedAt: at, eligible: !member.suspended });
    } else if (e.kind === 'close') {
        requireAdmin(); const r = s.rounds.find(x => x.id === e.round);
        fail(r && !r.closed && at > r.closesAt, 'Round must expire before closure');
        r.closed = true; r.result = evaluate(r, s);
    } else if (e.kind === 'substantiate') {
        requireAdmin();
        const r = s.rounds.find(x => x.id === e.round);
        const o = r?.observations.find(x => x.id === e.observation);
        fail(o && r?.closed, 'Review must reference an observation in a closed round');
        fail(text(e.cause) && text(e.evidence) && text(e.reason), 'Cause, evidence and reason required; disagreement alone is insufficient');
        fail(!s.incidents.some(i => i.observation === e.observation && !i.overturned), 'Observation already reviewed');
        s.incidents.push({ id: e.id, member: o.member, round: r.id, observation: o.id, cause: e.cause, evidence: e.evidence, reason: e.reason, at, overturned: false });
        if (incidentCount(s, o.member, at) >= POLICY.suspend) s.members.find(m => m.id === o.member)!.suspended = true;
    } else if (e.kind === 'appeal') {
        fail(member && text(e.reason), 'Contributor and appeal reason required');
        fail(s.incidents.some(i => i.id === e.incident && i.member === e.actor), 'Cannot appeal another contributor’s incident');
    } else if (e.kind === 'overturn') {
        requireAdmin(); fail(text(e.reason), 'Reason required');
        const incident = s.incidents.find(i => i.id === e.incident); fail(incident && !incident.overturned, 'Unknown or already overturned incident');
        incident.overturned = true;
    } else if (e.kind === 'reinstate') {
        requireAdmin(); fail(text(e.reason), 'Reason required');
        const m = s.members.find(x => x.id === e.member); fail(m?.suspended, 'Member not suspended');
        m.suspended = false; m.reinstatedAt = at;
    } else throw new Error('Unknown event kind');
    s.audit.push({ id: e.id, kind: e.kind, actor: e.actor, at, height, payload, signature });
    return s;
}

export function view(s: CommunityState, at: number) {
    const rounds = s.rounds.map(r => ({ ...r, recordedResult: r.result, result: evaluate(r, s) }));
    const members = s.members.map(m => ({ id: m.id, operator: m.operator, standing: standing(s, m.id, at), incidents: incidentCount(s, m.id, at), observations: s.rounds.flatMap(r => r.observations).filter(o => o.member === m.id).length,
        rewardEligibleObservations: rounds.filter(r => r.closed && r.result?.status === 'verified').flatMap(r => r.observations.filter(o => o.member === m.id && r.result.supporters.includes(o.id))).length }));
    return { policy: POLICY, members, rounds, incidents: s.incidents, audit: s.audit, at };
}
