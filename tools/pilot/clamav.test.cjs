const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {collectMalware,verdict}=require('./clamav.cjs');
const bytes=Buffer.from('ordinary package fixture'),digest=crypto.createHash('sha256').update(bytes).digest('hex');
const target={packagePlatform:'Pypi',packageName:'demo',version:'1.0'};
const metadata=()=>({info:{name:'demo',version:'1.0'},urls:[{filename:'demo-1.0.tar.gz',url:'https://files.pythonhosted.org/packages/demo.tar.gz',size:bytes.length,digests:{sha256:digest},packagetype:'sdist'}]});
const engine='ClamAV 1.4.3/12345/'+new Date().toUTCString();
const scan=reply=>async cmd=>cmd==='VERSION'?engine:reply;
test('exact artifacts produce signed complete clean and detected ratios',async()=>{
 for(const [reply,value] of [['stream: OK',0],['stream: Test-Signature FOUND',1000000]]){
 const r=await collectMalware(target,async()=>metadata(),scan(reply),async()=>bytes);
 assert.equal(r.value,value);assert.equal(r.malware.infected,value?1:0);assert.equal(r.malware.artifacts,1);assert.match(r.malware.manifestHash,/^[a-f0-9]{64}$/);
 }
});
test('scan errors, limits and encryption never become clean',()=>{
 for(const reply of ['stream: Heuristics.Limits.Exceeded.MaxScanSize FOUND','stream: Heuristics.Encrypted.Zip FOUND','stream: read ERROR','unexpected'])assert.throws(()=>verdict(reply));
});
test('missing release, wrong identity, download mismatch, unsafe URL and stale signatures fail closed',async()=>{
 for(const mutate of [m=>m.urls=[],m=>m.info.version='other',m=>m.urls[0].url='http://localhost/private',m=>m.urls[0].size=999999999,m=>m.urls[0].digests.sha256='0'.repeat(64)]){
 const m=metadata();mutate(m);await assert.rejects(collectMalware(target,async()=>m,scan('stream: OK'),async()=>bytes));
 }
 await assert.rejects(collectMalware(target,async()=>metadata(),async()=> 'ClamAV 1.4.3/12345/Mon, 01 Jan 2024 00:00:00 GMT',async()=>bytes),/stale/);
});
test('signature changes during the release require a fresh scan',async()=>{
 let calls=0;await assert.rejects(collectMalware(target,async()=>metadata(),async cmd=>cmd==='VERSION'?(++calls===1?engine:engine+'changed'):'stream: OK',async()=>bytes),/changed/);
});
