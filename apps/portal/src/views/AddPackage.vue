<template>
  <va-card>
    <va-card-title>Add new package</va-card-title>
    <va-card-content>
      <pilot-add-package v-if="pilot"/><add-package-component v-else/>
    </va-card-content>
  </va-card>
</template>

<script>
import AddPackageComponent from '../components/AddPackageComponent.vue';
import PilotAddPackage from '../components/PilotAddPackage.vue';

export default {
  name: 'add-package-view',
  data: () => ({pilot: import.meta.env.VITE_PILOT === 'true'}),
  components: {
    AddPackageComponent, PilotAddPackage,
  },
};
</script>

<style scoped>
</style>

<!-- This program has been developed by students from the bachelor Computer Science at Utrecht University within the Software Project course.
© Copyright Utrecht University (Department of Information and Computing Sciences) -->
