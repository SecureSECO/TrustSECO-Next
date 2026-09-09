import { createHash } from 'crypto';
import { JsonStore, loadState, saveState, migrateState, legacyKey } from '../community/storage';
import { Audit } from '../community/policy';
import { PilotState, Payment, Escrow } from './policy';
import { AVAILABILITY_VERSION } from './availability';
import { ASSIGNMENT_VERSION } from './assignment';

const key = (s: string) => Buffer.from(`pilot:${s}`);
export const AUDIT_WINDOW = 256;
interface Meta {
	collectionVersion?: 'scheduled-v1';
	reviewHeights?: Record<string, number>;
	assignmentVersion?: PilotState['assignmentVersion'];
	network: string;
	supply: string;
	payoutCount: number;
	revoked: string[];
}
export async function loadPilot<C>(store: JsonStore<C>, ctx: C): Promise<PilotState> {
	const read = async <T>(id: string) => JSON.parse((await store.get(ctx, key(id))).json) as T;
	const meta = await read<Meta>('meta');
	if (meta.collectionVersion !== undefined && meta.collectionVersion !== 'scheduled-v1') throw new Error('Unsupported collection policy');
	const community = await loadState(store, ctx, meta.collectionVersion ? AUDIT_WINDOW : undefined);
	if (meta.assignmentVersion !== undefined && meta.assignmentVersion !== ASSIGNMENT_VERSION && meta.assignmentVersion !== AVAILABILITY_VERSION) throw new Error('Unsupported assignment policy');
	const s: PilotState = {
		community,
		...(meta.collectionVersion ? {collectionVersion:meta.collectionVersion, reviewHeights:meta.reviewHeights ?? {}} : {}),
		...(meta.assignmentVersion ? { assignmentVersion: meta.assignmentVersion } : {}),
		network: meta.network,
		supply: meta.supply,
		revoked: meta.revoked,
		balances: {},
		escrows: {},
		payouts: [],
	};
	if (meta.assignmentVersion === AVAILABILITY_VERSION) s.availability = await read<NonNullable<PilotState['availability']>>('availability');
	for (const id of ['governor', ...community.members.map(m => m.id)])
		s.balances[id] = await read<string>(`balance:${id}`);
	for (const r of community.rounds) s.escrows[r.id] = await read<Escrow>(`escrow:${r.id}`);
	for (let i = 0; i < meta.payoutCount; i += 1) s.payouts.push(await read<Payment>(`payout:${i}`));
	return s;
}
function records(s: PilotState) {
	const r = new Map<string, string>();
	r.set(
		'meta',
		JSON.stringify({
			...(s.collectionVersion ? {collectionVersion:s.collectionVersion, reviewHeights:s.reviewHeights ?? {}} : {}),
			...(s.assignmentVersion ? { assignmentVersion: s.assignmentVersion } : {}),
			network: s.network,
			supply: s.supply,
			payoutCount: s.payouts.length,
			revoked: s.revoked,
		}),
	);
	if (s.availability) r.set('availability', JSON.stringify(s.availability));
	for (const [id, b] of Object.entries(s.balances)) r.set(`balance:${id}`, JSON.stringify(b));
	for (const [id, e] of Object.entries(s.escrows)) r.set(`escrow:${id}`, JSON.stringify(e));
	s.payouts.forEach((p, i) => r.set(`payout:${i}`, JSON.stringify(p)));
	return r;
}
export async function savePilot<C>(store: JsonStore<C>, ctx: C, old: PilotState, next: PilotState) {
	await saveState(store, ctx, old.community, next.community);
	if (next.collectionVersion) {
		const start = old.collectionVersion ? old.community.audit.length : 0;
		for (let i=start; i<next.community.audit.length; i+=1) await store.set(ctx, eventKey(next.community.audit[i].id), {json:JSON.stringify((next.community.auditOffset ?? 0)+i)});
	}
	const previous = records(old);
	for (const [id, json] of records(next))
		if (previous.get(id) !== json) await store.set(ctx, key(id), { json });
}
export async function initPilot<C>(store: JsonStore<C>, ctx: C, state: PilotState) {
	await store.set(ctx, legacyKey, { json: JSON.stringify(state.community) });
	await migrateState(store, ctx);
	for (const [id, json] of records(state)) await store.set(ctx, key(id), { json });
}

const eventKey = (id: string) => key(`event:${createHash('sha256').update(id).digest('hex')}`);
export async function recordedEvent<C>(store: JsonStore<C>, ctx: C, id: string): Promise<Audit | null> {
	if (typeof id !== 'string' || !id.length || id.length > 2000) throw new Error('Event ID required');
	if (await store.has(ctx, eventKey(id))) {
		const position = JSON.parse((await store.get(ctx,eventKey(id))).json) as number;
		const event = JSON.parse((await store.get(ctx,Buffer.from(`audit:${position}`))).json) as Audit;
		if(event.id !== id) throw new Error('Event index mismatch');
		return event;
	}
	const meta = JSON.parse((await store.get(ctx,key('meta'))).json) as Meta;
	if (meta.collectionVersion) return null;
	return (await loadState(store,ctx)).audit.find(a=>a.id === id) ?? null;
}

export async function auditPage<C>(store: JsonStore<C>, ctx: C, before?: number) {
	const meta = JSON.parse((await store.get(ctx, Buffer.from('layout:v1'))).json) as {audit: number};
	const cursor=before ?? meta.audit;
	if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > meta.audit) throw new Error('Invalid audit cursor');
	const from=Math.max(0,cursor-200); const events: Audit[]=[];
	for(let i=cursor-1;i>=from;i-=1)events.push(JSON.parse((await store.get(ctx,Buffer.from(`audit:${i}`))).json) as Audit);
	return {events,total:meta.audit,nextCursor:from>0?from:null};
}
