<template>
  <va-card>
    <va-card-title>DLT Metrics</va-card-title>
    <va-card-content>
      <DLTMetricsComponent/>
    </va-card-content>
  </va-card>
  <va-card v-if="!pilot">
    <va-card-title>Spider log</va-card-title>
    <va-card-content>
      <spider-log-component/>
    </va-card-content>
  </va-card>
<va-card v-else><va-card-title>Automatic mining</va-card-title><va-card-content><p>Manage your contributor identity, signing key and automatic mining in Settings.</p><router-link to="/user/settings/">Open mining settings →</router-link></va-card-content></va-card>
</template>

<script>
import SpiderLogComponent from '../components/SpiderLog.vue';
import DLTMetricsComponent from '../components/DLTMetricsComponent.vue';

export default {
  name: 'metrics-view',
  data: () => ({pilot: import.meta.env.VITE_PILOT === 'true'}),
  components: {
    SpiderLogComponent,
    DLTMetricsComponent,
  },
};
</script>

<style scoped>
</style>

<!-- This program has been developed by students from the bachelor Computer Science at Utrecht University within the Software Project course.
© Copyright Utrecht University (Department of Information and Computing Sciences) -->
