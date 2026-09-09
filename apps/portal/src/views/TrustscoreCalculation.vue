<template>
  <main class="methodology">
    <h1>How TrustSECO scores software</h1>
    <p class="lead">“Trust comes on foot, and leaves by horse.”</p>
    <p>
      Positive evidence builds confidence. Serious vulnerabilities impose
      penalties that popularity cannot cancel. A score supports a decision; it
      is not a probability that software is safe.
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="policy">
      <p>
        Policy <strong>{{ policy.version }}</strong> · These weights, ceilings
        and recovery settings are explicit policy choices requiring empirical
        evaluation.
      </p>
      <section>
        <h2>1. A bounded evidence baseline</h2>
        <p>
          For more-is-better indicators, z = x / (x + a). For less-is-better
          indicators, z = a / (x + a). Here a is the reference value. The
          baseline is B = 100 × Σ(w × z).
        </p>
        <p>
          Community support has a fixed 10% budget. Raw issue counts, dependency
          counts and an owner’s total stars do not automatically earn trust.
          Contributor counts are not counted twice across providers.
        </p>
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th>Indicator</th>
                <th>Budget</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="f in policy.features" :key="f.id">
                <td>{{ f.label }}</td>
                <td>{{ f.weight * 100 }}%</td>
                <td>
                  {{
                    f.unit === 'seconds' ? f.reference / 86400 : f.reference
                  }}
                  {{ f.unit === 'seconds' ? 'days' : f.unit }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Stack Overflow uses the share of questions in percentage points: 0.05%
          is stored as 50,000 millionths of a percentage point. At the reference
          of 0.05%, its normalized value is 0.5. Zero stays zero and a growing
          share never reverses its contribution. Collection uses an explicit tag
          and the last 30 complete UTC days.
        </p>
      </section>
      <section>
        <h2>2. Vulnerabilities cannot be outweighed by popularity</h2>
        <p>
          Q = min(B × Π(severity multipliers), strictest applicable ceiling).
        </p>
        <p>
          Only distinct, non-withdrawn advisories returned for the assessed
          ecosystem, package and exact version are included. CVE/GHSA aliases
          count once. CVSS describes severity; these multipliers are not
          probabilities.
        </p>
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th>Severity</th>
                <th>CVSS</th>
                <th>Multiplier</th>
                <th>Ceiling</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="band in policy.severity" :key="band.name">
                <td>{{ band.name }}</td>
                <td>{{ band.min }}–{{ band.max }}</td>
                <td>×{{ band.multiplier }}</td>
                <td>{{ band.ceiling }}</td>
              </tr>
              <tr>
                <td>Known exploitation</td>
                <td>CISA KEV</td>
                <td>Severity still applies</td>
                <td>{{ policy.knownExploitedCeiling }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          A baseline of 80 becomes 40 with one high-severity vulnerability, 20
          with one critical vulnerability, and at most 9 for an applicable
          known-exploited vulnerability. Fixed advisories leave the current
          target; recovery history still carries across versions.
        </p>
      </section>
      <section>
        <h2>3. Fast deterioration, gradual recovery</h2>
        <p>
          Accepted negative evidence lowers the assessment immediately. Upward
          movement is limited to {{ policy.recoveryPointsPerDay }} point per day
          supported by fresh evidence. Publishing another version does not reset
          the project’s history. Until {{ policy.historySeconds / 86400 }} days
          of supported history exist, the score says “insufficient history”.
        </p>
        <p>
          Remediation must be evidenced; time alone does not remove a
          vulnerability. A governor can record an auditable factual correction
          against a corroborated security round, with a reason and evidence. A confirmed ClamAV malware detection makes the score unavailable until a complete confirmed rescan reports no detections; a clean scan adds no positive points.
          This can restore the assessment promptly but cannot bypass current
          vulnerability ceilings.
        </p>
      </section>
      <section>
        <h2>4. Uncertainty stays visible</h2>
        <p>
          Evidence expires after {{ policy.freshnessSeconds / 3600 }} hours. At
          least {{ policy.minimumCoverage * 100 }}% of the fixed evidence budget
          and a fresh, complete security snapshot with known severities are
          required. Missing positive inputs produce a baseline range, not an
          inflated average; the numeric target uses the conservative lower
          bound.
        </p>
        <p>
          Failed queries, unknown severity and disputed or unfinalized updates
          cannot silently become zero risk. Local assessments are provisional;
          confirmed assessments require community agreement and ledger finality.
          Signed agreement does not prove the upstream source is correct.
        </p>
      </section>
      <p>
        Severity:
        <a href="https://www.first.org/cvss/v4.0/specification-document"
          >FIRST CVSS</a
        >
        · Version matching:
        <a href="https://google.github.io/osv.dev/api/">OSV</a> · Exploitation:
        <a href="https://www.cisa.gov/known-exploited-vulnerabilities-catalog"
          >CISA KEV</a
        >
      </p>
    </template>
  </main>
</template>
<script setup lang="ts">
import { ref, onMounted } from 'vue';
const policy = ref<any>(null),
  error = ref('');
onMounted(async () => {
  try {
    const response = await fetch('/api/pilot/score-policy', {
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error();
    policy.value = await response.json();
  } catch {
    error.value =
      'The active scoring policy is unavailable. Reconnect to the ledger to see its versioned methodology.';
  }
});
</script>
<style scoped>
.methodology {
  max-width: 1050px;
  margin: auto;
  padding: 32px;
  color: #172b4d;
}
.methodology h1 {
  font-size: 30px;
}
.lead {
  font-size: 22px;
  margin: 18px 0;
}
.methodology p {
  line-height: 1.65;
  margin: 16px 0;
}
.methodology section {
  background: white;
  padding: 24px;
  border: 1px solid #dce4ec;
  border-radius: 10px;
  margin: 24px 0;
}
.methodology h2 {
  font-size: 21px;
}
.scroll {
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
}
td,
th {
  text-align: left;
  padding: 10px;
  border-bottom: 1px solid #dce4ec;
}
a {
  color: #1769bb;
}
</style>
