const {test}=require('node:test'),assert=require('node:assert/strict');
const {packages,measurements,scores,portalRouter}=require('../dist/pilot-portal');
const round=(repository='owner/pkg',version='1.0')=>({escrow:{repository,version,closedHeight:10},metric:'stars',source:'github',closed:true,result:{status:'verified',supporters:['a','b','c']},observations:[{id:'a',member:'alice',value:10,observedAt:100},{id:'b',member:'bob',value:10,observedAt:101},{id:'c',member:'carol',value:10,observedAt:102},{id:'d',member:'dave',value:999,observedAt:103}]});
test('confirmed observations require closed agreement, supporting vote and finality',()=>{
 const r=round(),s={rounds:[r],audit:[{height:10}]};
 assert.deepEqual(measurements(s,'owner/pkg',10).map(f=>f.status),['confirmed','confirmed','confirmed','unverified']);
 assert.equal(measurements(s,'owner/pkg',9).filter(f=>f.status==='confirmed').length,0);
 r.closed=false;assert.equal(measurements(s,'owner/pkg',10).filter(f=>f.status==='confirmed').length,0);
 r.closed=true;s.audit.push({height:11});assert.equal(measurements(s,'owner/pkg',10).filter(f=>f.status==='confirmed').length,0);
 r.result.status='disputed';assert.ok(measurements(s,'owner/pkg',11).every(f=>f.status==='unverified'));
});
test('package identity keeps repository owners separate and versions together',()=>{
 const s={rounds:[round(),round('owner/pkg','2.0'),round('other/pkg')]};
 const result=packages(s);assert.equal(result.length,2);assert.deepEqual(result.find(p=>p.packageName==='owner/pkg').packageReleases,['2.0','1.0']);
});
test('confirmed scores use authoritative verified inputs, local estimates are version-specific and deduplicated',async()=>{
 const s={rounds:[round(),round('owner/pkg','2.0')],audit:[]},calls=[];
 const c={invoke:async(name,args)=>{calls.push({name,args});return name==='pilot_scoreInputs'?{facts:[{fact:'stars',factData:'10'}]}:{score:args.facts[0]?.factData}}};
 const pair=await scores(c,s,'owner/pkg','1.0',10);
 assert.equal(pair.local.score,'999');assert.equal(pair.confirmed.score,'10');assert.equal(calls[0].args.version,'1.0');assert.equal(calls[1].args.facts.length,1);
});
test('restored browser API exposes no unsigned write routes',()=>{assert.ok(portalRouter(async()=>{}).stack.every(r=>r.methods.every(m=>['GET','HEAD'].includes(m))))});

test('package browsing routes accept encoded repository names and reject legacy writes',async()=>{
 const Koa=require('koa'),s={rounds:[round()],audit:[]};
 const c={node:{getNodeInfo:async()=>({height:10,finalizedHeight:10})},invoke:async(name)=>name==='pilot_snapshot'?s:name==='pilot_scoreInputs'?{facts:[]}:{score:null}};
 const app=new Koa(),router=portalRouter(async work=>work(c));app.use(router.routes());const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 try{for(const path of ['/api/dlt/package/owner%2Fpkg','/api/dlt/package/owner%2Fpkg/trust-score/','/api/dlt/package/owner%2Fpkg/trust-score/1.0','/api/dlt/measurements/owner%2Fpkg']){const response=await fetch(base+path);assert.ok([200,204].includes(response.status),path)}assert.equal((await fetch(base+'/api/dlt/add-job',{method:'POST'})).status,404);assert.equal((await(await fetch(base+'/api/dlt/packages?query=missing')).json()).total,0)}finally{await new Promise(r=>server.close(r))}
});
