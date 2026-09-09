<template>
  <va-card v-if="privateServer" class="mining-settings">
    <va-card-title>Automatic mining</va-card-title>
    <va-card-content>
      <p class="mining-description">Contribute to TrustSECO by collecting outstanding measurement jobs and submitting signed results from this node.</p>
      <div class="mining-control"><SpiderToggleButton/></div>
      <p class="mining-note">Changes to this switch take effect immediately. Account settings below are saved separately.</p>
      <router-link to="/metrics/">View node details →</router-link>
    </va-card-content>
  </va-card>
  <va-card>
    <va-card-title>User settings</va-card-title>
    <va-card-content>
      <user-settings-component/>
    </va-card-content>
  </va-card>
</template>

<script>
import UserSettingsComponent from '../components/UserSettingsComponent.vue';
import SpiderToggleButton from '../components/button/SpiderToggle.vue';
import { api, ServerType } from '@/api';

export default {
  name: 'user-settings-view',
  components: { UserSettingsComponent, SpiderToggleButton },
  data() { return { privateServer: false }; },
  async mounted() {
    try { this.privateServer = await api.getServerType() === ServerType.Private; }
    catch { /* Only show node controls when operator mode is established. */ }
  },
};
</script>

<style scoped>
.mining-settings { margin-bottom:24px; }
.mining-description { max-width:700px; margin-bottom:20px; line-height:1.6; }
.mining-control { max-width:420px; min-width:0; overflow-wrap:anywhere; }
.mining-note { margin:16px 0; color:#64748b; font-size:13px; line-height:1.6; }
.mining-settings a { color:#1769bb; }
.mining-settings a:focus-visible { outline:3px solid #87b8ed; outline-offset:3px; }
</style>

<!-- This program has been developed by students from the bachelor Computer Science at Utrecht University within the Software Project course.
© Copyright Utrecht University (Department of Information and Computing Sciences) -->
