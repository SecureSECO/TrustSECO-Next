const {test}=require('node:test'),assert=require('node:assert/strict');
const {targets,next,summary,METRICS}=require('./collection-plan.cjs');
const packages=[{repository:'Pallets/Flask',version:'3.1.1',platform:'PyPI',name:'Flask'}];
const state=()=>({network:'n',at:100,policy:{collection:'scheduled-v1'},ledger:{height:10,finalizedHeight:8},rounds:[],members:['a','b','c'].map(id=>({id})),availability:Object.fromEntries(['a','b','c'].map(id=>[id,{until:1000,height:8}])),availableContributors:3,treasury:'1000000'});
const round=(event,extra={})=>({id:event.round,openedAt:100,closed:true,result:{status:'verified'},metric:event.metric,escrow:{repository:event.repository,version:event.version},...extra});
test('forty packages expand to 480 unique metric targets with correct collector routes',()=>{
 const ps=Array.from({length:40},(_,i)=>({...packages[0],repository:'owner/pkg'+i}));const tasks=targets('n',ps,[],100);
 assert.equal(tasks.length,480);assert.equal(new Set(tasks.map(t=>t.event.round)).size,480);assert.equal(METRICS.filter(m=>m.startsWith('gh_')).length,4);
 assert.equal(tasks.find(t=>t.metric==='lib_contributor_count').event.method,'libraries-repository-v1');assert.equal(tasks.find(t=>t.metric==='lib_dependency_count').event.packageName,'Flask');
});
test('restart preserves IDs, existing facts are skipped by identity rather than old queue IDs',()=>{
 const s=state(),e=next(s,packages).event;assert.deepEqual(next(s,packages).event,e);s.rounds=[round({...e,round:'old-source-rank'})];assert.notEqual(next(s,packages).event.metric,e.metric);
 assert.equal(summary(s,packages).verified,1);assert.equal(summary(s,packages).queued,11);
});
test('concurrency, finalized availability, lag and treasury bound publication',()=>{
 const s=state();s.rounds=targets('n',packages,[],100).slice(0,4).map(t=>round(t.event,{closed:false}));assert.match(next(s,packages).reason,/slots/);
 s.rounds=[];s.ledger.height=50;assert.match(next(s,packages).reason,/Finality/);s.ledger.height=10;s.availability.c.height=9;assert.match(next(s,packages).reason,/contributors/);s.availability.c.height=8;s.treasury='1';assert.match(next(s,packages).reason,/budget/);
});
test('refresh and failed retries wait equally, link previous rounds, preserve old attempts',()=>{
 const s=state();s.rounds=targets('n',packages,[],100).map(t=>round(t.event,{result:{status:'expired'}}));assert.match(next(s,packages).reason,/daily/);s.at=86500;for(const l of Object.values(s.availability))l.until=s.at+1000;
 const e=next(s,packages).event;assert.equal(e.refreshOf,s.rounds[0].id);assert.notEqual(e.round,e.refreshOf);assert.equal(summary(s,packages).insufficient,12);
});
test('unknown registry mappings and reported source failures stay visible without invented zero facts',()=>{
 const s=state();assert.equal(summary(s,[{repository:'x/y',version:'1'}]).unavailable,7);
 const e=next(s,packages).event;s.rounds=[round(e,{result:{status:'expired'},escrow:{repository:e.repository,version:e.version,failures:{a:{reason:'credentials-missing'}}}})];assert.equal(summary(s,packages).unavailable,1);assert.equal(summary(s,packages).verified,0);
});
test('slow provider and metric rounds cannot monopolize all four slots',()=>{
 const s=state(),ps=[...packages,{...packages[0],repository:'other/package'}];
 const ts=targets('n',ps,[],100);s.rounds=ts.filter(t=>['gh_open_issues_count','gh_contributor_count'].includes(t.metric)&&t.repository==='pallets/flask').map(t=>({...round(t.event,{closed:false}),source:t.event.source}));
 assert.equal(next(s,ps).event.source,'Libraries.io REST');
 const e=next(s,ps).event;s.rounds.push({...round(e,{closed:false}),source:e.source});assert.notEqual(next(s,ps).event.metric,e.metric);
});
