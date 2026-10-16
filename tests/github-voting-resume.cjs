const fs=require('node:fs'),assert=require('node:assert/strict');
const {createWSClient}=require('@klayr/api-client'),{address}=require('@klayr/cryptography');
(async()=>{
 const expected=JSON.parse(fs.readFileSync('/runtime/reviewer/validator/public.json')).address;
 const a=await createWSClient('ws://bootstrap:7887/rpc-ws'),b=await createWSClient('ws://127.0.0.1:7887/rpc-ws');
 let from=(await a.node.getNodeInfo()).height;
 try{
  for(let i=0;i<90;i++){
   const s=await fetch('http://localhost:3000/api/pilot/voting').then(r=>r.json());
   assert.equal(s.voters.length,1);assert.equal(s.voters[0].address,expected);
   const common=Math.min(s.finalizedHeight,(await b.node.getNodeInfo()).finalizedHeight);
   if(s.voters[0].enabled!==false){
    for(let h=from+1;h<=common;h++){
     const block=await a.block.getByHeight(h),v=block.header.generatorAddress;
     if((Buffer.isBuffer(v)?address.getKlayr32AddressFromAddress(v):v)===expected){
      const other=await b.block.getByHeight(h);assert.equal(block.header.id.toString('hex'),other.header.id.toString('hex'));
      console.log('PASS same reviewer resumed and produced finalized block '+h);return;
     }
    }
    from=Math.max(from,common);
   }
   await new Promise(r=>setTimeout(r,2000));
  }
  throw Error('Reviewer did not resume finalized block production');
 }finally{await a.disconnect();await b.disconnect();}
})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
