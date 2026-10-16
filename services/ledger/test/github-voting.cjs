const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const c=require('@klayr/cryptography');
const {validateRegistration,equalVoting,rotateCommittee,validateAvailability}=require('../dist/app/modules/github_voting/policy');
const {bindingRequest}=require('../../../tools/pilot/reviewer.cjs');
const {sign}=require('../../../tools/pilot/client.cjs');
const identity=id=>{const k=crypto.generateKeyPairSync('ed25519');return {id,publicKey:k.publicKey.export({type:'spki',format:'pem'}).toString(),privateKey:k.privateKey.export({type:'pkcs8',format:'pem'}).toString()}};
async function fixture(){
 const governor=identity('governor'),member=identity('reviewer'),privateKey=await c.ed.getPrivateKeyFromPhraseAndPath('isolated voting test',"m/44'/134'/0'");
 const generatorKey=c.ed.getPublicKeyFromPrivateKey(privateKey),secret=c.bls.generatePrivateKey(crypto.randomBytes(32)),blsKey=c.bls.getPublicKeyFromPrivateKey(secret);
 const validator={privateKey:privateKey.toString('hex'),public:{address:c.address.getKlayr32AddressFromPublicKey(generatorKey),generatorKey:generatorKey.toString('hex'),blsKey:blsKey.toString('hex'),proofOfPossession:c.bls.popProve(secret).toString('hex')}};
 const now=Math.floor(Date.now()/1000),request=bindingRequest(member,validator,'test',now);
 const event={id:'admission-1',kind:'register-validator',actor:'governor',network:'test',githubId:'123',member:member.id,key:member.publicKey,accountCreatedAt:now-181*86400,joinPayload:request.payload,joinSignature:request.signature};
 const run=(e=event,state={bootstrap:[],voters:[]},at=now)=>{const payload=JSON.stringify(e);return validateRegistration(state,payload,sign(payload,governor.privateKey),governor.publicKey,'test',at,50)};
 return {governor,member,validator,event,run,now};
}
test('verified identity binds both generator and BLS ownership; duplicate numeric IDs cannot gain votes',async()=>{
 const f=await fixture(),v=f.run();assert.equal(v.address,f.validator.public.address);assert.equal(v.githubId,'123');
 assert.throws(()=>f.run({...f.event,id:'new',member:'renamed'},{bootstrap:[],voters:[v]}));
 assert.throws(()=>f.run({...f.event,id:'new'},{bootstrap:[],voters:[v]}),/already registered/);
 assert.throws(()=>f.run({...f.event,accountCreatedAt:f.now}),/180/);
 assert.throws(()=>f.run({...f.event,network:'other'}),/domain/);
 assert.throws(()=>f.run(f.event,undefined,f.now+43201),/expired/);
 const join=JSON.parse(f.event.joinPayload);join.validatorSignature=Buffer.alloc(64).toString('base64');
 const altered=JSON.stringify(join);
 assert.throws(()=>f.run({...f.event,joinPayload:altered,joinSignature:sign(altered,f.member.privateKey,'TrustSECO-join-v1')}),/generator ownership/);
});
test('admission rejects malformed validator bundles before signing governor events',async()=>{
 const f=await fixture(),{validateValidatorRequest}=require('/tools/auto-admission.cjs');
 const request={payload:f.event.joinPayload};
 assert.doesNotThrow(()=>validateValidatorRequest(request));
 const join=JSON.parse(request.payload);join.validatorSignature=Buffer.alloc(64).toString('base64');
 assert.throws(()=>validateValidatorRequest({payload:JSON.stringify(join)}),/ownership/);
 join.validator.proofOfPossession='00';
 assert.throws(()=>validateValidatorRequest({payload:JSON.stringify(join)}),/bundle/);
});
test('equal votes require strictly more than two thirds and reject duplicate addresses',async()=>{
 const f=await fixture(),a=f.validator.public.address;assert.equal(equalVoting([a]).validators[0].bftWeight,1n);assert.equal(equalVoting([a]).threshold,1n);
 assert.throws(()=>equalVoting([a,a]),/Invalid voting set/);
 const addresses=Array.from({length:5},(_,i)=>c.address.getKlayr32AddressFromAddress(Buffer.alloc(20,i+1)));
 assert.equal(equalVoting(addresses).threshold,4n);assert.ok(equalVoting(addresses).validators.every(v=>v.bftWeight===1n));
});
test('rotation fits four seats, gives every identity equal turns, and changes one seat at a time',()=>{
 for(const size of [4,5,10,101]){
  let queue=Array.from({length:size},(_,i)=>'v'+i),previous=queue.slice(0,4);const counts=new Map();
  for(let turn=0;turn<size;turn++){
   const next=rotateCommittee(queue,4,true);assert.equal(next.committee.length,4);
   assert.ok(next.committee.filter(a=>!previous.includes(a)).length<=1);
   for(const a of next.committee)counts.set(a,(counts.get(a)||0)+1);
   queue=next.queue;previous=next.committee;
  }
  assert.equal(counts.size,size);assert.ok([...counts.values()].every(n=>n===4));
 }
 assert.equal(rotateCommittee(['a','b','c'],4,true).committee,null);
 assert.throws(()=>rotateCommittee(['a','a','b','c'],4,true),/queue/);
});
test('only a validator owner can leave or resume its existing identity',async()=>{
 const f=await fixture(),v=f.run(),state={bootstrap:[],voters:[v]};
 const payload=JSON.stringify({id:'leave',kind:'validator-availability',actor:'reviewer',network:'test',enabled:false});
 assert.equal(validateAvailability(state,payload,sign(payload,f.member.privateKey),'test').enabled,false);
 assert.throws(()=>validateAvailability(state,payload,sign(payload,f.governor.privateKey),'test'),/signature/);
 assert.throws(()=>validateAvailability(state,payload,sign(payload,f.member.privateKey),'wrong'),/availability/);
});
