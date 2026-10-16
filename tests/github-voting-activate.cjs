const fs=require('node:fs'),assert=require('node:assert/strict');
const {createWSClient}=require('@klayr/api-client');
const {sign}=require('/tools/client.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const c=await createWSClient('ws://bootstrap:7887/rpc-ws');
 try{
  for(let i=0;i<60;i++){const n=await c.node.getNodeInfo();if(n.finalizedHeight>=4)break;await sleep(1000)}
  const before=await c.node.getNodeInfo();assert.ok(before.finalizedHeight>=4);
  const governor=JSON.parse(fs.readFileSync('/runtime/governor/identity.json')),relayer=JSON.parse(fs.readFileSync('/runtime/relayer/relayer.json'));
  const payload=JSON.stringify({id:'activate-voting-test',actor:'governor',network:'trustseco-19c5e001',kind:'activate-github-voting'});
  const tx={module:'githubVoting',command:'record',params:{payload,signature:sign(payload,governor.privateKey)},fee:100000000n};
  await c.transaction.send(await c.transaction.create(tx,relayer.privateKey));
  for(let i=0;i<40;i++){const s=await c.invoke('githubVoting_status');if(s.active){assert.equal(s.bootstrap.length,4);console.log('PASS activated equal GitHub voting on isolated chain');return}await sleep(1000)}
  throw Error('Activation did not enter the chain');
 }finally{await c.disconnect()}
})().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1)});
