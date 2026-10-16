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
test('broken-executable diagnostics identify the artifact, survive restart and prevent unchanged-file rescans',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'clamav-diagnostic-'));let downloads=0,scans=0,activeEngine=engine;
 const scanner=async cmd=>{if(cmd==='VERSION')return activeEngine;scans++;return 'stream: Heuristics.Broken.Executable FOUND';};
 const attempt=()=>collectMalware(target,async()=>metadata(),scanner,async()=>{downloads++;return bytes;},{directory});
 try {
  await assert.rejects(attempt(),e=>e.code==='SCAN_INCONCLUSIVE'&&e.retryAfterMs===21600000&&e.message.includes('demo-1.0.tar.gz')&&e.message.includes(digest));
  await assert.rejects(attempt(),e=>e.retryAfterMs>21500000);assert.equal(downloads,1);assert.equal(scans,1);
  const file=path.join(directory,fs.readdirSync(directory)[0]),record=JSON.parse(fs.readFileSync(file));assert.equal(record.status,'inconclusive');assert.equal(record.filename,'demo-1.0.tar.gz');assert.equal(record.engine,engine);assert.equal(record.value,undefined);
  record.retryAt=Date.now()-1;fs.writeFileSync(file,JSON.stringify(record));await assert.rejects(attempt());assert.equal(downloads,2);
  activeEngine=engine.replace('/12345/','/12346/');await assert.rejects(attempt());assert.equal(downloads,3);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('an inconclusive artifact prevents a partial clean release result',async()=>{
 const m=metadata();m.urls.push({...m.urls[0],filename:'z-demo.whl',packagetype:'bdist_wheel'});let calls=0;
 await assert.rejects(collectMalware(target,async()=>m,async cmd=>cmd==='VERSION'?engine:++calls===1?'stream: OK':'stream: Heuristics.Encrypted.Zip FOUND',async()=>bytes),e=>e.code==='SCAN_INCONCLUSIVE'&&e.message.includes('z-demo.whl'));
});
test('cached inconclusive result stops the whole release before redownloading earlier clean artifacts',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const directory=fs.mkdtempSync(path.join(os.tmpdir(),'clamav-preflight-'));
 const m=metadata();m.urls.push({...m.urls[0],filename:'z-demo.whl',packagetype:'bdist_wheel'});let downloads=0,scans=0;
 const attempt=()=>collectMalware(target,async()=>m,async cmd=>cmd==='VERSION'?engine:++scans===1?'stream: OK':'stream: Heuristics.Broken.Executable FOUND',async()=>{downloads++;return bytes;},{directory});
 try{await assert.rejects(attempt());assert.equal(downloads,2);await assert.rejects(attempt(),e=>e.code==='SCAN_INCONCLUSIVE');assert.equal(downloads,2);assert.equal(scans,2);}finally{fs.rmSync(directory,{recursive:true,force:true});}
});
