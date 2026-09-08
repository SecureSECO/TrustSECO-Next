const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Koa=require('koa'),{koaBody}=require('koa-body');
const {setupRouter,queueAdmission}=require('../dist/pilot-setup');
test('shared deployment does not register local identity routes',()=>{const old=process.env.PILOT_LOCAL_ORIGIN;delete process.env.PILOT_LOCAL_ORIGIN;try{assert.equal(setupRouter(async()=>({})).stack.length,0)}finally{if(old!==undefined)process.env.PILOT_LOCAL_ORIGIN=old}});
test('local setup enforces origin, stores only public join requests, and gates mining',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'trustseco-setup-')),originalFetch=global.fetch,oldEnv={...process.env};
 process.env.PILOT_LOCAL_ORIGIN='http://localhost:3005';process.env.PILOT_IDENTITY_DIR=path.join(root,'identity');process.env.PILOT_REQUEST_DIR=path.join(root,'requests');
 let publicKey,linked=false;const network={network:'test',members:[],rounds:[],audit:[]};
 global.fetch=async url=>({ok:true,json:async()=>url.includes('ssh_signing_keys')?(linked?[{key:publicKey}]:[]):{id:123,login:'example',type:'User',created_at:'2020-01-01T00:00:00Z'}});
 const app=new Koa();app.use(async(ctx,next)=>{try{await next()}catch(e){ctx.status=e.status||400;ctx.body={error:e.message}}});app.use(koaBody());const router=setupRouter(async()=>network);app.use(router.routes());
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port;
 const request=(route,body,origin='http://localhost:3005')=>new Promise((resolve,reject)=>{const req=require('node:http').request(url+'/api/local/'+route,{method:body===undefined?'GET':'POST',headers:{Host:'localhost:3005',Origin:origin,'X-TrustSECO-Local':'1','Content-Type':'application/json'}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,json:async()=>JSON.parse(text)}))});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));});
 try {
  assert.equal((await request('identity',{login:'example'},'https://evil.example')).status,403);
  assert.equal((await request('status')).status,200);
  assert.equal((await request('mining',{enabled:true})).status,403);
  assert.equal((await(await request('status')).json()).mining,false);
  assert.equal((await request('credentials',{source:'github',token:'private-test-token'},'https://evil.example')).status,403);
  assert.equal((await request('credentials',{source:'github',token:'private-test-token'})).status,200);
  const savedStatus=await(await request('status')).json();assert.equal(savedStatus.credentials.github.configured,true);assert.ok(!JSON.stringify(savedStatus).includes('private-test-token'));
  assert.equal((await request('credentials',{source:'github',token:''})).status,200);
  assert.equal((await(await request('status')).json()).credentials.github.configured,false);
  const created=await(await request('identity',{login:'example'})).json();publicKey=created.sshKey;assert.ok(publicKey);assert.equal(created.privateKey,undefined);
  assert.equal((await request('mining',{enabled:true})).status,403);
  assert.equal((await(await request('verify',{})).json()).linked,false);linked=true;assert.equal((await(await request('verify',{})).json()).linked,true);
  const modulePath=fs.existsSync(path.join(__dirname,'../tools/pilot/local-identity.cjs'))?'../tools/pilot/local-identity.cjs':'../../../tools/pilot/local-identity.cjs';
  const {LocalIdentity}=require(modulePath),identity=new LocalIdentity(process.env.PILOT_IDENTITY_DIR),join=identity.join('test');
  assert.equal((await queueAdmission(join,network)).status,'awaiting-approval');const saved=JSON.parse(fs.readFileSync(path.join(root,'requests/123.json')));assert.deepEqual(saved,join);
  await assert.rejects(queueAdmission({...join,signature:'bad'},network),/ownership/);
  const status=await(await request('status')).json();assert.equal(status.admitted,false);assert.equal(status.mining,false);assert.ok(!JSON.stringify(status).includes('PRIVATE KEY'));
 }finally{global.fetch=originalFetch;for(const key of ['PILOT_LOCAL_ORIGIN','PILOT_IDENTITY_DIR','PILOT_REQUEST_DIR']){if(oldEnv[key]===undefined)delete process.env[key];else process.env[key]=oldEnv[key]}await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true})}
});
