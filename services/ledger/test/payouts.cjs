const {test}=require('node:test');const assert=require('node:assert/strict');
const {CodaModule}=require('../dist/app/modules/coda/module');
const {CodaJobListStore}=require('../dist/app/modules/coda/stores/coda-schemas');
const {PayoutStore,appendPayout,readPayouts}=require('../dist/app/modules/coda/stores/payouts');
function memory(){const data=new Map();return {has:async(c,k)=>data.has(k.toString()),get:async(c,k)=>{if(!data.has(k.toString()))throw Error('Missing key');return data.get(k.toString())},set:async(c,k,v)=>data.set(k.toString(),v)}}
function fixture(facts=[{account:{uid:'miner'},jobID:1}]){
 const m=new CodaModule();const job={package:'demo',version:'1',fact:'stars',date:'0',jobID:1,bounty:1000000000000000000n,account:{uid:'owner'}};let jobs={jobs:[job]};const payments=[];const ps=memory();
 const js={get:async()=>jobs,set:async(c,k,v)=>{jobs=v}};
 m.stores.get=t=>t===CodaJobListStore?js:t===PayoutStore?ps:null;
 m.accountsMethod={changeBalance:async(c,uid,amount)=>payments.push({uid,amount})};m.trustfactsMethod={getTrustFacts:async()=>facts};
 return {m,payments,ps,requeue:()=>{jobs={jobs:[job]}},history:()=>readPayouts(ps,{}),ctx:h=>({header:{height:h,timestamp:100000+h*15},logger:{info(){}}})};
}
test('payout history matches balance change after threshold and persistent receipt prevents duplicate payout',async()=>{const f=fixture();await f.m.afterTransactionsExecute(f.ctx(5760));assert.equal(f.payments.length,0);await f.m.afterTransactionsExecute(f.ctx(5761));assert.equal(f.payments.length,1);const p=(await f.history()).payouts[0];assert.equal(p.uid,f.payments[0].uid);assert.equal(p.amount,f.payments[0].amount.toString());assert.equal(p.height,5761);assert.equal(p.jobID,1);f.requeue();await f.m.afterTransactionsExecute(f.ctx(5762));assert.equal(f.payments.length,1);assert.equal((await f.history()).payouts.length,1)});
test('no facts produce neither a payout nor a history entry',async()=>{const f=fixture([]);await f.m.afterTransactionsExecute(f.ctx(5761));assert.deepEqual(f.payments,[]);assert.deepEqual((await f.history()).payouts,[])});
test('pagination retains all records, exact large amounts and stable cursors while new payouts arrive',async()=>{const s=memory();for(let jobID=1;jobID<=205;jobID++)await appendPayout(s,{}, {jobID,uid:'u',amount:'99999999999999999999'});const page=await readPayouts(s,{});assert.equal(page.total,'205');assert.equal(page.payouts.length,200);assert.equal(page.payouts[0].id,'205');assert.equal(page.nextCursor,'6');await appendPayout(s,{}, {jobID:206,uid:'u',amount:'1'});const old=await readPayouts(s,{},page.nextCursor);assert.equal(old.payouts.length,5);assert.equal(old.payouts.at(-1).id,'1');assert.equal(old.payouts[0].amount,'99999999999999999999');assert.equal(old.nextCursor,null);await assert.rejects(()=>readPayouts(s,{},'-1'),/cursor/)});
