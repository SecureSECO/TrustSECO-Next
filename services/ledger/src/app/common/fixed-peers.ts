import { lookup } from 'dns/promises';
import { seedPeers, SeedPeer } from './seed-peers';

/** Explicit operator-controlled peers only. The SDK does not resolve fixed-peer DNS. */
export async function fixedPeers(value: string | undefined, self: string | undefined, resolve = async (host: string) => lookup(host, {family: 4})): Promise<SeedPeer[] | undefined> {
    if (!value?.trim()) return undefined;
    const peers = seedPeers([], {seedPeers: value, nodeAddress: self});
    const result: SeedPeer[] = [];
    for (const peer of peers) {
        const {address} = await resolve(peer.ip);
        if (!result.some(p => p.ip === address && p.port === peer.port)) result.push({ip:address,port:peer.port});
    }
    return result;
}
