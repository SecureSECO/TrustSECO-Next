const {test}=require('node:test'),assert=require('node:assert/strict');
const {recoverExpiredLease}=require('../dist/pilot-relay-recovery');
test('only expired finalized leases can be replaced, preserving nonce and signed contributor request',async()=>{
 const signed={senderPublicKey:'aa',nonce:'4',fee:'100',module:'pilot',command:'record',params:{payload:'new signed request',signature:'signature'}};
 let queued={senderPublicKey:'aa',nonce:'4',fee:'200',module:'pilot',command:'record',params:{payload:JSON.stringify({kind:'availability',until:99})}},sent=[];
 const client={invoke:async()=>[queued],node:{getNodeInfo:async()=>({finalizedHeight:10})},block:{getByHeight:async h=>{assert.equal(h,10);return {header:{timestamp:100}}}},transaction:{fromJSON:t=>t,create:async t=>t,send:async t=>sent.push(t)}};
 const result=await recoverExpiredLease(client,signed,'key');assert.equal(result.fee,210n);assert.equal(result.nonce,'4');assert.equal(result.params,signed.params);assert.equal(sent.length,1);
 for(const event of [{kind:'availability',until:101},{kind:'availability',until:0},{kind:'transfer',until:99},{kind:'open',until:99}]){
 queued.params.payload=JSON.stringify(event);await assert.rejects(recoverExpiredLease(client,signed,'key'),/pending/);
 }
 queued.params.payload=JSON.stringify({kind:'availability',until:99});queued.fee='2000000';await assert.rejects(recoverExpiredLease(client,signed,'key'),/allowance/);
 queued.senderPublicKey='bb';await assert.rejects(recoverExpiredLease(client,signed,'key'),/occupied/);assert.equal(sent.length,1);
});
