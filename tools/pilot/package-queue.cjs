// Governor-operated publisher. Durable envelopes survive restarts without changing a draw.
const fs=require('node:fs'),{durableEvent}=require('./client.cjs'),{next}=require('./collection-plan.cjs');
const [url,queueFile,keyFile]=process.argv.slice(2);
if(url!=='http://localhost:3000')throw Error('Local test endpoint required');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{let lastReason='',finalized=-1,advancedAt=Date.now();for(;;){try{
 const queue=JSON.parse(fs.readFileSync(queueFile));
 const response=await fetch(url+'/api/pilot/snapshot',{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Ledger unavailable');const s=await response.json();
 if(!s.testNetwork||queue.network!==s.network||!Array.isArray(queue.packages)||queue.packages.length>500)throw Error('Queue network or targets invalid');
 // Always reconcile an uncertain signed opening before selecting another fact.
 const pending=keyFile+'.event-outbox';
 if(fs.existsSync(pending)){await durableEvent(url,keyFile,JSON.parse(fs.readFileSync(pending)).body);continue;}
 if(s.ledger.finalizedHeight!==finalized){finalized=s.ledger.finalizedHeight;advancedAt=Date.now();}
 const selected=Date.now()-advancedAt>180000?{reason:'Finality has not advanced for three minutes; new work paused'}:next(s,queue.packages);
 if(selected.event){await durableEvent(url,keyFile,selected.event);console.log('Opened '+selected.event.repository+' '+selected.event.version+' '+selected.event.metric);lastReason='';}
 else if(selected.reason!==lastReason){console.log(selected.reason);lastReason=selected.reason;}
 }catch(e){console.error(e.message);}await sleep(5000);}})().catch(e=>{console.error(e.message);process.exit(1)});
