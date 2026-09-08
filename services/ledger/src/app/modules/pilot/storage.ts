import { JsonStore, loadState, saveState, migrateState, legacyKey } from '../community/storage';
import { PilotState, Payment, Escrow } from './policy';

const key = (s: string) => Buffer.from(`pilot:${s}`);
interface Meta {
	network: string;
	supply: string;
	payoutCount: number;
	revoked: string[];
}
export async function loadPilot<C>(store: JsonStore<C>, ctx: C): Promise<PilotState> {
	const community = await loadState(store, ctx);
	const read = async <T>(id: string) => JSON.parse((await store.get(ctx, key(id))).json) as T;
	const meta = await read<Meta>('meta');
	const s: PilotState = {
		community,
		network: meta.network,
		supply: meta.supply,
		revoked: meta.revoked,
		balances: {},
		escrows: {},
		payouts: [],
	};
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
			network: s.network,
			supply: s.supply,
			payoutCount: s.payouts.length,
			revoked: s.revoked,
		}),
	);
	for (const [id, b] of Object.entries(s.balances)) r.set(`balance:${id}`, JSON.stringify(b));
	for (const [id, e] of Object.entries(s.escrows)) r.set(`escrow:${id}`, JSON.stringify(e));
	s.payouts.forEach((p, i) => r.set(`payout:${i}`, JSON.stringify(p)));
	return r;
}
export async function savePilot<C>(store: JsonStore<C>, ctx: C, old: PilotState, next: PilotState) {
	await saveState(store, ctx, old.community, next.community);
	const previous = records(old);
	for (const [id, json] of records(next))
		if (previous.get(id) !== json) await store.set(ctx, key(id), { json });
}
export async function initPilot<C>(store: JsonStore<C>, ctx: C, state: PilotState) {
	await store.set(ctx, legacyKey, { json: JSON.stringify(state.community) });
	await migrateState(store, ctx);
	for (const [id, json] of records(state)) await store.set(ctx, key(id), { json });
}
