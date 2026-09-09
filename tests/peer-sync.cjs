// Run inside the primary web container with this file mounted/copied to /tmp.
// Uses the existing development transaction signer; adds Requests 2.31.0 if absent.
const assert = require('node:assert/strict');
const {createWSClient} = require('/usr/app/node_modules/@klayr/api-client');
const d = require('/usr/app/dist/services/dlt-service');
const pause = ms => new Promise(r => setTimeout(r,ms));
(async()=>{
 const a=await createWSClient('ws://dlt:7887/rpc-ws');
 const b=await createWSClient('ws://dlt-replica:7887/rpc-ws');
 try {
  let caughtUp=false;
  for(let i=0;i<36;i++){
   const [n,m]=await Promise.all([a.node.getNodeInfo(),b.node.getNodeInfo()]);
   if(!n.syncing && !m.syncing && n.height===m.height && n.lastBlockID===m.lastBlockID){caughtUp=true;break}
   await pause(5000);
  }
  assert.ok(caughtUp,'Replica must catch up to the primary head within 180 seconds');
  console.log('PASS identical current heads, neither node syncing');
  for(const method of ['packageData_getAllPackages','trustfacts_getPackageFacts']) {
   const params=method.includes('Facts')?{packageName:'requests'}:{};
   const x=await a.invoke(method,params), y=await b.invoke(method,params);
   assert.ok(!x.error && !y.error, 'Endpoint must succeed');
   assert.deepEqual(x,y);
   console.log('PASS identical '+method);
  }
  const n=await a.node.getNodeInfo(), m=await b.node.getNodeInfo();
  assert.equal(n.chainID,m.chainID);
  const height=Math.min(n.height,m.height);
  const [x,y]=await Promise.all([a.block.getByHeight(height),b.block.getByHeight(height)]);
  assert.equal(x.header.id,y.header.id);
  assert.ok((await a.node.getConnectedPeers()).length>0);
  assert.ok((await b.node.getConnectedPeers()).length>0);
  console.log('PASS common block '+height+' '+x.header.id);
  const params={packageName:'requests',packageOwner:'psf',packagePlatform:'pypi',packageReleases:['2.31.0']};
  const pack=await a.invoke('packageData_getPackageInfo',{packageName:'requests'});
  if(!pack.packageReleases.includes('2.31.0')) {
   const tx={module:'packageData',command:'addPackageData',params,fee:0n};
   tx.fee=await d.getMinFee(tx);
   const signed=await b.transaction.create(tx,d.getPrivateKey());
   await b.transaction.send(signed);
   console.log('Submitted Requests 2.31.0 through replica');
   let found=false;
   for(let i=0;i<36;i++) {
    const p=await a.invoke('packageData_getPackageInfo',{packageName:'requests'});
    const q=await b.invoke('packageData_getPackageInfo',{packageName:'requests'});
    if(p.packageReleases?.includes('2.31.0') && q.packageReleases?.includes('2.31.0')){assert.deepEqual(p,q);found=true;break}
    await pause(5000);
   }
   assert.ok(found,'Transaction must propagate to primary and its block return to replica');
   console.log('PASS replica submission recorded on both nodes');
  } else console.log('Version already exists; skipped fresh submission');
 } finally {await a.disconnect();await b.disconnect()}
 process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1)});
