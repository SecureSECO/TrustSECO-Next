<template>
  <form class="package-form" @submit.prevent="submit">
    <p>Add a registry package and its GitHub repository to this node’s collection queue. Mining starts when contributors and collection slots are available.</p>
    <label>Package registry<select v-model="form.platform"><option value="PyPI">PyPI (Python)</option><option value="NPM">npm (JavaScript)</option></select></label>
    <label>Package name<input v-model="form.name" required maxlength="200" placeholder="e.g. babel"></label>
    <label>GitHub repository<input v-model="form.repository" required maxlength="202" placeholder="e.g. python-babel/babel"></label>
    <p class="hint">The registry name and repository name can differ. Enter the repository as owner/repository.</p>
    <label>Exact version<input v-model="form.version" required maxlength="100" placeholder="e.g. 2.18.0"></label>
    <p class="hint">Use a version published in the package registry, not a GitHub tag. Available collectors run for this target; unsupported or unavailable data is reported explicitly.</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="result" role="status">{{ result.alreadyAdded ? 'This package version is already queued.' : 'Package added to the collection queue.' }} <router-link :to="{name:'Package with Version',params:{name:result.package.repository,version:result.package.version}}">View package →</router-link></p>
    <div class="actions"><button :disabled="busy" type="submit">{{ busy ? 'Adding…' : 'Add package' }}</button><router-link to="/packages/">Back to packages</router-link></div>
  </form>
</template>
<script setup lang="ts">
import { reactive, ref } from 'vue';
const form = reactive({platform:'PyPI',name:'',repository:'',version:''});
const busy=ref(false),error=ref(''),result=ref<any>(null);
async function submit() {
  busy.value=true;error.value='';result.value=null;
  try {
    const response=await fetch('/api/local/packages',{method:'POST',headers:{'Content-Type':'application/json','X-TrustSECO-Local':'1'},body:JSON.stringify(form),signal:AbortSignal.timeout(45000)});
    const data=await response.json();
    if(!response.ok)throw Error(data.error || 'Could not add package');
    result.value=data;
  } catch(e) {error.value=(e as Error).message;} finally {busy.value=false;}
}
</script>
<style scoped>
.package-form { max-width: 680px; display: grid; gap: 16px; }
label { display: grid; gap: 8px; font-weight: 600; }
input,select { width:100%; padding:12px; border:1px solid #cbd5e1; border-radius:8px; background:white; font:inherit; box-sizing:border-box; }
p { line-height:1.5; }.hint { color:#52657d; font-size:13px; }
.actions { display:flex; flex-wrap:wrap; align-items:center; gap:20px; }
button { background:#1769bb; color:white; border:0; border-radius:8px; padding:12px 20px; font:inherit; cursor:pointer; }button:disabled { opacity:.6; }
</style>
