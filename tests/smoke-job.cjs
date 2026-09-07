const d = require('/usr/app/dist/services/dlt-service');
const { encodeAndSign } = require('/usr/app/dist/services/add-job-service');
const {runJob} = require('/usr/app/dist/services/spider-service');
const {getKeys,signMessage} = require('/usr/app/dist/keys');
const pause = () => new Promise(r=>setTimeout(r,5000));
async function until(check){for(let i=0;i<18;i++){const v=await check();if(v)return v;await pause()}throw Error('Ledger confirmation timed out')}
async function send(module,command,params){const c=await d.getClient();const tx={module,command,params,fee:0n};tx.fee=await d.getMinFee(tx);await d.runTransaction(await c.transaction.create(tx,d.getPrivateKey()))}
(async()=>{
 const pkg={packageName:'requests',packageOwner:'psf',packagePlatform:'pypi',packageReleases:['2.32.3']};
 if(!(await d.getPackageData('requests')).packageName){await send('packageData','addPackageData',pkg);await until(async()=> (await d.getPackageData('requests')).packageName)}
 console.log('Package confirmed');
 await send('coda','addJob',await encodeAndSign({package:'requests',version:'2.32.3',fact:'gh_open_issues_count',bounty:BigInt(await d.getMinimumBounty())}));
 const job=await until(async()=> (await d.getJobs()).find(j=>j.package==='requests'&&j.fact==='gh_open_issues_count'));
 console.log('Signed job confirmed');
 const result=await runJob(await d.getJobDetails(job));
 const value=result[job.fact];
 if(value===null||value===undefined)throw Error('Spider returned no GitHub measurement');
 console.log('GitHub measurement: '+JSON.stringify(value));
 const data={jobID:Number(job.jobID),factData:JSON.stringify(value)};
 const {id}=await getKeys();
 const signature=await signMessage(await d.encodeFact(data),id);
 await send('trustfacts','addFact',{data,signature});
 await until(async()=> (await d.getTrustFacts('requests')).facts.some(f=>Number(f.jobID)===Number(job.jobID)&&f.account.uid===id));
 console.log('PASS: measurement signed and persisted on local ledger');process.exit(0);
})().catch(e=>{console.error('Smoke test failed: '+e.message);process.exit(1)});
