// Offline migration only. Keeps signing-history records intact and trims key records.
const fs=require('fs');
const {Database}=require('@liskhq/lisk-db');
const {address}=require('@klayr/cryptography');
const root='/root/.klayr/TrustSECO-dlt';
(async()=>{
 const own=JSON.parse(fs.readFileSync('/migration/keys.json'));
 const allowed=new Set(own.keys.map(k=>address.getAddressFromKlayr32Address(k.address).toString('hex')));
 const db=new Database(root+'/data/generator.db');
 const prefix=Buffer.from('00000001','hex');
 const records=await new Promise((resolve,reject)=>{const rows=[];db.iterate({gte:Buffer.concat([prefix,Buffer.alloc(20)]),lte:Buffer.concat([prefix,Buffer.alloc(20,255)])}).on('data',r=>rows.push(r)).on('error',reject).on('end',()=>resolve(rows))});
 let removed=0;
 for(const r of records) if(!allowed.has(r.key.subarray(4).toString('hex'))){await db.del(r.key);removed++}
 if(fs.existsSync('/migration/history.json')) {
  const {codec}=require('@klayr/codec');
  const {previouslyGeneratedInfoSchema}=require('klayr-framework/dist-node/engine/generator/schemas');
  for(const [key,value] of Object.entries(JSON.parse(fs.readFileSync('/migration/history.json'))))
   await db.set(Buffer.from(key,'hex'),codec.encode(previouslyGeneratedInfoSchema,value));
 }
 await db.close();
 fs.writeFileSync(root+'/config/dev-validators.json',JSON.stringify(own),{mode:0o600});
 console.log(JSON.stringify({assigned:allowed.size,removedStoredKeys:removed,signingHistoryPreserved:true}));
})().catch(e=>{console.error(e.message);process.exit(1)});
