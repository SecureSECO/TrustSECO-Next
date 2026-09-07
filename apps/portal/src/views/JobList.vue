<template>
  <NetworkOverview/>
  <va-card>
    <va-card-title>Job list</va-card-title>
    <va-card-content>
      <JobsListComponent/>
    </va-card-content>
  </va-card>
</template>

<script>
import JobsListComponent from '../components/tables/Jobs.vue';
import NetworkOverview from '../components/NetworkOverview.vue';

export default {
  name: 'jobs-view',
  components: {
    NetworkOverview,
    JobsListComponent,
  },
};
</script>

<style scoped>
</style>
