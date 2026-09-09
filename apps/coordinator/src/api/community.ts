import Router from 'koa-router';
import fs from 'fs';
import crypto from 'crypto';
import { getClient } from '../services/dlt-service';
const router = new Router({ prefix: '/community' });
const enabled = process.env.COMMUNITY_DEMO === 'true';
// This endpoint intentionally controls simulated identities on a localhost-only prototype.
router.use(async (ctx, next) => {
    if (!enabled) { ctx.status = 404; return; }
    if (ctx.method !== 'GET') {
        const origin = ctx.get('Origin');
        if ((origin && origin !== 'http://localhost:3004') || ctx.get('Sec-Fetch-Site') === 'cross-site' || ctx.get('X-Community-Demo') !== '1') {
            ctx.status = 403; ctx.body = { error: 'Use the local community review screen.' }; return;
        }
    }
    try { await next(); } catch (e) { ctx.status = 400; ctx.body = { error: e instanceof Error ? e.message : 'Community request failed' }; }
});
router.get('/snapshot', async ctx => {
    const c = await getClient(); const node = await c.node.getNodeInfo();
    const snapshot: any = await c.invoke('community_snapshot');
    if (snapshot.error) { ctx.status = 503; ctx.body = {error:'Ledger unavailable'}; return; }
    ctx.body = {...snapshot, ledger: {height:node.height, finalizedHeight:node.finalizedHeight, chainID:node.chainID}, simulated:true};
});
let busy = false;
router.post('/event', async ctx => {
    if (busy) { ctx.status=409; ctx.body={error:'An event is being submitted; retry shortly.'}; return; }
    busy=true;
    try {
        const body = ctx.request.body as any;
        if (!body || typeof body.kind !== 'string' || typeof body.actor !== 'string') throw Error('Event kind and actor required');
        const actors=JSON.parse(fs.readFileSync('/community/actors.json','utf8'));
        if (!Object.prototype.hasOwnProperty.call(actors,body.actor)) throw Error('Unknown demo identity');
        const c=await getClient();const node=await c.node.getNodeInfo();const block=await c.block.getByHeight(node.height);
        const e={...body,id:crypto.randomUUID()};
        if(e.kind==='enrol') {
            if(!Object.prototype.hasOwnProperty.call(actors,e.member) || e.member==='governor')throw Error('Unknown contributor');
            e.key=actors[e.member].publicKey;e.githubId='simulated-'+e.member;e.operator='simulated-'+e.member;
            e.accountCreatedAt=block.header.timestamp-200*86400;e.evidence='Simulated admission fixture; no real GitHub verification or operator independence is claimed.';
        }
        if(e.kind==='observe') e.observedAt=block.header.timestamp;
        const payload=JSON.stringify(e),signature=crypto.sign(null,Buffer.from('TrustSECO-community-v1\n'+payload),actors[e.actor].privateKey).toString('base64');
        const key=JSON.parse(fs.readFileSync('/community/transport.json','utf8')).privateKey;
        const tx={module:'community',command:'record',params:{payload,signature},fee:100000000n};
        tx.fee=c.transaction.computeMinFee(await c.transaction.create(tx,key));
        const signed=await c.transaction.create(tx,key);await c.transaction.send(signed);
        ctx.body={eventId:e.id,transactionId:signed.id,status:'submitted'};
    } finally {busy=false;}
});
export default router;
