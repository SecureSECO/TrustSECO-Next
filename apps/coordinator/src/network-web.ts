// Advertisements are optional and untrusted. Never fetch their URLs server-side.
export function safeWebURL(value: unknown): string | null {
    if (typeof value !== 'string' || value.length > 2048) return null;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash ? url.href : null;
    } catch { return null; }
}
export async function networkSnapshot(client: any, node: any) {
    const peers = await client.node.getConnectedPeers();
    let web: any = null;
    try { web = await client.invoke('network_getWebInterfaces'); } catch { /* Older ledger: no advertised web interfaces. */ }
    return {
        observedAt: new Date().toISOString(),
        local: {height: node.height, finalizedHeight: node.finalizedHeight, syncing: node.syncing, webURL: safeWebURL(web?.local?.webURL)},
        peers: peers.map((peer: any) => ({address: peer.ipAddress, port: peer.port,
            webURL: safeWebURL(web?.peers?.find((p: any) => p.address === peer.ipAddress && p.port === peer.port)?.webURL)})),
    };
}
