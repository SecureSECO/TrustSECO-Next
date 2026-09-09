const { test } = require('node:test'),
	assert = require('node:assert/strict'),
	crypto = require('node:crypto');
const {
	freshPilot,
	applyPilot,
	settlePilot,
	roundResult,
} = require('../dist/app/modules/pilot/policy');
const now = 2000000000,
	keys = Object.fromEntries(
		['governor', 'a', 'b', 'c'].map(id => [id, crypto.generateKeyPairSync('ed25519')]),
	);
const pub = id => keys[id].publicKey.export({ type: 'spki', format: 'pem' }).toString();
let seq = 0;
function event(s, actor, body, at = now, height = 1) {
	const payload = JSON.stringify({ network: s.network, id: 's' + ++seq, actor, ...body });
	return applyPilot(
		s,
		payload,
		crypto
			.sign(null, Buffer.from('TrustSECO-community-v1\n' + payload), keys[actor].privateKey)
			.toString('base64'),
		at,
		height,
	);
}
function setup() {
	const s = freshPilot(pub('governor'), 'security-test', 'legacy-v1');
	s.community.members = ['a', 'b', 'c'].map(id => ({
		id,
		key: pub(id),
		operator: id,
		githubId: id,
		suspended: false,
		reinstatedAt: -1,
	}));
	for (const id of ['a', 'b', 'c']) s.balances[id] = '0';
	return s;
}
const body = {
	kind: 'open',
	round: 'security',
	repository: 'pallets/flask',
	package: 'pallets/flask',
	version: '3.1.1',
	metric: 'security_advisories',
	source: 'OSV + CISA KEV',
	method: 'osv-kev-v1',
	packagePlatform: 'PyPI',
	packageName: 'Flask',
	duration: 10,
	bounty: '300',
};
const clean = {
	schema: 1,
	ecosystem: 'PyPI',
	name: 'Flask',
	version: '3.1.1',
	complete: true,
	advisories: [],
};
const observe = (security = clean) => ({
	kind: 'observe',
	round: 'security',
	source: body.source,
	method: body.method,
	value: security.advisories.length,
	security,
	observedAt: now,
});
test('signed exact-version security observations require complete bound snapshots and correct source', () => {
	assert.throws(
		() => event(setup(), 'governor', { ...body, source: 'GitHub REST' }),
		/Unsupported/,
	);
	let s = event(setup(), 'governor', body);
	assert.throws(() => event(s, 'a', observe({ ...clean, version: '2' })), /target/);
	assert.throws(() => event(s, 'a', observe({ ...clean, complete: false })), /Complete/);
	assert.throws(() => event(s, 'a', { ...observe(), value: 1 }), /count/);
	for (const id of ['a', 'b', 'c']) s = event(s, id, observe());
	s = settlePilot(s, now + 11, 2);
	assert.equal(roundResult(s, s.community.rounds[0]).status, 'verified');
	const correction = {
		kind: 'score-correction',
		round: 'security',
		reason: 'Withdrawn false positive independently verified',
		evidence: 'https://example.org/correction',
	};
	assert.throws(() => event(s, 'a', correction, now + 12, 3), /Governor/);
	s = event(s, 'governor', correction, now + 12, 3);
	assert.equal(s.escrows.security.scoreCorrection.at, now + 12);
	assert.throws(() => event(s, 'governor', correction, now + 13, 4), /already/);
});
