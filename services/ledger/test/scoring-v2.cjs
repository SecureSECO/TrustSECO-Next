const { test } = require('node:test'),
	assert = require('node:assert/strict');
const {
	policy,
	normalize,
	assess,
	recover,
	validateSecurity,
} = require('../dist/app/modules/scoring/engine');
const { projectScore } = require('../dist/app/modules/scoring/projection');
const { freshPilot, roundResult } = require('../dist/app/modules/pilot/policy');
const D = 86400,
	T = 2000000000;
const security = advisories => ({
	schema: 1,
	ecosystem: 'PyPI',
	name: 'Flask',
	version: '1',
	complete: true,
	advisories,
});
const advisory = (severity, kev = false) => ({
	id: 'CVE-2026-1234',
	aliases: ['CVE-2026-1234'],
	severity,
	score: null,
	vector: null,
	scoreVersion: null,
	kev,
});
const frame = (at, advisories = [], multiple = 4) => ({
	at,
	securityAt: at,
	security: security(advisories),
	facts: policy.features.map(f => ({
		metric: f.metric,
		at,
		value:
			f.direction === 'age-lower'
				? at - f.reference / multiple
				: f.direction === 'age-higher'
				? at - f.reference * multiple
				: f.reference * multiple * (f.scale || 1),
	})),
});
const history = () => Array.from({ length: 8 }, (_, i) => frame(T + i * D));
test('bounded monotonic normalization preserves fractions below one; popularity has 10% budget', () => {
	assert.equal(normalize(0, 0.05), 0);
	assert.equal(normalize(0.05, 0.05), 0.5);
	for (const a of [0.05, 50, 5000]) {
		let previous = -1;
		for (const x of [0, 0.001, 0.01, 0.05, 0.1, 1, 10, 1000, 1e9]) {
			const z = normalize(x, a);
			assert.ok(z >= previous && z >= 0 && z <= 1);
			previous = z;
		}
	}
	assert.equal(normalize(50, 50, true), 0.5);
	assert.throws(() => normalize(1, 0));
	assert.ok(Math.abs(policy.features.reduce((s, f) => s + f.weight, 0) - 1) < 1e-10);
	assert.equal(
		policy.features
			.filter(f => f.category === 'Community support')
			.reduce((s, f) => s + f.weight, 0),
		0.1,
	);
	assert.equal(policy.features.filter(f => f.metric.includes('contributor')).length, 1);
	assert.ok(!policy.features.some(f => /issues|dependency_count|stargazer/.test(f.metric)));
	const f = frame(T);
	f.facts.find(f => f.metric === 'so_popularity').value = 50000;
	assert.equal(assess(f).contributions.at(-1).normalized, 0.5);
});
test('severity compounds and hard ceilings remain non-compensable', () => {
	for (const [severity, target] of [
		['none', 80],
		['low', 76],
		['medium', 68],
		['high', 40],
		['critical', 20],
	])
		assert.ok(Math.abs(assess(frame(T, [advisory(severity)])).target - target) < 1e-9);
	assert.equal(assess(frame(T, [advisory('critical', true)])).target, 9);
	assert.ok(
		Math.abs(
			assess(frame(T, [advisory('high'), { ...advisory('high'), id: 'other' }])).target - 20,
		) < 1e-9,
	);
	assert.equal(assess(frame(T, [advisory('high')], 1e8)).ceiling, 49);
});
test('missing, stale, disputed and unknown evidence cannot become a safety score', () => {
	const f = frame(T);
	delete f.security;
	assert.equal(assess(f).target, null);
	assert.equal(assess({ ...frame(T), at: T + D + 1 }).target, null);
	assert.equal(assess({ ...frame(T), blocked: true }).target, null);
	assert.equal(assess(frame(T, [advisory('unknown', true)])).target, null);
	assert.equal(assess(frame(T, [advisory('unknown', true)])).ceiling, 9);
	const partial = frame(T);
	partial.facts = partial.facts.filter(f => f.metric !== 'so_popularity');
	const a = assess(partial);
	assert.ok(a.target < 80);
	assert.ok(Math.abs(a.baselineUpper - a.baselineLower - 5) < 1e-9);
	partial.facts = partial.facts.filter(f => f.metric !== 'gh_yearly_commit_count');
	assert.equal(assess(partial).target, null);
});
test('history is earned, drops are immediate, recovery is one point per supported day', () => {
	assert.equal(recover([frame(T)]).status, 'insufficient-history');
	const h = history();
	assert.ok(Math.abs(recover(h).score - 80) < 1e-9);
	h.push(frame(T + 7 * D + 1, [advisory('critical')]));
	assert.ok(Math.abs(recover(h).score - 20) < 1e-9);
	h.push(frame(T + 8 * D + 1));
	assert.ok(Math.abs(recover(h).score - 21) < 1e-9);
	h.push(frame(T + 18 * D + 1));
	assert.ok(Math.abs(recover(h).score - 22) < 1e-9); // only first supported day of gap
	const correction = { ...frame(T + 18 * D + 2), correction: true };
	assert.ok(Math.abs(recover([...h, correction]).score - 80) < 1e-9);
	assert.ok(
		recover([...h, { ...correction, security: security([advisory('critical')]) }]).score <= 20,
	);
});
test('irrelevant stale facts do not prevent history and unsupported time is never credited', () => {
	const h = history().map(f => ({
		...f,
		facts: [...f.facts, { metric: 'excluded', at: 0, value: 1 }],
	}));
	assert.equal(recover(h).status, 'assessed');
	assert.equal(recover([frame(T), frame(T + 20 * D)]).historySeconds, D);
	const gap = [...history(), { ...frame(T + 8 * D), security: undefined }, frame(T + 30 * D)];
	assert.equal(recover(gap).historySeconds, 7 * D);
});
test('canonical security rejects alias duplicates, unknown/zero coercion and altered CVSS vectors', () => {
	const vector = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';
	const v = { ...advisory('critical'), score: 9.8, scoreVersion: '3.1', vector };
	assert.equal(validateSecurity(security([v])).advisories[0].score, 9.8);
	assert.throws(() => validateSecurity(security([{ ...v, score: 9.7 }])), /mismatch/);
	assert.throws(
		() => validateSecurity(security([v, { ...v, id: 'GHSA-test', aliases: v.aliases }])),
		/Duplicate/,
	);
	assert.throws(
		() => validateSecurity(security([{ ...v, score: null, vector: null, scoreVersion: null }])),
		/unknown/,
	);
	assert.throws(() => validateSecurity({ ...security([]), complete: false }), /Complete/);
});
// Minimal deterministic ledger fixtures exercise projection, independent of signed-event tests.
function ledger() {
	const s = freshPilot('fixture', 'score-fixture', 'legacy-v1');
	s.community.members = ['a', 'b', 'c'].map(id => ({
		id,
		key: id,
		operator: id,
		suspended: false,
		reinstatedAt: -1,
	}));
	return s;
}
function addFrame(s, f, version = '1', closed = true) {
	for (const [metric, value, snapshot] of [
		...f.facts.map(f => [f.metric, f.value]),
		[policy.securityMetric, f.security.advisories.length, { ...f.security, version }],
	]) {
		const id = 'r' + s.community.rounds.length;
		s.escrows[id] = { repository: 'owner/pkg', version, closedAt: f.at, closedHeight: 1 };
		s.community.rounds.push({
			id,
			metric,
			source: 'fixture',
			method: 'fixture',
			openedAt: f.at - 1,
			closesAt: f.at,
			closed,
			observations: ['a', 'b', 'c'].map(member => ({
				id: id + member,
				member,
				value,
				eligible: true,
				observedAt: f.at,
				receivedAt: f.at,
				source: 'fixture',
				method: 'fixture',
				...(snapshot ? { security: snapshot } : {}),
			})),
			invalid: [],
		});
	}
}
test('equal vulnerability counts do not corroborate different advisory snapshots', () => {
	const s = ledger();
	addFrame(s, frame(T, [advisory('high')]));
	const r = s.community.rounds.at(-1);
	assert.equal(roundResult(s, r).status, 'verified');
	r.observations[2].security = security([advisory('unknown')]);
	assert.notEqual(roundResult(s, r).status, 'verified');
});
test('new release retains low history; unfinalized evidence cannot produce confirmed assessment', () => {
	const s = ledger();
	for (const f of history()) addFrame(s, f);
	let a = projectScore(s, 'owner/pkg', '1', T + 7 * D, 1, true);
	assert.equal(a.status, 'assessed');
	addFrame(s, frame(T + 7 * D + 1, [advisory('critical')]));
	addFrame(s, frame(T + 8 * D + 1), '2');
	a = projectScore(s, 'owner/pkg', '2', T + 8 * D + 1, 1, true);
	assert.ok(a.score <= 21.001 && a.score >= 20);
	addFrame(s, frame(T + 8 * D + 2), '2', false);
	assert.equal(projectScore(s, 'owner/pkg', '2', T + 8 * D + 2, 1, true).score, null);
});
