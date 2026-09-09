<template>
  <section v-if="state?.policy.assignment === 'availability-beacon-v1'" class="assignment-overview" aria-label="Contributor availability">
    <h2>Contributors &amp; assignments</h2>
    <p><strong>{{ state.availableContributors }} available</strong> of {{ state.members.length }} admitted contributors.</p>
    <p v-if="state.availableContributors < 3" role="status">Waiting for contributors: new work needs three available operators. Existing assignments keep their fixed reserve order.</p>
    <p v-else>Three observers collect each fact. If an observer misses their deadline, the next reserve takes their slot.</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="!active.length">No collection round is currently open.</p>
    <article v-for="round in active" :key="round.id">
      <strong>{{ round.escrow.repository }} · {{ round.escrow.version }}</strong>
      <p v-if="!round.assignment.seed">Waiting for the fixed randomness beacon. Contributors do not need to participate in a draw.</p>
      <template v-else>
        <p>Assigned: {{ round.assignment.committee.join(', ') || 'No remaining responders' }}.</p>
        <p>Reserves: {{ round.assignment.order.slice(round.assignment.nextReserve).join(', ') || 'None remaining' }}.</p>
        <ul><li v-for="slot in round.assignment.slots" :key="slot.member">{{ slot.member }} — {{ slot.replaced ? 'Missed deadline; replaced' : round.observations.some(o => o.member === slot.member) ? 'Observation received' : 'Due ' + date(slot.until) }}</li></ul>
      </template>
    </article>
    <small>Disagreement never triggers replacement. Availability expires automatically; three compatible observations remain necessary.</small>
  </section>
  <p v-else-if="error" role="alert">{{ error }}</p>
</template>
<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref} from 'vue';
const state=ref<any>(null),error=ref('');let timer:ReturnType<typeof setTimeout>|undefined,stopped=false;
const active=computed(()=>state.value?.rounds.filter((r:any)=>!r.closed&&r.assignment?.version==='availability-beacon-v1')||[]);
const date=(seconds:number)=>new Date(seconds*1000).toLocaleTimeString();
async function refresh(){try{const r=await fetch('/api/pilot/snapshot',{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error();state.value=await r.json();error.value='';}catch{error.value='Contributor status is unavailable; previously displayed information may be stale.';}finally{if(!stopped)timer=setTimeout(refresh,15000)}}
onMounted(refresh);onUnmounted(()=>{stopped=true;clearTimeout(timer)});
</script>
<style scoped>
.assignment-overview{padding:24px;background:white;border:1px solid #e5eaf0;border-radius:12px;margin-bottom:24px;color:#172b4d}.assignment-overview h2{font-size:20px;font-weight:600;margin-bottom:16px}.assignment-overview p{margin:10px 0;line-height:1.5}.assignment-overview article{border-top:1px solid #e5eaf0;padding-top:14px;margin-top:14px;overflow-wrap:anywhere}.assignment-overview li{margin:8px 0}.assignment-overview small{display:block;margin-top:18px;color:#526674}
</style>
