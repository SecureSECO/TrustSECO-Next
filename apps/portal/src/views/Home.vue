<template>
  <main class="overview">
    <section class="hero">
      <h1>Trust in software, built together.</h1>
      <p class="intro">TrustSECO brings together a community of miners to collect evidence about open-source software and confirm its record in a shared ledger. Explore new measurements as they arrive, compare trust scores, and look for the blue check to see which records have reached confirmation.</p>
      <form class="package-search" @submit.prevent="refresh">
        <label class="sr-only" for="package-search">Search packages</label>
        <span aria-hidden="true">⌕</span>
        <input id="package-search" v-model="query" type="search" placeholder="Search tracked packages…" />
        <button type="submit" :disabled="busy">{{ busy ? 'Refreshing…' : 'Search' }}</button>
        <router-link v-if="privateServer" class="add-package" to="/add-package/">+ Add package</router-link>
      </form>
    </section>

    <div class="overview-stats" aria-label="Overview statistics">
      <div><strong>{{ loaded ? total : '—' }}</strong><span>{{ query ? 'packages found' : 'tracked packages' }}</span></div>
      <div><strong>{{ complete ? allFacts.length : '—' }}</strong><span>measurements in view</span></div>
      <div><strong>{{ complete ? pendingCount : '—' }}</strong><span>awaiting confirmation</span></div>
      <div><strong class="blue-count">{{ complete ? confirmedCount : '—' }}</strong><span>ledger-confirmed</span></div>
    </div>
    <p v-if="error" class="load-error" role="alert">{{ error }} <button @click="refresh">Try again</button></p>

    <section v-if="lastConfirmed.length && !error" class="panel history-panel" aria-label="Last confirmed assessments">
      <div class="panel-heading"><div><h2>Last confirmed assessments</h2><p>Historical scores for the versions shown. Current confirmation is unavailable; open a package for current evidence and warnings.</p></div></div>
      <div class="history-grid">
        <router-link v-for="item in lastConfirmed" :key="item.packageName + item.version" :to="packageLink(item.packageName,item.version)" class="history-card">
          <strong>{{ item.packageName }}</strong><span>Version {{ item.version }}</span>
          <b>{{ scoreText(item.score) }} <small>/ 100</small></b>
          <span>Last confirmed · {{ new Date(item.assessedAt * 1000).toLocaleString() }}</span>
        </router-link>
      </div>
    </section>

    <section class="panel packages-panel">
      <div class="panel-heading"><div><h2>Tracked packages</h2><p>Scored packages first, then latest collection activity.</p></div><router-link to="/packages/">Browse all →</router-link></div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Package</th><th>Version</th><th>Local estimate</th><th>Confirmation</th><th>Last collected</th></tr></thead>
          <tbody>
            <tr v-for="row in sortedRows" :key="row.pack.name">
              <td><router-link class="package-name" :to="packageLink(row.pack.name,row.version)">{{ row.pack.name }}</router-link><small>{{ row.pack.owner }} · {{ row.pack.platform }}</small></td>
              <td><span class="version-tag">{{ row.version || '—' }}</span></td>
              <td>
                <template v-if="row.scores?.local?.score != null"><strong>≈ {{ scoreText(row.scores.local.score) }}</strong><small>Provisional · {{ Math.round((row.scores.local.coverage || 0) * 100) }}% evidence coverage</small><progress class="coverage-bar" max="100" :value="Math.round((row.scores.local.coverage || 0) * 100)" :aria-label="`Evidence coverage for ${row.pack.name}`"></progress></template>
                <template v-else><span>Awaiting scoring evidence</span><small>{{ row.facts.filter(f => f.version === row.version).length }} observations for this version</small></template>
              </td>
              <td>
                <template v-if="row.scores?.confirmed?.score != null"><span class="confirmed-mark" aria-label="Based on finalized measurements">✓</span> {{ scoreText(row.scores.confirmed.score) }}</template>
                <template v-else-if="row.history"><router-link :to="packageLink(row.pack.name,row.history.version)"><strong>{{ scoreText(row.history.score) }}</strong> · Last confirmed</router-link><small>Version {{ row.history.version }} · {{ new Date(row.history.assessedAt * 1000).toLocaleDateString() }}</small><small>{{ confirmationReason(row) }}</small></template>
                <template v-else><span>Not yet confirmed</span><small>{{ confirmationReason(row) }}</small></template>
              </td>
              <td class="time-cell">{{ row.failed ? 'Temporarily unavailable' : timeText(row.updated) }}</td>
            </tr>
            <tr v-if="!rows.length"><td colspan="5" class="empty-state">{{ !loaded ? 'Loading your packages…' : query ? 'No tracked packages match your search.' : 'No packages yet. Add a package to start collecting measurements.' }}</td></tr>
          </tbody>
        </table>
      </div>
      <p class="table-note">Showing up to 12 packages. Counts cover all versions of these packages; local estimates show the listed version. Historical confirmations identify their own version.</p>
    </section>

    <div class="lower-grid">
      <section class="panel">
        <div class="panel-heading"><div><h2>Measurement activity</h2><p>Latest known observations and their current status.</p></div><router-link to="/jobs">View jobs →</router-link></div>
        <ul class="activity-list">
          <li v-for="fact in recentFacts" :key="`${fact.packageName}:${fact.jobID}:${fact.account.uid}`">
            <span :class="['activity-indicator',fact.status]" aria-hidden="true">{{ fact.status === 'confirmed' ? '✓' : fact.status === 'failed' ? 'i' : '•' }}</span>
            <div><router-link :to="packageLink(fact.packageName,fact.version)">{{ fact.packageName }} <span>{{ fact.version }}</span></router-link><p>{{ factLabel(fact.fact) }} · {{ statusText(fact.status) }}</p></div>
            <time>{{ timeText(fact.collectedAt) }}</time>
          </li>
        </ul>
        <p v-if="!recentFacts.length" class="empty-state">{{ loaded ? 'Collected measurements will appear here.' : 'Loading measurements…' }}</p>
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import axios from 'axios';
import { sortVersions } from '@/api/dlt/api';
import { dltApi, api, ServerType } from '@/api';
const base = `${import.meta.env.VITE_PROTOCOL}://${import.meta.env.VITE_HOST}/api/dlt`;
const query = ref('');
const rows = ref<any[]>([]);
const lastConfirmed = ref<any[]>([]);
const total = ref(0);
const loaded = ref(false);
const busy = ref(false);
const privateServer = ref(false);
const error = ref('');
let timer: ReturnType<typeof setInterval>;
let disposed = false;
const allFacts = computed(() => rows.value.flatMap(r => r.facts));
const complete = computed(() => loaded.value && !error.value && rows.value.every(r => !r.failed));
const confirmedCount = computed(() => allFacts.value.filter(f => f.status === 'confirmed').length);
const pendingCount = computed(() => allFacts.value.filter(f => ['collected','submitted','recorded'].includes(f.status)).length);
const sortedRows = computed(() => rows.value);
const recentFacts = computed(() => [...allFacts.value].sort((a,b) => Date.parse(b.collectedAt || '1970-01-01') - Date.parse(a.collectedAt || '1970-01-01') || b.jobID-a.jobID).slice(0,6));
const packageLink = (name: string, version: string) => `/package/${encodeURIComponent(name)}/version/${encodeURIComponent(version)}/`;
const confirmationReason = (row: any) => {
  const reasons = row.scores?.confirmed?.reasons || [];
  if (reasons.some((r: string) => r.includes('malware'))) return 'Security finding requires attention';
  if (reasons.some((r: string) => r.includes('unknown severity'))) return 'Security severity needs review';
  if (reasons.some((r: string) => r.includes('Insufficient fresh'))) return 'More fresh scoring evidence needed';
  if (reasons.some((r: string) => r.includes('Security evidence missing or stale'))) return 'Fresh security evidence needed';
  if (reasons.some((r: string) => r.includes('pending'))) return 'New evidence awaiting confirmation';
  return 'Current confirmation unavailable';
};
const scoreText = (score: unknown) => typeof score === 'number' ? score.toFixed(1) : '—';
const timeText = (date?: string) => date ? new Date(date).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : 'Time not recorded';
const factLabel = (fact: string) => fact.replace(/^(gh|lib|cve|so|vs)_/, '').replaceAll('_',' ');
const statusText = (status: string) => ({unverified:'Not community-verified',confirmed:'Confirmed',recorded:'Confirmation pending',submitted:'Confirmation pending',collected:'Collected',failed:'Submission needs attention'}[status] || 'Status unavailable');
async function refresh() {
  if (busy.value) return;
  busy.value = true;
  try {
    if (import.meta.env.VITE_PILOT === 'true') {
      const {data} = await axios.get(`${base}/overview`, {params:{query:query.value},timeout:20000});
      if (disposed) return;
      rows.value = data.packages.map(p => {
        const versions = sortVersions(p.packageReleases), version = versions[0] || '';
        const dates = p.facts.map(f => f.collectedAt).filter(Boolean).sort();
        const historical = versions.flatMap(v => p.scores[v]?.confirmed?.lastConfirmed ? [{...p.scores[v].confirmed.lastConfirmed,version:v}] : []).sort((a,b) => b.assessedAt-a.assessedAt);
        const history = p.scores[version]?.confirmed?.lastConfirmed ? {...p.scores[version].confirmed.lastConfirmed,version} : historical[0];
        return {pack:{name:p.packageName,owner:p.packageOwner,platform:p.packagePlatform,versions},
          version,history,facts:p.facts,scores:p.scores[version],updated:dates.at(-1),failed:false};
      });
      lastConfirmed.value = data.lastConfirmed || [];
      total.value = data.total;
      error.value = '';
      return;
    }
    const page = await dltApi.getPackages(0,12,query.value);
    const next = [];
    // Bound concurrent ledger reads: one package at a time, two requests per package.
    for (const pack of page.packages) {
      if (disposed) return;
      const version = pack.versions[0] || '';
      try {
        const [measurements, scores] = await Promise.all([
          axios.get(`${base}/measurements/${encodeURIComponent(pack.name)}`),
          axios.get(`${base}/scores/${encodeURIComponent(pack.name)}/${encodeURIComponent(version)}`),
        ]);
        const facts = measurements.data.facts.map(f => measurements.data.ledgerAvailable ? f : {...f,status:f.status === 'confirmed' ? 'recorded' : f.status});
        const dates = facts.map(f => f.collectedAt).filter(Boolean).sort();
        next.push({pack,version,facts,scores:scores.data,updated:dates.at(-1),failed:!measurements.data.ledgerAvailable});
      } catch { next.push({pack,version,facts:[],scores:null,failed:true}); }
    }
    if (disposed) return;
    rows.value = next; total.value = page.total;
    error.value = next.some(r => r.failed) ? 'Some measurements are temporarily unavailable.' : '';
  } catch { error.value = 'Unable to refresh the overview. Previously loaded data may be out of date.'; }
  finally { loaded.value = true; busy.value = false; }
}
onMounted(async () => {
  void api.getServerType().then(type => { if (!disposed) privateServer.value = type === ServerType.Private; }).catch(() => {});
  await refresh();
  if (!disposed) timer = setInterval(refresh,30000);
});
onUnmounted(() => { disposed = true; clearInterval(timer); });
</script>

<style scoped>
.coverage-bar { display:block; width:110px; height:5px; margin-top:8px; accent-color:#b77912; }
.history-panel { margin-bottom:28px; }
.history-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:16px; padding:0 24px 24px; }
.history-card { display:flex; flex-direction:column; gap:8px; padding:18px; border:1px solid #e5eaf0; border-radius:10px; color:#172b4d; text-decoration:none; overflow-wrap:anywhere; }
.history-card:hover { border-color:#1769bb; }
.history-card span,.history-card small { font-size:12px; color:#64748b; font-weight:400; }
.history-card b { font-size:28px; }
.overview { max-width:1180px; margin:0 auto; padding:36px 24px 56px; color:#172b4d; }
.hero { padding:12px 0 28px; }
h1 { font-size:clamp(30px,4vw,46px); font-weight:700; line-height:1.15; letter-spacing:-1.3px; margin:0 0 16px; }
.intro { max-width:780px; color:#64748b; font-size:16px; line-height:1.6; }
.package-search { display:flex; align-items:center; gap:12px; margin-top:26px; }
.package-search > span { font-size:28px; color:#64748b; }
.package-search input { flex:1; min-width:100px; border:1px solid #d9e2ed; background:white; border-radius:9px; padding:14px 16px; font:inherit; font-size:15px; }
.package-search button,.add-package { border:0; border-radius:9px; padding:14px 20px; font:inherit; font-size:14px; font-weight:600; white-space:nowrap; cursor:pointer; text-decoration:none; }
.package-search button { background:#e9f2fc; color:#1769bb; }
.add-package { background:#1769bb; color:white; }
.overview-stats { display:grid; grid-template-columns:repeat(4,1fr); border:1px solid #e5eaf0; border-radius:12px; background:white; margin:4px 0 28px; }
.overview-stats > div { padding:22px 24px; border-right:1px solid #e5eaf0; }
.overview-stats > div:last-child { border:0; }
.overview-stats strong { display:block; font-size:28px; font-weight:600; margin-bottom:6px; }
.overview-stats span { font-size:12px; color:#64748b; }.blue-count { color:#1769bb; }
.panel { background:white; border:1px solid #e5eaf0; border-radius:12px; }
.panel-heading { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:22px 24px; }
h2 { font-size:18px; font-weight:600; margin:0 0 6px; }.panel-heading p { color:#64748b; font-size:12px; }
a { color:#1769bb; text-decoration:none; }.panel-heading > a { font-size:13px; white-space:nowrap; }
.table-scroll { overflow-x:auto; } table { width:100%; border-collapse:collapse; text-align:left; font-size:14px; }
th { padding:12px 24px; background:#f8fafc; color:#64748b; font-weight:500; font-size:12px; white-space:nowrap; }
td { padding:18px 24px; border-top:1px solid #eef2f6; } td small { display:block; font-size:11px; color:#7a899c; margin-top:6px; }
.package-name { color:#172b4d; font-weight:600; }.version-tag { font-size:12px; background:#f1f5f9; padding:5px 7px; border-radius:5px; }
.time-cell { font-size:12px; color:#64748b; }.pending-dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:#d99012; margin-left:4px; }.confirmed-mark { color:#1769bb; }
.table-note { padding:12px 24px; border-top:1px solid #eef2f6; font-size:11px; color:#7a899c; }
.lower-grid { display:grid; grid-template-columns:minmax(0,1fr); gap:24px; margin-top:24px; }
.lower-grid > * { min-width:0; }
.activity-list li > div { min-width:0; overflow-wrap:anywhere; }
.activity-list time { flex-shrink:0; }
.activity-list { padding:0 24px 12px; list-style:none; }.activity-list li { display:flex; align-items:flex-start; gap:12px; padding:16px 0; border-top:1px solid #eef2f6; }.activity-list a { font-size:13px; font-weight:600; color:#172b4d; }.activity-list a span { font-weight:400; color:#64748b; }.activity-list p { font-size:12px; color:#64748b; margin-top:6px; }.activity-list time { font-size:11px; color:#7a899c; margin-left:auto; max-width:100px; text-align:right; }
.activity-indicator { color:#d99012; }.activity-indicator.confirmed { color:#1769bb; }.activity-indicator.failed { color:#64748b; }
.empty-state { padding:28px; color:#64748b; font-size:14px; }.load-error { padding:12px; background:#fff8eb; margin-bottom:18px; font-size:13px; }.load-error button { cursor:pointer; background:none; border:0; color:#1769bb; }
.sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0); }
input:focus-visible,button:focus-visible,a:focus-visible { outline:3px solid #87b8ed; outline-offset:3px; }
@media(max-width:760px) { .overview { padding:24px 12px; }.lower-grid { grid-template-columns:1fr; }.overview-stats { grid-template-columns:repeat(2,1fr); }.overview-stats > div { padding:18px; }.package-search { flex-wrap:wrap; }.package-search > span { display:none; }.add-package { text-align:center; }.panel-heading { padding:18px; }th,td { padding:14px 18px; }.desktop-break { display:none; } }
</style>
