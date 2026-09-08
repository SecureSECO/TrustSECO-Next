<template>
  <main class="pilot">
    <h1>Community verification</h1>
    <p>Signed observations, contributor identities and agreement recorded on the shared ledger.</p>
    <p v-if="error" role="alert" class="error">{{ error }} <button @click="refresh">Retry</button></p>
    <template v-if="state">
      <p v-if="state.testNetwork" class="note">Local test network: validator and test contributor keys are held on this machine. Agreement here tests the protocol; it does not demonstrate independent community participation.</p>
      <div class="summary"><article><strong>{{ state.members.length }}</strong><span>Admitted contributors</span></article><article><strong>{{ verifiedCount }}</strong><span>Closed rounds with agreement</span></article><article><strong>{{ state.ledger.finalizedHeight }}</strong><span>Finalized block · {{ state.ledger.height }} recorded</span></article><article><strong><TrustCoinAmount :amount="state.treasury" /></strong><span>TrustCOIN available in treasury</span></article></div>
      <p class="note" v-if="state.members.length < 3">This network needs at least three independent contributors to verify findings. Assigned rounds cannot open with fewer than three eligible operators. Unresolved funded rounds are refunded after closure and the 24-hour review period.</p>
      <p class="note" v-if="state.policy.assignment === 'commit-reveal-v1'">Each round assigns three distinct operators. All eligible operators contribute to the draw first. Missing responses expire the round; the committee is never redrawn. Three compatible observations establish agreement, not proof of independent collection. Misconduct review still requires three substantiated incidents, and suspension five, within 30 days.</p>
      <section id="work"><h2>Observations &amp; trust scores</h2><p>These collectors measure the repository today. A version label associates the finding with a package; it does not reconstruct that version’s historical repository statistics.</p>
        <p v-if="!state.rounds.length" class="empty">No collection rounds yet. The network governor can publish funded work; admitted contributors run their own mining client.</p>
        <article class="round" v-for="round in [...state.rounds].reverse()" :key="round.id">
          <div class="round-heading"><h3>{{ round.escrow.repository }} <small>{{ round.escrow.version }}</small></h3><span :title="statusHelp(round)" :class="['status', round.result.status]">{{ status(round) }}</span></div>
          <p>{{ metric(round.metric) }} · {{ round.observations.length }} observations · <TrustCoinAmount :amount="round.escrow.bounty" /> reserved</p>
          <p v-if="round.assignment">{{ assignmentStatus(round) }}<br><small>Frozen pool: {{ round.assignment.pool.length }} operators · {{ Object.keys(round.assignment.commitments).length }} commitments · {{ Object.keys(round.assignment.reveals).length }} reveals. Measurement window starts {{ date(round.assignment.revealUntil) }}.</small></p>
          <p>Agreed value: <strong>{{ round.result.value ?? 'Awaiting agreement' }}</strong> · Window closes {{ date(round.closesAt) }}</p>
          <div class="observations"><span v-for="o in round.observations" :key="o.id" :title="'Observed ' + date(o.observedAt)">{{ o.member }}: <b>{{ o.value }}</b></span></div>
          <p v-if="scores[round.escrow.repository + '@' + round.escrow.version]" class="score">Confirmed Trust Score: <strong>{{ formatScore(scores[round.escrow.repository + '@' + round.escrow.version].score) }}</strong><br><small>Based on {{ scores[round.escrow.repository + '@' + round.escrow.version].facts.length }} finalized, community-verified metric types using the existing formula.</small></p>
          <p class="muted">{{ round.escrow.settled ? 'Bounty settled on the ledger.' : round.closed ? 'Review period ends ' + date(round.escrow.closedAt + state.policy.delaySeconds) : 'Collection in progress.' }}</p>
        </article>
      </section>
      <section id="community"><h2>Community</h2><p>Admission checks a GitHub account’s age and published signing key. An operator also attests that the contributor is independent. Account age alone does not prevent one person from controlling several accounts.</p><div class="members"><article v-for="m in state.members" :key="m.id"><strong v-if="state.testNetwork">{{ m.id }}</strong><a v-else :href="'https://github.com/' + m.id">{{ m.id }}</a><p>{{ m.revoked ? 'Key revoked' : m.standing }} · <TrustCoinAmount :amount="m.balance" /></p><small>{{ state.testNetwork ? 'Test identity' : 'GitHub ID ' + m.githubId }} · Operator {{ m.operator }}</small></article></div><p v-if="!state.members.length" class="empty">No contributor identities have been admitted. This screen displays ledger data, with no example contributors.</p></section>
      <footer>Network {{ state.network }} · refreshed {{ refreshed }} · <button @click="refresh">Refresh</button><p>Set up your contributor identity and automatic mining in Settings. Private signing keys stay with their operators.</p></footer>
    </template>
    <p v-else-if="!error">Connecting to the ledger…</p>
  </main>
</template>
<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import TrustCoinAmount from '@/components/TrustCoinAmount.vue';
const state = ref<any>(null), payouts = ref<any[]>([]), scores = ref<Record<string, any>>({}), error = ref(''), refreshed = ref('');
let timer: ReturnType<typeof setTimeout> | undefined, stopped = false, loading = false;
const verifiedCount = computed(() => state.value?.rounds.filter((r: any) => r.closed && r.result.status === 'verified').length || 0);
const formatScore = (value: number | null) => value === null ? 'Not enough verified evidence' : value.toFixed(2);
const date = (seconds: number) => new Date(seconds * 1000).toLocaleString();
const metric = (id: string) => ({ gh_owner_stargazer_count: 'Stars across the owner’s public repositories', gh_contributor_count: 'Repository contributors', gh_open_issues_count: 'Open issues (excluding pull requests)', gh_yearly_commit_count: 'Commits in GitHub’s last 52 weeks' }[id] || id);
const status = (r: any) => !r.closed ? (r.assignment && state.value.at < r.assignment.revealUntil ? '● Preparing assignment' : '● Collecting') : r.result.status === 'verified' ? r.escrow.closedHeight <= state.value.ledger.finalizedHeight && state.value.audit.every((e: any) => e.height <= state.value.ledger.finalizedHeight) ? '✓ Community agreement · finalized' : '● Community agreement · recorded' : r.result.status === 'disputed' ? '● Conflicting observations' : '○ Not enough agreement';
const assignmentStatus = (r: any) => r.assignment.committee.length ? 'Assigned observers: ' + r.assignment.committee.join(', ') : state.value.at >= r.assignment.revealUntil ? 'Assignment failed: incomplete entropy. No replacement draw.' : 'Waiting for all frozen operators to complete the draw.';
const statusHelp = (r: any) => r.result.status === 'verified' ? 'Three or more compatible eligible observations. This is agreement under the network policy, not a guarantee that the source is correct.' : 'The network does not treat this round as verified evidence.';
async function get(path: string) { const response = await fetch('/api/pilot/' + path, { signal: AbortSignal.timeout(15000) }); if (!response.ok) throw Error('The ledger is unavailable. Previously loaded data may be stale.'); return response.json(); }
async function refresh() {
  if (loading) return; loading = true;
  try {
    const [s, p] = await Promise.all([get('snapshot'), get('payouts')]); state.value = s; payouts.value = p.payouts;
    const packages = new Map<string, any>(s.rounds.map((r: any) => [r.escrow.repository + '@' + r.escrow.version, r.escrow]));
    const next: Record<string, any> = {};
    for (const [key, item] of packages) next[key] = await get('score?repository=' + encodeURIComponent(item.repository) + '&version=' + encodeURIComponent(item.version));
    scores.value = next; error.value = ''; refreshed.value = new Date().toLocaleTimeString();
  } catch (e) { scores.value = {}; error.value = (e as Error).message; } finally { loading = false; }
}
async function poll() { await refresh(); if (!stopped) timer = setTimeout(poll, 15000); }
onMounted(poll); onUnmounted(() => { stopped = true; if (timer) clearTimeout(timer); });
</script>
<style scoped>
.pilot{max-width:1180px;margin:auto;padding:36px 24px 56px;color:#172b4d}.pilot>h1{font-size:32px;font-weight:700;margin-bottom:16px}.pilot section,.summary{background:white;border:1px solid #e5eaf0;border-radius:12px;padding:24px;margin-top:24px}.pilot section h2{margin:0 0 12px}.members article{border-radius:8px}.pilot header{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;align-items:center}.pilot header>a{font-size:24px;font-weight:750}.pilot a{color:#156d8a}.pilot nav{display:flex;gap:24px;flex-wrap:wrap}.intro{max-width:790px;padding:50px 0 26px}.intro h1{font-size:clamp(28px,4vw,42px);line-height:1.18;margin:12px 0}.pilot p{line-height:1.65}.eyebrow{text-transform:uppercase;letter-spacing:.1em;font-size:12px}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));border:1px solid #d5e1e6}.summary article{padding:22px}.summary strong{display:block;font-size:28px}.summary article:last-child strong{font-size:24px}.summary span,.muted,small{color:#526674}.pilot section{scroll-margin-top:20px}.pilot h2{margin:42px 0 12px}.note,.empty{background:#edf3f6;padding:18px;border-left:3px solid #7e9fad}.round{border-top:1px solid #d5e1e6;padding:20px 0}.round-heading{display:flex;justify-content:space-between;align-items:center;gap:15px;flex-wrap:wrap}.round h3{margin:0;overflow-wrap:anywhere}.status{font-size:13px;color:#576a78}.verified{color:#126e9f}.disputed,.error{color:#964e20}.observations{display:flex;gap:12px;flex-wrap:wrap}.observations span{background:#eaf0f4;padding:6px 12px}.score{border-left:3px solid #247fa8;padding-left:12px}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:12px;border-bottom:1px solid #d5e1e6}.members{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}.members article{padding:18px;border:1px solid #d5e1e6;overflow-wrap:anywhere}footer{margin-top:45px;padding-top:20px;border-top:1px solid #d5e1e6;color:#526674}button{border:1px solid #b8cbd5;background:white;padding:5px 12px;border-radius:4px;cursor:pointer}
</style>
