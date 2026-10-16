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
	assert.equal(assess({ ...frame(T), at: T + policy.freshnessSeconds + 1 }).target, null);
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
	assert.equal(recover([frame(T)]).status, 'assessed');
	assert.ok(Math.abs(recover([frame(T)]).score - 80) < 1e-9);
	assert.equal(recover([frame(T)]).historySeconds, 0);
	assert.equal(recover([frame(T)]).historyRequiredSeconds, 0);
	const h = history();
	assert.ok(Math.abs(recover(h).score - 80) < 1e-9);
	h.push(frame(T + 7 * D + 1, [advisory('critical')]));
	assert.ok(Math.abs(recover(h).score - 20) < 1e-9);
	h.push(frame(T + 8 * D + 1));
	assert.ok(Math.abs(recover(h).score - 21) < 1e-9);
	h.push(frame(T + 18 * D + 1));
	assert.ok(Math.abs(recover(h).score - 23) < 1e-9); // only the two supported days of the gap
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
	assert.equal(recover([frame(T), frame(T + 20 * D)]).historySeconds, policy.freshnessSeconds);
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

test('confirmed malware blocks trust; a clean scan provides no positive bonus',()=>{
 const f=frame(T);const target=assess(f).target;
 f.malware={infected:1};assert.equal(assess(f).target,null);assert.match(assess(f).reasons.join(' '),/ClamAV/);
 f.malware={infected:0};assert.equal(assess(f).target,target);
});
test('pending and failed malware refreshes cannot erase confirmed detections',()=>{
 const s=ledger();for(const f of history())addFrame(s,f);
 function scan(id,at,infected,closed=true,observations=true){
  s.escrows[id]={repository:'owner/pkg',version:'1',closedAt:at,closedHeight:1};
  s.community.rounds.push({id,metric:'vs_virus_ratio',openedAt:at-1,closesAt:at,closed,invalid:[],observations:observations?['a','b','c'].map(member=>({id:id+member,member,value:infected*1000000,eligible:true,observedAt:at,receivedAt:at,malware:{infected,manifestHash:id}})):[]});
 }
 const at=T+7*D;scan('detected',at+1,1);
 assert.equal(projectScore(s,'owner/pkg','1',at+1,1,true).target,null);
 scan('pending',at+2,0,false);assert.equal(projectScore(s,'owner/pkg','1',at+2,1,true).malware.infected,1);
 s.community.rounds.at(-1).closed=true;s.community.rounds.at(-1).observations=[];
 assert.equal(projectScore(s,'owner/pkg','1',at+3,1,true).malware.infected,1);
 scan('clean',at+4,0);assert.equal(projectScore(s,'owner/pkg','1',at+4,1,true).malware.infected,0);
 assert.notEqual(projectScore(s,'owner/pkg','1',at+4,1,true).target,null);
});

test('immediate initialization keeps security, coverage and finality gates', () => {
 assert.equal(recover([]).score, null);
 assert.equal(recover([{ ...frame(T), security: undefined }]).score, null);
 assert.equal(recover([{ ...frame(T), facts: [] }]).score, null);
 assert.equal(recover([{ ...frame(T), at: T + policy.freshnessSeconds + 1 }]).score, null);
 assert.equal(recover([frame(T, [advisory('unknown')])]).score, null);
 const s = ledger(); addFrame(s, frame(T));
 assert.equal(projectScore(s, 'owner/pkg', '1', T, 0, true).score, null);
 const confirmed = projectScore(s, 'owner/pkg', '1', T, 1, true);
 assert.ok(Math.abs(confirmed.score - 80) < 1e-9);
 assert.equal(confirmed.historySeconds, 0);
});
test('an immediately initialized score still drops immediately and recovers gradually', () => {
 const h = [frame(T), frame(T + 1, [advisory('critical')])];
 assert.ok(Math.abs(recover(h).score - 20) < 1e-9);
 h.push(frame(T + 2));
 assert.ok(recover(h).score < 20.001);
 h.push(frame(T + D + 2));
 assert.ok(recover(h).score < 21.001);
});
test('provisional estimates normalize partial older evidence and disclose age/coverage; confirmed gates remain',()=>{
 const f=frame(T);f.facts=f.facts.filter(x=>['lib_latest_release_date','lib_first_release_date','lib_dependent_count','so_popularity'].includes(x.metric));
 const at=T+35*D,old={...f,at,securityAt:at};
 const local=assess(old,true),confirmed=assess(old);
 assert(Math.abs(local.coverage-.45)<1e-9);assert.equal(local.factTypeCount,4);assert.equal(local.staleInputCount,3);
 assert.equal(local.oldestObservedAt,T);assert.equal(local.missingInputs.length,2);
 assert.equal(local.target,local.baselineLower/local.coverage);assert.equal(confirmed.target,null);
 assert.equal(assess({...old,facts:[]},true).target,null);
 assert.equal(assess({...old,facts:[{metric:'gh_yearly_commit_count',value:0,at:T}]},true).target,0);
});
test('provisional estimates keep old vulnerability penalties and expose missing security without inventing clearance',()=>{
 const f=frame(T,[advisory('critical',true)]);f.at+=35*D;
 const a=assess(f,true);assert(a.target<=9);assert.equal(a.securityFresh,false);assert.match(a.reasons.join(' '),/Security evidence missing or stale/);
 assert.equal(assess({...f,malware:{infected:1}},true).target,0);
 assert.notEqual(assess({...f,security:undefined,securityAt:undefined},true).target,null);
});
test('per-indicator expiry keeps release origin useful longer but security still expires at its policy boundary',()=>{
 const f=frame(T);f.at+=policy.freshnessSeconds+1;f.securityAt=f.at;
 const a=assess(f);assert.equal(a.contributions.find(x=>x.metric==='lib_latest_release_date').value,null);
 assert.notEqual(a.contributions.find(x=>x.metric==='lib_first_release_date').value,null);
 assert.notEqual(a.contributions.find(x=>x.metric==='gh_yearly_commit_count').value,null);
 const securityExpired=assess({...frame(T),at:T+policy.freshnessSeconds+1});assert.equal(securityExpired.securityFresh,false);assert.equal(securityExpired.target,null);
});
test('pending refresh does not erase a usable local estimate or source rank; confirmed score stays gated',()=>{
 const s=ledger(),f=frame(T);addFrame(s,f,'1',false);
 const local=projectScore(s,'owner/pkg','1',T,0,false);assert.notEqual(local.score,null);assert.equal(local.status,'provisional');
 assert.equal(projectScore(s,'owner/pkg','1',T,0,true).score,null);
 const id='pending';s.escrows[id]={repository:'owner/pkg',version:'1',closedAt:null,closedHeight:null};s.community.rounds.push({id,metric:'gh_yearly_commit_count',openedAt:T+1,closesAt:T+100,closed:false,observations:[]});
 assert.equal(projectScore(s,'owner/pkg','1',T+1,0,false).factTypeCount,6);
 const r={...s.community.rounds[0],id:'rank',metric:'lib_sourcerank',closed:true,observations:s.community.rounds[0].observations.map(o=>({...o,id:'rank-'+o.member,value:32}))};
 s.community.rounds.push(r);s.escrows.rank={repository:'owner/pkg',version:'1',closedAt:T,closedHeight:1};
 const ranked=projectScore(s,'owner/pkg','1',T,1,false);assert.equal(ranked.sourceRank.value,32);assert(ranked.sourceRank.confirmed);assert.equal(ranked.score,local.score);
});
test('provisional clean reports cannot erase known malware or vulnerability findings before confirmation',()=>{
 const s=ledger();addFrame(s,frame(T,[advisory('critical')]),'1',true);
 addFrame(s,frame(T+1,[]),'1',false);
 assert(projectScore(s,'owner/pkg','1',T+1,1,false).score<=24);
 const scan=(id,at,infected,closed)=>{s.escrows[id]={repository:'owner/pkg',version:'1',closedAt:closed?at:null,closedHeight:closed?1:null};s.community.rounds.push({id,metric:'vs_virus_ratio',openedAt:at-1,closesAt:at,closed,observations:['a','b','c'].map(member=>({id:id+member,member,value:infected*1000000,eligible:true,observedAt:at,receivedAt:at,malware:{infected,manifestHash:id}}))});};
 scan('bad',T+2,1,true);scan('pending-clean',T+3,0,false);
 assert.equal(projectScore(s,'owner/pkg','1',T+3,1,false).score,0);
 scan('confirmed-clean',T+4,0,true);assert(projectScore(s,'owner/pkg','1',T+4,1,false).score>0);
});
test('a minority local malware report remains visible until a clean scan is actually confirmed',()=>{
 const s=ledger();addFrame(s,frame(T),'1',true);
 const id='conflicting-scan';s.escrows[id]={repository:'owner/pkg',version:'1',closedAt:null,closedHeight:null};s.community.rounds.push({id,metric:'vs_virus_ratio',openedAt:T,closesAt:T+100,closed:false,observations:[{id:'bad',member:'a',eligible:true,value:1000000,observedAt:T+1,receivedAt:T+1,malware:{infected:1}},{id:'clean',member:'b',eligible:true,value:0,observedAt:T+2,receivedAt:T+2,malware:{infected:0}}]});
 assert.equal(projectScore(s,'owner/pkg','1',T+2,1,false).score,0);
});

test('last confirmed survives expiry without making the current score available', () => {
 const s = ledger(); addFrame(s, frame(T));
 const initial = projectScore(s, 'owner/pkg', '1', T, 100, true);
 assert.notEqual(initial.score, null);
 const expired = projectScore(s, 'owner/pkg', '1', T + policy.freshnessSeconds + 1, 100, true);
 assert.equal(expired.score, null);
 assert.deepEqual(expired.lastConfirmed, {score: initial.score, assessedAt:T, policyVersion:policy.version});
 assert.ok(expired.reasons.includes('Security evidence missing or stale'));
 assert.equal(projectScore(s, 'owner/pkg', '2', T + policy.freshnessSeconds + 1, 100, true).lastConfirmed, null);
 assert.equal(projectScore(s, 'owner/pkg', '1', T, 0, true).lastConfirmed, null);
 assert.equal(projectScore(ledger(), 'owner/pkg', '1', T, 100, true).lastConfirmed, null);
});
test('pending refresh retains historical confirmation and a newer confirmed assessment replaces it', () => {
 const s = ledger(); addFrame(s, frame(T));
 const old = projectScore(s, 'owner/pkg', '1', T, 100, true).lastConfirmed;
 addFrame(s, frame(T + 60), '1', false);
 const pending = projectScore(s, 'owner/pkg', '1', T + 60, 100, true);
 assert.equal(pending.score, null); assert.deepEqual(pending.lastConfirmed, old);
 addFrame(s, frame(T + 120, [advisory('critical')]));
 const updated = projectScore(s, 'owner/pkg', '1', T + 120, 100, true);
 assert.equal(updated.lastConfirmed.assessedAt, T + 120);
 assert.ok(updated.lastConfirmed.score <= 20);
 assert.notEqual(updated.lastConfirmed.score, old.score);
});
test('historical score preserves recovery limits and is never borrowed from another release', () => {
 const s = ledger(); addFrame(s, frame(T, [advisory('critical')]));
 addFrame(s, frame(T + 60));
 const recovered = projectScore(s, 'owner/pkg', '1', T + 60, 100, true);
 assert.ok(recovered.lastConfirmed.score < recovered.target);
 assert.equal(recovered.lastConfirmed.score, recovered.score);
 addFrame(s, frame(T + 120), '2');
 const expired = projectScore(s, 'owner/pkg', '1', T + 120 + policy.freshnessSeconds + 1, 100, true);
 assert.deepEqual(expired.lastConfirmed, recovered.lastConfirmed);
 assert.equal(expired.score, null);
});

test('v2.1.1 doubles evidence validity and retains exact expiry boundaries', () => {
 assert.equal(policy.version,'trust-v2.1.1');
 assert.equal(policy.freshnessSeconds,2*D);
 for (const feature of policy.features) {
  const days=feature.metric==='lib_first_release_date'?730:feature.metric==='lib_latest_release_date'?2:14;
  assert.equal(feature.freshnessSeconds,days*D);
  const f=frame(T); f.at=T+feature.freshnessSeconds;f.securityAt=f.at;
  assert.notEqual(assess(f).contributions.find(x=>x.metric===feature.metric).value,null);
  f.at++;f.securityAt=f.at;
  assert.equal(assess(f).contributions.find(x=>x.metric===feature.metric).value,null);
 }
 assert.notEqual(assess({...frame(T),at:T+2*D}).target,null);
 assert.equal(assess({...frame(T),at:T+2*D+1}).target,null);
});
