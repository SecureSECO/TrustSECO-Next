// Exit nonzero until every selected package has both local and confirmed scores.
const fs=require('node:fs');
const [origin,queueFile]=process.argv.slice(2);
if(!origin||!queueFile)throw Error('Usage: node demo-readiness.cjs https://demo.example packages.json');
(async()=>{
 const queue=JSON.parse(fs.readFileSync(queueFile));let ready=0;
 for(const p of queue.packages){
  try{
   const r=await fetch(origin+'/api/dlt/scores/'+encodeURIComponent(p.repository)+'/'+encodeURIComponent(p.version),{signal:AbortSignal.timeout(30000)});
   if(!r.ok)throw Error('HTTP '+r.status);
   const s=await r.json();const ok=s.ledgerAvailable&&Number.isFinite(s.local?.score)&&Number.isFinite(s.confirmed?.score);
   if(ok)ready++;
   console.log(JSON.stringify({repository:p.repository,version:p.version,ready:!!ok,local:s.local?.score,confirmed:s.confirmed?.score,coverage:s.local?.coverage,reasons:s.local?.reasons}));
  }catch(e){console.log(JSON.stringify({repository:p.repository,ready:false,error:e.message}));}
 }
 console.log(`${ready}/${queue.packages.length} demo packages ready`);process.exitCode=ready===queue.packages.length?0:1;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
