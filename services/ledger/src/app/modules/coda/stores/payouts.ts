import { Modules } from 'klayr-sdk';

export interface Payout { uid: string; amount: string; jobID: number; package: string; version: string; height: number; timestamp: number }
export class PayoutStore extends Modules.BaseStore<{ json: string }> {
    public schema = { $id: 'coda/payoutHistory', type: 'object', required: ['json'], properties: { json: { dataType: 'string', fieldNumber: 1 } } };
}
export const payoutKey = Buffer.alloc(0);
export const paidKey = (jobID: number, uid: string) => Buffer.from(`paid:${jobID}:${uid}`);
const entryKey = (id: bigint) => Buffer.from(`entry:${id.toString()}`);
type Store = Pick<PayoutStore, 'has' | 'get' | 'set'>;
export async function appendPayout(store: Store, ctx: Parameters<PayoutStore['set']>[0], payout: Payout) {
    const total = await store.has(ctx, payoutKey) ? BigInt((await store.get(ctx, payoutKey)).json) : BigInt(0);
    const id = total + BigInt(1);
    await store.set(ctx, entryKey(id), { json: JSON.stringify({ ...payout, id: id.toString() }) });
    await store.set(ctx, paidKey(payout.jobID, payout.uid), { json: id.toString() });
    await store.set(ctx, payoutKey, { json: id.toString() });
}
/** Cursor is exclusive; old records remain available without loading the entire history. */
export async function readPayouts(store: Store, ctx: Parameters<PayoutStore['get']>[0], before?: string) {
    const total = await store.has(ctx, payoutKey) ? BigInt((await store.get(ctx, payoutKey)).json) : BigInt(0);
    if (before !== undefined && !/^[1-9][0-9]{0,39}$/.test(before)) throw new Error('Invalid payout cursor');
    let id = before === undefined ? total : BigInt(before) - BigInt(1);
    if (id > total) id = total;
    const payouts: (Payout & { id: string })[] = [];
    while (id > BigInt(0) && payouts.length < 200) {
        payouts.push(JSON.parse((await store.get(ctx, entryKey(id))).json) as Payout & { id: string });
        id -= BigInt(1);
    }
    return { payouts, nextCursor: id > BigInt(0) ? (id + BigInt(1)).toString() : null, total: total.toString(), historicalBackfill: false };
}
