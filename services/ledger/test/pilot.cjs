const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {freshPilot,applyPilot,settlePilot,conserved,roundResult,verifiedInputs,DELAY}=require('../dist/app/modules/pilot/policy');
const {initPilot,loadPilot,savePilot}=require('../dist/app/modules/pilot/storage');
const keys=Object.fromEntries(['governor','a','b','c','d'].map(id=>[id,crypto.generateKeyPairSync('ed25519')]));
const pub=id=>keys[id].publicKey.export({type:'spki',format:'pem'}).toString();
const now=2000000000;let seq=0;
const signature=(payload,id,domain='TrustSECO-community-v1')=>crypto.sign(null,Buffer.from(domain+'\n'+payload),keys[id].privateKey).toString('base64');
function envelope(actor,body){const payload=JSON.stringify({id:'e'+(++seq),actor,network:'test-network',...body});return {payload,signature:signature(payload,actor)}}
function event(s,actor,body,at=now,height=1){const e=envelope(actor,body);return applyPilot(s,e.payload,e.signature,at,height)}
function enrolment(id){const joinPayload=JSON.stringify({network:'test-network',login:id,publicKey:pub(id),expiresAt:now+3600,nonce:crypto.randomUUID()});return {kind:'enrol',member:id,key:pub(id),githubId:String(id.charCodeAt(0)),operator:id,accountCreatedAt:now-200*86400,evidence:'Test fixture only',joinPayload,joinSignature:signature(joinPayload,id,'TrustSECO-join-v1')}}
function setup(){let s=freshPilot(pub('governor'),'test-network');for(const id of ['a','b','c','d'])s=event(s,'governor',enrolment(id));return s}
const openBody={kind:'open',round:'r',package:'pallets/flask',repository:'pallets/flask',version:'3.1.2',metric:'gh_contributor_count',source:'GitHub REST',method:'github-rest-v1',duration:10,bounty:'100'};
function open(s=setup(),body={}){return event(s,'governor',{...openBody,...body})}
function observations(s,values=[100,101,100]){for(let i=0;i<values.length;i++)s=event(s,['a','b','c','d'][i],{kind:'observe',round:'r',value:values[i],source:'GitHub REST',method:'github-rest-v1',observedAt:now});return s}
const closed=values=>settlePilot(observations(open(),values),now+11,2);
test('admission requires contributor proof and prevents cross-network signatures',()=>{
 const s=freshPilot(pub('governor'),'test-network');assert.throws(()=>event(s,'governor',{...enrolment('a'),joinSignature:'bad'}),/proof/);
 assert.throws(()=>event(s,'governor',{...enrolment('a'),network:'another'}),/network/);
 assert.throws(()=>event(s,'governor',{...enrolment('a'),key:pub('b')}),/key mismatch/);
 assert.throws(()=>event(s,'governor',enrolment('a'),now+7200),/expired/);
});
test('age, unique GitHub IDs and operator identities remain enforced',()=>{
 const s=setup();assert.throws(()=>event(s,'governor',{...enrolment('a'),accountCreatedAt:now}),/180/);
 assert.throws(()=>event(s,'governor',enrolment('a')),/already/);
});
test('escrow reserves a finite bounty and rejects overdraw or duplicate work',()=>{
 const s=open();assert.equal(s.balances.governor,'999900');assert.ok(conserved(s));
 assert.throws(()=>open(setup(),{bounty:'1000001'}),/Insufficient/);
 assert.throws(()=>open(s,{round:'second'}),/already open/);
 assert.throws(()=>open(setup(),{round:'constructor'}),/round ID/);
});
test('metric-specific tolerance rejects agreement that legacy stars tolerance would accept',()=>{
 const s=closed([100,103,104]);assert.equal(roundResult(s,s.community.rounds[0]).status,'disputed');
 assert.equal(roundResult(closed(),closed().community.rounds[0]).status,'verified');
});
test('two contributors never lower the quorum or receive rewards',()=>{
 const s=settlePilot(closed([100,100]),now+11+DELAY,3);assert.equal(s.payouts.length,1);
 assert.equal(s.payouts[0].kind,'refund');assert.equal(s.balances.governor,'1000000');
});
test('no early payout; exact 24h boundary pays supporters and refunds integer remainder',()=>{
 const s=closed();assert.equal(settlePilot(s,now+10+DELAY,3).payouts.length,0);
 const paid=settlePilot(s,now+11+DELAY,3);assert.deepEqual(paid.payouts.map(p=>[p.uid,p.amount,p.kind]),[['a','33','reward'],['b','33','reward'],['c','33','reward'],['governor','1','refund']]);
 assert.equal(paid.balances.governor,'999901');assert.ok(conserved(paid));
 assert.deepEqual(settlePilot(paid,now+12+DELAY,4),paid);
});
test('outlier gets no reward and no automatic misconduct incident',()=>{
 const s=settlePilot(closed([100,101,100,900]),now+11+DELAY,3);
 assert.equal(s.balances.d,'0');assert.equal(s.community.incidents.length,0);assert.ok(conserved(s));
});
test('revocation before payment removes eligibility and refunds unresolved work',()=>{
 let s=event(closed(),'governor',{kind:'revoke',member:'c',reason:'Key compromised'},now+12,3);
 s=settlePilot(s,now+11+DELAY,4);assert.equal(s.payouts[0].kind,'refund');
 assert.throws(()=>event(s,'c',{kind:'transfer',recipient:'a',amount:'1'}),/revoked/);
 assert.throws(()=>event(s,'governor',{kind:'reinstate',member:'c',reason:'oops'}),/Revoked/);
});
test('rewards are spendable ledger balances, transfer cannot mint or replay',()=>{
 const s=settlePilot(closed(),now+11+DELAY,3),e=envelope('a',{kind:'transfer',recipient:'b',amount:'20'});
 const next=applyPilot(s,e.payload,e.signature,now+12+DELAY,4);assert.equal(next.balances.a,'13');assert.equal(next.balances.b,'53');assert.ok(conserved(next));
 assert.throws(()=>applyPilot(next,e.payload,e.signature,now+12+DELAY,4),/replay/);
 assert.throws(()=>event(next,'a',{kind:'transfer',recipient:'b',amount:'14'}),/Insufficient/);
});
test('scores exclude open, disputed and unfinalized rounds',()=>{
 assert.deepEqual(verifiedInputs(observations(open()),'pallets/flask','3.1.2',10),[]);
 assert.deepEqual(verifiedInputs(closed(),'pallets/flask','3.1.2',1),[]);
 assert.deepEqual(verifiedInputs(closed(),'pallets/flask','3.1.2',2),[{fact:'gh_contributor_count',factData:'100',round:'r'}]);
 assert.deepEqual(verifiedInputs(closed([100,900,500]),'pallets/flask','3.1.2',2),[]);
});
test('unfinalized review cannot restore confirmed score inputs',()=>{
 const s=event(closed(),'governor',{kind:'revoke',member:'d',reason:'test'},now+12,3);
 assert.deepEqual(verifiedInputs(s,'pallets/flask','3.1.2',2),[]);
 assert.equal(verifiedInputs(s,'pallets/flask','3.1.2',3).length,1);
});
test('normalized storage preserves balances, escrow, audit and payments across reload',async()=>{
 const data=new Map();let writes=0;
 const store={has:async(c,k)=>data.has(k.toString('hex')),get:async(c,k)=>data.get(k.toString('hex')),set:async(c,k,v)=>{writes++;data.set(k.toString('hex'),v)},del:async(c,k)=>data.delete(k.toString('hex'))};
 const initial=freshPilot(pub('governor'),'test-network');await initPilot(store,{},initial);
 const next=settlePilot(closed(),now+11+DELAY,3);await savePilot(store,{},initial,next);assert.deepEqual(await loadPilot(store,{}),next);
 const previousWrites=writes;await savePilot(store,{},next,next);assert.equal(writes,previousWrites);
});

test('Libraries.io rounds require their own source and feed finalized scores and rewards',()=>{
 assert.throws(()=>open(setup(),{metric:'lib_contributor_count'}),/Unsupported/);
 assert.throws(()=>open(setup(),{source:'Libraries.io REST',method:'libraries-repository-v1'}),/Unsupported/);
 let s=open(setup(),{metric:'lib_contributor_count',source:'Libraries.io REST',method:'libraries-repository-v1'});
 for(const actor of ['a','b','c'])s=event(s,actor,{kind:'observe',round:'r',value:100,source:'Libraries.io REST',method:'libraries-repository-v1',observedAt:now});
 s=settlePilot(s,now+11,2);assert.equal(verifiedInputs(s,'pallets/flask','3.1.2',2)[0].fact,'lib_contributor_count');
 s=settlePilot(s,now+11+DELAY,3);assert.equal(s.balances.a,'33');assert.ok(conserved(s));
});
test('registry targets survive storage, prevent collisions and use exact dependency/date agreement',async()=>{
 const body={metric:'lib_dependency_count',source:'Libraries.io REST',method:'libraries-project-v1',packagePlatform:'PyPI',packageName:'Flask'};
 assert.throws(()=>open(setup(),{...body,packageName:undefined}),/registry/);
 let s=open(setup(),body);assert.equal(s.escrows.r.packageName,'Flask');
 assert.throws(()=>open(s,{...body,round:'different',metric:'lib_release_count',packageName:'Another'}),/mapping/);
 for(const actor of ['a','b','c'])s=event(s,actor,{kind:'observe',round:'r',value:5,source:body.source,method:body.method,observedAt:now});
 s=settlePilot(s,now+11,2);assert.equal(verifiedInputs(s,'pallets/flask','3.1.2',2)[0].factData,'5');
 const data=new Map(),store={has:async(c,k)=>data.has(k.toString('hex')),get:async(c,k)=>data.get(k.toString('hex')),set:async(c,k,v)=>data.set(k.toString('hex'),v),del:async(c,k)=>data.delete(k.toString('hex'))};
 const initial=freshPilot(pub('governor'),'test-network');await initPilot(store,{},initial);await savePilot(store,{},initial,s);assert.deepEqual((await loadPilot(store,{})).escrows,s.escrows);
 const {METRICS}=require('../dist/app/modules/pilot/policy');assert.deepEqual(METRICS.lib_first_release_date,{absolute:0,relativeBps:0});assert.deepEqual(METRICS.lib_dependency_count,{absolute:0,relativeBps:0});
});

test('release timestamps accept modern dates and reject future observations',()=>{
 const body={metric:'lib_first_release_date',source:'Libraries.io REST',method:'libraries-project-v1',packagePlatform:'PyPI',packageName:'Flask'};
 let s=open(setup(),body);
 const observation={kind:'observe',round:'r',value:1271428177,source:body.source,method:body.method,observedAt:now};
 assert.throws(()=>event(s,'a',{...observation,value:now+1}),/Invalid observation value/);
 for(const actor of ['a','b','c'])s=event(s,actor,observation);
 s=settlePilot(s,now+11,2);assert.equal(verifiedInputs(s,'pallets/flask','3.1.2',2)[0].factData,'1271428177');
});
