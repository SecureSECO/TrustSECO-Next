#!/usr/bin/env node
// Emit reviewable funded-round commands, never read keys or submit work.
const {metrics,targetPath}=require('./libraries.cjs');
function plan(repository,packagePlatform,packageName,version,prefix){
 targetPath({packagePlatform,packageName,version});
 if(!/^[\w.-]+\/[\w.-]+$/.test(repository)||!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,50}$/.test(prefix))throw Error('Repository and unique round prefix required');
 return ['lib_contributor_count',...metrics].map((metric,i)=>({kind:'open',round:prefix+'-'+i,package:repository,repository,version,metric,source:'Libraries.io REST',method:metric==='lib_contributor_count'?'libraries-repository-v1':'libraries-project-v1',...(metric==='lib_contributor_count'?{}:{packagePlatform,packageName}),duration:3600,bounty:'300'}));
}
module.exports={plan};
if(require.main===module){try{console.log(JSON.stringify(plan(...process.argv.slice(2)),null,2));}catch(e){console.error(e.message+'\nUsage: libraries-plan.cjs owner/repository PyPI PackageName version round-prefix');process.exitCode=1;}}
