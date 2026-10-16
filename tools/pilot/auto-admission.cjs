#!/usr/bin/env node
// Dedicated service: only this service gets the governor key. No key in the public relay.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {verifiedAdmission,durableEvent,baseURL}=require('./client.cjs');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
function validateValidatorRequest(request) {
  const join=JSON.parse(request.payload),bundle=join.validator;
  if(!bundle)return;
  const {address,bls}=require('@klayr/cryptography');
  if(!/^[a-f0-9]{64}$/.test(bundle.generatorKey)||!/^[a-f0-9]{96}$/.test(bundle.blsKey)||!/^[a-f0-9]{192}$/.test(bundle.proofOfPossession))throw Error('Invalid validator bundle');
  if(address.getKlayr32AddressFromPublicKey(Buffer.from(bundle.generatorKey,'hex'))!==bundle.address||!bls.popVerify(Buffer.from(bundle.blsKey,'hex'),Buffer.from(bundle.proofOfPossession,'hex')))throw Error('Invalid validator ownership');
  const key=crypto.createPublicKey({key:{kty:'OKP',crv:'Ed25519',x:Buffer.from(bundle.generatorKey,'hex').toString('base64url')},format:'jwk'});
  const binding=JSON.stringify({network:join.network,login:join.login,publicKey:join.publicKey,validator:bundle});
  if(!crypto.verify(null,Buffer.from('TrustSECO-validator-binding-v1\n'+binding),key,Buffer.from(join.validatorSignature||'','base64')))throw Error('Invalid generator ownership proof');
}
async function processRequest(url,file,governorFile){
  if(fs.existsSync(governorFile+'.event-outbox')) {
    const pending=read(governorFile+'.event-outbox');
    await durableEvent(url,governorFile,pending.body);
  }
  const request=read(file),e=await verifiedAdmission(url,request,undefined,true);
  // Reject malformed public bundles before creating any durable governor event.
  validateValidatorRequest(request);
  const response=await fetch(baseURL(url)+'/api/pilot/snapshot',{redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('Ledger unavailable');
  const state=await response.json();
  const member=state.members.find(m=>m.githubId===e.githubId || m.id===e.member || m.key===e.key);
  if(member){
    if(member.id!==e.member || member.key!==e.key || member.githubId!==e.githubId || member.revoked || member.standing==='suspended')throw Error('Existing identity conflicts or is disabled');
  }else{
    const id='github-enrol-'+crypto.createHash('sha256').update(state.network+'\n'+e.githubId).digest('hex');
    await durableEvent(url,governorFile,{...e,id});
  }
  if(JSON.parse(request.payload).validator){
    const response=await fetch(baseURL(url)+'/api/pilot/voting',{redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('Voting endpoint unavailable');
    const voting=await response.json();
    if(!voting.active)throw Error('Voting upgrade is not activated');
    const existing=voting.voters.find(v=>v.githubId===e.githubId);
    if(existing){if(existing.address!==JSON.parse(request.payload).validator.address)throw Error('This GitHub account already has a validator');}
    else {
      if(voting.bootstrap.length+voting.voters.length>=101)throw Error('Voting network capacity reached');
      const bundle=JSON.parse(request.payload).validator;
      if(voting.bootstrap.includes(bundle.address)||voting.voters.some(v=>v.address===bundle.address||v.generatorKey===bundle.generatorKey||v.blsKey===bundle.blsKey))throw Error('Validator keys already registered');
      await durableEvent(url,governorFile,{...e,kind:'register-validator',id:'github-validator-'+crypto.createHash('sha256').update(state.network+'\n'+e.githubId).digest('hex')});
    }
  }
  const id=(JSON.parse(request.payload).validator?'github-validator-':'github-enrol-')+crypto.createHash('sha256').update(state.network+'\n'+e.githubId).digest('hex');
  const receiptResponse=await fetch(baseURL(url)+'/api/pilot/event?id='+encodeURIComponent(id),{redirect:'error',signal:AbortSignal.timeout(20000)});
  const statusResponse=await fetch(baseURL(url)+'/api/pilot/status',{redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!receiptResponse.ok||!statusResponse.ok)throw Error('Could not confirm admission finality');
  const receipt=await receiptResponse.json(),status=await statusResponse.json();
  return {status:receipt.event&&receipt.event.height<=status.ledger.finalizedHeight?'finalized':'recorded',githubId:e.githubId,validator:!!JSON.parse(request.payload).validator};
}
async function main(){
  const [url,directory,governorFile]=process.argv.slice(2);baseURL(url);
  if(process.env.PILOT_ADMISSION_CREDENTIALS_FILE)process.env.GITHUB_TOKEN=read(process.env.PILOT_ADMISSION_CREDENTIALS_FILE).github;
  if(read(governorFile).id!=='governor')throw Error('Governor identity required');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  for(;;){
    for(const file of fs.readdirSync(directory).filter(f=>/^[1-9][0-9]*\.json$/.test(f)).sort()){
      const full=path.join(directory,file),digest=crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
      const statusFile=full+'.status';
      if(fs.existsSync(statusFile)){const previous=read(statusFile);if(previous.status==='finalized'&&previous.digest===digest)continue;}
      let result;
      try{result=await processRequest(url,full,governorFile);}catch(e){result={status:'retrying',error:e.message};}
      // Receipt is advisory: clients verify membership/validator state on the ledger.
      fs.writeFileSync(full+'.status.tmp',JSON.stringify({...result,digest,at:new Date().toISOString()}),{mode:0o600});
      fs.renameSync(full+'.status.tmp',full+'.status');
    }
    if(process.argv.includes('--once'))return;
    await new Promise(r=>setTimeout(r,15000));
  }
}
module.exports={processRequest,validateValidatorRequest};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exit(1)});
