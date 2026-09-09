const {test}=require('node:test'),assert=require('node:assert/strict');
const {collectProject,metrics}=require('./libraries.cjs'),{plan}=require('./libraries-plan.cjs');
const target={packagePlatform:'PyPI',packageName:'Flask',version:'3.1.2'};
const project=()=>({platform:'PyPI',name:'Flask',repository_url:'https://github.com/pallets/flask.git',dependents_count:321,rank:25,versions:[{number:'3.1.2',published_at:'2025-01-03T00:00:00Z'},{number:'1.0',published_at:'2025-01-01T00:00:00Z'},{number:'2.0',published_at:'2025-01-02T00:00:00Z'}]});
const deps=()=>({platform:'PyPI',name:'Flask',dependencies_for_version:'3.1.2',dependencies:[{platform:'PyPI',name:'Jinja2',kind:'Runtime'},{platform:'PyPI',name:'pytest',kind:'Development'},{platform:'PyPI',name:'Jinja2',kind:'Runtime'}]});
function collect(metric,p=project(),d=deps()){return collectProject('pallets/flask',metric,target,'secret-key',async u=>u.includes('/dependencies?')?d:p);}
test('all original Libraries.io numeric collectors yield meaningful values with key-free evidence',async()=>{
 const expected={lib_dependency_count:1,lib_dependent_count:321,lib_first_release_date:1735689600,lib_latest_release_date:1735862400,lib_release_count:3,lib_release_frequency:86400,lib_sourcerank:25};
 for(const metric of metrics){const result=await collect(metric);assert.equal(result.value,expected[metric],metric);assert.match(result.evidenceHash,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(result).includes('secret-key'));}
 assert.equal(plan('pallets/flask','PyPI','Flask','3.1.2','test').length,8);
});
test('reject wrong package/repository/version and never treat unavailable dependency data as zero',async()=>{
 for(const p of [{...project(),name:'other'},{...project(),platform:'npm'},{...project(),repository_url:'https://github.com/evil/flask'},{...project(),versions:[{number:'other'}]}])await assert.rejects(collect('lib_release_count',p));
 for(const d of [{...deps(),dependencies:null},{...deps(),dependencies:[]},{...deps(),dependencies_for_version:'latest'},{...deps(),dependencies:[{name:'unknown'}]}])await assert.rejects(collect('lib_dependency_count',project(),d));
});
test('dates need complete history and intervals need at least two releases',async()=>{
 await assert.rejects(collect('lib_first_release_date',{...project(),versions:[{number:'3.1.2',published_at:null}]}));
 await assert.rejects(collect('lib_release_frequency',{...project(),versions:[project().versions[0]]}));
 await assert.rejects(collect('lib_sourcerank',{...project(),rank:null}));
 assert.equal((await collect('lib_dependent_count',{...project(),dependents_count:0})).value,0);
});
test('scoped registry package names are encoded and provider failures cannot submit a value',async()=>{
 const scoped={packagePlatform:'NPM',packageName:'@scope/pkg',version:'1.0.0'};let url;
 await assert.rejects(collectProject('owner/repo','lib_release_count',scoped,'secret',async u=>{url=u;throw Error('HTTP 429');}),/429/);
 assert.ok(url.includes('/NPM/%40scope%2Fpkg?'));await assert.rejects(collectProject('pallets/flask','lib_release_count',target,'',async()=>project()),/API key/);
});
