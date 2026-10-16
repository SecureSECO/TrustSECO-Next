const {test}=require('node:test'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
test('replica portal starts without a relay key and rejects direct event submission',async()=>{
 const child=spawn(process.execPath,['dist/pilot.js'],{env:{...process.env,PILOT_READ_ONLY:'true',PILOT_RELAYER_FILE:'',DLT_ENDPOINT:'ws://127.0.0.1:1',PORT:'3019'},stdio:'ignore'});
 try {
  let response;
  for(let i=0;i<50;i++){
   try{response=await fetch('http://127.0.0.1:3019/api/pilot/event',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});break}
   catch{await new Promise(resolve=>setTimeout(resolve,100))}
  }
  assert.equal(response?.status,503);
 }finally{child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve))}
});
