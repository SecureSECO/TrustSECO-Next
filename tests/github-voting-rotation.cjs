// Runs only against the disposable compose.github-voting.yaml network.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {createWSClient}=require('@klayr/api-client');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const reviewer=JSON.parse(fs.readFileSync('/runtime/reviewer/validator/public.json'));
 const a=await createWSClient('ws://bootstrap:7887/rpc-ws');
 const b=await createWSClient('ws://127.0.0.1:7887/rpc-ws');
 let generated=0,scanned=0,sawActive=false,sawWaiting=false,returned=false,last='';
 try{
  for(let i=0;i<180;i++){
   const state=await fetch('http://localhost:3000/api/pilot/voting').then(r=>r.json());
   assert.equal(state.currentValidators.length,4);assert.equal(state.threshold,'3');
   assert.ok(state.currentValidators.every(v=>v.weight==='1'));
   const active=state.currentValidators.some(v=>v.address===reviewer.address);
   if(active){if(sawWaiting)returned=true;sawActive=true;}else if(sawActive)sawWaiting=true;
   const label=active?'active':'waiting';if(label!==last){console.log('Reviewer '+label+' at height '+state.height);last=label;}
   const nodes=await Promise.all([a.node.getNodeInfo(),b.node.getNodeInfo()]);
   const finalized=Math.min(...nodes.map(n=>n.finalizedHeight));
   if(finalized>0){
    const [x,y]=await Promise.all([a.block.getByHeight(finalized),b.block.getByHeight(finalized)]);
    assert.equal(x.header.id.toString('hex'),y.header.id.toString('hex'));
    for(let h=scanned+1;h<=finalized;h++){
     const block=await a.block.getByHeight(h);
     if(block.header.generatorAddress===reviewer.address || (Buffer.isBuffer(block.header.generatorAddress)&&require('@klayr/cryptography').address.getKlayr32AddressFromAddress(block.header.generatorAddress)===reviewer.address))generated=h;
    }
    scanned=finalized;
   }
   if(generated&&returned){console.log('PASS reviewer generated finalized block '+generated+', rotated out and back, and both nodes agree through height '+scanned);return;}
   await sleep(2000);
  }
  throw Error('Rotation/finality timed out: '+JSON.stringify({generated,scanned,sawActive,sawWaiting,returned}));
 }finally{await a.disconnect();await b.disconnect();}
})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
