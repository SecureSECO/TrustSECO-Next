const {test}=require('node:test'), assert=require('node:assert/strict');
const {freshPilot}=require('../dist/app/modules/pilot/policy');
const {initPilot,miningWork,miningStatus}=require('../dist/app/modules/pilot/storage');
const {canObserve,expiredEnvelope}=require('../../../tools/pilot/assignment.cjs');
function store(){const data=new Map(),reads=[];return {data,reads,has:async(_,k)=>data.has(k.toString()),get:async(_,k)=>{reads.push(k.toString());if(!data.has(k.toString()))throw Error('Missing '+k);return data.get(k.toString());},set:async(_,k,v)=>data.set(k.toString(),v),del:async(_,k)=>data.delete(k.toString())};}
function state(){
 const s=freshPilot('governor-key','test','availability-beacon-v1');s.collectionVersion='scheduled-v1';
 for(const id of ['alice','bob']){s.community.members.push({id,key:id+'-key',operator:id,githubId:id,suspended:false,reinstatedAt:0});s.balances[id]='0';s.availability[id]={until:900,height:1};}
 function add(id,closed,member,seed='fixed'){
  s.community.rounds.push({id,package:'org/repo',metric:'gh_open_issues_count',source:'GitHub REST',method:'github-rest-v1',openedAt:50,closesAt:closed?80:1000,closed,observations:[{id:'o-'+id,member:'bob',value:123,observedAt:60,receivedAt:60,eligible:true,security:{large:'x'.repeat(10000)}}]});
  s.escrows[id]={repository:'org/repo',version:'1.0',packagePlatform:'PyPI',packageName:'example',sponsor:'governor',bounty:'100',closedAt:closed?80:null,closedHeight:closed?2:null,settled:closed,assignment:{version:'availability-beacon-v1',seed,openedHeight:1,assignedHeight:seed?2:null,beaconTime:60,beaconDeadline:900,slots:[{member,from:90,until:900,replaced:false}]}};
 }
 for(let i=0;i<250;i++)add('old-'+i,true,'alice');
 add('mine',false,'alice');add('other',false,'bob');add('beacon',false,'bob',null);
 s.payouts.push({id:'1',uid:'bob',amount:'100',round:'old-0',package:'org/repo',version:'1.0',height:2,timestamp:80,kind:'reward'});
 return s;
}
test('worker projection excludes history, unrelated work, audit, balances and observation values at storage read time',async()=>{
 const db=store(),s=state();await initPilot(db,{},s);db.reads.length=0;
 const work=await miningWork(db,{},'alice',100);
 assert.deepEqual(work.rounds.map(r=>r.id),['mine','beacon']);
 assert.deepEqual(work.members,[{id:'alice',key:'alice-key',suspended:false,revoked:false}]);
 assert.deepEqual(Object.keys(work.availability),['alice']);
 assert.equal(work.audit,undefined);assert.equal(work.payouts,undefined);assert.equal(work.rounds[0].escrow.bounty,undefined);
 assert.deepEqual(work.rounds[0].observations,[]);
 assert(!db.reads.some(k=>/^(audit:|incident:|pilot:balance:|pilot:payout:)/.test(k)));
 assert(!db.reads.some(k=>k.startsWith('observation:')&&Number(k.split(':')[1])<250));
 assert(!db.reads.includes('pilot:escrow:old-0'));assert(!db.reads.includes('observation:251:0'));
 assert(canObserve(work.rounds[0],{...work,ledger:{finalizedHeight:2}},'alice'));
 assert(!canObserve(work.rounds[0],{...work,ledger:{finalizedHeight:1}},'alice'));
 assert(Buffer.byteLength(JSON.stringify(work))<5000);
});
test('pending historical round remains available for durable outbox expiry, not mistaken for disappeared work',async()=>{
 const db=store();await initPilot(db,{},state());
 const work=await miningWork(db,{},'alice',100,'old-0');
 assert(work.rounds.some(r=>r.id==='old-0'));
 assert(expiredEnvelope({kind:'observe',round:'old-0',actor:'alice'},work));
});
test('self-observation marker suppresses duplicate collection; suspended/revoked contributors get no new work',async()=>{
 const s=state();s.community.rounds.find(r=>r.id==='mine').observations.push({id:'mine-a',member:'alice',value:5});
 const db=store();await initPilot(db,{},s);
 assert.deepEqual((await miningWork(db,{},'alice',100)).rounds[0].observations,[{member:'alice'}]);
 s.revoked.push('alice');await initPilot(db,{},s);assert.equal((await miningWork(db,{},'alice',100)).rounds.length,0);
 s.revoked=[];s.community.members[0].suspended=true;const suspended=store();await initPilot(suspended,{},s);assert.equal((await miningWork(suspended,{},'alice',100)).rounds.length,0);
});
test('status never reads rounds or historical data; invalid requests fail closed',async()=>{
 const db=store();await initPilot(db,{},state());db.reads.length=0;
 const status=await miningStatus(db,{},'alice');assert.equal(status.network,'test');
 assert(!db.reads.some(k=>/^(round:|observation:|audit:|pilot:escrow:|pilot:payout:)/.test(k)));
 await assert.rejects(miningWork(db,{},undefined,100),/Contributor required/);
 await assert.rejects(miningWork(db,{},'../alice',100),/Invalid contributor/);
 await assert.rejects(miningWork(db,{},'alice',100,''),/Invalid pending round/);
});
test('unchanged projection returns only a revision; a same-height state change invalidates it',async()=>{
 const {PilotModule}=require('../dist/app/modules/pilot/module');
 const endpoint=new PilotModule('governor-key','test').endpoint;
 const db=store();await initPilot(db,{},state());
 endpoint.stores.get=()=>db;
 const header={timestamp:100,height:10};
 const first=await endpoint.work({params:{member:'alice'},header});
 const current=await endpoint.work({params:{member:'alice',since:first.revision},header});
 assert.equal(current.unchanged,true);assert.equal(current.rounds,undefined);
 const key='member:0',member=JSON.parse(db.data.get(key).json);member.suspended=true;db.data.set(key,{json:JSON.stringify(member)});
 const changed=await endpoint.work({params:{member:'alice',since:first.revision},header});
 assert.notEqual(changed.revision,first.revision);assert.equal(changed.rounds.length,0);assert(changed.members[0].suspended);
 await assert.rejects(endpoint.work({params:{member:'../alice',since:first.revision},header}),/Invalid work request/);
});
