const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'self-stake.cjs'),'utf8');
async function run(selfStake,eligible){const sent=[];const client={invoke:async name=>name==='pos_getValidator'?{selfStake}:{validators:eligible?[{address:'validator'}]:[]},disconnect:async()=>{},transaction:{computeMinFee:()=>1n,create:async tx=>({...tx,id:'fixture'}),send:async tx=>sent.push(tx)}};
 await vm.runInNewContext(source,{console:{log(){},error(){}},process:{exit(){throw Error('Unexpected helper failure');}},require:name=>name==='node:fs'?{readFileSync:()=>JSON.stringify({keys:[{address:'validator',plain:{generatorPrivateKey:'fixture'}}]})}:{createWSClient:async()=>client}});
 return sent;
}
test('eligible self-staked validator is unchanged',async()=>assert.equal((await run('1000000000000',true)).length,0));
test('missing genesis eligibility index is populated with a small additional stake',async()=>assert.equal((await run('1000000000000',false))[0].params.stakes[0].amount,'1000000000'));
test('unstaked validator receives the original bootstrap stake',async()=>assert.equal((await run('0',false))[0].params.stakes[0].amount,'1000000000000'));
