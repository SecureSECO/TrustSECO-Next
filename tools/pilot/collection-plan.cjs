// Shared scheduling/read projection. No credentials, network calls or writes.
const {createHash}=require('node:crypto');
const METRICS=['lib_sourcerank','lib_release_count','gh_open_issues_count','lib_dependent_count','lib_dependency_count','gh_contributor_count','lib_contributor_count','lib_first_release_date','lib_latest_release_date','lib_release_frequency','gh_yearly_commit_count','gh_owner_stargazer_count'];
const REFRESH_SECONDS=86400, MAX_CONCURRENT=4;
function targets(network,packages,rounds,at){
 const byFact=new Map();
 for(const r of rounds){const k=JSON.stringify([r.escrow.repository.toLowerCase(),r.escrow.version,r.metric]);byFact.set(k,r);}
 return METRICS.flatMap(metric=>packages.map(p=>{
  const repository=p.repository.toLowerCase(),previous=byFact.get(JSON.stringify([repository,p.version,metric]));
  const registry=metric.startsWith('lib_')&&metric!=='lib_contributor_count';
  let applicable=/^[\w.-]+\/[\w.-]+$/.test(repository)&&typeof p.version==='string'&&!!p.version;
  if(registry)try{require('./libraries.cjs').targetPath({packagePlatform:p.platform,packageName:p.name,version:p.version});}catch{applicable=false;}
  const dueAt=previous?previous.openedAt+REFRESH_SECONDS:0;
  const id='collect-'+createHash('sha256').update(JSON.stringify([network,repository,p.version,metric,previous?.id||'initial'])).digest('hex').slice(0,40);
  const status=!applicable?'unavailable':!previous?'queued':!previous.closed?'collecting':previous.result.status==='verified'?'verified':previous.result.status==='disputed'?'disputed':previous.escrow.failures&&Object.keys(previous.escrow.failures).length?'source-unavailable':'insufficient-contributors';
  return {repository,version:p.version,metric,status,dueAt,previous,applicable,ready:applicable&&(!previous||(previous.closed&&at>=dueAt)),event:{kind:'open',round:id,package:repository,repository,version:p.version,metric,source:metric.startsWith('lib_')?'Libraries.io REST':'GitHub REST',method:registry?'libraries-project-v1':metric.startsWith('lib_')?'libraries-repository-v1':'github-rest-v1',...(registry?{packagePlatform:p.platform,packageName:p.name}:{}),...(previous?{refreshOf:previous.id}:{}),duration:900,bounty:'300'}};
 }));
}
function summary(state,packages){
 const items=targets(state.network,packages,state.rounds,state.at);
 const count=status=>items.filter(t=>t.status===status).length;
 return {entries:items.map(({previous,event,...t})=>({...t,round:previous?.id,failures:previous?.escrow.failures||{}})),total:items.length,queued:count('queued'),collecting:count('collecting'),verified:count('verified'),disputed:count('disputed'),unavailable:count('unavailable')+count('source-unavailable'),insufficient:count('insufficient-contributors'),maxConcurrent:MAX_CONCURRENT,refreshSeconds:REFRESH_SECONDS,availableContributors:state.availableContributors,waitingForContributors:state.availableContributors<3};
}
function next(state,packages){
 if(state.policy.collection!=='scheduled-v1')return {reason:'Waiting for coordinated collection-policy activation'};
 const ready=state.members.filter(m=>!m.revoked&&!m.suspended&&state.availability?.[m.id]?.until>state.at+60&&state.availability[m.id].height<=state.ledger.finalizedHeight);
 if(ready.length<3)return {reason:'Waiting for three available contributors'};
 if(state.ledger.height-state.ledger.finalizedHeight>20)return {reason:'Finality is lagging; new work paused'};
 if(state.rounds.filter(r=>!r.closed).length>=MAX_CONCURRENT)return {reason:'Collection slots occupied'};
 const planned=targets(state.network,packages,state.rounds,state.at);
 // Untouched facts come before refreshes; one slow metric cannot block the rest.
 const open=state.rounds.filter(r=>!r.closed);
 const attempts=Object.fromEntries(METRICS.map(metric=>[metric,planned.filter(t=>t.metric===metric&&t.previous).length]));
 const candidates=planned.filter(t=>t.ready&&!open.some(r=>r.metric===t.metric)&&open.filter(r=>r.source===t.event.source).length<2);
 candidates.sort((a,b)=>Number(!!a.previous)-Number(!!b.previous)||attempts[a.metric]-attempts[b.metric]);
 const task=candidates[0];
 if(!task)return {reason:planned.some(t=>t.ready)?'Waiting for a provider or metric collection slot':'Waiting for the next daily collection window'};
 if(BigInt(state.treasury)<300n)return {reason:'Waiting for funded TrustCOIN budget'};
 return {event:task.event};
}
module.exports={METRICS,REFRESH_SECONDS,MAX_CONCURRENT,targets,summary,next};
