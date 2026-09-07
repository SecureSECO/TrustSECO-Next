export interface SeedPeer { ip: string; port: number }
interface Options { profile?: string; nodeAddress?: string; seedPeers?: string }
const defaults = ['trustseco1.science.uu.nl:8000', 'trustseco2.science.uu.nl:8000'];
function parse(value: string): SeedPeer {
    const match = /^(\[[^\]]+\]|[^:\s]+):(\d+)$/.exec(value.trim());
    if (!match) throw new Error(`Invalid peer address: ${value}. Expected host:port.`);
    const port = Number(match[2]);
    if (port < 1 || port > 65535) throw new Error('Peer port must be between 1 and 65535');
    return { ip: match[1].replace(/^\[|\]$/g, '').toLowerCase(), port };
}
const identity = (peer: SeedPeer): string => `${peer.ip.toLowerCase()}:${peer.port}`;
/** Seeds are discovery contacts, never a special leader role. */
export function seedPeers(configured: SeedPeer[], options: Options): SeedPeer[] {
    const profile = options.profile ?? 'local';
    if (!['local', 'shared'].includes(profile)) throw new Error('TRUSTSECO_NETWORK must be local or shared');
    let peers = configured;
    if (options.seedPeers?.trim()) peers = options.seedPeers.split(',').map(parse);
    else if (profile === 'shared') peers = defaults.map(parse);
    const self = options.nodeAddress?.trim() ? identity(parse(options.nodeAddress)) : undefined;
    const seen = new Set<string>();
    return peers.filter(peer => {
        const key = identity(peer);
        if (key === self || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
