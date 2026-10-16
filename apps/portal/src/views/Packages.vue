<template>
  <main class="catalogue">
    <header class="catalogue-hero">
      <div><span class="eyebrow">THE PACKAGE EXPLORER</span><h1>Explore the evidence.</h1><p>Open-source packages, real observations, and a clearer picture of trust.<br class="wide-only" /> Follow a score back to the evidence behind it.</p></div>
      <router-link class="primary-button" to="/add-package/">+ Track a package</router-link>
    </header>

    <template v-if="pilot">
      <section class="collection-strip" aria-label="Collection activity">
        <span class="activity-dot" :class="{active:queue?.collecting > 0}" aria-hidden="true"></span>
        <strong>{{ queue ? queue.collecting ? 'Collection in progress' : 'Collection standing by' : 'Collection status unavailable' }}</strong>
        <span v-if="queue">{{ queue.collecting }} active rounds <span class="divider">/</span> {{ queue.queued.toLocaleString() }} queued targets</span>
        <router-link to="/jobs">View activity →</router-link>
      </section>
      <section class="browse-panel" aria-label="Browse packages">
        <form class="filters" @submit.prevent="search">
          <div class="search-field"><label for="catalogue-query">Find a package</label><div class="search-box"><span aria-hidden="true">⌕</span><input id="catalogue-query" v-model="query" type="search" placeholder="Search by package or owner…" /><button type="submit" :disabled="busy">Search</button></div></div>
          <div><label for="catalogue-evidence">Evidence</label><select id="catalogue-evidence" v-model="evidence" @change="search"><option value="">All packages</option><option value="history">With confirmation history</option></select></div>
          <div><label for="catalogue-sort">Sort by</label><select id="catalogue-sort" v-model="sort" @change="search"><option value="evidence">Scored first</option><option value="recent">Recent collection rounds</option><option value="name">Name A–Z</option></select></div>
        </form>
        <div class="results-heading"><p aria-live="polite"><strong>{{ loaded ? total.toLocaleString() : '…' }}</strong> {{ appliedQuery || evidence ? 'matching packages' : 'tracked packages' }}<span v-if="loaded && total"> · Showing {{ (page-1)*pageSize+1 }}–{{ Math.min(page*pageSize,total) }}</span></p><button class="text-button" @click="refresh" :disabled="busy">{{ busy ? 'Refreshing…' : '↻ Refresh' }}</button></div>
        <p v-if="error" class="error" role="alert">{{ error }} <button @click="refresh">Try again</button></p>
        <div v-if="busy && !loaded" class="package-grid" aria-label="Loading packages"><div v-for="n in 6" :key="n" class="package-card skeleton"><span></span><span></span><span></span></div></div>
        <div v-else-if="rows.length" class="package-grid" :aria-busy="busy">
          <article v-for="row in rows" :key="row.name" class="package-card">
            <div class="card-top"><span class="platform">{{ row.platform }}</span><span class="status" :class="row.statusClass">{{ row.status }}</span></div>
            <h2><router-link :to="link(row.name,row.version)">{{ row.name.split('/').slice(1).join('/') || row.name }}</router-link></h2>
            <p class="owner">{{ row.name.split('/')[0] }} <span>· v{{ row.version }}</span></p>
            <div class="score-line"><div><span class="field-label">LOCAL ESTIMATE</span><strong v-if="row.local?.score != null">≈ {{ row.local.score.toFixed(1) }}<small> / 100</small></strong><strong v-else class="awaiting">Awaiting evidence</strong></div><span class="observation-count">{{ row.observations }}<small>observations</small></span></div>
            <div class="coverage"><span>Evidence coverage <b>{{ Math.round((row.local?.coverage || 0)*100) }}%</b></span><progress max="100" :value="Math.round((row.local?.coverage || 0)*100)" :aria-label="`Evidence coverage for ${row.name}`"></progress><small>{{ row.local?.staleInputCount ? `${row.local.staleInputCount} older inputs included in estimate` : 'Provisional estimate for the version above' }}</small></div>
            <div class="confirmation" :class="{current:row.confirmation?.current}">
              <template v-if="row.confirmation"><span class="field-label">{{ row.confirmation.current ? '✓ CONFIRMED' : 'LAST CONFIRMED' }}</span><div><strong>{{ row.confirmation.score.toFixed(1) }}</strong><router-link :to="link(row.name,row.confirmation.version)">v{{ row.confirmation.version }} ↗</router-link></div><small>{{ row.confirmation.current ? 'Verified, finalized and sufficiently fresh' : `Historical assessment · ${date(row.confirmation.assessedAt)}` }}</small></template>
              <template v-else><span class="field-label">BUILDING THE RECORD</span><div class="no-confirmation">No confirmed assessment yet</div><small>{{ row.local?.score != null ? 'More verified evidence is needed.' : 'Observations will appear as collection progresses.' }}</small></template>
            </div>
            <router-link class="card-footer" :to="link(row.name,row.version)">Explore evidence <span aria-hidden="true">→</span></router-link>
          </article>
        </div>
        <div v-else-if="loaded && !error" class="empty"><h2>No packages found</h2><p>Try another name or include packages without confirmation history.</p><button class="text-button" @click="reset">Clear filters</button></div>
        <nav v-if="total > pageSize" class="pagination" aria-label="Package pages"><button :disabled="busy || page === 1" @click="changePage(page-1)">← Previous</button><span>Page {{ page }} of {{ Math.ceil(total/pageSize) }}</span><button :disabled="busy || page*pageSize >= total" @click="changePage(page+1)">Next →</button></nav>
      </section>
      <p class="reading-note">Scores describe the evidence collected, not a guarantee of safety. Historical assessments keep their own version and date; open a package to inspect current findings.</p>
      <details v-if="queue" class="collection-details"><summary>Collection details</summary><p>{{ queue.verified }} verified rounds · {{ queue.disputed }} disputed · {{ queue.unavailable }} unavailable · {{ queue.insufficient }} without enough contributors.</p><p v-if="queue.waitingForContributors">Waiting for contributors: {{ queue.availableContributors }} available; three are needed to start work.</p><p>Targets become eligible for refresh after {{ queue.refreshSeconds / 3600 }} hours. Queued targets are measurements, not individual packages.</p><details v-if="issues.length"><summary>Provider and collection issues ({{ issues.length }})</summary><div v-for="entry in issues" :key="entry.repository+entry.version+entry.metric"><strong>{{ entry.repository }} · {{ entry.metric }}</strong><p v-for="(failure,member) in entry.failures" :key="member">{{ member }}: {{ failure.reason }}</p></div></details></details>
    </template>
    <LegacyPackages v-else />
  </main>
</template>

<script setup lang="ts">
import {ref,computed,onMounted,onUnmounted} from 'vue';
import axios from 'axios';
import {sortVersions} from '@/api/dlt/api';
import LegacyPackages from '@/components/package/Packages.vue';
const pilot=import.meta.env.VITE_PILOT==='true';
const query=ref(''),appliedQuery=ref(''),evidence=ref(''),sort=ref('evidence');
const page=ref(1),pageSize=24,total=ref(0),rows=ref<any[]>([]),queue=ref<any>(null);
const busy=ref(false),loaded=ref(false),error=ref('');
let request=0,controller:AbortController|undefined;
const issues=computed(()=>queue.value?.entries?.filter((e:any)=>e.failures && Object.keys(e.failures).length)||[]);
const link=(name:string,version:string)=>`/package/${encodeURIComponent(name)}/version/${encodeURIComponent(version)}/`;
const date=(at:number)=>new Date(at*1000).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
function project(p:any){
 const versions=sortVersions(p.packageReleases),version=versions[0]||'',pair=p.scores[version];
 const current=versions.find(v=>p.scores[v]?.confirmed?.score!=null);
 const history=versions.flatMap(v=>p.scores[v]?.confirmed?.lastConfirmed?[{...p.scores[v].confirmed.lastConfirmed,version:v,current:false}]:[]).sort((a,b)=>b.assessedAt-a.assessedAt);
 const confirmation=current?{score:p.scores[current].confirmed.score,version:current,current:true}:history[0];
 return {name:p.packageName,platform:p.packagePlatform,version,local:pair?.local,confirmation,observations:p.facts.filter((f:any)=>f.version===version).length,
 status:current?'Confirmed release':confirmation?'History available':pair?.local?.score!=null?'Provisional':'Awaiting evidence',statusClass:current?'verified':confirmation?'historical':'pending'};
}
async function refresh(){
 const id=++request;controller?.abort();controller=new AbortController();busy.value=true;error.value='';
 axios.get('/api/dlt/collection-queue',{signal:controller.signal,timeout:20000}).then(r=>{if(id===request)queue.value=r.data;}).catch(()=>{if(id===request)queue.value=null;});
 try{
  const {data}=await axios.get('/api/dlt/overview',{params:{query:appliedQuery.value,evidence:evidence.value,sort:sort.value,from:(page.value-1)*pageSize,count:pageSize},signal:controller.signal,timeout:20000});
  if(id!==request)return;rows.value=data.packages.map(project);total.value=data.total;loaded.value=true;
 }catch(e){if(id===request && !axios.isCancel(e)){error.value='Could not load this view. Please try again.';rows.value=[];total.value=0;loaded.value=true;}}
 finally{if(id===request)busy.value=false;}
}
function search(){appliedQuery.value=query.value.trim();page.value=1;loaded.value=false;rows.value=[];refresh();}
function reset(){query.value='';evidence.value='';search();}
function changePage(value:number){page.value=value;loaded.value=false;rows.value=[];refresh();}
onMounted(()=>{if(pilot)refresh();});
onUnmounted(()=>{request++;controller?.abort();});
</script>

<style scoped>
.catalogue{max-width:1180px;margin:auto;padding:40px 24px 56px;color:#172b4d}.catalogue-hero{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:30px}.eyebrow{font-size:11px;font-weight:700;letter-spacing:2px;color:#1769bb}.catalogue h1{font-size:40px;line-height:1.15;letter-spacing:-1.2px;margin:12px 0 16px;font-weight:750}.catalogue-hero p{color:#64748b;line-height:1.7;margin:0;font-size:15px}.primary-button{background:#1769bb;color:white;text-decoration:none;border-radius:9px;padding:14px 20px;white-space:nowrap;font-weight:600;font-size:14px}.collection-strip{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#eaf3fa;border:1px solid #d7e7f4;border-radius:10px;padding:15px 20px;font-size:13px;margin-bottom:28px}.collection-strip>span{color:#52657d}.collection-strip a{margin-left:auto;color:#1769bb;text-decoration:none}.activity-dot{width:8px;height:8px;border-radius:50%;background:#94a3b8}.activity-dot.active{background:#258475;box-shadow:0 0 0 4px #d6eee8}.divider{padding:0 8px;color:#9aa9b8}.filters{display:grid;grid-template-columns:minmax(220px,1fr) 220px 210px;gap:16px;align-items:end}label{display:block;font-size:12px;font-weight:600;margin-bottom:8px;color:#52657d}.search-box{display:flex;align-items:center;gap:10px;background:white;border:1px solid #dce4ed;border-radius:9px;padding:5px 5px 5px 14px}.search-box span{color:#64748b;font-size:24px}.search-box input{min-width:0;flex:1;border:0;padding:10px 0;font:inherit;background:transparent;font-size:14px}select{width:100%;height:46px;border:1px solid #dce4ed;border-radius:9px;background:white;color:#172b4d;padding:0 12px;font:inherit;font-size:13px}button{cursor:pointer;font:inherit;border:1px solid #dce4ed;border-radius:7px;background:white;color:#1769bb;padding:10px 14px;font-size:13px;font-weight:600}button:disabled{opacity:.5;cursor:default}.search-box button{background:#eff6fd;border:0}.results-heading{display:flex;align-items:center;justify-content:space-between;margin:24px 0 16px;font-size:13px;color:#64748b}.results-heading strong{color:#172b4d;font-size:18px}.text-button{border:0;background:transparent}.package-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.package-card{background:white;border:1px solid #e2e8f0;border-radius:13px;padding:22px 22px 0;display:flex;flex-direction:column;overflow:hidden;transition:border-color .15s,box-shadow .15s}.package-card:hover{border-color:#abcce7;box-shadow:0 5px 18px #173c6510}.card-top{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:20px}.platform{font-size:11px;font-weight:650;color:#52657d;background:#f1f5f9;padding:5px 8px;border-radius:5px}.status{font-size:10px;font-weight:600;border-radius:20px;padding:5px 9px}.verified{background:#e4f4ee;color:#26705c}.historical{background:#eaf1fb;color:#416592}.pending{background:#fbf3e5;color:#8c671d}.package-card h2{font-size:20px;letter-spacing:-.4px;line-height:1.2;margin:0 0 8px;overflow-wrap:anywhere}.package-card h2 a{color:#172b4d;text-decoration:none}.owner{color:#64748b;font-size:12px;margin:0 0 24px;overflow-wrap:anywhere}.owner span{color:#8794a5}.score-line{display:flex;justify-content:space-between;align-items:end;gap:12px}.field-label{display:block;color:#718198;font-size:9px;letter-spacing:1px;font-weight:650;margin-bottom:8px}.score-line strong{display:block;font-size:32px;letter-spacing:-1px;font-weight:650}.score-line strong small{font-size:12px;letter-spacing:0;font-weight:400;color:#94a3b8}.score-line .awaiting{font-size:16px;letter-spacing:0}.observation-count{font-size:20px;text-align:right;color:#52657d}.observation-count small{display:block;font-size:10px;margin-top:4px;color:#94a3b8}.coverage{margin:20px 0;font-size:11px;color:#64748b}.coverage>span{display:flex;justify-content:space-between;margin-bottom:8px}.coverage b{font-weight:600}.coverage progress{display:block;width:100%;height:5px;accent-color:#b98a35;border:0;border-radius:5px}.coverage>small{display:block;font-size:10px;margin-top:7px}.confirmation{background:#f5f7fa;border-radius:8px;padding:13px 14px;margin-top:auto;margin-bottom:20px;min-height:91px}.confirmation.current{background:#edf7f3}.confirmation>div{display:flex;justify-content:space-between;gap:8px;align-items:center}.confirmation strong{font-size:22px;font-weight:650}.confirmation a{font-size:12px;color:#1769bb;text-decoration:none}.confirmation small{display:block;color:#718198;font-size:10px;line-height:1.4;margin-top:7px}.no-confirmation{font-size:13px;color:#52657d}.card-footer{display:flex;justify-content:space-between;align-items:center;margin:0 -22px;padding:15px 22px;border-top:1px solid #edf1f5;font-size:12px;font-weight:600;color:#1769bb;text-decoration:none}.pagination{display:flex;align-items:center;justify-content:center;gap:24px;margin:28px 0;font-size:13px;color:#64748b}.reading-note{font-size:12px;line-height:1.7;color:#718198;margin:24px 0}.collection-details{border-top:1px solid #dce4ed;padding-top:20px;color:#64748b;font-size:12px;line-height:1.7}.collection-details summary{cursor:pointer;font-weight:600;color:#52657d}.collection-details details{margin-top:12px}.error{padding:16px;border:1px solid #edd9bb;border-radius:8px;background:#fff8ed;color:#865b23;font-size:13px}.empty{text-align:center;padding:60px 20px;color:#64748b}.empty h2{font-size:22px;color:#172b4d}.empty p{margin:16px 0}.skeleton{height:300px;gap:25px;padding-top:35px}.skeleton span{height:18px;background:#edf1f5;border-radius:5px}.skeleton span:nth-child(2){width:65%}.skeleton span:nth-child(3){height:90px;margin-top:30px}input:focus-visible,select:focus-visible,button:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid #1769bb;outline-offset:3px}
@media(max-width:950px){.package-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.filters{grid-template-columns:1fr 1fr}.search-field{grid-column:1/-1}.catalogue h1{font-size:34px}}
@media(max-width:600px){.catalogue{padding:28px 16px}.catalogue-hero{align-items:flex-start;flex-direction:column}.catalogue h1{font-size:32px}.wide-only{display:none}.package-grid{grid-template-columns:1fr}.collection-strip{gap:10px}.collection-strip a{margin-left:0}.results-heading span{display:block;margin-top:6px}.filters{gap:12px}.pagination{gap:14px}.package-card{padding:20px 20px 0}.card-footer{margin:0 -20px;padding:15px 20px}}
</style>

<!-- Original application © Copyright Utrecht University (Department of Information and Computing Sciences). -->
