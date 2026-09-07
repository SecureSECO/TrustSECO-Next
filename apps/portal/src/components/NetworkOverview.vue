<template>
  <section class="network-overview" aria-labelledby="network-title">
    <div class="network-heading">
      <div><h2 id="network-title">Ecosystem nodes</h2><p>Community nodes collect measurements and maintain the shared ledger.</p></div>
      <button type="button" :disabled="loading" @click="refresh">{{ loading ? 'Refreshing…' : 'Refresh' }}</button>
    </div>
    <p class="scope">This node and its connected ledger peers. This is a view of the network from here, rather than a complete ecosystem directory. A connection does not indicate that a peer is mining or has confirmed a particular fact.</p>
    <p v-if="error" class="network-error" role="status">{{ error }}</p>
    <p v-if="!snapshot && loading" role="status">Discovering connected nodes…</p>
    <template v-if="snapshot">
      <div class="node-grid">
        <article class="node-card">
          <h3>This node <span class="node-badge">Local</span></h3>
          <p><span class="dot" :class="{uncertain:error || snapshot.local.syncing}" aria-hidden="true"></span>{{ error ? 'Status unavailable' : snapshot.local.syncing ? 'Syncing ledger' : 'Ledger reachable' }}</p>
          <dl><dt>Block height</dt><dd>{{ snapshot.local.height.toLocaleString() }}</dd><dt>Finalized height</dt><dd>{{ snapshot.local.finalizedHeight.toLocaleString() }}</dd></dl>
          <router-link to="/metrics/">Node details →</router-link>
        </article>
        <article v-for="peer in snapshot.peers" :key="`${peer.address}:${peer.port}`" class="node-card">
          <h3>{{ peer.address }}:{{ peer.port }}</h3>
          <p><span class="dot" :class="{uncertain:error}" aria-hidden="true"></span>{{ error ? 'Status unavailable' : 'Connected ledger peer' }}</p>
          <p class="peer-note">Miner activity and confirmation progress are not reported by this peer API.</p>
        </article>
      </div>
      <p v-if="!snapshot.peers.length && !error" class="network-empty">No connected peers. This node currently has no peer connections through which to exchange ledger data.</p>
      <p class="network-updated">{{ error ? 'Last successful snapshot' : 'Updated' }} {{ new Date(snapshot.observedAt).toLocaleTimeString() }} · {{ snapshot.peers.length }} connected {{ snapshot.peers.length === 1 ? 'peer' : 'peers' }}{{ error ? ' at that time' : '' }} · Refreshes every 30 seconds</p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import axios from 'axios';
interface Snapshot {
  observedAt: string;
  local: { height: number; finalizedHeight: number; syncing: boolean };
  peers: { address: string; port: number }[];
}
const snapshot = ref<Snapshot | null>(null);
const loading = ref(false);
const error = ref('');
let timer: ReturnType<typeof setInterval>;
let disposed = false;
async function refresh() {
  if (loading.value) return;
  loading.value = true;
  try {
    const {data} = await axios.get<Snapshot>(`${import.meta.env.VITE_PROTOCOL}://${import.meta.env.VITE_HOST}/api/dlt/network`, {timeout:10000});
    if (!disposed) { snapshot.value = data; error.value = ''; }
  } catch {
    if (!disposed) error.value = 'Cannot reach the ledger. Node status is unavailable; any snapshot below may be out of date.';
  } finally { if (!disposed) loading.value = false; }
}
onMounted(() => { refresh(); timer = setInterval(refresh,30000); });
onUnmounted(() => { disposed = true; clearInterval(timer); });
</script>

<style scoped>
.network-overview { background:white; border:1px solid #e5eaf0; border-radius:12px; padding:24px; margin-bottom:24px; color:#172b4d; }
.network-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; }
h2 { font-size:22px; font-weight:600; margin:0 0 8px; }h3 { font-size:15px; font-weight:600; margin:0 0 16px; overflow-wrap:anywhere; }
p { line-height:1.6; font-size:14px; } .scope,.network-updated,.peer-note { color:#64748b; font-size:13px; }.scope { max-width:900px; margin:16px 0; }
button { border:1px solid #d9e2ed; border-radius:7px; background:white; color:#1769bb; padding:9px 14px; cursor:pointer; }button:disabled { cursor:wait; opacity:.6; }
.node-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr)); gap:16px; }
.node-card { min-width:0; border:1px solid #e5eaf0; border-radius:8px; padding:18px; }
.node-badge { display:inline-block; font-size:11px; font-weight:400; padding:3px 7px; background:#edf5ff; color:#1769bb; border-radius:4px; margin-left:8px; }
.dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:#23845c; margin-right:7px; }.dot.uncertain { background:#b98116; }
dl { display:grid; grid-template-columns:1fr auto; gap:8px; margin:16px 0; font-size:13px; }dt { color:#64748b; }dd { margin:0; }
a { color:#1769bb; font-size:13px; }.network-empty,.network-error { margin-top:16px; padding:12px; background:#f8fafc; border-radius:6px; }.network-error { background:#fff8eb; }.network-updated { margin-top:16px; }
button:focus-visible,a:focus-visible { outline:3px solid #87b8ed; outline-offset:3px; }
@media(max-width:600px) { .network-overview { padding:16px; } }
</style>
