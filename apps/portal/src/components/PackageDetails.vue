<template>
  <p v-if="packageLoading">Loading package…</p>
  <p v-else-if="packageError" role="alert">{{ packageError }}</p>
  <section v-else class="package-overview" aria-label="Package overview">
    <header class="package-heading">
      <div class="package-identity">
        <h1>{{ package.name.includes('/') ? package.name : package.owner + '/' + package.name }}</h1>
        <p class="package-meta"><span>{{ package.platform }}</span><span v-if="language">{{ language }}</span><a :href="githubLink">GitHub repository ↗</a></p>
      </div>
      <label class="version-picker">Version
        <select v-model="versionLocal"><option v-for="release in package.versions" :key="release" :value="release">{{ release }}</option></select>
      </label>
    </header>
    <section class="score-grid" aria-label="Trust scores">
      <article v-for="kind in ['local', 'confirmed']" :key="kind" class="score-card">
        <h2><span :class="['score-indicator', scorePair?.[kind]?.score != null ? kind : 'unavailable']" aria-hidden="true">{{ kind === 'confirmed' && scorePair?.confirmed?.score != null ? '✓' : '●' }}</span>{{ kind === 'local' ? 'Local estimate' : 'Community-confirmed' }}</h2>
        <p class="score-value" v-if="scorePair?.[kind]?.score != null">{{ kind === 'local' ? '≈ ' : '' }}{{ scorePair[kind].score.toFixed(1) }} <span>/ 100</span></p>
        <div v-else-if="kind === 'confirmed' && scorePair?.confirmed?.lastConfirmed">
          <p class="score-value">{{ scorePair.confirmed.lastConfirmed.score.toFixed(1) }} <span>/ 100</span></p>
          <p class="score-context">Last confirmed · {{ new Date(scorePair.confirmed.lastConfirmed.assessedAt * 1000).toLocaleString() }}</p>
          <p class="score-reason">Historical assessment, not a current confirmation. Current evidence status is shown below.</p>
        </div>
        <p class="score-empty" v-else>{{ scorePair ? (kind === 'local' ? 'No evidence yet' : 'Collecting evidence') : 'Loading score…' }}</p>
        <p class="score-caption">{{ kind === 'local' ? 'Provisional · available observations' : scorePair?.confirmed?.score != null ? 'Verified, finalized, sufficiently fresh evidence' : 'Current confirmation unavailable' }}</p>
        <p v-if="scorePair?.[kind]?.coverage != null" class="score-context">{{ Math.round(scorePair[kind].coverage * 100) }}% weighted evidence coverage</p>
        <p v-if="scorePair?.[kind]" class="score-context">{{ scorePair[kind].factTypeCount }}/{{ scorePair[kind].totalFactTypes }} scoring inputs<span v-if="kind === 'confirmed' && scorePair[kind].score != null && scorePair[kind].historySeconds != null"> · {{ scorePair[kind].historySeconds < 86400 ? 'Less than 1 day of supported history' : `${(scorePair[kind].historySeconds / 86400).toFixed(1)} days of supported history` }}</span></p>
        <p v-if="kind === 'local' && scorePair?.local?.oldestObservedAt" class="score-context">Oldest input: {{ new Date(scorePair.local.oldestObservedAt * 1000).toLocaleDateString() }}<span v-if="scorePair.local.staleInputCount"> · {{ scorePair.local.staleInputCount }} older than freshness limits</span></p>
        <p v-for="reason in scorePair?.[kind]?.reasons || []" :key="reason" class="score-reason">{{ reason }}</p>
      </article>
    </section>
    <p v-if="scoreError" role="status" class="score-reason">{{ scoreError }}</p>
    <p v-for="warning in scorePair?.local?.warnings || []" :key="warning" role="status" class="score-reason">Local advisory evidence: {{ warning }}</p>
    <details class="score-details">
      <summary>Score details</summary>
      <p>Local estimates normalize the available indicators by their combined weight, including older observations. Missing inputs are not treated as zero, so always read the coverage and age alongside the estimate. Known security penalties still apply. Confirmed scores use the fixed weights, stricter coverage and freshness requirements, community agreement and ledger finality. Neither is a guarantee of safety.</p>
      <div v-if="scorePair" class="details-grid">
        <section v-for="kind in ['local','confirmed']" :key="kind">
          <h3>{{ kind === 'local' ? 'Local estimate' : 'Community-confirmed' }}</h3>
          <p v-if="scorePair[kind].policyVersion">Policy {{ scorePair[kind].policyVersion }} · {{ scorePair[kind].status }}</p>
          <p>{{ scorePair[kind].measurementCount }} scoring measurements</p>
          <p v-if="kind === 'local' && scorePair.local.missingInputs?.length">Missing: {{ scorePair.local.missingInputs.join(', ') }}</p>
          <p v-if="scorePair[kind].baselineLower != null">Baseline evidence range: {{ scorePair[kind].baselineLower.toFixed(1) }}–{{ scorePair[kind].baselineUpper?.toFixed(1) }}</p>
          <p v-if="scorePair[kind].ceiling != null">Security ceiling: {{ scorePair[kind].ceiling }}</p>
          <p v-for="advisory in scorePair[kind].advisories || []" :key="advisory.id">{{ advisory.id }} · {{ advisory.severity }}{{ advisory.kev ? ' · Known exploitation' : '' }}</p>
        </section>
      </div>
      <p v-if="scorePair">Calculated: {{ new Date(scorePair.updatedAt).toLocaleString() }}</p>
      <router-link to="/score-calculation/">How this assessment is calculated →</router-link>
    </details>
  </section>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import axios from 'axios';
import { defaultPackage } from '@/api';
import router from '@/router';

export default defineComponent({
  name: 'PackageDetailsComponent',
  props: {
    name: {
      type: String,
      required: true,
    },
    version: {
      type: String,
      required: true,
    },
  },
  data() {
    return {
      pilot: import.meta.env.VITE_PILOT === 'true',
      package: { ...defaultPackage, name: '', owner: '', platform: '', versions: [] },
      packageLoading: true,
      packageError: '',
      scorePair: null as any,
      scoreError: '',
      timer: undefined as ReturnType<typeof setInterval> | undefined,
      // version prop is immutable so this is needed to use in a v-model
      versionLocal: this.version,
      language: undefined as string | undefined,
    };
  },
  computed: {
    githubLink(): string {
      return `https://github.com/${this.package.name.includes('/') ? this.package.name : this.package.owner + '/' + this.package.name}`;
    },
  },
  watch: {
    async versionLocal(newVersion) {
      if (newVersion !== this.version) this.selectVersion(newVersion);
    },
    async version(newVersion) {
      this.versionLocal = newVersion;
      this.scorePair = null;
      await this.updateScore();
    },
  },
  async mounted() {
    this.timer = setInterval(() => this.updateScore().catch(() => { this.scorePair = null; this.scoreError = 'Scores temporarily unavailable.'; }), 5000);
    try {
      const pack = await this.$dltApi.getPackage(this.name);
      if (!pack) throw Error('Package not found');
      this.package = pack;
    } catch { this.packageError = 'Package unavailable. Try refreshing the page.'; return; }
    finally { this.packageLoading = false; }
    if (this.version === '') {
      await router.replace({
        name: 'Package with Version',
        params: {
          name: this.name,
          version: this.package.versions[0],
        },
      });
    } else {
      await this.updateScore();
    }
    this.versionLocal = this.version;
  },
  beforeUnmount() { clearInterval(this.timer); },
  methods: {
    selectVersion(version: string) {
      router.push({
        name: 'Package with Version',
        params: {
          name: this.name,
          version,
        },
      });
    },
    async updateScore() {
      const trustfacts = await this.$dltApi.getTrustFacts(this.name, this.version);
      const {data} = await axios.get(`${import.meta.env.VITE_PROTOCOL}://${import.meta.env.VITE_HOST}/api/dlt/scores/${encodeURIComponent(this.name)}/${encodeURIComponent(this.version)}`);
      this.scorePair = data;
      this.scoreError = data.ledgerAvailable ? '' : 'Ledger unavailable; confirmed score cannot be checked.';
      this.language = trustfacts.find((fact) => fact.type === 'gh_repository_language')?.value.replaceAll('"', '');
    },
  },
});
</script>

<style scoped>
.package-overview { padding: 8px 0; }
.package-heading { display:flex; justify-content:space-between; align-items:flex-start; gap:24px; margin-bottom:28px; }
.package-identity { min-width:0; }
h1 { font-size:28px; font-weight:750; color:#192e50; line-height:1.25; overflow-wrap:anywhere; margin:0 0 10px; }
.package-meta { display:flex; flex-wrap:wrap; gap:10px 20px; color:#52657d; font-size:14px; line-height:1.5; }
.version-picker { display:grid; gap:8px; font-size:12px; font-weight:600; color:#52657d; min-width:180px; max-width:100%; }
.version-picker select { padding:10px 12px; background:white; border:1px solid #cbd5e1; border-radius:8px; font:inherit; font-size:14px; color:#192e50; max-width:100%; }
.score-grid,.details-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:20px; }
.score-card { padding:24px; border:1px solid #e0e7ef; border-radius:12px; background:#f8fafc; min-width:0; }
.score-card h2 { display:flex; align-items:center; gap:10px; font-size:15px; font-weight:600; color:#334155; margin:0; }
.score-value { font-size:38px; font-weight:750; color:#192e50; margin:18px 0 8px; font-variant-numeric:tabular-nums; line-height:1.2; }
.score-value span { font-size:16px; font-weight:400; color:#64748b; }
.score-empty { font-size:23px; color:#52657d; margin:18px 0 8px; line-height:1.4; }
.score-caption { font-size:14px; color:#52657d; line-height:1.5; }
.score-context { font-size:12px; color:#52657d; line-height:1.6; margin-top:12px; }
.score-indicator { width:20px; height:20px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; }
.score-indicator.local { color:#b77912; }.score-indicator.unavailable { color:#94a3b8; }.score-indicator.confirmed { background:#1769bb; color:white; border-radius:50%; font-size:13px; }
.score-reason { color:#854d0e; font-size:13px; margin-top:12px; line-height:1.5; }
.score-details { margin-top:22px; border-top:1px solid #e0e7ef; padding-top:18px; color:#52657d; font-size:13px; line-height:1.6; }
.score-details summary { cursor:pointer; font-weight:600; color:#192e50; }.score-details p { margin:12px 0; }.score-details h3 { font-size:14px; font-weight:600; margin-top:18px; }
select:focus-visible,summary:focus-visible { outline:2px solid #1769bb; outline-offset:3px; }
@media(max-width:640px) { .package-heading { flex-direction:column; gap:18px; }.version-picker { width:100%; min-width:0; }.score-grid,.details-grid { grid-template-columns:1fr; gap:12px; }h1 { font-size:24px; }.score-card { padding:20px; } }
</style>
