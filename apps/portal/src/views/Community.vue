<template>
 <main class="community">
  <p class="eyebrow">COMMUNITY VERIFICATION · PROTOTYPE</p>
  <h1>Evidence, disagreement and accountability.</h1>
  <p class="intro">Explore signed observations and auditable review decisions on a separate test ledger. All contributors below are simulated; no real users are penalised.</p>
  <p v-if="error" role="alert" class="error">{{ error }}</p>
  <p v-if="notice" role="status">{{ notice }}</p>
  <template v-if="data">
   <div class="policy"><span>3 compatible contributors</span><span>±5 stars or 2%</span><span>3 incidents → review</span><span>5 incidents → suspension</span><span>30-day incident window</span></div>
   <p class="muted">Ledger block {{ data.ledger.height }} · Finalized {{ data.ledger.finalizedHeight }} · Policy {{ data.policy.version }}. Community agreement and ledger finality are separate checks.</p>
   <section><h2>Contributors</h2><p class="muted">Only reviewed, substantiated incidents count. A disagreement never creates a strike automatically. Repeated reports of the same root cause or round count once.</p>
    <div class="members"><article v-for="m in data.members" :key="m.id"><h3>{{ m.id }}</h3><span :class="['badge',m.standing]">{{ m.standing === 'review' ? 'Needs review' : m.standing }}</span><p>{{ m.incidents }} incidents · {{ m.observations }} observations</p><p>{{ m.rewardEligibleObservations }} eligible contribution credits</p><small>Prototype credits only; no DAO payment.</small></article></div>
    <div class="actions"><button v-for="m in ['alice','bob','carol','dana'].filter(x=>!data.members.some(m=>m.id===x))" :key="m" :disabled="busy" @click="send({kind:'enrol',actor:'governor',member:m})">Enrol simulated {{ m }}</button></div>
   </section>
   <section><h2>Verification rounds</h2>
    <form @submit.prevent="open"><label>Package or fixture<input v-model="packageName" required></label><label>Window (seconds)<input v-model.number="duration" type="number" min="10" max="3600" required></label><button :disabled="busy">Open stars round</button></form>
    <article v-for="r in [...data.rounds].reverse()" :key="r.id" class="round">
     <div class="row"><h3>{{ r.package }}</h3><span :class="['badge',r.result.status]">{{ r.result.status }}{{ !r.closed ? ' · provisional' : '' }}</span></div>
     <p class="muted">{{ r.id }} · {{ r.source }} · {{ r.method }} · Closes {{ date(r.closesAt) }}</p>
     <p v-if="r.result.value !== null"><strong>{{ r.result.value }} stars</strong> · Representative value of compatible observations</p>
     <p>{{ r.result.supporters.length }} supporting · {{ r.observations.length - r.result.supporters.length }} other observations (including excluded submissions)</p>
     <div class="observations"><span v-for="o in r.observations" :key="o.id" :title="o.id">{{ o.member }}: {{ o.value }} <small>{{ !o.eligible ? '(excluded at submission)' : '' }}</small></span></div>
     <form v-if="!r.closed && data.at <= r.closesAt" @submit.prevent="observe(r)"><label>Simulated contributor<select v-model="actor"><option v-for="m in data.members" :key="m.id" :value="m.id">{{ m.id }}</option></select></label><label>Observed stars<input v-model.number="value" type="number" min="0" max="1000000000" required></label><button :disabled="busy">Sign observation</button></form>
     <button v-if="!r.closed && data.at > r.closesAt" :disabled="busy" @click="send({kind:'close',actor:'governor',round:r.id})">Close and evaluate round</button>
     <details v-if="r.closed && r.observations.length"><summary>Review an observation</summary><p>Reviewer attestation, not a majority vote. Include independently substantiated evidence and a root-cause identifier. A URL alone is not proof.</p><form @submit.prevent="review(r)"><label>Observation<select v-model="observation"><option v-for="o in r.observations" :key="o.id" :value="o.id">{{ o.member }} · {{ o.value }} · {{ o.id.slice(0,8) }}</option></select></label><label>Root cause<input v-model="cause" required></label><label>Evidence reference<input v-model="evidence" required></label><label>Reason<textarea v-model="reason" required></textarea></label><button :disabled="busy">Sign substantiated incident</button></form></details>
    </article>
   </section>
   <section><h2>Incidents and appeals</h2><p class="muted">Suspension persists until explicit reinstatement. No automatic permanent bans and no changes to validator voting rights.</p>
    <article v-for="i in [...data.incidents].reverse()" :key="i.id" class="round"><h3>{{ i.member }} · {{ i.overturned ? 'Overturned' : 'Substantiated' }}</h3><p>{{ i.reason }}</p><p>Cause: {{ i.cause }} · Evidence: {{ i.evidence }}</p><p class="muted">{{ i.id }} · {{ date(i.at) }}</p><label>Appeal or review explanation<input v-model="appealReason" placeholder="Explain the correction or appeal"></label><div class="actions"><button :disabled="busy || !appealReason" @click="send({kind:'appeal',actor:i.member,incident:i.id,reason:appealReason})">Sign contributor appeal</button><button v-if="!i.overturned" :disabled="busy || !appealReason" @click="send({kind:'overturn',actor:'governor',incident:i.id,reason:appealReason})">Reviewer: overturn</button><button v-if="data.members.find(m=>m.id===i.member)?.standing==='suspended'" :disabled="busy || !appealReason" @click="send({kind:'reinstate',actor:'governor',member:i.member,reason:appealReason})">Reviewer: reinstate</button></div></article>
   </section>
   <section><h2>Signed audit trail</h2><p class="muted">Every decision and appeal remains recorded. Suspended contributors may still submit observations, but those submissions cannot contribute to verification or credits.</p><ol><li v-for="a in [...data.audit].reverse()" :key="a.id"><strong>{{ a.kind }}</strong> · {{ a.actor }} · block {{ a.height }} <span class="badge">{{ a.height <= data.ledger.finalizedHeight ? 'Ledger finalized' : 'Awaiting ledger finality' }}</span><details><summary>Evidence and signature</summary><pre>{{ a.payload }}</pre><pre>{{ a.signature }}</pre></details></li></ol></section>
  </template>
 </main>
</template>
<script setup lang="ts">
import {ref,onMounted,onUnmounted} from 'vue';import axios from 'axios';
const base=`${import.meta.env.VITE_PROTOCOL}://${import.meta.env.VITE_HOST}/api/community`;
const data=ref<any>(null),error=ref(''),notice=ref(''),busy=ref(false);
const packageName=ref('demo/star-count'),duration=ref(180),actor=ref('alice'),value=ref(900),observation=ref(''),cause=ref(''),evidence=ref(''),reason=ref(''),appealReason=ref('');
let timer:ReturnType<typeof setInterval>;let disposed=false;
const date=(t:number)=>new Date(t*1000).toLocaleString();
async function refresh(){try{const r=await axios.get(`${base}/snapshot`,{timeout:10000});if(!disposed)data.value=r.data}catch(e){if(!disposed)error.value='Prototype ledger unavailable.'}}
async function send(event:any){if(busy.value)return;busy.value=true;error.value='';notice.value='Signing and submitting…';try{const r=await axios.post(`${base}/event`,event,{headers:{'X-Community-Demo':'1'},timeout:15000});notice.value=`Submitted ${r.data.eventId}. Waiting for inclusion…`;for(let i=0;i<60&&!disposed;i++){await new Promise(r=>setTimeout(r,1000));await refresh();if(data.value?.audit.some(a=>a.id===r.data.eventId)){notice.value='Recorded on the prototype ledger.';return}}notice.value='Submitted; not yet observed in the ledger. Refresh to check.'}catch(e:any){error.value=e.response?.data?.error||e.message;notice.value=''}finally{busy.value=false}}
const open=()=>send({kind:'open',actor:'governor',round:crypto.randomUUID(),package:packageName.value,metric:'github_stars',source:'GitHub fixture',method:'prototype-v1',duration:duration.value});
const observe=(r:any)=>send({kind:'observe',actor:actor.value,round:r.id,value:value.value,source:r.source,method:r.method});
const review=(r:any)=>send({kind:'substantiate',actor:'governor',round:r.id,observation:observation.value,cause:cause.value,evidence:evidence.value,reason:reason.value});
onMounted(()=>{refresh();timer=setInterval(refresh,3000)});onUnmounted(()=>{disposed=true;clearInterval(timer)});
</script>
<style scoped>
.community{max-width:1100px;margin:auto;padding:32px 20px;color:#172b4d}.eyebrow{font-size:12px;letter-spacing:1.5px;color:#1769bb}h1{font-size:32px;line-height:1.2;margin:12px 0}h2{font-size:22px;margin-bottom:12px}h3{font-size:17px;margin:0 0 10px}.intro,p{line-height:1.6}.intro{max-width:800px}.muted,small{color:#64748b;font-size:13px}.policy,.actions,.observations,.row{display:flex;gap:12px;flex-wrap:wrap}.policy{margin:24px 0}.policy span{padding:8px;background:#edf5ff;border-radius:5px;font-size:13px}section{background:white;border:1px solid #dce4ec;border-radius:10px;padding:24px;margin:24px 0}.members{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:16px;margin:18px 0}.members article,.round{border:1px solid #e5eaf0;padding:16px;border-radius:7px}.round{margin:16px 0;overflow-wrap:anywhere}.badge{display:inline-block;font-size:12px;padding:4px 8px;background:#eef2f6;border-radius:5px}.verified,.active{color:#14633d;background:#e7f5ed}.disputed,.review{color:#835300;background:#fff1d4}.suspended{color:#8e2929;background:#fce7e7}.row{justify-content:space-between}form{display:flex;gap:12px;flex-wrap:wrap;align-items:end;margin:18px 0}label{display:flex;flex-direction:column;gap:6px;font-size:13px;flex:1;min-width:150px}input,select,textarea{padding:10px;border:1px solid #cdd8e3;border-radius:5px;max-width:100%;font:inherit}button{padding:10px 14px;border:1px solid #cdd8e3;background:#edf5ff;color:#1769bb;border-radius:5px;cursor:pointer}button:disabled{opacity:.5;cursor:default}.actions{margin-top:12px}.observations span{padding:8px;background:#f6f8fb}summary{cursor:pointer;margin:12px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}li{padding:12px 0;border-bottom:1px solid #eef2f6}.error{padding:12px;background:#fce7e7}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #87b8ed;outline-offset:2px}@media(max-width:600px){section{padding:16px}.community{padding:20px 12px}}
</style>
