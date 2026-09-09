// Governor-operated local test queue. Publishes one funded round at a time; never stores observations.
const fs=require('node:fs'),{durableEvent}=require('./client.cjs');
const [url,queueFile,keyFile]=process.argv.slice(2);
if(url!=='http://localhost:3000')throw Error('Local test endpoint required');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{for(;;){try{
 const queue=JSON.parse(fs.readFileSync(queueFile));
 const response=await fetch(url+'/api/pilot/snapshot');if(!response.ok)throw Error('Ledger unavailable');const s=await response.json();
 if(!s.testNetwork||queue.network!==s.network)throw Error('Queue network mismatch');
 if(s.rounds.some(r=>!r.closed)){await sleep(15000);continue;}
 const p=queue.packages.find(p=>!s.rounds.some(r=>r.id===p.roundID));
 if(!p){console.log('All queued packages have completed an attempted collection round');return;}
 // New rounds wait for preceding state to finalize; an expired target is never redrawn.
 if(s.policy.assignment==='availability-beacon-v1'){
  const ready=s.members.filter(m=>!m.revoked&&!m.suspended&&s.availability?.[m.id]?.until>s.at&&s.availability[m.id].height<=s.ledger.finalizedHeight);
  if(ready.length<3){await sleep(15000);continue;}
 }else if(!s.audit.every(a=>a.height<=s.ledger.finalizedHeight)){await sleep(15000);continue;}
 await durableEvent(url,keyFile,{kind:'open',round:p.roundID,package:p.repository,repository:p.repository,version:p.version,metric:'lib_sourcerank',source:'Libraries.io REST',method:'libraries-project-v1',packagePlatform:p.platform,packageName:p.name,duration:s.policy.assignment==='availability-beacon-v1'?300:180,bounty:'300'});
 console.log('Opened '+p.repository+' '+p.version);
 }catch(e){console.error(e.message);}await sleep(15000);}})().catch(e=>{console.error(e.message);process.exit(1)});
