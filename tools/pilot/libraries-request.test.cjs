const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {createLibrariesRequest,observedAt}=require('./libraries-request.cjs');
const url='https://libraries.io/api/Pypi/Flask?api_key=private-test-key';
const ok=()=>({ok:true,json:async()=>({rank:28,versions:[]})});
test('cache reuses a response only for its contributor and credential, expires, and preserves observation time',async()=>{
 let clock=100000,calls=0;const request=createLibrariesRequest({now:()=>clock,interval:0,fetcher:async()=>{calls++;return ok();}});
 const first=await request(url,'a');first.rank=0;clock+=1000;
 assert.equal((await request(url,'a')).rank,28);assert.equal(observedAt(await request(url,'a')),100);assert.equal(calls,1);
 await request(url,'b');await request(url+'2','a');assert.equal(calls,3);
 clock+=60000;await request(url,'a');assert.equal(calls,4);
});
test('workers share request spacing and a persisted access-denial cooldown, without sharing response data',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'libraries-budget-'));let clock=100000,calls=0;
 try {
 const make=()=>createLibrariesRequest({directory,now:()=>clock,fetcher:async()=>{calls++;return {ok:false,status:403};}});
 await assert.rejects(make()(url,'a'),e=>e.status===403&&e.retryAfterMs===1800000&&!e.providerDeferred);
 await assert.rejects(make()(url,'b'),e=>e.status===403&&e.providerDeferred);assert.equal(calls,1);
 assert(!fs.readFileSync(path.join(directory,'libraries.json'),'utf8').includes('private-test-key'));
 clock+=1800000;await assert.rejects(make()(url,'b'),e=>e.retryAfterMs===3600000);assert.equal(calls,2);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('shared budget limits independent workers and permits fresh independent fetches later',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'libraries-budget-'));let clock=100000,calls=0;
 try {const make=()=>createLibrariesRequest({directory,now:()=>clock,fetcher:async()=>{calls++;return ok();}});const a=make(),b=make();
 await a(url,'a');await assert.rejects(b(url,'b'),e=>e.providerDeferred&&e.retryAfterMs===5000);clock+=5000;await b(url,'b');assert.equal(calls,2);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('429 honours Retry-After and errors never enter cache',async()=>{
 let clock=100000,calls=0;const request=createLibrariesRequest({now:()=>clock,fetcher:async()=>{calls++;return calls===1?{ok:false,status:429,headers:{get:()=> '120'}}:ok();}});
 await assert.rejects(request(url,'a'),e=>e.retryAfterMs===120000&&e.rateLimited);
 await assert.rejects(request(url,'a'),e=>e.providerDeferred);clock+=120000;
 assert.equal((await request(url,'a')).rank,28);assert.equal(calls,2);
});
test('network failure is sanitized and delays the next request',async()=>{
 const request=createLibrariesRequest({fetcher:async()=>{throw Error(url);}});
 await assert.rejects(request(url,'a'),e=>!e.message.includes('private-test-key')&&e.retryAfterMs===60000);
 await assert.rejects(request(url,'b'),e=>e.providerDeferred);
});
test('a new assignment window forces a fresh observation and cache memory is bounded',async()=>{
 let clock=100000,calls=0;const request=createLibrariesRequest({now:()=>clock,interval:0,maxBytes:100,fetcher:async()=>{calls++;return ok();}});
 await request(url,'a');clock+=1000;await request(url,'a',101);assert.equal(calls,2);
 const uncached=createLibrariesRequest({now:()=>clock,interval:0,maxBytes:1,fetcher:async()=>{calls++;return ok();}});
 await uncached(url,'a');await uncached(url,'a');assert.equal(calls,4);
});
