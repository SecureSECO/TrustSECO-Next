// Separate entry point: no legacy token store, demo actor keys or unsigned write routes.
import Koa from 'koa';
import Router from 'koa-router';
import { koaBody } from 'koa-body';
import serve from 'koa-static';
import send from 'koa-send';
import fs from 'fs';
import crypto from 'crypto';
import { createWSClient } from '@klayr/api-client';
import { portalRouter } from './pilot-portal';
import { setupRouter, queueAdmission } from './pilot-setup';
import { recoverExpiredLease } from './pilot-relay-recovery';

const endpoint = process.env.DLT_ENDPOINT;
const keyFile = process.env.PILOT_RELAYER_FILE;
if (!endpoint || !keyFile) throw Error('DLT_ENDPOINT and PILOT_RELAYER_FILE required');
const transportKey = JSON.parse(fs.readFileSync(keyFile, 'utf8')).privateKey;
if (typeof transportKey !== 'string' || !/^[a-f0-9]{128}$/i.test(transportKey)) throw Error('Invalid relayer key');
const app = new Koa();
const router = new Router({ prefix: '/api/pilot' });
let busy = false;
let lastFinalized = -1, finalityAdvancedAt = Date.now();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function withClient<T>(work: (c: any) => Promise<T>): Promise<T> {
    const client = await createWSClient(endpoint);
    try { return await work(client); } finally { await client.disconnect(); }
}
app.use(async (ctx, next) => {
    try { await next(); } catch (error) {
        ctx.status = (error as any).status || 400;
        ctx.body = { error: ctx.status >= 500 ? 'Ledger temporarily unavailable' : (error as Error).message };
    }
});
app.use(koaBody({ jsonLimit: '16kb', multipart: false, urlencoded: false, text: false }));
router.get('/snapshot', async ctx => {
    ctx.body = await withClient(async c => {
        const node = await c.node.getNodeInfo();
        const snapshot = await c.invoke('pilot_snapshot');
        if (node.finalizedHeight !== lastFinalized) { lastFinalized=node.finalizedHeight; finalityAdvancedAt=Date.now(); }
        const stalled = Date.now()-finalityAdvancedAt > 180000 || node.height-node.finalizedHeight > 20;
        return { ...snapshot, health:{finalityStalled:stalled,reason:stalled?'Finality is stalled or lagging. New collection should wait for recovery.':null}, testNetwork: process.env.PILOT_TEST_NETWORK === 'true', ledger: { height: node.height, finalizedHeight: node.finalizedHeight, chainID: node.chainID } };
    });
});
router.get('/audit', async ctx => { ctx.body = await withClient(c => c.invoke('pilot_audit', ctx.query.before === undefined ? {} : {before:Number(ctx.query.before)})); });
router.get('/event', async ctx => { if (typeof ctx.query.id !== 'string') ctx.throw(400, 'Event ID required'); ctx.body = await withClient(c => c.invoke('pilot_event', {id:ctx.query.id})); });
router.get('/capabilities', ctx => { ctx.body = { localSetup: !!process.env.PILOT_LOCAL_ORIGIN }; });
let nextAdmissionAt = 0;
router.post('/join', async ctx => {
    if (Date.now() < nextAdmissionAt) ctx.throw(429, 'Please wait briefly before retrying admission');
    nextAdmissionAt = Date.now() + 2000;
    ctx.body = await queueAdmission(ctx.request.body, await withClient(c => c.invoke('pilot_snapshot')));
});
router.get('/payouts', async ctx => {
    ctx.body = await withClient(async c => {
        const node = await c.node.getNodeInfo();
        const history = await c.invoke('pilot_payouts', ctx.query.before ? { before: ctx.query.before } : {});
        return { ...history, finalizedHeight: node.finalizedHeight };
    });
});
router.get('/score', async ctx => {
    const { repository, version } = ctx.query;
    if (typeof repository !== 'string' || typeof version !== 'string') ctx.throw(400, 'Repository and version required');
    ctx.body = await withClient(async c => {
        const node = await c.node.getNodeInfo();
        const { facts } = await c.invoke('pilot_scoreInputs', { repository, version, finalizedHeight: node.finalizedHeight });
        const score = await c.invoke('trustfacts_calculateScoreForFacts', { facts: facts.map(({ fact, factData }) => ({ fact, factData })) });
        return { ...score, facts, finalizedHeight: node.finalizedHeight, scope: 'Current repository measurements, associated with the requested package version' };
    });
});
router.post('/event', async ctx => {
    const body = ctx.request.body as any;
    if (!body || typeof body.payload !== 'string' || Buffer.byteLength(body.payload) > 12000 || typeof body.signature !== 'string' || body.signature.length > 256) ctx.throw(400, 'Signed envelope required');
    if (busy) ctx.throw(429, 'Relayer busy; retry the same signed envelope shortly');
    busy = true;
    let client: any;
    try {
        client = await createWSClient(endpoint);
        const snapshot = await client.invoke('pilot_snapshot');
        const event = JSON.parse(body.payload);
        const member = snapshot.members.find(m => m.id === event.actor);
        const key = event.actor === 'governor' ? snapshot.governorKey : member?.key;
        if (!key || member?.revoked || event.network !== snapshot.network || typeof event.id !== 'string' || event.id.length > 2000 || !event.id) ctx.throw(403, 'Unknown or revoked signing identity');
        if (!crypto.verify(null, Buffer.from('TrustSECO-community-v1\n' + body.payload), key, Buffer.from(body.signature, 'base64'))) ctx.throw(403, 'Invalid contributor signature');
        const existing = snapshot.audit.find(a => a.id === event.id) || (snapshot.policy?.collection ? (await client.invoke('pilot_event', {id:event.id})).event : null);
        if (existing && (existing.payload !== body.payload || existing.signature !== body.signature)) ctx.throw(409, 'Event ID collision');
        if (existing) { ctx.body = { eventId: event.id, status: 'recorded' }; return; }
        if (!['enrol', 'open', 'observe', 'close', 'substantiate', 'appeal', 'overturn', 'reinstate', 'transfer', 'revoke', 'activate-assignment', 'activate-availability', 'activate-collection', 'unavailable', 'availability', 'assignment-beacon', 'entropy-commit', 'entropy-reveal'].includes(event.kind)) ctx.throw(400, 'Unknown event kind');
        const tx = { module: 'pilot', command: 'record', params: { payload: body.payload, signature: body.signature }, fee: 100000000n };
        tx.fee = client.transaction.computeMinFee(await client.transaction.create(tx, transportKey));
        let signed = await client.transaction.create(tx, transportKey);
        try { await client.transaction.send(signed); }
        catch (error) {
            if (!(error as Error).message.includes('fee is not sufficient to replace existing transaction')) throw error;
            signed = await recoverExpiredLease(client, signed, transportKey);
        }
        ctx.status = 202; ctx.body = { eventId: event.id, transactionId: signed.id, status: 'submitted' };
        // Keep this nonce serialized until inclusion. A worker retains its envelope across timeouts.
        const pendingClient = client; client = undefined;
        void (async () => {
            try {
                for (let i = 0; i < 90; i++) {
                    await sleep(1000);
                    const state = await pendingClient.invoke('pilot_snapshot');
                    if (state.audit.some(a => a.id === event.id) || (state.policy?.collection && (await pendingClient.invoke('pilot_event', {id:event.id})).event)) break;
                }
            } catch { /* Worker will retry its durable envelope. */ }
            finally { busy = false; await pendingClient.disconnect().catch(() => { /* SDK disconnect timeouts must not crash the relay. */ }); }
        })();
    } finally {
        if (client) { busy = false; await client.disconnect(); }
        // Connection establishment can fail before a client exists.
        else if (ctx.status !== 202) busy = false;
    }
});
app.use(router.routes()).use(router.allowedMethods());
const portal = portalRouter(withClient);
app.use(portal.routes()).use(portal.allowedMethods());
const localSetup = setupRouter(() => withClient(c => c.invoke('pilot_snapshot')));
app.use(localSetup.routes()).use(localSetup.allowedMethods());
app.use(async (ctx, next) => { if (ctx.path.startsWith('/api/')) { ctx.status = 404; return; } await next(); });
app.use(serve('public'));
app.use(async ctx => { if (ctx.method === 'GET') await send(ctx, 'index.html', { root: 'public' }); });
app.listen(Number(process.env.PORT || 3000), '0.0.0.0');
