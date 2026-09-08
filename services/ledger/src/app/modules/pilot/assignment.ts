import { createHash } from 'crypto';
import { Member } from '../community/policy';

/** This is a blocking commit/reveal protocol, NOT an always-available random beacon. */
export const ASSIGNMENT_VERSION = 'commit-reveal-v1';
export const ENTROPY_WINDOW = 300;
export interface Assignment {
    version: typeof ASSIGNMENT_VERSION;
    context: string;
    pool: { id: string; operator: string }[];
    openedHeight: number;
    commitmentHeights: Record<string, number>;
    commitUntil: number;
    revealUntil: number;
    commitments: Record<string, string>;
    reveals: Record<string, string>;
    committee: string[];
    seed: string | null;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const check = (ok: unknown, message: string): void => { if (!ok) throw new Error(message); };
const hex = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export function createAssignment(network: string, round: string, fact: string[], members: Member[], revoked: string[], at: number, height: number): Assignment {
    const pool = members.filter(m => !m.suspended && !revoked.includes(m.id))
        .map(m => ({ id: m.id, operator: m.operator }))
        .sort((a, b) => { if (a.id === b.id) return 0; return a.id < b.id ? -1 : 1; });
    check(pool.length >= 3, 'At least three eligible operators required');
    check(new Set(pool.map(m => m.operator)).size === pool.length && new Set(pool.map(m => m.id)).size === pool.length,
        'Assignment pool contains duplicate identities');
    return { version: ASSIGNMENT_VERSION,
        context: hash(JSON.stringify(['TrustSECO-assignment-context-v1', network, round, fact, pool, at, height])),
        pool, openedHeight: height, commitmentHeights: {}, commitUntil: at + ENTROPY_WINDOW, revealUntil: at + 2 * ENTROPY_WINDOW,
        commitments: {}, reveals: {}, committee: [], seed: null };
}
export function entropyCommitment(context: string, member: string, secret: string): string {
    check(hex(secret), 'Entropy must be 32 bytes of lowercase hex');
    return hash(JSON.stringify(['TrustSECO-entropy-v1', context, member, secret]));
}
/** Fisher-Yates sampling without replacement, with rejection to avoid modulo bias. */
export function committeeFromSeed(seed: string, pool: string[]): string[] {
    check(hex(seed) && pool.length >= 3 && new Set(pool).size === pool.length, 'Invalid draw inputs');
    const shuffled = [...pool]; let counter = 0;
    for (let i = 0; i < 3; i += 1) {
        const n = BigInt(shuffled.length - i);
        const space = BigInt(2) ** BigInt(256);
        const limit = space - space % n;
        let sample: bigint;
        do {
            sample = BigInt(`0x${hash(JSON.stringify(['TrustSECO-draw-v1', seed, counter]))}`);
            counter += 1;
        } while (sample >= limit);
        const j = i + Number(sample % n);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, 3);
}
/** Caller authenticates the signed event and stores the updated assignment atomically. */
export function contribute(a: Assignment, actor: string, kind: string, value: string, at: number, height: number): Assignment {
    const next = JSON.parse(JSON.stringify(a)) as Assignment;
    check(next.pool.some(m => m.id === actor), 'Not in frozen entropy pool');
    check(hex(value), 'Entropy contribution must be 32 bytes of lowercase hex');
    if (kind === 'entropy-commit') {
        check(at >= next.commitUntil - ENTROPY_WINDOW && at < next.commitUntil, 'Entropy commitment window ended or not started');
        check(!has(next.commitments, actor), 'Entropy already committed');
        next.commitments[actor] = value;
        next.commitmentHeights[actor] = height;
    } else {
        check(kind === 'entropy-reveal', 'Unknown entropy event');
        check(at >= next.commitUntil && at < next.revealUntil, 'Outside entropy reveal window');
        check(next.pool.every(m => has(next.commitments, m.id)), 'Every pool operator must commit before revealing');
        check(!has(next.reveals, actor), 'Entropy already revealed');
        check(entropyCommitment(next.context, actor, value) === next.commitments[actor], 'Entropy commitment mismatch');
        next.reveals[actor] = value;
        if (next.pool.every(m => has(next.reveals, m.id))) {
            next.seed = hash(JSON.stringify(['TrustSECO-seed-v1', next.context, next.pool.map(m => [m.id, next.reveals[m.id]])]));
            next.committee = committeeFromSeed(next.seed, next.pool.map(m => m.id));
        }
    }
    return next;
}
