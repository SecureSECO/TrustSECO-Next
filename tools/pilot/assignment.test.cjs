const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {entropyEvent,entropyCommitment,canObserve,expiredEnvelope}=require('./assignment.cjs');
const {mineOnce}=require('./client.cjs');
function fixture() {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'trustseco-assignment-'));
 const file=path.join(dir,'identity.json'), key=crypto.generateKeyPairSync('ed25519');
 const identity={id:'a',privateKey:key.privateKey.export({type:'pkcs8',format:'pem'}).toString()};fs.writeFileSync(file,JSON.stringify(identity));
 const a={version:'commit-reveal-v1',context:'12'.repeat(32),openedHeight:1,commitUntil:300,revealUntil:600,pool:['a','b','c'].map(id=>({id,operator:id})),commitments:{},commitmentHeights:{},reveals:{},committee:[],seed:null};
 const state={network:'n',policy:{assignment:'commit-reveal-v1'},ledger:{finalizedHeight:1},at:100,members:[{id:'a',standing:'active'}],audit:[],rounds:[{id:'r',assignment:a,closed:false,closesAt:1000,observations:[],escrow:{repository:'org/repo'},metric:'gh_open_issues_count',source:'GitHub REST',method:'github-rest-v1'}]};
 return {dir,file,identity,a,state,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('entropy is persisted before submission, reused on restart, private and context-bound',()=>{
 const f=fixture();try {
  const first=entropyEvent(f.state,f.identity,f.file),second=entropyEvent(f.state,f.identity,f.file);
  assert.deepEqual(first,second);assert.equal(first.kind,'entropy-commit');
  const saved=path.join(f.file+'.entropy',f.a.context+'.json');const {secret}=JSON.parse(fs.readFileSync(saved));
  assert.match(secret,/^[a-f0-9]{64}$/);assert.equal(fs.statSync(saved).mode & 0o777,0o600);
  assert.equal(first.contribution,entropyCommitment(f.a.context,'a',secret));
  assert.notEqual(first.contribution,entropyCommitment(f.a.context,'b',secret));
  assert.notEqual(first.contribution,entropyCommitment('34'.repeat(32),'a',secret));
 }finally{f.cleanup();}
});
test('honest client waits for finalized opening and every finalized commitment before revealing',()=>{
 const f=fixture();try {
  f.state.ledger.finalizedHeight=0;assert.equal(entropyEvent(f.state,f.identity,f.file),null);assert.ok(!fs.existsSync(f.file+'.entropy'));
  f.state.ledger.finalizedHeight=1;const c=entropyEvent(f.state,f.identity,f.file);f.a.commitments.a=c.contribution;f.a.commitmentHeights.a=2;
  f.state.at=300;assert.equal(entropyEvent(f.state,f.identity,f.file),null);
  f.a.commitments.b=f.a.commitments.c='aa'.repeat(32);f.a.commitmentHeights.b=f.a.commitmentHeights.c=2;
  assert.equal(entropyEvent(f.state,f.identity,f.file),null);
  f.state.ledger.finalizedHeight=2;const r=entropyEvent(f.state,f.identity,f.file);assert.equal(r.kind,'entropy-reveal');assert.equal(entropyCommitment(f.a.context,'a',r.contribution),c.contribution);
  f.a.reveals.a=r.contribution;assert.equal(entropyEvent(f.state,f.identity,f.file),null);
  delete f.a.reveals.a;f.state.at=600;assert.equal(entropyEvent(f.state,f.identity,f.file),null);
  f.state.at=300;delete f.state.ledger;assert.equal(entropyEvent(f.state,f.identity,f.file),null);
 }finally{f.cleanup();}
});
test('lost or altered entropy never generates a substitute reveal',()=>{
 const f=fixture();try {
  const c=entropyEvent(f.state,f.identity,f.file);f.a.commitments={a:c.contribution,b:'aa',c:'bb'};f.a.commitmentHeights={a:1,b:1,c:1};f.state.at=300;
  const saved=path.join(f.file+'.entropy',f.a.context+'.json');fs.writeFileSync(saved,JSON.stringify({secret:'ff'.repeat(32)}));
  assert.throws(()=>entropyEvent(f.state,f.identity,f.file),/does not match/);fs.unlinkSync(saved);
  assert.throws(()=>entropyEvent(f.state,f.identity,f.file),/cannot replace/);
 }finally{f.cleanup();}
});
test('client restricts collection to assigned operators and measurement window, with explicit legacy support',()=>{
 const f=fixture();try {
  const r=f.state.rounds[0];f.a.committee=['a','b','c'];assert.equal(canObserve(r,f.state,'a'),false);
  f.state.at=600;assert.equal(canObserve(r,f.state,'a'),true);assert.equal(canObserve(r,f.state,'outsider'),false);
  f.a.version='unknown';assert.equal(canObserve(r,f.state,'a'),false);
  delete r.assignment;assert.equal(canObserve(r,f.state,'a'),false);f.state.policy.assignment='self-selected-legacy';assert.equal(canObserve(r,f.state,'a'),true);
 }finally{f.cleanup();}
});
test('miner signs entropy, retains uncertain envelope, and never contacts collectors for unassigned work',async()=>{
 const f=fixture(),original=global.fetch;let envelope,posts=0;
 try {
  global.fetch=async(url,options)=>{
   assert.ok(url.includes('/api/pilot/'),'Unassigned miner must not contact providers');
   if(options?.method==='POST'){posts++;envelope=JSON.parse(options.body);throw Error('uncertain response');}
   return {ok:true,json:async()=>f.state};
  };
  await assert.rejects(mineOnce('http://localhost',f.file),/Could not reach/);
  const payload=JSON.parse(envelope.payload);assert.equal(payload.kind,'entropy-commit');assert.equal(payload.actor,'a');
  assert.ok(crypto.verify(null,Buffer.from('TrustSECO-community-v1\n'+envelope.payload),crypto.createPublicKey(f.identity.privateKey),Buffer.from(envelope.signature,'base64')));
  f.state.audit.push({id:payload.id,...envelope});f.a.commitments.a=payload.contribution;
  assert.equal(await mineOnce('http://localhost',f.file),true);assert.equal(posts,1);assert.ok(!fs.existsSync(f.file+'.outbox'));
  f.state.at=600;f.a.committee=['b','c','d'];assert.equal(await mineOnce('http://localhost',f.file),false);assert.equal(posts,1);
 }finally{global.fetch=original;f.cleanup();}
});
test('expired mining outbox is archived rather than endlessly retried or redrawn',async()=>{
 const f=fixture(),original=global.fetch;
 try {
  const pending={payload:JSON.stringify({id:'old',network:'n',kind:'entropy-commit',round:'r'}),signature:'fixture'};
  fs.writeFileSync(f.file+'.outbox',JSON.stringify(pending));f.state.at=600;
  global.fetch=async(url,options)=>{assert.ok(!options?.method);return {ok:true,json:async()=>f.state};};
  assert.ok(expiredEnvelope(JSON.parse(pending.payload),f.state));
  assert.equal(await mineOnce('http://localhost',f.file),false);
  assert.ok(!fs.existsSync(f.file+'.outbox'));assert.equal(fs.readdirSync(f.dir).filter(n=>n.includes('.expired-')).length,1);
 }finally{global.fetch=original;f.cleanup();}
});

test('commitment encoding has a stable cross-language protocol vector',()=>{
 assert.equal(entropyCommitment('00'.repeat(32),'alice','11'.repeat(32)),'663961b7c0879b7580446e768f4d898e2da582acf6ede33192d476866f63aa0c');
});
