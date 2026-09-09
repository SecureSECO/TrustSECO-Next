const {test}=require('node:test'),assert=require('node:assert/strict');
const {assignmentEvent,canObserve,VERSION}=require('./availability.cjs');
const {expiredEnvelope}=require('./assignment.cjs');
const state=()=>({policy:{assignment:VERSION},at:1000,ledger:{finalizedHeight:10},availability:{alice:{until:1800,height:9}},rounds:[{id:'r',closed:false,assignment:{version:VERSION,openedHeight:10,beaconRound:123,beaconTime:1000,beaconDeadline:1600,seed:null}}]});
test('availability renewals are bounded and do not send heartbeat on every mining tick',async()=>{
 const s=state();s.rounds=[];assert.equal(await assignmentEvent(s,{id:'alice'}),null);
 s.at=1500;assert.deepEqual(await assignmentEvent(s,{id:'alice'}),{kind:'availability',until:2400});
 s.policy.assignment='commit-reveal-v1';assert.equal(await assignmentEvent(s,{id:'alice'}),null);
});
test('beacon submission waits for finalized opening, uses fixed round and falls back only between relays',async()=>{
 const before=global.fetch,calls=[];try{
  global.fetch=async url=>{calls.push(url);return {ok:!url.startsWith('https://api.drand.sh/'),json:async()=>({round:123,signature:'ab'.repeat(48)})}};
  const s=state();s.ledger.finalizedHeight=9;assert.equal(await assignmentEvent(s,{id:'alice'}),null);assert.equal(calls.length,0);
  s.ledger.finalizedHeight=10;const e=await assignmentEvent(s,{id:'alice'});assert.equal(e.beaconRound,123);assert.equal(e.kind,'assignment-beacon');assert.equal(calls.length,2);assert.ok(calls.every(url=>url.endsWith('/public/123')));
 }finally{global.fetch=before}
});
test('unexpected beacon response never becomes a different draw',async()=>{
 const before=global.fetch;try{global.fetch=async()=>({ok:true,json:async()=>({round:124,signature:'ab'.repeat(48)})});await assert.rejects(assignmentEvent(state(),{id:'alice'}),/no replacement draw/)}finally{global.fetch=before}
});
test('miner waits for finalized assignment and rejects elapsed or replaced slots',()=>{
 const s=state(),r=s.rounds[0];r.assignment.assignedHeight=11;r.assignment.slots=[{member:'alice',from:900,until:1100,replaced:false}];
 assert.equal(canObserve(r,s,'alice'),false);s.ledger.finalizedHeight=11;assert.equal(canObserve(r,s,'alice'),true);
 r.assignment.slots[0].replaced=true;assert.equal(canObserve(r,s,'alice'),false);r.assignment.slots[0].replaced=false;s.at=1090;assert.equal(canObserve(r,s,'alice'),false);
});
test('outbox reconciles a proof submitted by another miner and archives elapsed availability/observer slots',()=>{
 const s=state(),r=s.rounds[0];r.assignment.seed='a';assert.equal(expiredEnvelope({kind:'assignment-beacon',round:'r'},s),true);
 assert.equal(expiredEnvelope({kind:'availability',until:999},s),true);
 r.assignment.slots=[{member:'alice',replaced:true,until:999}];assert.equal(expiredEnvelope({kind:'observe',round:'r',actor:'alice'},s),true);
});
