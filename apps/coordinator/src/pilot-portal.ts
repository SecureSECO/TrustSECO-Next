// Read-only projection of signed community work into the established portal API.
// Writes continue through the signed pilot protocol, never the legacy job/token routes.
import Router from 'koa-router';
import {queuedPackages, queueStatus} from './package-queue';
type Connect = <T>(work: (client: any) => Promise<T>) => Promise<T>;

export function packages(state: any) {
    const result = new Map<string, any>();
    for (const r of [...state.rounds].reverse()) {
        const repository = r.escrow.repository;
        if (!result.has(repository)) result.set(repository, { packageName: repository, packageOwner: repository.split('/')[0], packagePlatform: 'GitHub', packageReleases: [] });
        const item = result.get(repository);
        if (!item.packageReleases.includes(r.escrow.version)) item.packageReleases.push(r.escrow.version);
    }
    for (const p of state.catalog || []) {
        if (!result.has(p.repository)) result.set(p.repository, {packageName:p.repository, packageOwner:p.repository.split('/')[0], packagePlatform:p.platform, packageReleases:[]});
        const item = result.get(p.repository);
        if (!item.packageReleases.includes(p.version)) item.packageReleases.push(p.version);
    }
    return [...result.values()];
}
function resolve(state: any, name: string) {
    const all = packages(state);
    const exact = all.find(p => p.packageName === name);
    const matches = all.filter(p => p.packageName.split('/').at(-1) === name);
    const result = exact || (matches.length === 1 ? matches[0] : undefined);
    if (!result) throw Object.assign(Error('Package not found'), { status: 404 });
    return result;
}
export function measurements(state: any, repository: string, finalizedHeight: number) {
    // Match scoreInputs' conservative finality gate, including subsequent appeals/reviews.
    const reviewsFinal = state.audit.every((a: any) => a.height <= finalizedHeight);
    return state.rounds.flatMap((r: any, index: number) => r.escrow.repository !== repository ? [] : r.observations.map((o: any) => {
        const supported = r.result.status === 'verified' && r.result.supporters.includes(o.id);
        const confirmed = r.closed && supported && reviewsFinal && r.escrow.closedHeight <= finalizedHeight;
        const unverified = r.closed && !supported;
        return { packageName: repository, version: r.escrow.version, jobID: index + 1, fact: r.metric, factData: String(o.value), account: { uid: o.member },
            status: confirmed ? 'confirmed' : unverified ? 'unverified' : 'recorded', source: r.source,
            collectedAt: new Date(o.observedAt * 1000).toISOString(),
            scope: r.method === 'libraries-project-v1' ? `${r.escrow.packagePlatform}/${r.escrow.packageName} · ${r.metric === 'lib_dependency_count' ? 'Dependencies for version ' + r.escrow.version : 'Current package metadata, not a historical snapshot'}` : undefined,
            error: unverified ? 'This observation is recorded, but is not supported by the closed round’s community agreement.' : undefined,
        };
    }));
}
// Group one verification round while retaining every signed observation for inspection.
export function factGroups(state: any, repository: string, finalizedHeight: number) {
    const raw = measurements(state, repository, finalizedHeight);
    return state.rounds.flatMap((r: any, index: number) => {
        const observations = raw.filter(f => f.jobID === index + 1);
        if (!observations.length) return [];
        const latest = [...observations].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt)).at(-1);
        const confirmed = observations.filter(o => o.status === 'confirmed');
        return [{ ...latest, factData: r.result.status === 'verified' ? String(r.result.value) : latest.factData,
            status: confirmed.length ? 'confirmed' : r.closed && r.result.status !== 'verified' ? 'unverified' : 'recorded',
            account: {uid: ''}, assigned: !!r.assignment,
            error: r.closed && r.result.status !== 'verified' ? 'This round did not reach community agreement.' : undefined,
            confirmationCount: new Set(confirmed.map(o => o.account.uid)).size,
            agreement: r.result.status === 'verified',
            observations: observations.map(o => ({uid:o.account.uid,value:o.factData,collectedAt:o.collectedAt,status:o.status})),
        }];
    });
}
export async function scores(client: any, state: any, repository: string, version: string, finalizedHeight: number) {
    const latest = new Map<string, any>();
    for (const f of measurements(state, repository, finalizedHeight).filter((f: any) => f.version === version).sort((a: any, b: any) => a.collectedAt.localeCompare(b.collectedAt))) latest.set(f.fact, { fact: f.fact, factData: f.factData });
    const { facts } = await client.invoke('pilot_scoreInputs', { repository, version, finalizedHeight });
    const local = await client.invoke('trustfacts_calculateScoreForFacts', { facts: [...latest.values()] });
    const confirmed = await client.invoke('trustfacts_calculateScoreForFacts', { facts: facts.map(({ fact, factData }: any) => ({ fact, factData })) });
    return { local, confirmed, ledgerAvailable: true, updatedAt: new Date().toISOString() };
}
export function portalRouter(connect: Connect) {
    const router = new Router({ prefix: '/api' });
    router.get('/server_type', ctx => { ctx.body = 'PUBLIC'; });
    const read = (path: string, work: (ctx: any, c: any, state: any, node: any) => Promise<any>) => router.get('/dlt' + path, async ctx => {
        ctx.body = await connect(async c => {
            const node = await c.node.getNodeInfo();
            const state = await c.invoke('pilot_snapshot');
            state.catalog = queuedPackages(state.network);
            return work(ctx, c, state, node);
        });
    });
    read('/collection-queue', async (ctx, c, state) => queueStatus(state));
    read('/packages', async (ctx, c, state) => {
        const query = String(ctx.query.query || '').toLowerCase();
        const all = packages(state).filter(p => p.packageName.toLowerCase().includes(query));
        const from = Math.max(0, Math.floor(Number(ctx.query.from) || 0));
        const count = Math.max(1, Math.min(200, Math.floor(Number(ctx.query.count) || 20)));
        return { packages: all.slice(from, from + count), total: all.length };
    });
    read('/package/:name', async (ctx, c, state) => resolve(state, ctx.params.name));
    read('/measurements/:name', async (ctx, c, state, node) => ({ facts: measurements(state, resolve(state, ctx.params.name).packageName, node.finalizedHeight), ledgerAvailable: true }));
    read('/fact-groups/:name', async (ctx, c, state, node) => ({ facts: factGroups(state, resolve(state, ctx.params.name).packageName, node.finalizedHeight), ledgerAvailable: true }));
    read('/scores/:name/:version', async (ctx, c, state, node) => scores(c, state, resolve(state, ctx.params.name).packageName, ctx.params.version, node.finalizedHeight));
    read('/package/:name/trust-score{/:version}', async (ctx, c, state, node) => {
        const pack = resolve(state, ctx.params.name);
        return (await scores(c, state, pack.packageName, ctx.params.version || pack.packageReleases[0], node.finalizedHeight)).confirmed.score;
    });
    read('/jobs', async (ctx, c, state) => state.rounds.map((r: any, i: number) => ({jobID: i + 1, package: r.escrow.repository, version: r.escrow.version, fact: r.metric, bounty: r.escrow.bounty, account: { uid: r.escrow.sponsor } })));
    read('/metrics', async (ctx, c, state, node) => ({ block_height: node.height, package_count: packages(state).length, peer_info: { connected: (await c.node.getConnectedPeers()).length } }));
    read('/network', async (ctx, c, state, node) => ({ observedAt: new Date().toISOString(), local: { height: node.height, finalizedHeight: node.finalizedHeight, syncing: node.syncing }, peers: (await c.node.getConnectedPeers()).map((p: any) => ({ address: p.ipAddress, port: p.port })) }));
    read('/payouts', async (ctx, c, state, node) => {
        const history = await c.invoke('pilot_payouts', ctx.query.before ? { before: ctx.query.before } : {});
        return { ...history, finalizedHeight: node.finalizedHeight };
    });
    return router;
}
