<template>
  <header class="trust-header">
    <router-link class="trust-brand" to="/" aria-label="TrustSECO home"><span class="brand-mark">T</span>TrustSECO</router-link>
    <nav aria-label="Main navigation">
      <router-link v-if="communityDemo" to="/community/" active-class="selected">Community prototype</router-link>
      <router-link to="/" exact-active-class="selected">Overview</router-link>
      <router-link to="/packages/" active-class="selected">Packages</router-link>
      <router-link to="/jobs" active-class="selected">Activity</router-link>
      <router-link to="/metrics/" active-class="selected">Node</router-link>
    </nav>
    <div class="account-area">
      <router-link class="help-link" to="/about/">About</router-link>
      <details v-if="privateServer" class="account-menu" @keydown.esc="closeMenu">
        <summary>{{ username || 'My account' }} <span aria-hidden="true">⌄</span></summary>
        <div class="account-panel">
          <span class="account-caption">Credits</span>
          <strong>{{ credits }}</strong>
          <p>Credits fund measurement jobs. Accepted work can earn rewards under the ledger’s rules.</p>
          <p v-if="accountError" role="status">Balance unavailable. Try refreshing.</p>
          <button type="button" @click="refreshAccount">Refresh balance</button>
          <router-link to="/user/settings/" @click="closeMenu">Account settings →</router-link>
        </div>
      </details>
    </div>
  </header>
</template>
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import axios from 'axios';
const base = `${import.meta.env.VITE_PROTOCOL}://${import.meta.env.VITE_HOST}/api`;
const communityDemo = import.meta.env.VITE_COMMUNITY_DEMO === 'true';
const privateServer = ref(false);
const username = ref('');
const credits = ref('—');
const accountError = ref(false);
let timer: ReturnType<typeof setInterval>;
function closeMenu(event: Event) { const menu = (event.target as HTMLElement).closest('details'); if (menu) menu.open = false; }
async function refreshAccount() {
  try { const { data } = await axios.get(`${base}/dlt/account`); credits.value = data.slingers == null ? 'Not registered' : BigInt(data.slingers).toLocaleString(); accountError.value = false; }
  catch { credits.value = '—'; accountError.value = true; }
}
onMounted(async () => {
  try {
    privateServer.value = (await axios.get(`${base}/server_type`)).data === 'PRIVATE';
    if (privateServer.value) {
      await refreshAccount();
      timer = setInterval(refreshAccount, 30000);
      const {data} = await axios.get(`${base}/dlt/get-github-link`);
      username.value = typeof data === 'string' ? data.match(/^https:\/\/github\.com\/([^/]+)\.gpg$/)?.[1] || '' : '';
    }
  } catch { /* Public navigation remains available if account lookup fails. */ }
});
onUnmounted(() => clearInterval(timer));
</script>
<style scoped>
.trust-header { display:flex; align-items:center; gap:36px; padding:18px 5%; background:white; border-bottom:1px solid #e5eaf0; flex-wrap:wrap; position:relative; z-index:30; }
.trust-brand { display:flex; align-items:center; gap:10px; color:#172b4d; font-weight:800; font-size:22px; text-decoration:none; }
.brand-mark { display:grid; place-items:center; width:32px; height:32px; background:#1769bb; color:white; border-radius:9px; font-size:20px; }
nav { display:flex; gap:8px; flex-wrap:wrap; }
nav a { padding:9px 12px; border-radius:7px; text-decoration:none; color:#52647c; font-size:14px; }
nav a.selected { color:#145fa9; background:#edf5ff; font-weight:600; }
.account-area { margin-left:auto; display:flex; gap:22px; align-items:center; }
.help-link { color:#52647c; font-size:14px; }
.account-menu { position:relative; }
.account-menu summary { cursor:pointer; list-style:none; color:#172b4d; font-size:14px; font-weight:600; }
.account-menu summary::-webkit-details-marker { display:none; }
.account-panel { position:absolute; right:0; top:34px; width:min(300px,85vw); padding:22px; background:white; border:1px solid #e5eaf0; border-radius:12px; box-shadow:0 12px 32px #172b4d22; }
.account-caption { display:block; color:#64748b; font-size:13px; }
.account-panel strong { display:block; font-size:26px; margin:7px 0 12px; color:#172b4d; }
.account-panel p { font-size:13px; line-height:1.6; color:#64748b; }
.account-panel button,.account-panel a { display:block; background:none; border:0; padding:0; margin-top:16px; color:#1769bb; cursor:pointer; font:inherit; font-size:14px; }
a:focus-visible,button:focus-visible,summary:focus-visible { outline:3px solid #87b8ed; outline-offset:3px; }
@media(max-width:700px) { .trust-header { gap:14px; } nav { order:3; width:100%; } .account-area { gap:12px; } }
</style>
