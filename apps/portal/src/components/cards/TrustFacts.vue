<script lang="ts">
import { defineComponent } from 'vue';
import { TrustFact } from '../../api';
import TrustFactCategory from './TrustFactCategory.vue';

interface Category {
  name: string,
  trustfacts: TrustFact[],
  score: number,
}

const categories = [
  { name: 'Technical specifications', fact_codes: ['gh_repository_language'] },
  {
    name: 'Community and Popularity',
    fact_codes: [
      'gh_gitstar_ranking',
      'gh_owner_stargazer_count',
      'gh_release_download_count',
      'so_popularity',
      'gh_contributor_count',
      'lib_contributor_count',
      'lib_sourcerank',
      'gh_total_download_count',
    ],
  },
  {
    name: 'Dependencies and Ecosystem',
    fact_codes: [
      'gh_user_count',
      'lib_dependency_count',
      'lib_dependent_count',
    ],
  },
  {
    name: 'Project Health and Maintenance',
    fact_codes: [
      'lib_first_release_date',
      'gh_issue_ratio',
      'gh_open_issues_count',
      'gh_release_issues_count',
      'gh_yearly_commit_count',
      'gh_zero_response_issues_count',
      'lib_latest_release_date',
      'lib_release_count',
      'lib_release_frequency',
      'gh_average_resolution_time',
    ],
  },
  {
    name: 'Security',
    fact_codes: ['security_advisories', 'cve_count', 'cve_vulnerabilities', 'vs_virus_ratio'],
  },
];

export default defineComponent({
  name: 'trust-facts-table',
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
      trustFacts: [] as TrustFact[],
      filter: '',
      confirmedOnly: false,
      showHistory: false,
      refreshTimer: undefined as ReturnType<typeof setInterval> | undefined,
      socket: undefined as WebSocket | undefined,
      loadError: '',
      platformNotices: [] as string[],
      refreshing: false,
      isLoading: true,
      categories,
      scoreCategories: {} as Record<string, number>,
    };
  },
  watch: {
    async version() {
      await this.updateTrustFacts();
    },
  },
  async mounted() {
    this.refreshTimer = setInterval(() => this.updateTrustFacts(), 5000);
    if (import.meta.env.VITE_PILOT !== 'true') {
    this.socket = new WebSocket(`${import.meta.env.VITE_PROTOCOL === 'https' ? 'wss' : 'ws'}://${import.meta.env.VITE_HOST}/websocket/measurements`);
    this.socket.onmessage = () => this.updateTrustFacts();
    }
    if (this.version !== '') {
      await this.updateTrustFacts();
    }
  },
  beforeUnmount() { clearInterval(this.refreshTimer); this.socket?.close(); },
  computed: {
    currentFacts(): TrustFact[] {
      const latest = new Map<string, TrustFact>();
      for (const fact of this.trustFacts) {
        const previous = latest.get(fact.type);
        const time = (value: TrustFact) => Date.parse(value.collectedAt || '') || 0;
        if (!previous || time(fact) >= time(previous)) latest.set(fact.type, fact);
      }
      return [...latest.values()];
    },
    displayedFacts(): TrustFact[] { return this.showHistory ? this.trustFacts : this.currentFacts; },
    earlierRoundCount(): number { return this.trustFacts.length - this.currentFacts.length; },
    measurementSummary() {
      const confirmed = this.displayedFacts.filter(f => f.status === 'confirmed').length;
      const unverified = this.displayedFacts.filter(f => f.status === 'unverified').length;
      const failed = this.displayedFacts.filter(f => f.status === 'failed').length;
      return { observations: this.displayedFacts.reduce((n, f) => n + (f.observations?.length || 1), 0), total: this.displayedFacts.length, confirmed, failed, unverified, pending: this.displayedFacts.length - confirmed - failed - unverified };
    },
    /** Filters out the correct facts for each category, and filters out any
    categories that do not contain any trustfacts */
    categoryTrustFacts(): Category[] {
      const categorys = [] as Category[];
      /* eslint-disable-next-line no-restricted-syntax */
      for (const category of categories) {
        // Filter only the facts the belong to this category
        const categoryFacts = this.displayedFacts.filter((fact: TrustFact) => category.fact_codes.includes(fact.type) && (!this.confirmedOnly || fact.status === 'confirmed'));
        if (categoryFacts.length > 0) {
          categorys.push({ name: category.name, trustfacts: categoryFacts, score: this.scoreCategories[category.name] });
        }
      }
      // If all categories are empty and facts are still loading fill with placeholder
      if (categorys.length === 0 && this.isLoading) {
        return [{
          name: '',
          trustfacts: Array(12).fill({ type: '', value: '' }),
          score: 0,
        }];
      }
      return categorys;
    },
  },
  methods: {
    async updateTrustFacts() {
      if (this.refreshing) return;
      this.refreshing = true;
      try {
      this.trustFacts = (
        await this.$dltApi.getTrustFacts(this.name, this.version)
      /* eslint-disable-next-line no-nested-ternary */
      ).sort((a, b) => (a.type === b.type ? 0 : a.type > b.type ? 1 : -1));
      this.loadError = '';
      if (import.meta.env.VITE_PILOT === 'true') {
        try {
          const response = await fetch(`${import.meta.env.VITE_PROTOCOL === 'https' ? 'https' : 'http'}://${import.meta.env.VITE_HOST}/api/dlt/collection-queue`);
          if (response.ok) {
            const queue = await response.json();
            this.platformNotices = (queue.entries || []).filter((entry: any) => entry.repository === this.name.toLowerCase() && entry.version === this.version && ['so_popularity', 'vs_virus_ratio'].includes(entry.metric) && entry.status !== 'verified').map((entry: any) => `${entry.metric === 'so_popularity' ? 'Stack Overflow' : 'ClamAV'}: ${entry.unavailableReason || (entry.status === 'queued' ? 'queued for collection' : entry.status === 'collecting' ? 'collection in progress' : 'collection unavailable; no clean or zero result inferred')}.`);
          }
        } catch { /* Keep the last collection status during transient network errors. */ }
      }
      } catch { this.loadError = 'Unable to refresh measurements. Previously loaded values are shown.'; }
      finally { this.isLoading = false; this.refreshing = false; }
    },
  },
  components: {
    TrustFactCategory,
  },
});
</script>

<template>
  <section class="measurement-summary" aria-label="Measurement summary">
    <div class="summary-row">
      <div class="summary-counts" v-if="!isLoading">
        <strong>{{ measurementSummary.total }} {{ showHistory ? 'rounds' : measurementSummary.total === 1 ? 'fact' : 'facts' }} · {{ measurementSummary.observations }} {{ measurementSummary.observations === 1 ? 'observation' : 'observations' }}</strong>
        <span class="summary-confirmed">✓ {{ measurementSummary.confirmed }} confirmed</span>
        <span><span class="summary-pending-dot" aria-hidden="true"></span>{{ measurementSummary.pending }} pending</span>
        <span v-if="measurementSummary.unverified">{{ measurementSummary.unverified }} unverified</span>
        <span v-if="measurementSummary.failed">ⓘ {{ measurementSummary.failed }} need attention</span>
      </div>
      <span v-else>Loading measurements…</span>
      <div class="summary-controls">
        <va-switch v-if="earlierRoundCount" v-model="showHistory" :label="`Show earlier rounds (${earlierRoundCount})`" />
        <va-switch v-model="confirmedOnly" label="Confirmed only" />
      </div>
    </div>
    <p class="summary-hint">{{ showHistory ? 'Showing current and earlier verification rounds.' : 'Latest observed round per fact. Pending results keep their own status; earlier confirmations are available in the history.' }} Expand a card to inspect contributor observations.</p>
    <p v-for="notice in platformNotices" :key="notice" class="summary-hint">{{ notice }}</p>
    <p v-if="loadError" role="alert">{{ loadError }}</p>
  </section>
  <va-card v-if="categoryTrustFacts.length === 0">
    <va-card-title>{{ confirmedOnly ? 'No finalized measurements yet' : 'No measurements collected yet' }}</va-card-title>

    <va-card-content>
      <p> This package may be queued for collection. Collection and ledger confirmation may still be in progress. This view updates automatically. </p>
    </va-card-content>
  </va-card>
  <div class="cardContainer">
    <TrustFactCategory
      v-for="category in categoryTrustFacts"
      :key="category.name"
      :category="category.name"
      :trustFacts="category.trustfacts"
      :isLoading="isLoading"
      :categoryScore="category.score">
    </TrustFactCategory>
  </div>
</template>

<style scoped>
.measurement-summary { margin: 20px 0; padding: 18px 20px; border: 1px solid #e2e8f0; border-radius: 12px; background: #f8fafc; }
.summary-row, .summary-counts, .summary-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; }
.summary-row { justify-content: space-between; }
.summary-counts { color: #64748b; font-size: 14px; }
.summary-counts strong { color: #1e293b; }
.summary-confirmed { color: #1769bb; }
.summary-pending-dot { display: inline-block; width: 8px; height: 8px; background: #d99012; border-radius: 50%; margin-right: 6px; }
.summary-hint { margin-top: 12px; color: #64748b; font-size: 13px; }

.cardContainer {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(15em, 1fr));
  gap: 18px;
}
</style>
