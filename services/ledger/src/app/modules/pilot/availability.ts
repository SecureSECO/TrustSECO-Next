import { createHash } from 'crypto';
import { bls12_381 as bls } from '@noble/curves/bls12-381';
import * as network from './beacon-network.json';
import { Member, Round } from '../community/policy';

export const AVAILABILITY_VERSION = 'availability-beacon-v1';
export const LEASE_SECONDS = 900;
export const BEACON_LEAD_SECONDS = 180;
export const BEACON_WAIT_SECONDS = 600;
export interface Lease { until: number; height: number }
export interface Slot { member: string; from: number; until: number; replaced: boolean }
export interface BeaconAssignment {
    version: typeof AVAILABILITY_VERSION;
    context: string;
    pool: { id: string; operator: string }[];
    openedHeight: number;
    beaconRound: number;
    beaconTime: number;
    beaconDeadline: number;
    beaconSignature: string | null;
    assignedHeight: number | null;
    window: number;
    seed: string | null;
    order: string[];
    nextReserve: number;
    slots: Slot[];
    committee: string[];
}
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
export function availableMembers(members: Member[], revoked: string[], leases: Record<string, Lease>, at: number) {
    return members.filter(m => !m.suspended && !revoked.includes(m.id) && leases[m.id]?.until > at)
        .map(m => ({ id: m.id, operator: m.operator }))
        .sort((a, b) => { if (a.id === b.id) return 0; return a.id < b.id ? -1 : 1; });
}
export function createBeaconAssignment(networkID: string, round: string, fact: string[], members: Member[], revoked: string[], leases: Record<string, Lease>, at: number, height: number, window: number): BeaconAssignment {
    const pool = availableMembers(members, revoked, leases, at);
    check(pool.length >= 3, 'Waiting for contributors: at least three available operators required');
    check(new Set(pool.map(m => m.id)).size === pool.length && new Set(pool.map(m => m.operator)).size === pool.length, 'Duplicate assignment operators');
    check(Number.isSafeInteger(window) && window >= 120 && window <= 3600, 'Response window must be 120–3600 seconds');
    const beaconRound = Math.ceil((at + BEACON_LEAD_SECONDS - network.genesis_time) / network.period) + 1;
    const beaconTime = network.genesis_time + (beaconRound - 1) * network.period;
    return {version: AVAILABILITY_VERSION, pool, openedHeight: height, beaconRound, beaconTime,
        beaconDeadline: beaconTime + BEACON_WAIT_SECONDS, window,
        context: hash(JSON.stringify([AVAILABILITY_VERSION, networkID, round, fact, pool, beaconRound])),
        seed: null, order: [], committee: [], slots: [], nextReserve: 3, assignedHeight: null, beaconSignature: null};
}
export function verifyBeacon(round: number, signature: string): boolean {
    if (!Number.isSafeInteger(round) || round < 1 || typeof signature !== 'string' || !/^[a-f0-9]{96}$/.test(signature)) return false;
    const bytes = Buffer.alloc(8); bytes.writeBigUInt64BE(BigInt(round));
    try {
        return bls.verifyShortSignature(signature, Buffer.from(hash(bytes), 'hex'), network.public_key);
    } catch { return false; }
}
// The entire reserve order is determined once, without modulo bias.
export function reserveOrder(seed: string, members: string[]): string[] {
    const order = [...members]; let counter = 0;
    for (let i = 0; i < order.length - 1; i += 1) {
        const n = BigInt(order.length - i);
        const space = BigInt(2) ** BigInt(256);
        const limit = space - space % n;
        let sample: bigint;
        do { sample = BigInt(`0x${hash(JSON.stringify(['TrustSECO-reserves-v1', seed, counter]))}`); counter += 1; } while (sample >= limit);
        const j = i + Number(sample % n); [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
}
export function acceptBeacon(a: BeaconAssignment, round: number, signature: string, at: number, height: number): BeaconAssignment {
    check(!a.seed, 'Assignment already determined');
    check(round === a.beaconRound && at >= a.beaconTime && at <= a.beaconDeadline, 'Wrong beacon round or outside beacon window');
    check(verifyBeacon(round, signature), 'Invalid drand signature');
    const next = JSON.parse(JSON.stringify(a)) as BeaconAssignment;
    next.beaconSignature = signature; next.assignedHeight = height;
    next.seed = hash(JSON.stringify(['TrustSECO-beacon-seed-v1', a.context, hash(Buffer.from(signature, 'hex'))]));
    next.order = reserveOrder(next.seed, a.pool.map(m => m.id));
    next.slots = next.order.slice(0, 3).map(member => ({member, from: at, until: at + a.window, replaced: false}));
    next.committee = next.order.slice(0, 3);
    return next;
}
// Deadlines, not result values, advance the fixed reserve order. Submitted evidence
// occupies its slot even if disputed, reviewed, or the identity is later revoked.
export function advanceReserves(a: BeaconAssignment, r: Round, at: number): BeaconAssignment {
    if (!a.seed || r.closed) return a;
    const next = JSON.parse(JSON.stringify(a)) as BeaconAssignment;
    for (;;) {
        const missing = next.slots.filter(slot => !slot.replaced && at > slot.until && !r.observations.some(o => o.member === slot.member))
            .sort((x, y) => x.until - y.until || next.order.indexOf(x.member) - next.order.indexOf(y.member));
        const slot = missing[0];
        if (!slot) break;
        slot.replaced = true;
        if (next.nextReserve < next.order.length) {
            const member = next.order[next.nextReserve]; next.nextReserve += 1;
            next.slots.push({member, from: slot.until + 1, until: slot.until + next.window, replaced: false});
        }
    }
    next.committee = next.slots.filter(slot => !slot.replaced).map(slot => slot.member);
    return next;
}
export function canSubmit(a: BeaconAssignment, actor: string, observedAt: number, at: number): boolean {
    return a.slots.some(slot => !slot.replaced && slot.member === actor && at >= slot.from && at <= slot.until && observedAt >= slot.from && observedAt <= at);
}
export function assignmentPhase(a: BeaconAssignment, r: Round, at: number): string {
    if (r.closed) {
        if (r.result?.status === 'verified' || r.result?.status === 'disputed') return r.result.status;
        return 'insufficient-contributors';
    }
    if (!a.seed) return at <= a.beaconDeadline ? 'waiting-for-beacon' : 'beacon-unavailable';
    if (r.observations.length === 3) return 'awaiting-closure';
    if (a.committee.length < 3) return 'insufficient-contributors';
    return a.nextReserve > 3 ? 'collecting-with-reserves' : 'collecting';
}
