// A recovered fork can leave expired leases occupying the relayer's next nonce.
// Never displace an unexpired request or a payment to make room for new work.
export async function recoverExpiredLease(client: any, signed: any, transportKey: string) {
    const pool = await client.invoke('txpool_getTransactionsFromPool', {});
    const sender = typeof signed.senderPublicKey === 'string' ? signed.senderPublicKey : Buffer.from(signed.senderPublicKey).toString('hex');
    const queued = pool.find((t: any) => t.senderPublicKey === sender && BigInt(t.nonce) === BigInt(signed.nonce));
    if (!queued || queued.module !== 'pilot' || queued.command !== 'record') throw Error('Relayer nonce occupied; waiting for pending transaction');
    const old = client.transaction.fromJSON(queued);
    const event = JSON.parse(old.params.payload);
    const node = await client.node.getNodeInfo();
    const finalized = await client.block.getByHeight(node.finalizedHeight);
    if (event.kind !== 'availability' || !Number.isSafeInteger(event.until) || event.until <= 0 || event.until > finalized.header.timestamp) {
        throw Error('Relayer nonce occupied by a pending request; retry later');
    }
    const minimum = BigInt(signed.fee);
    const fee = BigInt(queued.fee) + 10n > minimum ? BigInt(queued.fee) + 10n : minimum;
    if (fee > minimum + 1000000n) throw Error('Stale transaction replacement exceeds fee allowance');
    const replacement = await client.transaction.create({module:signed.module, command:signed.command, nonce:signed.nonce, params:signed.params, fee}, transportKey);
    await client.transaction.send(replacement);
    return replacement;
}
