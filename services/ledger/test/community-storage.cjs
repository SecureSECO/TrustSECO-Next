const {test}=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const {initialState,applyEvent,view}=require('../dist/app/modules/community/policy');
const {legacyKey,layoutKey,loadState,saveState,migrateState}=require('../dist/app/modules/community/storage');
function memory(){const data=new Map();const writes=[];return {data,writes,has:async(c,k)=>data.has(k.toString()),get:async(c,k)=>{if(!data.has(k.toString()))throw Error('Missing record '+k);return data.get(k.toString())},set:async(c,k,v)=>{data.set(k.toString(),v);writes.push({key:k.toString(),bytes:Buffer.byteLength(v.json)})},del:async(c,k)=>data.delete(k.toString())}}
const keys=Object.fromEntries(['governor','a','b','c','d'].map(id=>[id,crypto.generateKeyPairSync('ed25519')]));const pub=id=>keys[id].publicKey.export({type:'spki',format:'pem'}).toString();
function events(){let seq=0,at=2000000000;const events=[];const add=(actor,body)=>{const payload=JSON.stringify({id:'e'+(++seq),actor,...body});const signature=crypto.sign(null,Buffer.from('TrustSECO-community-v1\n'+payload),keys[actor].privateKey).toString('base64');events.push({payload,signature,at,height:seq});return 'e'+seq};
for(const id of ['a','b','c','d'])add('governor',{kind:'enrol',member:id,key:pub(id),operator:id,githubId:id,accountCreatedAt:at-200*86400,evidence:'fixture'});
const observations=[];for(let i=0;i<50;i++){at+=20;add('governor',{kind:'open',round:'r'+i,package:'demo',metric:'github_stars',source:'fixture',method:'v1',duration:10});for(const [id,value]of [['a',100],['b',101],['c',102],['d',900]]){const obs=add(id,{kind:'observe',round:'r'+i,value,observedAt:at,source:'fixture',method:'v1'});if(id==='d')observations.push(obs)}at+=11;add('governor',{kind:'close',round:'r'+i})}
let incident;for(let i=0;i<5;i++)incident=add('governor',{kind:'substantiate',round:'r'+i,observation:observations[i],cause:'bug'+i,evidence:'fixture',reason:'independently reproduced'});
add('d',{kind:'appeal',incident,reason:'please review'});add('governor',{kind:'overturn',incident,reason:'corrected evidence'});add('governor',{kind:'reinstate',member:'d',reason:'review complete'});return events;}
test('migration and all event types preserve exact state, signatures and decisions; only changed records are written',async()=>{
 const old=memory(),split=memory();let expected=initialState(pub('governor'));for(const s of [old,split])await s.set({},legacyKey,{json:JSON.stringify(expected)});
 const all=events();let oldBytes=0,newBytes=0,checked=false;
 for(let i=0;i<all.length;i++){
  if(i===20){assert.equal(await migrateState(split,{}),true);assert.equal(await split.has({},legacyKey),false);assert.equal(await migrateState(split,{}),false);assert.deepEqual(await loadState(split,{}),expected)}
  const e=all[i];const next=applyEvent(expected,e.payload,e.signature,e.at,e.height);
  for(const s of [old,split]){s.writes.length=0;await saveState(s,{},expected,next);assert.deepEqual(await loadState(s,{}),next)}
  if(i>20){oldBytes+=old.writes.reduce((n,w)=>n+w.bytes,0);newBytes+=split.writes.reduce((n,w)=>n+w.bytes,0)}
  if(i>100&&JSON.parse(e.payload).kind==='observe'){assert.equal(split.writes.length,4);assert(split.writes.every(w=>!w.key.startsWith('member:')&&!w.key.startsWith('incident:')));checked=true}
  assert.deepEqual(view(await loadState(split,{}),e.at),view(next,e.at));expected=next;
 }
 assert(checked);assert(newBytes<oldBytes/5);console.log(JSON.stringify({benchmark:'serialized values passed to store.set, excludes one-time migration and DB overhead',events:all.length,legacyBytes:oldBytes,individualRecordBytes:newBytes,reductionPercent:Math.round(100*(1-newBytes/oldBytes))}));
 // A fresh node with the same activation point reproduces identical physical state.
 const replay=memory();let state=initialState(pub('governor'));await replay.set({},legacyKey,{json:JSON.stringify(state)});
 for(let i=0;i<all.length;i++){if(i===20)await migrateState(replay,{});const e=all[i],next=applyEvent(state,e.payload,e.signature,e.at,e.height);await saveState(replay,{},state,next);state=next}
 assert.deepEqual(replay.data,split.data);
});
test('legacy layout remains unchanged until explicit migration; missing records fail rather than silently dropping evidence',async()=>{const s=memory(),state=initialState(pub('governor'));await s.set({},legacyKey,{json:JSON.stringify(state)});assert.equal(await s.has({},layoutKey),false);await migrateState(s,{});s.data.set('layout:v1',{json:JSON.stringify({version:1,governor:state.governor,members:1,rounds:0,incidents:0,audit:0})});await assert.rejects(()=>loadState(s,{}),/Missing record/)});
