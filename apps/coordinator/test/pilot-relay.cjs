const {test}=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module');
test('HTTP relay accepts signed assignment events and still rejects invalid signatures and unknown events',async()=>{
 const keys=crypto.generateKeyPairSync('ed25519'),sent=[],archived=new Map();
 const state={height:10,at:100,network:'relay-test',policy:{collection:'scheduled-v1'},members:[],audit:[],governorKey:keys.publicKey.export({type:'spki',format:'pem'}).toString()};
 let disconnects=0;
 const client={node:{getNodeInfo:async()=>({height:12,finalizedHeight:11,chainID:'test-chain'})},invoke:async(method,params)=>{assert(['pilot_status','pilot_work','pilot_event','githubVoting_event'].includes(method),'Relay and worker routes must not fetch full snapshots');return method==='githubVoting_event'?{event:null}:method==='pilot_event'?{event:archived.get(params.id)||state.audit.find(a=>a.id===params.id)||null}:state;},disconnect:async()=>{if(disconnects++<3)throw Error("Simulated SDK disconnect timeout");},transaction:{
  computeMinFee:()=>1n,create:async tx=>({...tx,id:'test-transaction'}),
  send:async tx=>{const e=JSON.parse(tx.params.payload);sent.push(e.kind);state.audit.push({id:e.id,payload:tx.params.payload,signature:tx.params.signature});}
 }};
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'trustseco-relay-test-'));
 const keyfile=path.join(directory,'relay.json');fs.writeFileSync(keyfile,JSON.stringify({privateKey:'00'.repeat(64)}),{mode:0o600});
 const Koa=require('koa'),originalListen=Koa.prototype.listen,originalLoad=Module._load,previous={...process.env};let server;
 process.env.DLT_ENDPOINT='ws://test.invalid';process.env.PILOT_RELAYER_FILE=keyfile;process.env.PORT='0';
 Koa.prototype.listen=function(...args){server=originalListen.apply(this,args);return server;};
 Module._load=function(name,...args){return name==='@klayr/api-client'?{createWSClient:async()=>client}:originalLoad.call(this,name,...args);};
 try {
  require('../dist/pilot');
  Module._load=originalLoad;Koa.prototype.listen=originalListen;
  if(!server.listening)await new Promise(r=>server.once('listening',r));
  const url='http://127.0.0.1:'+server.address().port+'/api/pilot/event';
  async function post(kind,valid=true){const payload=JSON.stringify({id:crypto.randomUUID(),actor:'governor',network:'relay-test',kind});
   const signature=valid?crypto.sign(null,Buffer.from('TrustSECO-community-v1\n'+payload),keys.privateKey).toString('base64'):'invalid';
   return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload,signature})});}
  for(const kind of ['activate-assignment','entropy-commit','entropy-reveal','activate-collection','unavailable']){assert.equal((await post(kind)).status,202,kind);await new Promise(r=>setTimeout(r,1100));}
  assert.deepEqual(sent,['activate-assignment','entropy-commit','entropy-reveal','activate-collection','unavailable']);
  assert.equal((await post('entropy-commit',false)).status,403);
  assert.equal((await post('invented-event')).status,400);
  assert.equal(sent.length,5);
  const payload=JSON.stringify({id:'archived',actor:'governor',network:'relay-test',kind:'transfer'}),signature=crypto.sign(null,Buffer.from('TrustSECO-community-v1\n'+payload),keys.privateKey).toString('base64');
  archived.set('archived',{payload,signature});
  assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload,signature})})).status,200);
  const collision=JSON.stringify({...JSON.parse(payload),amount:'999'}),collisionSignature=crypto.sign(null,Buffer.from('TrustSECO-community-v1\n'+collision),keys.privateKey).toString('base64');
  assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload:collision,signature:collisionSignature})})).status,409);
  assert.equal(sent.length,5);
  const base=url.slice(0,-6);
  const work=await fetch(base+'/work?member=alice');assert.equal(work.status,200);assert.equal(work.headers.get('cache-control'),'no-store');
  const projection=await work.json();assert.equal(projection.ledger.height,10);assert.equal(projection.ledger.finalizedHeight,10);
  assert.equal((await fetch(base+'/work')).status,400);
  assert.equal((await fetch(base+'/work?member=alice&since=invalid')).status,400);
  assert.equal((await fetch(base+'/status')).status,200);
 } finally {
  Module._load=originalLoad;Koa.prototype.listen=originalListen;
  if(server)await new Promise(r=>server.close(r));
  for(const name of ['DLT_ENDPOINT','PILOT_RELAYER_FILE','PORT'])if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];
  fs.rmSync(directory,{recursive:true,force:true});
 }
});
