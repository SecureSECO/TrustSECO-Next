<template>
 <main class="payouts"><h1>Most recent payouts</h1><p>TrustCOIN awarded for mining work on this ledger.</p>
 <p class="muted">Payouts are stored permanently on the ledger and shown 200 at a time. Older balance changes were not recorded as payout history. Community reward eligibility is not a payment.</p>
 <p v-if="error" role="alert">{{ error }} <button @click="refresh(cursor)">Retry</button></p>
 <p v-else-if="!data">Loading payouts…</p>
 <p v-else-if="!data.payouts.length">No payouts recorded yet. Mining payouts currently become eligible after 5,760 blocks—about 24 hours with 15-second blocks.</p>
 <div v-else class="scroll"><table><thead><tr><th>Paid at</th><th>Contributor</th><th>Package</th><th>Amount</th><th>Ledger status</th></tr></thead><tbody>
 <tr v-for="(p,i) in data.payouts" :key="`${p.height}:${p.jobID}:${p.uid}:${i}`"><td>{{ new Date(p.timestamp*1000).toLocaleString() }}</td><td>{{ p.uid }}</td><td>{{ p.package }} {{ p.version }}<small>Job {{ p.jobID }}</small></td><td>{{ amount(p.amount) }} TrustCOIN</td><td>{{ p.height <= data.finalizedHeight ? 'Finalized' : 'Awaiting finality' }}<small>Block {{ p.height }}</small></td></tr>
 </tbody></table><button v-if="data.nextCursor" @click="refresh(data.nextCursor)">Older payouts</button><button v-if="cursor" @click="refresh(null)">Most recent payouts</button></div>
 </main>
</template>
<script setup lang="ts">
import {ref,onMounted,onUnmounted} from 'vue';import axios from 'axios';
const data=ref<any>(null),error=ref(''),cursor=ref<string|null>(null);let timer:ReturnType<typeof setInterval>;let disposed=false;
const amount=(value:string)=>BigInt(value).toLocaleString();
async function refresh(before:string|null=cursor.value){cursor.value=before;try{const r=await axios.get(`${import.meta.env.VITE_PROTOCOL}://${import.meta.env.VITE_HOST}/api/dlt/payouts`,{timeout:10000,params:before?{before}:undefined});if(!disposed){data.value=r.data;error.value=''}}catch{if(!disposed){data.value=null;error.value='Payout history is unavailable on this node. Its ledger may need updating.'}}}
onMounted(()=>{refresh();timer=setInterval(()=>refresh(),15000)});onUnmounted(()=>{disposed=true;clearInterval(timer)});
</script>
<style scoped>
.payouts{max-width:1200px;margin:auto;padding:32px 20px;color:#172b4d}p{line-height:1.6}.muted,small{color:#64748b}small{display:block;margin-top:6px}.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;background:white}th,td{text-align:left;padding:16px;border-bottom:1px solid #e5eaf0}td{overflow-wrap:anywhere}button{padding:8px 12px;cursor:pointer}
</style>
