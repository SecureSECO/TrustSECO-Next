const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {durableEvent,mineOnce}=require('./client.cjs');
function identity(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'collection-')),file=path.join(dir,'identity.json');fs.writeFileSync(file,JSON.stringify({id:'a',privateKey:crypto.generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}).toString()}));return {dir,file};}
test('durable publisher reconciles an archived event without reissuing it',async()=>{
 const {dir,file}=identity(),before=global.fetch;let posts=0;
 try{global.fetch=async(url,options)=>{if(options?.method==='POST')posts++;return {ok:true,json:async()=>url.includes('/event?')?{event:{...JSON.parse(fs.readFileSync(file+'.event-outbox')).envelope}}:{network:'n',audit:[],policy:{collection:'scheduled-v1'}}};};
 await durableEvent('http://localhost',file,{kind:'open',round:'r'});assert.equal(posts,0);assert.equal(fs.existsSync(file+'.event-outbox'),false);
 }finally{global.fetch=before;fs.rmSync(dir,{recursive:true,force:true});}
});
test('a missing source credential creates a bounded diagnostic, never a zero observation',async()=>{
 const {dir,file}=identity(),before=global.fetch,now=Math.floor(Date.now()/1000),events=[];
 const s={network:'n',at:now,ledger:{finalizedHeight:1},policy:{assignment:'availability-beacon-v1',collection:'scheduled-v1'},availability:{a:{until:now+800}},members:[{id:'a'}],audit:[],rounds:[{id:'missing-key',closed:false,closesAt:now+900,metric:'lib_sourcerank',observations:[],assignment:{version:'availability-beacon-v1',seed:'fixed',assignedHeight:1,slots:[{member:'a',from:now-10,until:now+900,replaced:false}]},escrow:{repository:'pallets/flask',version:'3.1.1',packagePlatform:'PyPI',packageName:'Flask'}}]};
 try{global.fetch=async(url,options)=>{if(options?.method==='POST'){const envelope=JSON.parse(options.body),e=JSON.parse(envelope.payload);events.push(e);s.audit.push({id:e.id,...envelope});}return {ok:true,json:async()=>url.includes('/event?')?{event:s.audit.find(e=>e.id===new URL(url).searchParams.get('id'))||null}:s};};
 assert.equal(await mineOnce('http://localhost',file,{}),true);assert.equal(events.length,1);assert.equal(events[0].kind,'unavailable');assert.equal(events[0].reason,'credentials-missing');assert.equal(events[0].value,undefined);
 }finally{global.fetch=before;fs.rmSync(dir,{recursive:true,force:true});}
});
test('fork recovery archives a redundant opening only after exact signed finalized evidence',async()=>{
 const {dir,file}=identity(),before=global.fetch,key=JSON.parse(fs.readFileSync(file));let posts=0;
 const body={kind:'open',round:'same-round',bounty:'300'};
 const payload=JSON.stringify({...body,id:'canonical',actor:'a',network:'n'}),signature=crypto.sign(null,Buffer.from('TrustSECO-community-v1\n'+payload),key.privateKey).toString('base64');
 const record={id:'canonical',kind:'open',payload,signature,height:5};
 const s={network:'n',policy:{collection:'scheduled-v1'},ledger:{finalizedHeight:5},members:[{id:'a',key:crypto.createPublicKey(key.privateKey).export({type:'spki',format:'pem'}).toString()}],rounds:[{id:'same-round'}],audit:[],auditOffset:10};
 try{global.fetch=async(url,options)=>{if(options?.method==='POST'){posts++;return {ok:false,status:400};}return {ok:true,json:async()=>url.includes('/audit?')?{events:[record],nextCursor:null}:url.includes('/event?')?{event:s.audit.find(e=>e.id===new URL(url).searchParams.get('id'))||null}:s};};
 assert.equal(await durableEvent('http://localhost',file,body),'canonical');assert.equal(posts,0);assert.equal(fs.existsSync(file+'.event-outbox'),false);assert.equal(fs.readdirSync(dir).filter(x=>x.includes('superseded')&&!x.endsWith('.receipt')).length,1);
 await assert.rejects(durableEvent('http://localhost',file,{...body,bounty:'999'}),/HTTP 400/);assert.ok(fs.existsSync(file+'.event-outbox'));
 fs.unlinkSync(file+'.event-outbox');s.ledger.finalizedHeight=4;await assert.rejects(durableEvent('http://localhost',file,body),/HTTP 400/);assert.ok(fs.existsSync(file+'.event-outbox'));
 }finally{global.fetch=before;fs.rmSync(dir,{recursive:true,force:true});}
});
test('idle mining uses compact work reads, refreshes finality, invalidates changed work at the same height and never fetches snapshots',async()=>{
 const {dir,file}=identity(),before=global.fetch,seen=[];let calls=0;
 const revision='ab'.repeat(32),fork='cd'.repeat(32);
 try {
  global.fetch=async(url,options)=>{
   assert(!options?.method);assert(url.includes('/work?'));assert(!url.includes('/snapshot'));seen.push(url);calls++;
   const common={testNetwork:true,at:100,ledger:{height:10,finalizedHeight:calls===1?8:9},revision:calls<3?revision:fork};
   return {ok:true,json:async()=>calls===2?{...common,unchanged:true}:{...common,network:'n',members:[{id:'a',suspended:calls===3}],policy:{},rounds:[]}};
  };
  assert.equal(await mineOnce('http://localhost:34321',file,{}, {testNetwork:true}),false);
  assert.equal(await mineOnce('http://localhost:34321',file,{}, {testNetwork:true}),false);
  await assert.rejects(mineOnce('http://localhost:34321',file,{}, {testNetwork:true}),/suspended/);
  assert(!seen[0].includes('since='));assert(seen[1].includes('since='+revision));assert(seen[2].includes('since='+revision));
 }finally{global.fetch=before;fs.rmSync(dir,{recursive:true,force:true});}
});
test('fixture miner rejects a non-test network before signing or collecting',async()=>{
 const {dir,file}=identity(),before=global.fetch;
 try {global.fetch=async(url,options)=>{assert(!options?.method);assert(url.includes('/work?'));return {ok:true,json:async()=>({testNetwork:false,members:[{id:'a'}],rounds:[]})};};
  await assert.rejects(mineOnce('http://localhost:34322',file,{}, {testNetwork:true}),/Local test network required/);
 }finally{global.fetch=before;fs.rmSync(dir,{recursive:true,force:true});}
});
