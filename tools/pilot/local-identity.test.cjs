const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {LocalIdentity,localRequestAllowed}=require('./local-identity.cjs');
function fixture(run){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'trustseco-identity-'));try{return run(new LocalIdentity(dir),dir)}finally{fs.rmSync(dir,{recursive:true,force:true})}}
test('creates one private identity and exposes only its public data',()=>fixture((store,dir)=>{
 const pub=store.create('example');assert.equal(pub.login,'example');assert.equal(pub.privateKey,undefined);assert.match(pub.sshKey,/^ssh-ed25519 /);assert.equal(fs.statSync(store.file).mode&0o777,0o600);assert.equal(fs.statSync(dir).mode&0o777,0o700);assert.throws(()=>store.create('another'),/already/);
 const join=store.join('network'),data=JSON.parse(join.payload);assert.equal(data.network,'network');assert.ok(crypto.verify(null,Buffer.from('TrustSECO-join-v1\n'+join.payload),pub.publicKey,Buffer.from(join.signature,'base64')));
}));
test('encrypted recovery preserves the exact identity and rejects wrong passwords/tampering',()=>fixture(store=>{
 const original=store.create('example'),backup=store.backup('a long recovery password');assert.ok(!JSON.stringify(backup).includes('PRIVATE KEY'));assert.throws(()=>store.backup('short'),/12/);
 fixture(other=>{assert.throws(()=>other.restore(backup,'wrong recovery password'),/Recovery failed/);assert.equal(other.public(),null);assert.throws(()=>other.restore({...backup,tag:'00'.repeat(16)},'a long recovery password'),/Recovery failed/);assert.deepEqual(other.restore(backup,'a long recovery password'),original);assert.throws(()=>other.restore(backup,'a long recovery password'),/replace/)});
}));
test('settings survive restart without exporting the private key',()=>fixture((store,dir)=>{store.create('example');store.setMining(true);assert.equal(new LocalIdentity(dir).settings().mining,true);assert.equal(new LocalIdentity(dir).public().privateKey,undefined)}));
test('local guard rejects DNS rebinding, cross-site origins and unmarked requests',()=>{
 const allow=(host='localhost:3005',origin='http://localhost:3005',site='same-origin',header='1')=>localRequestAllowed('http://localhost:3005',host,origin,site,header);
 assert.ok(allow());assert.equal(allow('attacker.example:3005'),false);assert.equal(allow(undefined,'https://attacker.example'),false);assert.equal(allow(undefined,undefined,'cross-site'),false);assert.equal(allow(undefined,undefined,undefined,''),false);assert.equal(localRequestAllowed('http://remote.example','remote.example','','','1'),false);
});
