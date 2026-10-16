// Offline only. Read all stopped source DBs; retain the greatest safety watermark.
const fs=require('fs');
const {Database}=require('@liskhq/lisk-db'),{codec}=require('@klayr/codec');
const {previouslyGeneratedInfoSchema:schema}=require('klayr-framework/dist-node/engine/generator/schemas');
const prefix=Buffer.from('00000000','hex');
(async()=>{
 const merged={};
 for(let i=1;i<=4;i++){
  const db=new Database(`/source${i}/TrustSECO-dlt/data/generator.db`);
  try{
   const rows=await new Promise((resolve,reject)=>{const rows=[];db.iterate({gte:prefix,lte:Buffer.concat([prefix,Buffer.alloc(20,255)])}).on('data',r=>rows.push(r)).on('end',()=>resolve(rows)).on('error',reject)});
   for(const r of rows){
    if(r.key.length!==24)throw Error('Unexpected signing record key');
    const value=codec.decode(schema,r.value),key=r.key.toString('hex'),previous=merged[key]||{};
    merged[key]=Object.fromEntries(['height','maxHeightPrevoted','maxHeightGenerated'].map(k=>[k,Math.max(previous[k]||0,value[k])]));
   }
  }finally{await db.close()}
 }
 if(Object.keys(merged).length!==4)throw Error('Expected exactly four historical signing identities');
 fs.writeFileSync('/migration/history.json',JSON.stringify(merged),{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({identities:Object.keys(merged).length,watermarks:Object.values(merged)}));
})().catch(e=>{console.error(e.message);process.exit(1)});
