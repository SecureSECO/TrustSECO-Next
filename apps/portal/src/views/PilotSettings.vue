<template>
  <main class="setup">
    <h1>Settings</h1><h2>Identity &amp; mining</h2>
    <p>Set up this node to contribute signed observations. Your private key stays on this machine.</p>
    <p v-if="error" role="alert" class="notice">{{ error }}</p><p v-if="message" role="status" class="notice">{{ message }}</p>
    <p v-if="loading">Loading setup…</p>
    <section v-else-if="!available"><h2>Use your local node</h2><p>This shared portal cannot create or hold your contributor key. Open Settings on your locally installed TrustSECO node to set up an identity and start mining.</p></section>
    <template v-else-if="state">
      <p v-if="state.networkError" role="alert">{{ state.networkError }}. Your saved identity remains available.</p>
      <section><h2>1. Your GitHub identity</h2>
        <form v-if="!state.identity" @submit.prevent="create">
          <label for="login">GitHub username</label><input id="login" v-model="login" autocomplete="username" placeholder="Your GitHub username" required />
          <p>We check that your personal account is at least six months old, then generate a signing key on this node. Linking the public key in the next step proves account ownership.</p>
          <button :disabled="busy">Create my signing identity</button>
        </form>
        <div v-else><strong>{{ state.identity.login }}</strong><p class="fingerprint">Key fingerprint: {{ state.identity.fingerprint }}</p><p>This identity is saved on this node. It is not a login to your GitHub account.</p></div>
      </section>
      <template v-if="state.identity">
        <section><h2>2. Link your public key</h2><p>Copy this public key, open GitHub’s key settings, choose <strong>New SSH key</strong>, and select <strong>Signing Key</strong> as its type.</p>
          <textarea readonly aria-label="Public SSH signing key" :value="state.identity.sshKey" rows="3" />
          <div class="actions"><button @click="copyKey">Copy public key</button><a href="https://github.com/settings/ssh/new" target="_blank" rel="noopener noreferrer">Open GitHub key settings ↗</a><button :disabled="busy" @click="verify">Verify key on GitHub</button></div>
          <p v-if="linked">✓ Your GitHub account has this signing key.</p>
        </section>
        <section><h2>3. Join the community</h2><p v-if="state.admitted">✓ This identity has been admitted to {{ state.network }}.</p><template v-else><p>An operator reviews your request before your observations can count toward agreement. Publishing a key does not automatically grant membership.</p><button :disabled="busy" @click="request">Request admission</button><p v-if="receipt">Request submitted; awaiting operator approval. This request expires {{ new Date(receipt.expiresAt * 1000).toLocaleString() }}. You can renew it with the same button.</p><button v-if="joinRequest" @click="download(joinRequest, 'trustseco-join.json')">Download public admission request</button></template></section>
      </template>
      <section id="mining"><h2>Automatic mining</h2>
        <div class="mining-toggle"><button type="button" role="switch" aria-label="Automatic mining" :aria-checked="state.mining" :class="['mining-switch',{on:state.mining}]" :disabled="busy || (!state.mining && !!miningBlocker)" @click="toggle"><span aria-hidden="true"></span></button><strong>{{ state.mining ? 'Mining is on' : 'Start mining' }}</strong></div>
        <p v-if="miningBlocker" role="status">{{ miningBlocker }}</p>
        <p>{{ state.activity }}</p><p v-if="state.lastSuccess">Last recorded observation: {{ new Date(state.lastSuccess).toLocaleString() }}</p>
        <p v-if="!state.credentials?.github?.configured">No GitHub API token: public GitHub collection can run with lower rate limits. Add a token below for regular mining.</p>
        <p v-if="!state.credentials?.libraries?.configured">No Libraries.io API key: Libraries.io collection cannot run until you save its key. GitHub collection can still run.</p>
        <p>Mining runs on this node even when you close this page. Stopping lets an in-flight submission finish. With no available jobs, the miner waits for work.</p>
      </section>
      <section><h2>Data sources &amp; API keys</h2><p>These credentials let this node collect data. Your signing identity proves who submitted it. Keys are saved privately on this node and never sent to the ledger.</p>
        <form v-for="source in sources" :key="source.id" @submit.prevent="saveCredential(source.id)">
          <label :for="source.id + '-token'">{{ source.label }}</label>
          <input :id="source.id + '-token'" v-model="tokens[source.id]" type="password" autocomplete="new-password" :placeholder="state.credentials?.[source.id]?.configured ? 'Saved — enter a new key to replace it' : 'Paste API key'" />
          <p>{{ source.help }}</p><p role="status">{{ state.credentials?.[source.id]?.configured ? 'Key saved on this node' : 'No key saved' }}<span v-if="state.credentials?.[source.id]?.check"> · {{ state.credentials[source.id].check.message }} · {{ new Date(state.credentials[source.id].check.checkedAt).toLocaleString() }}</span></p>
          <button :disabled="busy || !tokens[source.id].trim()">Save key</button><button type="button" :disabled="busy || !state.credentials?.[source.id]?.configured" @click="checkCredential(source.id)">Test connection</button><button type="button" :disabled="busy || !state.credentials?.[source.id]?.configured" @click="removeCredential(source.id)">Remove key</button>
        </form>
        <p>Saved keys apply to the next collection attempt; no restart is needed. Identity recovery files do not contain API keys.</p>
      </section>
      <template v-if="state.identity">
        <section><h2>Protect your identity</h2><p>Download an encrypted recovery file and keep its password separately. Your working key is stored in the node’s private data directory; protect this machine and its backups.</p><label for="backup-password">Recovery password (at least 12 characters)</label><input id="backup-password" v-model="password" type="password" minlength="12" autocomplete="new-password" /><button :disabled="busy || password.length < 12" @click="backup">Download encrypted recovery file</button></section>
      </template>
      <section v-else><h2>Already have an identity?</h2><p>Restore its encrypted recovery file instead of creating another key. Do not run two miners with the same identity.</p><input aria-label="Encrypted recovery file" type="file" accept="application/json,.json" @change="readBackup" /><label for="restore-password">Recovery password</label><input id="restore-password" v-model="password" type="password" autocomplete="current-password" /><button :disabled="busy || !recovery || password.length < 12" @click="restore">Restore identity</button></section>
    </template>
  </main>
</template>
<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
const state = ref<any>(null), loading = ref(true), available = ref(false), busy = ref(false), error = ref(''), message = ref(''), login = ref(''), password = ref(''), linked = ref(false), receipt = ref<any>(null), joinRequest = ref<any>(null), recovery = ref<any>(null);
const miningBlocker = computed(() => !state.value?.identity ? 'Create or restore your signing identity first.' : state.value.networkError ? 'The ledger is unavailable. Reconnect before starting mining.' : !state.value.admitted ? 'Link your signing key and request admission. Mining becomes available after approval.' : state.value.revoked || state.value.standing === 'suspended' ? 'This identity cannot mine while suspended or revoked.' : '');
const sources = [{id:'github',label:'GitHub API token',help:'Used by GitHub collectors for authenticated API access. Without it, public requests have lower rate limits.'},{id:'libraries',label:'Libraries.io API key',help:'Used by the Libraries.io contributor-count collector. Requires a funded Libraries.io collection round.'}];
const tokens = ref<Record<string,string>>({github:'',libraries:''});
const saveCredential = (source:string) => act(async()=>{await api('credentials',{source,token:tokens.value[source].trim()});tokens.value[source]='';message.value='API key saved privately on this node.';});
const checkCredential = (source:string) => act(async()=>{const result=await api('credentials/check',{source});message.value=result.message;});
const removeCredential = (source:string) => act(async()=>{await api('credentials',{source,token:''});tokens.value[source]='';message.value='API key removed.';});
let timer: ReturnType<typeof setInterval> | undefined;
async function api(route: string, body?: any) {
  const response = await fetch('/api/local/' + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-TrustSECO-Local': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45000) });
  const result = await response.json(); if (!response.ok) throw Error(result.error || 'Setup failed'); return result;
}
async function refresh() { state.value = await api('status'); receipt.value = state.value.request; }
async function act(work: () => Promise<void>) { busy.value = true; error.value = ''; message.value = ''; try { await work(); await refresh(); } catch (e) { error.value = (e as Error).message; } finally { busy.value = false; } }
const create = () => act(async () => { await api('identity', { login: login.value }); message.value = 'Your signing identity is saved. Next, link its public key to GitHub.'; });
const verify = () => act(async () => { const result = await api('verify', {}); linked.value = result.linked; if (!result.linked) throw Error('GitHub does not list this signing key yet. Check that its key type is Signing Key, then try again.'); });
const request = () => act(async () => { const result = await api('request', {}); receipt.value = result; joinRequest.value = result.request; message.value = 'Your request is in the operator’s admission inbox.'; });
const toggle = () => act(async () => { await api('mining', { enabled: !state.value.mining }); });
function download(value: any, name: string) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
const backup = () => act(async () => { const result = await api('backup', { password: password.value }); password.value = ''; download(result, 'trustseco-identity.encrypted.json'); message.value = 'Recovery file downloaded. Keep its password separately.'; });
const restore = () => act(async () => { await api('restore', { backup: recovery.value, password: password.value }); password.value = ''; recovery.value = null; message.value = 'Identity restored. Mining remains off until you start it.'; });
async function copyKey() { try { await navigator.clipboard.writeText(state.value.identity.sshKey); message.value = 'Public key copied.'; } catch { error.value = 'Clipboard unavailable. Select and copy the public key above.'; } }
async function readBackup(event: Event) { try { const file = (event.target as HTMLInputElement).files?.[0]; if (!file || file.size > 16000) throw Error('Choose a recovery JSON file smaller than 16 KB'); recovery.value = JSON.parse(await file.text()); } catch (e) { error.value = (e as Error).message; } }
onMounted(async () => { try { const capabilities = await fetch('/api/pilot/capabilities').then(r => r.json()); available.value = capabilities.localSetup; if (available.value) { await refresh(); timer = setInterval(() => { if (!busy.value) void refresh().catch(e => { error.value = e.message; }); }, 15000); } } catch (e) { error.value = (e as Error).message; } finally { loading.value = false; } });
onUnmounted(() => { if (timer) clearInterval(timer); });
</script>
<style scoped>
.setup{max-width:820px;padding:32px 24px;margin:auto;color:#223744;font-family:system-ui,sans-serif}.setup h1{margin:24px 0 16px}.setup p{line-height:1.65}.setup section{padding:24px 0;border-top:1px solid #d5e1e6;margin-top:24px}.setup h2{font-size:21px}.setup label{display:block;margin:16px 0 8px}.setup input:not([type=file]),.setup textarea{display:block;width:100%;box-sizing:border-box;padding:12px;border:1px solid #afc4ce;border-radius:5px;margin-bottom:16px;background:white;color:#223744}.setup textarea,.fingerprint{font-family:monospace;overflow-wrap:anywhere}.setup button{border:1px solid #216d89;border-radius:5px;background:#216d89;color:white;padding:10px 16px;cursor:pointer;margin:6px 8px 6px 0}.setup button:disabled{opacity:.5;cursor:default}.setup a{color:#156d8a}.actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.notice{padding:14px;background:#edf3f6;border-left:3px solid #216d89}
.mining-toggle{display:flex;align-items:center;gap:12px;margin:16px 0}.setup button.mining-switch{width:48px;height:28px;border:0;border-radius:20px;background:#94a3b8;padding:3px;margin:0;flex:none}.mining-switch span{display:block;width:22px;height:22px;background:white;border-radius:50%;transition:transform .15s}.setup button.mining-switch.on{background:#1769bb}.mining-switch.on span{transform:translateX(20px)}.mining-switch:focus-visible{outline:3px solid #87b8ed;outline-offset:3px}
</style>
