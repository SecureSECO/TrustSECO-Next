<template>
  <va-card>
    <va-card-title>View Packages</va-card-title>
    <va-card-content>
      <p v-if="queue" class="queue-note">Collection queue: {{ queue.queued }} waiting · {{ queue.collecting }} collecting · {{ queue.verified }} verified rounds. Packages appear immediately; scores appear as observations arrive. One job runs at a time.</p>
      <p v-if="queue?.waitingForContributors" role="status" class="queue-note">Waiting for contributors: {{ queue.availableContributors }} available; three are needed to start new work.</p>
      <Packages></Packages>
    </va-card-content>
  </va-card>
</template>

<script>
import Packages from '@/components/package/Packages.vue';
import axios from 'axios';

export default {
  name: 'packages-view',
  data: () => ({queue: null, queueTimer: null}),
  async mounted() { if (import.meta.env.VITE_PILOT === 'true') { await this.refreshQueue(); this.queueTimer = setInterval(() => this.refreshQueue(), 10000); } },
  beforeUnmount() { clearInterval(this.queueTimer); },
  methods: { async refreshQueue() { try { this.queue = (await axios.get('/api/dlt/collection-queue')).data; } catch { this.queue = null; } } },
  components: {
    Packages,
  },
};
</script>

<style scoped>
.queue-note { margin-bottom: 20px; color: #52657d; line-height: 1.6; }
</style>

<!-- This program has been developed by students from the bachelor Computer Science at Utrecht University within the Software Project course.
© Copyright Utrecht University (Department of Information and Computing Sciences) -->
