const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {freshPilot, applyPilot, settlePilot, roundResult, verifiedInputs, conserved, pilotView, DELAY} = require('../dist/app/modules/pilot/policy');
const {createAssignment, entropyCommitment, committeeFromSeed, ENTROPY_WINDOW} = require('../dist/app/modules/pilot/assignment');
const {initPilot, loadPilot, savePilot} = require('../dist/app/modules/pilot/storage');
const ids = ['a','b','c','d','e','f'];
const keys = Object.fromEntries(['governor',...ids,'late'].map(id=>[id,crypto.generateKeyPairSync('ed25519')]));
const pub = id=>keys[id].publicKey.export({type:'spki',format:'pem'}).toString();
const now = 2000000000, measureAt = now + ENTROPY_WINDOW * 2, closeAt = measureAt + 11;
let seq=0;
const sign = (payload, actor, domain='TrustSECO-community-v1')=>crypto.sign(null,Buffer.from(domain+'\n'+payload),keys[actor].privateKey).toString('base64');
function envelope(actor, body) {const payload=JSON.stringify({id:'assignment-'+ ++seq,network:'assignment-test',actor,...body});return {payload, signature:sign(payload,actor)};}
function event(s,actor,body,at=now,height=1) {const e=envelope(actor,body);return applyPilot(s,e.payload,e.signature,at,height);}
function enrol(s,id,extra={}) {
 const joinPayload=JSON.stringify({network:s.network,login:id,publicKey:pub(id),expiresAt:now+3600,nonce:'0123456789abcdef'});
 return event(s,'governor',{kind:'enrol',member:id,operator:id,githubId:String(id.charCodeAt(0)),key:pub(id),accountCreatedAt:now-200*86400,evidence:'Fixture: distinct operators',joinPayload,joinSignature:sign(joinPayload,id,'TrustSECO-join-v1'),...extra});
}
function setup(count=6,mode='commit-reveal-v1') {let s=freshPilot(pub('governor'),'assignment-test',mode);for(const id of ids.slice(0,count))s=enrol(s,id);return s;}
const openBody={kind:'open',round:'r',package:'pallets/flask',repository:'pallets/flask',version:'3.1.2',metric:'gh_contributor_count',source:'GitHub REST',method:'github-rest-v1',duration:10,bounty:'100'};
const open=(s=setup(),extra={})=>event(s,'governor',{...openBody,...extra});
const assignment=s=>s.escrows.r.assignment;
const secret=id=>crypto.createHash('sha256').update('deterministic TEST ONLY '+id).digest('hex');
function commit(s,actors=assignment(s).pool.map(m=>m.id)) {for(const actor of actors)s=event(s,actor,{kind:'entropy-commit',round:'r',contribution:entropyCommitment(assignment(s).context,actor,secret(actor))},now+1,2);return s;}
function reveal(s,actors=assignment(s).pool.map(m=>m.id)) {for(const actor of actors)s=event(s,actor,{kind:'entropy-reveal',round:'r',contribution:secret(actor)},now+ENTROPY_WINDOW,3);return s;}
const assigned=()=>reveal(commit(open()));
const observation=(actor,value=100,extra={})=>({kind:'observe',round:'r',source:'GitHub REST',method:'github-rest-v1',value,observedAt:measureAt,...extra});
function observe(s,values=[100,100,101]) {for(const [i,actor] of assignment(s).committee.slice(0,values.length).entries())s=event(s,actor,observation(actor,values[i]),measureAt,4);return s;}
const close=s=>settlePilot(s,closeAt,5);
const result=s=>roundResult(s,s.community.rounds[0]);

test('genesis is replay-compatible; activation is explicit, one-way and waits for escrows',()=>{
 assert.equal(freshPilot(pub('governor'),'n').assignmentVersion,undefined);
 let s=setup(6,'legacy-v1');assert.equal(s.assignmentVersion,undefined);
 assert.throws(()=>event(s,'a',{kind:'activate-assignment'}),/Governor/);
 const legacy=open(s);assert.throws(()=>event(legacy,'governor',{kind:'activate-assignment'}),/Settle/);
 const settled=settlePilot(settlePilot(legacy,now+11,2),now+11+DELAY,3);
 s=event(settled,'governor',{kind:'activate-assignment'},now+12+DELAY,4);
 assert.equal(s.assignmentVersion,'commit-reveal-v1');assert.throws(()=>event(s,'governor',{kind:'activate-assignment'}),/once/);
 assert.throws(()=>open(s,{round:'new-id'}),/redraw/);
 assert.equal(pilotView(s,now).policy.assignment,'commit-reveal-v1');
});
test('eligible pool is frozen, sorted and distinct; too few operators cannot lock bounty',()=>{
 assert.throws(()=>open(setup(2)),/three eligible/);
 let s=setup();s=event(s,'governor',{kind:'revoke',member:'f',reason:'fixture'});
 s=open(s);assert.deepEqual(assignment(s).pool.map(m=>m.id),ids.slice(0,5));
 const original=structuredClone(assignment(s));s=enrol(s,'late');assert.deepEqual(assignment(s),original);
 assert.throws(()=>event(s,'late',{kind:'entropy-commit',round:'r',contribution:secret('late')}),/frozen/);
 assert.throws(()=>enrol(setup(),'late',{operator:'a'}),/already enrolled/);
 assert.throws(()=>enrol(setup(),'late',{githubId:'97'}),/already enrolled/);
 const malformed=setup();malformed.community.members[1].operator='a';assert.throws(()=>open(malformed),/duplicate identities/);
});
test('same pool and inputs reproduce draw; event order and supplied seed/committee cannot select it',()=>{
 const s=setup();const first=open(s,{seed:secret('governor'),committee:['a','b','c']});
 const shuffled=structuredClone(s);shuffled.community.members.reverse();
 assert.deepEqual(assignment(first),assignment(open(shuffled)));
 const forward=reveal(commit(first));const reverse=reveal(commit(first,[...ids].reverse()),[...ids].reverse());
 assert.deepEqual(assignment(forward),assignment(reverse));assert.equal(assignment(forward).committee.length,3);
 assert.equal(new Set(assignment(forward).committee).size,3);
 assert.deepEqual(committeeFromSeed(assignment(forward).seed,ids),assignment(forward).committee);
 assert.equal(entropyCommitment('00'.repeat(32),'alice','11'.repeat(32)),'663961b7c0879b7580446e768f4d898e2da582acf6ede33192d476866f63aa0c');
 assert.equal(assignment(first).seed,null);assert.deepEqual(assignment(first).committee,[]);
});
test('commit/reveal authentication, binding, exact windows, replay and replacement defenses',()=>{
 const opened=open(), a=assignment(opened), c={kind:'entropy-commit',round:'r',contribution:entropyCommitment(a.context,'a',secret('a'))};
 assert.throws(()=>event(opened,'a',{...c,contribution:'xyz'}),/32 bytes/);
 assert.throws(()=>event(opened,'governor',c),/frozen/);
 const signed=envelope('a',c);assert.throws(()=>applyPilot(opened,signed.payload,sign(signed.payload,'b'),now,2),/signature/);
 let s=applyPilot(opened,signed.payload,signed.signature,now,2);
 assert.throws(()=>applyPilot(s,signed.payload,signed.signature,now,2),/replay/);
 assert.throws(()=>event(s,'a',c),/already committed/);
 assert.throws(()=>event(opened,'a',c,now+ENTROPY_WINDOW),/ended/);
 const r={kind:'entropy-reveal',round:'r',contribution:secret('a')};
 assert.throws(()=>event(s,'a',r,now+ENTROPY_WINDOW),/Every pool/);
 s=commit(opened);assert.throws(()=>event(s,'a',r,now+ENTROPY_WINDOW-1),/window/);
 assert.throws(()=>event(s,'a',{...r,contribution:secret('b')},now+ENTROPY_WINDOW),/mismatch/);
 assert.throws(()=>event(s,'a',r,measureAt),/window/);
 const one=reveal(s,['a']);assert.throws(()=>reveal(one,['a']),/already revealed/);
 const other=createAssignment('other-network','r',['pallets/flask','3.1.2','gh_contributor_count'],opened.community.members,[],now,1);
 assert.notEqual(entropyCommitment(other.context,'a',secret('a')),c.contribution);
 assert.equal(assignment(s).seed,null);assert.equal(assignment(one).seed,null);
});
test('missing commitment or reveal cannot cause fallback, replacement, or same-fact retry',()=>{
 for(const s of [commit(open(),ids.slice(0,5)),reveal(commit(open()),ids.slice(0,5))]) {
  assert.equal(assignment(s).seed,null);assert.deepEqual(assignment(s).committee,[]);
  assert.throws(()=>event(s,'a',observation('a'),measureAt,4),/not assigned/);
  const closed=close(s);assert.equal(result(closed).status,'expired');
  const paid=settlePilot(closed,closeAt+DELAY,6);assert.equal(paid.balances.governor,'1000000');assert.ok(conserved(paid));
  assert.deepEqual(paid.payouts.map(p=>p.kind),['refund']);
  assert.throws(()=>event(paid,'governor',{...openBody,round:'different',repository:'Pallets/Flask'},closeAt+DELAY+1,7),/redraw/);
  assert.equal(paid.community.incidents.length,0);
 }
});
test('only assigned operators can measure, after entropy window, once per round',()=>{
 let s=assigned();const [actor]=assignment(s).committee, outsider=ids.find(id=>!assignment(s).committee.includes(id));
 assert.throws(()=>event(s,outsider,observation(outsider),measureAt,4),/not assigned/);
 assert.throws(()=>event(s,actor,observation(actor),measureAt-1,4),/not started/);
 assert.throws(()=>event(s,actor,observation(actor,100,{observedAt:now}),measureAt,4),/not started/);
 s=event(s,actor,observation(actor),measureAt,4);
 assert.throws(()=>event(s,actor,observation(actor),measureAt,4),/already observed/);
 assert.throws(()=>event(s,assignment(s).committee[1],observation(actor),closeAt,5),/closed/);
});
test('compatible committee feeds scores only after closure/finality and preserves exact payouts',()=>{
 let s=observe(assigned());assert.equal(result(s).status,'verified');assert.deepEqual(verifiedInputs(s,'pallets/flask','3.1.2',4),[]);
 s=close(s);assert.deepEqual(verifiedInputs(s,'pallets/flask','3.1.2',4),[]);
 assert.deepEqual(verifiedInputs(s,'pallets/flask','3.1.2',5),[{fact:'gh_contributor_count',factData:'100',round:'r'}]);
 assert.equal(settlePilot(s,closeAt+DELAY-1,6).payouts.length,0);
 const paid=settlePilot(s,closeAt+DELAY,6);
 assert.deepEqual(paid.payouts.filter(p=>p.kind==='reward').map(p=>p.uid),[...assignment(s).committee].sort());
 assert.equal(paid.balances.governor,'999901');assert.ok(paid.payouts.filter(p=>p.kind==='reward').every(p=>p.amount==='33'));assert.ok(conserved(paid));
 assert.deepEqual(settlePilot(paid,closeAt+DELAY+1,7),paid);
});
test('missing observations and disagreements never lower quorum, redraw, or punish automatically',()=>{
 for(const [values,status] of [[[100,100],'expired'],[[100,100,999],'disputed']]) {
  const s=close(observe(assigned(),values));assert.equal(result(s).status,status);assert.equal(s.community.incidents.length,0);
  assert.deepEqual(verifiedInputs(s,'pallets/flask','3.1.2',5),[]);
  assert.deepEqual(settlePilot(s,closeAt+DELAY,6).payouts.map(p=>p.kind),['refund']);
  assert.throws(()=>open(s,{round:'retry'}),/redraw/);
 }
});
test('revocation never replaces an entropy participant or selected observer',()=>{
 let s=commit(open());const old=structuredClone(assignment(s).pool);
 s=event(s,'governor',{kind:'revoke',member:'f',reason:'fixture'},now+2,3);
 assert.deepEqual(assignment(s).pool,old);assert.throws(()=>reveal(s,['f']),/revoked/);
 let ready=observe(assigned());const member=assignment(ready).committee[0],committee=structuredClone(assignment(ready).committee);
 ready=event(ready,'governor',{kind:'revoke',member,reason:'fixture'},measureAt+1,5);
 assert.deepEqual(assignment(ready).committee,committee);assert.equal(result(close(ready)).status,'expired');
 assert.deepEqual(settlePilot(close(ready),closeAt+DELAY,6).payouts.map(p=>p.kind),['refund']);
});
test('evidence review and appeals retain score and reward consequences',()=>{
 let s=close(observe(assigned()));const o=s.community.rounds[0].observations[0];
 s=event(s,'governor',{kind:'substantiate',round:'r',observation:o.id,cause:'independent-evidence',evidence:'fixture evidence',reason:'fixture failure'},closeAt+1,6);
 const incident=s.community.incidents[0].id;assert.equal(result(s).status,'expired');
 assert.deepEqual(settlePilot(s,closeAt+DELAY,9).payouts.map(p=>p.kind),['refund']);
 s=event(s,o.member,{kind:'appeal',incident,reason:'counter-evidence'},closeAt+2,7);
 assert.equal(result(s).status,'expired');
 s=event(s,'governor',{kind:'overturn',incident,reason:'verified counter-evidence'},closeAt+3,8);
 assert.equal(result(s).status,'verified');assert.deepEqual(verifiedInputs(s,'pallets/flask','3.1.2',7),[]);
 assert.equal(verifiedInputs(s,'pallets/flask','3.1.2',8).length,1);
 assert.equal(settlePilot(s,closeAt+DELAY,9).payouts.filter(p=>p.kind==='reward').length,3);
});
test('new and activated metadata plus partial entropy survive normalized storage reload',async()=>{
 const data=new Map();const store={has:async(c,k)=>data.has(k.toString('hex')),get:async(c,k)=>data.get(k.toString('hex')),set:async(c,k,v)=>data.set(k.toString('hex'),v),del:async(c,k)=>data.delete(k.toString('hex'))};
 let previous=freshPilot(pub('governor'),'assignment-test','legacy-v1');await initPilot(store,{},previous);
 assert.deepEqual(await loadPilot(store,{}),previous);
 let next=event(setup(6,'legacy-v1'),'governor',{kind:'activate-assignment'});next=commit(open(next),['a']);
 await savePilot(store,{},previous,next);assert.deepEqual(await loadPilot(store,{}),next);
 previous=next;next=reveal(commit(next,ids.slice(1)));await savePilot(store,{},previous,next);assert.deepEqual(await loadPilot(store,{}),next);
});

test('standard miners complete signed entropy, collect only assigned work and settle through ledger policy',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const {mineOnce}=require('../../../tools/pilot/client.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'trustseco-miner-ledger-'));
 const fetchBefore=global.fetch,dateBefore=Date.now;
 let s=open(setup(),{metric:'gh_open_issues_count',duration:120}),at=now+1,height=2,collections=0;
 try {
  for(const id of ids)fs.writeFileSync(path.join(dir,id+'.json'),JSON.stringify({id,privateKey:keys[id].privateKey.export({type:'pkcs8',format:'pem'}).toString()}));
  global.fetch=async(url,options)=>{
   if(url.startsWith('https://api.github.com/')) {collections++;return {ok:true,json:async()=>({incomplete_results:false,total_count:100})};}
   assert.ok(url.startsWith('http://localhost/api/pilot/'));
   if(options?.method==='POST') {const e=JSON.parse(options.body);s=applyPilot(s,e.payload,e.signature,at,height);return {ok:true,json:async()=>({status:'recorded'})};}
   return {ok:true,json:async()=>({...pilotView(s,at),ledger:{height,finalizedHeight:height}})};
  };
  for(const id of ids)assert.equal(await mineOnce('http://localhost',path.join(dir,id+'.json')),true);
  assert.equal(collections,0);assert.equal(Object.keys(assignment(s).commitments).length,6);
  at=now+ENTROPY_WINDOW;height=3;
  for(const id of ids)assert.equal(await mineOnce('http://localhost',path.join(dir,id+'.json')),true);
  assert.equal(assignment(s).committee.length,3);assert.equal(collections,0);
  at=measureAt;height=4;Date.now=()=>measureAt*1000;
  for(const id of ids)assert.equal(await mineOnce('http://localhost',path.join(dir,id+'.json')),assignment(s).committee.includes(id));
  assert.equal(collections,3);assert.equal(s.community.rounds[0].observations.length,3);
  s=settlePilot(s,measureAt+121,5);assert.equal(result(s).status,'verified');assert.equal(verifiedInputs(s,'pallets/flask','3.1.2',5)[0].factData,'100');
  s=settlePilot(s,measureAt+121+DELAY,6);assert.equal(s.payouts.filter(p=>p.kind==='reward').length,3);assert.ok(conserved(s));
 } finally {global.fetch=fetchBefore;Date.now=dateBefore;fs.rmSync(dir,{recursive:true,force:true});}
});
