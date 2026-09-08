// Libraries.io project collectors. Targets are explicit; repository names are not registry names.
const crypto=require('node:crypto');
const metrics=['lib_dependency_count','lib_dependent_count','lib_first_release_date','lib_latest_release_date','lib_release_count','lib_release_frequency','lib_sourcerank'];
function targetPath(target){
 if(!target || !/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(target.packagePlatform)||typeof target.packageName!=='string'||!target.packageName.length||target.packageName.length>200||/[\s?#\\]/.test(target.packageName)||target.packageName.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('An explicit registry platform and package name are required');
 if(typeof target.version!=='string'||!target.version.length||target.version==='latest')throw Error('An exact package version is required');
 return 'https://libraries.io/api/'+encodeURIComponent(target.packagePlatform)+'/'+encodeURIComponent(target.packageName);
}
function repositoryName(url){if(typeof url!=='string')return null;const m=url.match(/^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)\/?$/i);return m?(m[1]+'/'+m[2].replace(/\.git$/i,'')).toLowerCase():null;}
function count(value){if(!Number.isSafeInteger(value)||value<0)throw Error('Missing or invalid Libraries.io count');return value;}
function versions(project){if(!Array.isArray(project.versions)||!project.versions.length)throw Error('Release history is unavailable');const seen=new Set();for(const v of project.versions){if(typeof v.number!=='string'||seen.has(v.number))throw Error('Incomplete or duplicate release history');seen.add(v.number);}return project.versions;}
function releaseTimes(project){return versions(project).map(v=>{if(typeof v.published_at!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(v.published_at))throw Error('Release dates are incomplete');const t=Math.floor(Date.parse(v.published_at)/1000);if(!Number.isSafeInteger(t)||t<0||t>Date.now()/1000)throw Error('Invalid release timestamp');return t;}).sort((a,b)=>a-b);}
async function collectProject(repository,metric,target,key,request){
 if(!metrics.includes(metric))throw Error('Unsupported Libraries.io project metric');
 if(!key)throw Error('Save a Libraries.io API key in Settings to collect this metric');
 const source=targetPath(target),project=await request(source+'?api_key='+encodeURIComponent(key));
 if(project.platform?.toLowerCase()!==target.packagePlatform.toLowerCase()||project.name!==target.packageName||repositoryName(project.repository_url)!==repository.toLowerCase())throw Error('Libraries.io package/repository mapping does not match the funded target');
 if(!versions(project).some(v=>v.number===target.version))throw Error('Requested version is not in the package release history');
 let value,raw=project,evidence=source,scope='Current package metadata';
 if(metric==='lib_dependent_count')value=count(project.dependents_count);
 if(metric==='lib_sourcerank')value=count(project.rank);
 if(metric==='lib_release_count')value=versions(project).length;
 if(['lib_first_release_date','lib_latest_release_date','lib_release_frequency'].includes(metric)){
  const times=releaseTimes(project);
  if(metric==='lib_first_release_date')value=times[0];
  if(metric==='lib_latest_release_date')value=times.at(-1);
  if(metric==='lib_release_frequency'){if(times.length<2)throw Error('At least two dated releases are needed for a release interval');value=Math.round((times.at(-1)-times[0])/(times.length-1));}
 }
 if(metric==='lib_dependency_count'){
  evidence=source+'/'+encodeURIComponent(target.version)+'/dependencies';
  const data=await request(evidence+'?api_key='+encodeURIComponent(key));
  if(data.platform?.toLowerCase()!==target.packagePlatform.toLowerCase()||data.name!==target.packageName||data.dependencies_for_version!==target.version)throw Error('Dependency response does not match the requested package version');
  // Some provider versions return [] before dependencies have been indexed. It is not reliable evidence of zero dependencies.
  if(!Array.isArray(data.dependencies)||!data.dependencies.length)throw Error('Dependency data is empty or not indexed; zero dependencies cannot be established');
  const unique=new Set();for(const d of data.dependencies){if(typeof d.kind!=='string'||typeof d.name!=='string'||typeof d.platform!=='string'||!d.kind.trim()||!d.name||!d.platform)throw Error('Incomplete dependency entry');if(d.kind.toLowerCase()!=='development')unique.add(d.platform+':'+d.name);}
  value=unique.size;raw={project,dependencies:data};scope='Dependencies for exact version '+target.version;
 }
 count(value);
 return {value,observedAt:Math.floor(Date.now()/1000),evidence,evidenceHash:crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex'),scope};
}
module.exports={collectProject,metrics,targetPath};
