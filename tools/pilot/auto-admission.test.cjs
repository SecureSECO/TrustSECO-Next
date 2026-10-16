const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {verifiedAdmission,sign,sshKey}=require('./client.cjs');
test('automatic admission checks live GitHub ownership and age without asserting person independence',async()=>{
 const old=global.fetch,k=crypto.generateKeyPairSync('ed25519'),publicKey=k.publicKey.export({type:'spki',format:'pem'}).toString(),now=Math.floor(Date.now()/1000);
 const payload=JSON.stringify({login:'reviewer',publicKey,network:'test',expiresAt:now+43200,nonce:crypto.randomUUID()}),request={payload,signature:sign(payload,k.privateKey,'TrustSECO-join-v1')};
 let linked=true,created='2020-01-01T00:00:00Z',id=123;
 global.fetch=async url=>({ok:true,json:async()=>String(url).includes('/snapshot')?{network:'test',at:now}:String(url).includes('ssh_signing_keys')?(linked?[{key:sshKey(publicKey)}]:[]):{login:'reviewer',id,type:'User',created_at:created}});
 try{
  const e=await verifiedAdmission('http://localhost:3000',request,undefined,true);
  assert.equal(e.githubId,'123');assert.equal(e.operator,'github:123');assert.match(e.evidence,/not proof of distinct humans/);
  linked=false;await assert.rejects(verifiedAdmission('http://localhost:3000',request,undefined,true),/Publish/);linked=true;
  created=new Date().toISOString();await assert.rejects(verifiedAdmission('http://localhost:3000',request,undefined,true),/180/);created='2020-01-01T00:00:00Z';
  id=0;await assert.rejects(verifiedAdmission('http://localhost:3000',request,undefined,true),/account ID/);id=123;
  await assert.rejects(verifiedAdmission('http://localhost:3000',{...request,signature:'bad'},undefined,true),/signature/);
  const expired=JSON.stringify({...JSON.parse(payload),expiresAt:now-1});await assert.rejects(verifiedAdmission('http://localhost:3000',{payload:expired,signature:sign(expired,k.privateKey,'TrustSECO-join-v1')},undefined,true),/current join/);
 }finally{global.fetch=old}
});
