#!/usr/bin/env node
// Run in the ledger image with a private persistent volume at /reviewer.
const fs=require('node:fs'),crypto=require('node:crypto'),{spawn,execFileSync}=require('node:child_process');
const {baseURL,sshKey,sign,durableEvent}=require('./client.cjs');
function bindingRequest(identity,validator,network,now=Math.floor(Date.now()/1000)) {
  const bundle=validator.public;
  const binding=JSON.stringify({network,login:identity.id,publicKey:identity.publicKey,validator:bundle});
  const seed=Buffer.from(validator.privateKey,'hex').subarray(0,32);
  const generator=crypto.createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),type:'pkcs8',format:'der'});
  const payload=JSON.stringify({network,login:identity.id,publicKey:identity.publicKey,validator:bundle,validatorSignature:sign(binding,generator,'TrustSECO-validator-binding-v1'),expiresAt:now+43200,nonce:crypto.randomUUID()});
  return {payload,signature:sign(payload,identity.privateKey,'TrustSECO-join-v1')};
}
async function get(url,options={}) {
  const r=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error(`Network request failed (${r.status}); check GitHub key linking and retry`);
  return r.json();
}
async function main(){
  const [raw,login]=process.argv.slice(2),url=baseURL(raw),root='/reviewer';
  if(!/^[a-z0-9][a-z0-9-]{0,38}$/.test(login)||['governor','constructor','prototype'].includes(login))throw Error('Supply your lowercase personal GitHub username');
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  const network=await get(url+'/api/pilot/network');
  const hash=crypto.createHash('sha256').update(Buffer.from(network.genesis,'base64')).digest('hex');
  if(hash!==network.genesisSHA256)throw Error('Genesis checksum mismatch');
  const manifest={network:network.network,chainID:network.chainID,genesisSHA256:hash,governor:network.governor,login};
  if(fs.existsSync(root+'/network.json')&&JSON.stringify(JSON.parse(fs.readFileSync(root+'/network.json')))!==JSON.stringify(manifest))throw Error('Existing data belongs to a different network, governor or GitHub identity');
  fs.writeFileSync(root+'/network.json',JSON.stringify(manifest),{mode:0o600});
  if(!fs.existsSync(root+'/identity.json'))execFileSync(process.execPath,['/tools/client.cjs','init',login,root+'/identity.json'],{stdio:'ignore'});
  if(!fs.existsSync(root+'/validator/keys.json'))execFileSync(process.execPath,['/tools/validator.cjs',root+'/validator'],{stdio:'ignore'});
  const identity=JSON.parse(fs.readFileSync(root+'/identity.json'));
  if(identity.id!==login)throw Error('GitHub identity mismatch');
  const validator={public:JSON.parse(fs.readFileSync(root+'/validator/public.json')),privateKey:JSON.parse(fs.readFileSync(root+'/validator/keys.json')).keys[0].plain.generatorPrivateKey};
  const config=JSON.parse(fs.readFileSync('config/default/config.json'));
  config.genesis={...network.genesisConfig,block:{fromFile:root+'/genesis_block.blob'}};
  config.modules=network.modules;
  config.system.dataPath=root+'/ledger';config.system.logLevel='error';
  config.generator.keys={fromFile:root+'/validator/keys.json'};
  config.network.seedPeers=network.peers;config.network.fixedPeers=network.peers;
  config.rpc={modes:['ws'],host:'127.0.0.1',port:7887,allowedMethods:['*']};
  fs.writeFileSync(root+'/config.json',JSON.stringify(config),{mode:0o600});
  fs.writeFileSync(root+'/genesis_block.blob',Buffer.from(network.genesis,'base64'),{mode:0o600});
  fs.writeFileSync(root+'/governor.pem',network.governor,{mode:0o600});
  console.log('Add this public key as a GitHub SSH Signing Key: https://github.com/settings/ssh/new\n'+sshKey(identity.publicKey));
  console.log('Your node is synchronizing. Admission and voting activation will be checked automatically.');
  const child=spawn('./bin/run',['start','--data-path',root+'/ledger','--config',root+'/config.json','--overwrite-config'],{stdio:'inherit',env:{...process.env,TRUSTSECO_PILOT:'true',PILOT_NETWORK:network.network,PILOT_GOVERNOR_FILE:root+'/governor.pem',TRUSTSECO_SEED_PEERS:network.peers.map(p=>`${p.ip}:${p.port}`).join(','),TRUSTSECO_FIXED_PEERS:network.peers.map(p=>`${p.ip}:${p.port}`).join(',')}});
  let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(stopping){child.kill(signal);return;}stopping=true;console.log('Leaving the voting rotation before stopping…');});
  child.on('exit',code=>{if(code)process.exitCode=code;stopping=true});
  const {createWSClient}=require('@klayr/api-client');let last='',nextJoin=0;
  while(!stopping){
    let client;
    try{
      client=await createWSClient('ws://127.0.0.1:7887/rpc-ws');
      const local=await client.node.getNodeInfo(),remote=await get(url+'/api/pilot/voting');
      if(local.syncing||local.finalizedHeight<remote.finalizedHeight)throw Error('Synchronizing ledger before requesting a vote');
      const registered=remote.voters.find(v=>v.address===validator.public.address);
      const current=remote.currentValidators.find(v=>v.address===validator.public.address);
      const message=current?`Voting active: weight ${current.weight}; finalized height ${local.finalizedHeight}`:registered ? 'Registered; waiting for the next equal-weight voting turn' : 'Synchronized; waiting for GitHub verification and validator activation';
      if(message!==last){console.log(message);last=message;}
      if(fs.existsSync(root+'/identity.json.event-outbox')) {
        await durableEvent(url,root+'/identity.json',JSON.parse(fs.readFileSync(root+'/identity.json.event-outbox')).body);
      } else if(registered?.enabled===false) {
        await durableEvent(url,root+'/identity.json',{kind:'validator-availability',enabled:true});
      }
      if(!registered&&Date.now()>=nextJoin){
        nextJoin=Date.now()+60000;
        await get(url+'/api/pilot/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(bindingRequest(identity,validator,network.network))});
      }
    }catch(e){if(e.message!==last){console.log(e.message);last=e.message}}
    finally{if(client)await client.disconnect().catch(()=>{})}
    if(!stopping)await new Promise(r=>setTimeout(r,15000));
  }
  if(child.exitCode===null){
    try{
      if(fs.existsSync(root+'/identity.json.event-outbox'))await durableEvent(url,root+'/identity.json',JSON.parse(fs.readFileSync(root+'/identity.json.event-outbox')).body);
      const state=await get(url+'/api/pilot/voting');
      if(state.voters.some(v=>v.address===validator.public.address)){
        const id=await durableEvent(url,root+'/identity.json',{kind:'validator-availability',enabled:false});
        const receipt=await get(url+'/api/pilot/event?id='+encodeURIComponent(id));
        let left=false;
        for(let i=0;i<90;i++){
          const current=await get(url+'/api/pilot/voting');
          if(current.finalizedHeight>=receipt.event.height&&!current.currentValidators.some(v=>v.address===validator.public.address)){left=true;break;}
          await new Promise(r=>setTimeout(r,2000));
        }
        if(!left)throw Error('Departure is not finalized yet');
        console.log('Departure finalized; validator keys and signing history remain on this volume.');
      }
    }catch(e){console.error('Could not confirm departure: '+e.message+'. This identity may remain scheduled; restart this same volume to recover.');process.exitCode=1;}
    child.kill('SIGTERM');
  }
}

module.exports={bindingRequest};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exit(1)});
