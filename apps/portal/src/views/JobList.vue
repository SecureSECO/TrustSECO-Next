<template>
  <div class="activity-heading"><h1>Activity</h1><router-link to="/user/settings/#mining">Mining settings →</router-link></div>
  <NetworkOverview/>
  <section id="node-details" class="node-details"><h2>Node details</h2><DLTMetricsComponent/></section>
  <va-card v-if="!pilot"><va-card-title>Spider log</va-card-title><va-card-content><SpiderLogComponent/></va-card-content></va-card>
  <va-card>
    <va-card-title>Job list</va-card-title>
    <va-card-content>
      <JobsListComponent/>
    </va-card-content>
  </va-card>
</template>

<script>
import JobsListComponent from '../components/tables/Jobs.vue';
import DLTMetricsComponent from '../components/DLTMetricsComponent.vue';
import SpiderLogComponent from '../components/SpiderLog.vue';
import NetworkOverview from '../components/NetworkOverview.vue';

export default {
  name: 'jobs-view',
  data: () => ({pilot: import.meta.env.VITE_PILOT === 'true'}),
  components: {
    NetworkOverview, DLTMetricsComponent, SpiderLogComponent,
    JobsListComponent,
  },
};
</script>

<style scoped>
.activity-heading{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:24px;color:#172b4d}.activity-heading h1{font-size:28px;font-weight:700}.activity-heading a{color:#1769bb}.node-details{padding:24px;background:white;border:1px solid #e5eaf0;border-radius:12px;margin-bottom:24px;color:#172b4d}.node-details h2{font-size:20px;font-weight:600;margin-bottom:20px}

</style>
