// Explicit operator fixtures on the existing test network; never represent independent people.
const fs=require('node:fs');
const {mineOnce}=require('./client.cjs');
const [url,identityFile,credentialsFile]=process.argv.slice(2);
const endpoint=new URL(url);
if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.pathname!=='/'||endpoint.search||endpoint.hash)throw Error('HTTPS portal origin required');
const identity=JSON.parse(fs.readFileSync(identityFile));
if(!/^test-[a-f]$/.test(identity.id))throw Error('Explicit test contributor required');
(async()=>{for(;;){try{
 const credentials=JSON.parse(fs.readFileSync(credentialsFile));
 if(await mineOnce(url,identityFile,credentials,{testNetwork:true}))console.log(identity.id+': signed event recorded');
}catch(error){console.error(error.message);}await new Promise(resolve=>setTimeout(resolve,15000));}})().catch(error=>{console.error(error.message);process.exit(1);});
