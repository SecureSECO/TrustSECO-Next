const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {freshPilot,applyPilot,settlePilot,roundResult,pilotView,verifiedInputs,conserved,DELAY}=require('../dist/app/modules/pilot/policy');
const {verifyBeacon,AVAILABILITY_VERSION,BEACON_LEAD_SECONDS}=require('../dist/app/modules/pilot/availability');
const {initPilot,loadPilot,savePilot}=require('../dist/app/modules/pilot/storage');
const beacon=require('./drand-quicknet-vector.json'),network=require('../dist/app/modules/pilot/beacon-network.json');
const beaconTime=network.genesis_time+(beacon.round-1)*network.period,now=beaconTime-BEACON_LEAD_SECONDS;
const ids=['a','b','c','d','e','f'],keys=Object.fromEntries(['governor',...ids].map(id=>[id,crypto.generateKeyPairSync('ed25519')]));
const pub=id=>keys[id].publicKey.export({type:'spki',format:'pem'}).toString();let seq=0;
const sign=(payload,id,domain='TrustSECO-community-v1')=>crypto.sign(null,Buffer.from(domain+'\n'+payload),keys[id].privateKey).toString('base64');
function event(s,actor,body,at=now,height=1){const payload=JSON.stringify({network:s.network,id:'availability-'+ ++seq,actor,...body});return applyPilot(s,payload,sign(payload,actor),at,height)}
function setup(online=ids,mode=AVAILABILITY_VERSION){let s=freshPilot(pub('governor'),'availability-test',mode);for(const id of ids){const joinPayload=JSON.stringify({network:s.network,login:id,publicKey:pub(id),expiresAt:now+3600,nonce:'0123456789abcdef'});s=event(s,'governor',{kind:'enrol',member:id,key:pub(id),githubId:String(id.charCodeAt(0)),operator:id,accountCreatedAt:now-200*86400,evidence:'Local fixture',joinPayload,joinSignature:sign(joinPayload,id,'TrustSECO-join-v1')});}if(mode===AVAILABILITY_VERSION)for(const id of online)s=event(s,id,{kind:'availability',until:now+900});return s;}
const body={kind:'open',round:'r',package:'pallets/flask',repository:'pallets/flask',version:'3.1.2',metric:'gh_open_issues_count',source:'GitHub REST',method:'github-rest-v1',duration:180,bounty:'300'};
const open=(s=setup())=>event(s,'governor',body,now,2);
const a=s=>s.escrows.r.assignment;
const assign=(s=open())=>event(s,'a',{kind:'assignment-beacon',round:'r',beaconRound:beacon.round,beaconSignature:beacon.signature},beaconTime,3);
const observe=(s,id,value=100,at=beaconTime+1,height=4)=>event(s,id,{kind:'observe',round:'r',value,observedAt:at,source:body.source,method:body.method},at,height);
const result=s=>roundResult(s,s.community.rounds[0]);

test('real Quicknet vector verifies; wrong round, altered signature and untrusted keys do not',()=>{
 assert.equal(verifyBeacon(beacon.round,beacon.signature),true);
 assert.equal(verifyBeacon(beacon.round+1,beacon.signature),false);
 assert.equal(verifyBeacon(beacon.round,'00'+beacon.signature.slice(2)),false);
 assert.equal(verifyBeacon(beacon.round,'00'.repeat(48)),false);
 assert.equal(verifyBeacon(-1,beacon.signature),false);
 assert.deepEqual(network,require('../../../tools/pilot/beacon-network.json'));
});
test('availability is signed, bounded, expiring, withdrawable and cannot enrol fake members',()=>{
 let s=setup([]);assert.throws(()=>event(s,'governor',{kind:'availability',until:now+900}),/contributor/);
 for(const until of [now,now+901,1.5,-1])assert.throws(()=>event(s,'a',{kind:'availability',until}),/expiry/);
 s=event(s,'a',{kind:'availability',until:now+900});assert.equal(pilotView(s,now).availableContributors,1);assert.equal(pilotView(s,now+900).availableContributors,0);
 s=event(s,'a',{kind:'availability',until:0});assert.equal(pilotView(s,now).availableContributors,0);
 s=event(s,'governor',{kind:'revoke',member:'a',reason:'fixture'});assert.throws(()=>event(s,'a',{kind:'availability',until:now+900}),/revoked/);
});
test('two available contributors wait without opening a round or taking bounty',()=>{
 const s=setup(['a','b']);assert.throws(()=>open(s),/Waiting for contributors/);assert.equal(s.balances.governor,'1000000');assert.equal(s.community.rounds.length,0);
 assert.throws(()=>event(setup(),'governor',body,now+901),/Waiting for contributors/);
});
test('six admitted, three online: no entropy participation by the offline members is needed',()=>{
 let s=assign(open(setup(['a','b','c'])));assert.deepEqual(a(s).pool.map(m=>m.id),['a','b','c']);
 for(const id of a(s).committee)s=observe(s,id);
 s=settlePilot(s,beaconTime+2,5);assert.ok(s.community.rounds[0].closesAt>=s.community.rounds[0].observations[0].observedAt);assert.equal(result(s).status,'verified');assert.equal(s.community.rounds[0].closed,true);
 assert.equal(verifiedInputs(s,body.repository,body.version,4).length,0);assert.equal(verifiedInputs(s,body.repository,body.version,5).length,1);
 const paid=settlePilot(s,beaconTime+2+DELAY,6);assert.deepEqual(paid.payouts.map(p=>p.amount),['100','100','100']);assert.ok(conserved(paid));
 assert.deepEqual(settlePilot(paid,beaconTime+3+DELAY,7),paid);
});
test('frozen pool and future beacon cannot be changed by renewal, caller seed or alternative proof',()=>{
 let s=open();const original=structuredClone(a(s));assert.equal(a(s).beaconRound,beacon.round);
 s=event(s,'f',{kind:'availability',until:0},now+1,3);assert.deepEqual(a(s),original);
 const proof={kind:'assignment-beacon',round:'r',beaconRound:beacon.round,beaconSignature:beacon.signature,seed:'0'.repeat(64),committee:['a','b','c']};
 assert.throws(()=>event(s,'a',proof,beaconTime-1,4),/window/);
 assert.throws(()=>event(s,'a',{...proof,beaconRound:beacon.round+1},beaconTime,4),/Wrong/);
 assert.throws(()=>event(s,'a',{...proof,beaconSignature:'00'.repeat(48)},beaconTime,4),/signature/);
 s=event(s,'a',proof,beaconTime,4);assert.notEqual(a(s).seed,proof.seed);assert.equal(new Set(a(s).order).size,6);
 assert.throws(()=>event(s,'b',proof,beaconTime+1,5),/already determined/);
 assert.throws(()=>event(s,'a',{kind:'entropy-commit',round:'r',contribution:'00'.repeat(32)},beaconTime+1,5),/Assigned round/);
});
test('offline assigned observer is replaced in fixed order; old and premature reserve submissions fail',()=>{
 let s=assign();const order=[...a(s).order],missing=order[0];
 for(const id of order.slice(1,3))s=observe(s,id);
 assert.throws(()=>observe(s,order[3]),/not assigned/);
 s=settlePilot(s,beaconTime+181,5);assert.equal(a(s).slots[0].replaced,true);assert.ok(a(s).committee.includes(order[3]));assert.deepEqual(a(s).order,order);
 assert.throws(()=>observe(s,missing,100,beaconTime+181,6),/not assigned/);
 assert.throws(()=>event(s,order[3],{kind:'observe',round:'r',value:100,observedAt:beaconTime,source:body.source,method:body.method},beaconTime+181,6),/slot/);
 s=observe(s,order[3],100,beaconTime+182,6);s=settlePilot(s,beaconTime+183,7);
 assert.equal(result(s).status,'verified');assert.equal(s.community.incidents.length,0);
 assert.equal(verifiedInputs(s,body.repository,body.version,7).length,1);
});
test('all initial observers offline: three reserves still complete the same draw',()=>{
 let s=assign();const order=[...a(s).order];s=settlePilot(s,beaconTime+181,5);assert.deepEqual(a(s).committee,order.slice(3));
 for(const id of order.slice(3))s=observe(s,id,100,beaconTime+182,6);
 s=settlePilot(s,beaconTime+183,7);assert.equal(result(s).status,'verified');
});
test('a submitted disagreement occupies its slot and cannot be replaced to manufacture agreement',()=>{
 let s=assign();const order=[...a(s).order];s=observe(s,order[0],999);s=observe(s,order[1]);s=observe(s,order[2]);
 s=settlePilot(s,beaconTime+2,5);assert.equal(result(s).status,'disputed');assert.equal(a(s).nextReserve,3);assert.equal(s.community.rounds[0].observations.length,3);
 assert.throws(()=>observe(s,order[3],100,beaconTime+181,6),/not assigned/);
 assert.equal(verifiedInputs(s,body.repository,body.version,5).length,0);assert.deepEqual(settlePilot(s,beaconTime+2+DELAY,6).payouts.map(p=>p.kind),['refund']);
});
test('two remaining responders and beacon outage never lower quorum or create punishment',()=>{
 let s=assign();for(const id of a(s).committee.slice(0,2))s=observe(s,id);
 s=settlePilot(s,beaconTime+721,6);assert.equal(result(s).status,'expired');assert.equal(pilotView(s,beaconTime+721).rounds[0].assignmentPhase,'insufficient-contributors');assert.equal(s.community.incidents.length,0);
 assert.throws(()=>event(s,'governor',{...body,round:'redraw'},beaconTime+722,7),/redraw/);
 const unavailable=settlePilot(open(),beaconTime+601,4);assert.equal(result(unavailable).status,'expired');assert.equal(a(unavailable).seed,null);
});
test('activation preserves existing rounds and balances and new state survives normalized reload',async()=>{
 let old=setup([],'legacy-v1'),s=event(old,'governor',{kind:'activate-availability'});assert.equal(s.assignmentVersion,AVAILABILITY_VERSION);assert.throws(()=>event(s,'governor',{kind:'activate-availability'}),/once/);
 assert.throws(()=>event(setup([],'legacy-v1'),'a',{kind:'activate-availability'}),/Governor/);
 const openLegacy=event(old,'governor',body);assert.throws(()=>event(openLegacy,'governor',{kind:'activate-availability'}),/Close/);
 const closedLegacy=settlePilot(openLegacy,now+181,2);const upgraded=event(closedLegacy,'governor',{kind:'activate-availability'},now+182,3);assert.deepEqual(upgraded.escrows,closedLegacy.escrows);assert.deepEqual(upgraded.balances,closedLegacy.balances);
 const data=new Map(),store={has:async(c,k)=>data.has(k.toString('hex')),get:async(c,k)=>data.get(k.toString('hex')),set:async(c,k,v)=>data.set(k.toString('hex'),v),del:async(c,k)=>data.delete(k.toString('hex'))};
 await initPilot(store,{},old);s=settlePilot(assign(),beaconTime+181,5);await savePilot(store,{},old,s);assert.deepEqual(await loadPilot(store,{}),s);
});
test('real miner client obtains leases and a pinned beacon, then handles an offline selected miner',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{mineOnce}=require('../../../tools/pilot/client.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'availability-e2e-'));const oldFetch=global.fetch,oldDate=Date.now;
 let s=setup([]),at=now,height=1,collections=0;
 const mine=id=>mineOnce('http://localhost',path.join(dir,id+'.json'),{github:'test'});
 try{
  for(const id of ids)fs.writeFileSync(path.join(dir,id+'.json'),JSON.stringify({id,privateKey:keys[id].privateKey.export({type:'pkcs8',format:'pem'}).toString()}));
  global.fetch=async(url,options)=>{
   if(url.startsWith('https://api.drand.sh/'))return {ok:true,json:async()=>beacon};
   if(url.startsWith('https://api.github.com/')){collections++;return {ok:true,json:async()=>({incomplete_results:false,total_count:100})};}
   if(options?.method==='POST'){const e=JSON.parse(options.body);s=applyPilot(s,e.payload,e.signature,at,height);return {ok:true,json:async()=>({status:'recorded'})};}
   return {ok:true,json:async()=>({...pilotView(s,at),ledger:{height,finalizedHeight:height}})};
  };
  Date.now=()=>at*1000;
  for(const id of ids)assert.equal(await mine(id),true);
  s=open(s);at=beaconTime;height=3;assert.equal(await mine('a'),true);const order=[...a(s).order];
  for(const id of order.slice(1,3))assert.equal(await mine(id),true);
  assert.equal(await mine(order[3]),false);assert.equal(collections,2);
  at=beaconTime+181;height=5;s=settlePilot(s,at,height);assert.equal(await mine(order[3]),true);
  s=settlePilot(s,at+1,6);assert.equal(result(s).status,'verified');assert.equal(collections,3);
  assert.equal(verifiedInputs(s,body.repository,body.version,6).length,1);
 }finally{global.fetch=oldFetch;Date.now=oldDate;fs.rmSync(dir,{recursive:true,force:true});}
});
