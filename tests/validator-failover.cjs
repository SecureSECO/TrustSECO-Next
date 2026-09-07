// Run with original dlt stopped; tests submission, matching survivors and finality progress.
const fs=require('fs');const assert=require('node:assert/strict');
const {createWSClient}=require('/usr/app/node_modules/@klayr/api-client');
const d=require('/usr/app/dist/services/dlt-service');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const clients=await Promise.all(['dlt-replica','ledger3','ledger4'].map(h=>createWSClient(`ws://${h}:7887/rpc-ws`)));try{
 const c=clients[0], start=await c.node.getNodeInfo();console.log(JSON.stringify({event:'baseline',height:start.height,finalized:start.finalizedHeight}));
 const params={packageName:'requests',packageOwner:'psf',packagePlatform:'pypi',packageReleases:['2.30.0']};
 const tx={module:'packageData',command:'addPackageData',params,fee:100000000n};
 const draft=await c.transaction.create(tx,d.getPrivateKey());tx.fee=c.transaction.computeMinFee(draft);
 const signed=await c.transaction.create(tx,d.getPrivateKey());await c.transaction.send(signed);
 console.log('Submitted Requests 2.30.0 through surviving replica');
 for(let i=0;i<60;i++){
  const nodes=await Promise.all(clients.map(c=>c.node.getNodeInfo()));
  const packs=await Promise.all(clients.map(c=>c.invoke('packageData_getPackageInfo',{packageName:'requests'})));
  const equal=nodes.every(n=>n.lastBlockID===nodes[0].lastBlockID && !n.syncing);
  const included=packs.every(p=>p.packageReleases?.includes('2.30.0'));
  console.log(JSON.stringify({event:'progress',height:nodes[0].height,finalized:nodes[0].finalizedHeight,equal,included}));
  if(equal&&included&&nodes.every(n=>n.finalizedHeight>start.finalizedHeight)){
   const report={startHeight:start.height,startFinalized:start.finalizedHeight,endHeight:nodes[0].height,endFinalized:nodes[0].finalizedHeight,head:nodes[0].lastBlockID,newVersionIncluded:true,note:'Finality advanced during outage; this does not assert that the new transaction itself is finalized.'};
   fs.writeFileSync('/tmp/validator-failover-result.json',JSON.stringify(report,null,2));
   console.log('PASS: survivors agree, accept new transaction and advance finality without original ledger');return;
  }
  await pause(10000);
 }
 throw Error('Failover criteria not met within 10 minutes');
}finally{for(const c of clients)await c.disconnect()}})().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1)});
