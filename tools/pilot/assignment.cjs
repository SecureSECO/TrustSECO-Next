const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const entropyCommitment = (context, member, secret) => hash(JSON.stringify(['TrustSECO-entropy-v1', context, member, secret]));
// The endpoint must be a trusted validating node. An HTTP response is not a finality proof.
function entropyEvent(state, identity, keyfile) {
  const finalized = state.ledger?.finalizedHeight;
  if (!Number.isSafeInteger(finalized)) return null;
  for (const round of state.rounds) {
    const a = round.assignment;
    if (!a || a.version !== 'commit-reveal-v1' || round.closed || !a.pool.some(m => m.id === identity.id)) continue;
    if (a.openedHeight > finalized || state.at >= a.revealUntil) continue;
    if (!/^[a-f0-9]{64}$/.test(a.context)) throw Error('Invalid assignment context');
    const file = keyfile + '.entropy/' + a.context + '.json';
    if (state.at < a.commitUntil && !a.commitments[identity.id]) {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      // Exclusive create persists entropy before signing. Restarts and concurrent attempts reuse it.
      if (!fs.existsSync(file)) {
        try { fs.writeFileSync(file, JSON.stringify({secret:crypto.randomBytes(32).toString('hex')}), {mode:0o600,flag:'wx'}); }
        catch (e) { if (e.code !== 'EEXIST') throw e; }
      }
      const {secret} = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!/^[a-f0-9]{64}$/.test(secret)) throw Error('Invalid saved entropy');
      return { kind:'entropy-commit', round:round.id, contribution:entropyCommitment(a.context,identity.id,secret) };
    }
    if (state.at >= a.commitUntil && !a.reveals[identity.id] &&
        a.pool.every(m => a.commitments[m.id] && Number.isSafeInteger(a.commitmentHeights[m.id]) && a.commitmentHeights[m.id] <= finalized)) {
      if (!fs.existsSync(file)) throw Error('Saved entropy missing; cannot replace the committed draw');
      const {secret} = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (entropyCommitment(a.context,identity.id,secret) !== a.commitments[identity.id]) throw Error('Saved entropy does not match commitment');
      return {kind:'entropy-reveal',round:round.id,contribution:secret};
    }
  }
  return null;
}
function canObserve(round, state, member) {
  if (round.assignment?.version === 'availability-beacon-v1') return require('./availability.cjs').canObserve(round,state,member);
  if (!round.assignment) return !['commit-reveal-v1','availability-beacon-v1'].includes(state.policy?.assignment);
  return round.assignment.version === 'commit-reveal-v1' &&
    state.at >= round.assignment.revealUntil && round.assignment.committee.includes(member);
}
function expiredEnvelope(event, state) {
  if (event.kind === 'availability') return event.until !== 0 && event.until <= state.at;
  if (event.kind === 'assignment-beacon') {
    const a=state.rounds.find(r=>r.id===event.round)?.assignment;
    if(a?.seed || (a && state.at > a.beaconDeadline))return true;
  }
  if (event.kind === 'observe') {
    const a=state.rounds.find(r=>r.id===event.round)?.assignment;
    if(a?.version==='availability-beacon-v1' && !a.slots.some(slot=>!slot.replaced && slot.member===event.actor && state.at<=slot.until))return true;
  }
  const round = state.rounds.find(r => r.id === event.round);
  if (!round) return false;
  if (round.closed || state.at > round.closesAt) return true;
  if (event.kind === 'entropy-commit') return state.at >= round.assignment.commitUntil;
  if (event.kind === 'entropy-reveal') return state.at >= round.assignment.revealUntil;
  return false;
}
module.exports = {entropyCommitment, entropyEvent, canObserve, expiredEnvelope};
