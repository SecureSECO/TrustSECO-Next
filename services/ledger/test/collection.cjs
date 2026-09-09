const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {freshPilot,applyPilot,settlePilot,pilotView,conserved}=require('../dist/app/modules/pilot/policy');
const {initPilot,loadPilot,savePilot,recordedEvent,auditPage,AUDIT_WINDOW}=require('../dist/app/modules/pilot/storage');
const beacon=require('./drand-quicknet-vector.json'),network=require('../dist/app/modules/pilot/beacon-network.json');
const at=network.genesis_time+(beacon.round-1)*network.period-180;
const keys=Object.fromEntries(['governor','a','b','c','d'].map(id=>[id,crypto.generateKeyPairSync('ed25519')]));
const pub=id=>keys[id].publicKey.export({type:'spki',format:'pem'}).toString();let sequence=0;
function event(s,actor,body,time=at,height=1){const payload=JSON.stringify({network:s.network,id:'c-'+ ++sequence,actor,...body});return applyPilot(s,payload,crypto.sign(null,Buffer.from('TrustSECO-community-v1\n'+payload),keys[actor].privateKey).toString('base64'),time,height);}
function setup(){let s=freshPilot(pub('governor'),'collection-test','availability-beacon-v1');s.community.members=['a','b','c','d'].map(id=>({id,key:pub(id),operator:id,githubId:id,suspended:false,reinstatedAt:-1}));for(const id of ['a','b','c','d']){s.balances[id]='0';s=event(s,id,{kind:'availability',until:at+900});}return s;}
const body={kind:'open',round:'first',repository:'pallets/flask',package:'pallets/flask',version:'3.1.1',metric:'lib_sourcerank',source:'Libraries.io REST',method:'libraries-project-v1',packagePlatform:'PyPI',packageName:'Flask',duration:900,bounty:'300'};
const activate=s=>event(s,'governor',{kind:'activate-collection'});
const mem=()=>{const data=new Map();return {data,has:async(c,k)=>data.has(k.toString('hex')),get:async(c,k)=>{if(!data.has(k.toString('hex')))throw Error('Missing '+k);return data.get(k.toString('hex'));},set:async(c,k,v)=>data.set(k.toString('hex'),v),del:async(c,k)=>data.delete(k.toString('hex'))};};
test('collection activation is signed, one-way, waits for closed rounds and preserves balances',()=>{
 const s=setup();assert.throws(()=>event(s,'a',{kind:'activate-collection'}),/Governor/);const live=event(s,'governor',body);assert.throws(()=>activate(live),/Close/);const closed=settlePilot(live,at+1000,2),up=activate(closed);assert.deepEqual(up.balances,closed.balances);assert.deepEqual(up.escrows,closed.escrows);assert.throws(()=>activate(up),/once/);
});
test('failed, disputed and successful refreshes all require 24h and exact predecessor',()=>{
 for(const status of ['expired','disputed','verified']){
  let s=event(activate(setup()),'governor',body);s=settlePilot(s,at+1000,2);s.community.rounds[0].result.status=status;
  assert.throws(()=>event(s,'governor',{...body,round:'retry',refreshOf:'first'},at+86399),/24-hour/);
  for(const id of ['a','b','c','d'])s=event(s,id,{kind:'availability',until:at+86400+900},at+86400);
  assert.throws(()=>event(s,'governor',{...body,round:'retry',refreshOf:'wrong'},at+86400),/latest/);
  s=event(s,'governor',{...body,round:'retry',refreshOf:'first'},at+86400);assert.equal(s.escrows.retry.refreshOf,'first');assert.equal(s.community.rounds.length,2);assert.ok(conserved(s));
 }
});
test('source failures are signed claims, not observations, rewards or replacements',()=>{
 let s=event(activate(setup()),'governor',body);s=event(s,'a',{kind:'assignment-beacon',round:'first',beaconRound:beacon.round,beaconSignature:beacon.signature},at+180,2);
 const a=s.escrows.first.assignment,member=a.committee[0],reserve=a.order[3];
 assert.throws(()=>event(s,reserve,{kind:'unavailable',round:'first',reason:'source-incomplete'},at+181),/active observer/);
 s=event(s,member,{kind:'unavailable',round:'first',reason:'source-incomplete'},at+181);assert.equal(s.community.rounds[0].observations.length,0);assert.equal(s.escrows.first.assignment.nextReserve,3);assert.equal(s.community.incidents.length,0);
 assert.throws(()=>event(s,member,{kind:'unavailable',round:'first',reason:'source-incomplete'},at+182),/already reported/);
 // A temporary source problem does not prohibit a later successful observation.
 s=event(s,member,{kind:'observe',round:'first',value:28,observedAt:at+182,source:body.source,method:body.method},at+182);assert.equal(s.community.rounds[0].observations.length,1);
});
test('more than 10,000 audit events remain retrievable while loaded history is bounded',async()=>{
 const store=mem(),old=setup();old.community.audit=Array.from({length:10500},(_,i)=>({id:'history-'+i,kind:i===1?'reinstate':'availability',actor:'governor',at,height:i+1,payload:JSON.stringify({member:'a',id:'history-'+i}),signature:'synthetic-storage-fixture'}));
 await initPilot(store,{},old);const activated=activate(old);await savePilot(store,{},old,activated);
 let current=await loadPilot(store,{});assert.equal(current.community.audit.length,AUDIT_WINDOW);assert.equal(current.reviewHeights.a,2);
 assert.equal((await recordedEvent(store,{},'history-0')).id,'history-0');assert.equal(await recordedEvent(store,{},'missing'),null);
 const updated=event(current,'a',{kind:'availability',until:at+900});await savePilot(store,{},current,updated);current=await loadPilot(store,{});
 assert.equal(current.community.audit.length,AUDIT_WINDOW);assert.equal(pilotView(current,at).auditCount,10502);assert.equal(current.reviewHeights.a,2);
 const newest=await auditPage(store,{}),oldest=await auditPage(store,{},2);assert.equal(newest.total,10502);assert.equal(newest.events.length,200);assert.deepEqual(oldest.events.map(e=>e.id),['history-1','history-0']);assert.equal(oldest.nextCursor,null);
 assert.equal((await recordedEvent(store,{},updated.community.audit.at(-1).id)).payload,updated.community.audit.at(-1).payload);
 // Saving a no-op block cannot remove an archived record or shift its index.
 const before=store.data.size;await savePilot(store,{},current,settlePilot(current,at,3));assert.equal(store.data.size,before);assert.ok(await recordedEvent(store,{},'history-0'));
});
