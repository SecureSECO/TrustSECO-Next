import Router from 'koa-router';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
const pilotTools = fs.existsSync(path.join(__dirname, '../tools/pilot/client.cjs')) ? path.join(__dirname, '../tools/pilot') : path.join(__dirname, '../../../tools/pilot');
const { LocalIdentity, localRequestAllowed } = require(path.join(pilotTools, 'local-identity.cjs'));
const { mineOnce, baseURL, sshKey } = require(path.join(pilotTools, 'client.cjs'));

async function github(route: string) {
    const response = await fetch('https://api.github.com' + route, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'TrustSECO-setup' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error(`GitHub returned ${response.status}; please try again later`);
    return response.json() as Promise<any>;
}
export async function checkGithub(login: string, sshKey?: string) {
    if (typeof login !== 'string' || !/^[a-z0-9][a-z0-9-]{0,38}$/.test(login) || ['governor', 'constructor', 'prototype'].includes(login)) throw Error('Enter a personal GitHub username');
    const profile = await github('/users/' + login);
    if (!Number.isSafeInteger(profile.id) || profile.id <= 0) throw Error('GitHub returned an invalid account ID');
    if (profile.type !== 'User' || profile.login.toLowerCase() !== login) throw Error('A personal GitHub account is required');
    const eligible = Date.parse(profile.created_at) <= Date.now() - 180 * 86400000;
    let linked = false;
    if (sshKey) for (let page = 1; page <= 10; page++) {
        const keys = await github(`/users/${login}/ssh_signing_keys?per_page=100&page=${page}`);
        if (!Array.isArray(keys)) throw Error('Could not read GitHub signing keys');
        if (keys.some(k => k.key.split(' ').slice(0, 2).join(' ') === sshKey)) { linked = true; break; }
        if (keys.length < 100) break;
    }
    return { login: profile.login, githubId: String(profile.id), eligible, linked };
}

export function setupRouter(snapshot: () => Promise<any>) {
    const router = new Router({ prefix: '/api/local' });
    const origin = process.env.PILOT_LOCAL_ORIGIN;
    if (!origin) return router;
    if (!localRequestAllowed(origin, new URL(origin).host, origin, 'same-origin', '1')) throw Error('Local setup requires an explicit localhost HTTP origin');
    const identity = new LocalIdentity(process.env.PILOT_IDENTITY_DIR || '/local-identity');
    const relay = baseURL(process.env.PILOT_RELAY_URL || 'http://localhost:3000');
    let active = false, activity = 'Mining is off', lastSuccess: string | null = null;
    const tick = async () => {
        if (active || !identity.settings().mining) return;
        active = true; activity = 'Collecting or submitting an observation';
        try { const worked = await mineOnce(relay, identity.file); if (worked) lastSuccess = new Date().toISOString(); activity = worked ? 'Observation recorded' : 'Waiting for work'; }
        catch (e) { activity = (e as Error).message; }
        finally { active = false; }
    };
    setInterval(() => void tick(), 15000).unref();
    router.use(async (ctx, next) => {
        if (!localRequestAllowed(origin, ctx.get('Host'), ctx.get('Origin'), ctx.get('Sec-Fetch-Site'), ctx.get('X-TrustSECO-Local'))) ctx.throw(403, 'Local setup is available only from this node’s localhost address');
        ctx.set('Cache-Control', 'no-store'); await next();
    });
    router.get('/status', async ctx => {
        const publicIdentity = identity.public(); let network: any, networkError: string | null = null;
        try { network = await snapshot(); } catch { networkError = 'Cannot connect to the ledger'; }
        const member = network?.members.find(m => m.id === publicIdentity?.login && m.key === publicIdentity?.publicKey);
        ctx.body = { identity: publicIdentity, request: fs.existsSync(identity.file + '.request') ? JSON.parse(fs.readFileSync(identity.file + '.request', 'utf8')) : null, network: network?.network, networkError, admitted: !!member, standing: member?.standing, revoked: member?.revoked, mining: identity.settings().mining, activity: !identity.settings().mining && !active ? 'Mining is off' : activity, lastSuccess };
    });
    router.post('/identity', async ctx => {
        const login = String((ctx.request.body as any)?.login || '').trim().toLowerCase();
        const profile = await checkGithub(login); if (!profile.eligible) ctx.throw(400, 'GitHub account must be at least 180 days old');
        ctx.body = identity.create(login);
    });
    router.post('/verify', async ctx => {
        const key = identity.public(); if (!key) ctx.throw(400, 'Create an identity first');
        ctx.body = await checkGithub(key.login, key.sshKey);
    });
    router.post('/request', async ctx => {
        const key = identity.public(); if (!key) ctx.throw(400, 'Create an identity first');
        const profile = await checkGithub(key.login, key.sshKey);
        if (!profile.eligible || !profile.linked) ctx.throw(400, 'Publish your signing key on GitHub and verify it first');
        const network = await snapshot(), request = identity.join(network.network);
        const response = await fetch(relay + '/api/pilot/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(20000) });
        if (!response.ok) ctx.throw(400, 'Admission request was not accepted; please retry');
        const receipt = await response.json() as any;
        fs.writeFileSync(identity.file + '.request', JSON.stringify(receipt), { mode: 0o600 });
        ctx.body = { ...receipt, request };
    });
    router.post('/mining', async ctx => {
        const enabled = (ctx.request.body as any)?.enabled; if (typeof enabled !== 'boolean') ctx.throw(400, 'Choose on or off');
        if (enabled) {
            const key = identity.public(), network = await snapshot();
            const member = network.members.find(m => m.id === key?.login && m.key === key?.publicKey);
            if (!member || member.revoked || member.standing === 'suspended') ctx.throw(403, 'An admitted, active identity is required');
        }
        identity.setMining(enabled); if (enabled) void tick(); ctx.body = { mining: enabled };
    });
    router.post('/backup', ctx => { ctx.body = identity.backup((ctx.request.body as any)?.password); });
    router.post('/restore', ctx => { const body = ctx.request.body as any; ctx.body = identity.restore(body?.backup, body?.password); });
    return router;
}

export async function queueAdmission(body: any, network: any) {
    const directory = process.env.PILOT_REQUEST_DIR; if (!directory) throw Error('Admission inbox is not configured');
    if (typeof body?.payload !== 'string' || Buffer.byteLength(body.payload) > 4000 || typeof body.signature !== 'string' || body.signature.length > 256) throw Error('Signed join request required');
    const join = JSON.parse(body.payload), now = Math.floor(Date.now() / 1000);
    if (join.network !== network.network || !Number.isSafeInteger(join.expiresAt) || join.expiresAt < now || join.expiresAt > now + 86400 || typeof join.nonce !== 'string' || join.nonce.length < 16) throw Error('Expired or invalid join request');
    const key = crypto.createPublicKey(join.publicKey); if (key.asymmetricKeyType !== 'ed25519' || !crypto.verify(null, Buffer.from('TrustSECO-join-v1\n' + body.payload), key, Buffer.from(body.signature, 'base64'))) throw Error('Invalid ownership proof');
    const profile = await checkGithub(join.login, sshKey(join.publicKey));
    if (!profile.eligible || !profile.linked) throw Error('GitHub age and signing key must be verified');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (fs.readdirSync(directory).filter(f => f.endsWith('.json')).length >= 100 && !fs.existsSync(path.join(directory, profile.githubId + '.json'))) throw Error('Admission inbox is full');
    const file = path.join(directory, profile.githubId + '.json');
    fs.writeFileSync(file + '.tmp', JSON.stringify({ payload: body.payload, signature: body.signature }), { mode: 0o600 }); fs.renameSync(file + '.tmp', file);
    return { status: 'awaiting-approval', expiresAt: join.expiresAt };
}
