<template>
  <article class="about-trust">
    <p class="eyebrow">ABOUT TRUSTSECO</p>
    <h1>Evidence for software trust.</h1>
    <p>TrustSECO collects measurements about software packages, records their provenance, and calculates trust scores. Local measurements are visible immediately; finalized ledger records carry a blue check.</p>
    <p>A confirmed record establishes ledger finality. It does not independently prove that the underlying data is accurate or that a package is safe.</p>
    <h2>Understand the scores</h2>
    <p>Local and Confirmed scores use the same formula with different eligible measurements. Coverage matters when comparing scores.</p>
    <router-link to="/score-calculation/">Read the scoring methodology →</router-link>
    <h2>Run your own node</h2>
    <p>The portal, coordinator, Spider and ledger are available together in TrustSECO-Next.</p>
    <a href="https://github.com/SecureSECO/TrustSECO-Next#start-locally" target="_blank" rel="noopener noreferrer">Setup instructions on GitHub →</a>
  </article>
</template>
<style scoped>
.about-trust { max-width:760px; margin:32px auto; padding:28px; color:#334155; line-height:1.8; }
.eyebrow { color:#1769bb; font-size:12px; letter-spacing:2px; }
h1 { font-size:36px; line-height:1.2; margin:12px 0 24px; color:#172b4d; }
h2 { font-size:22px; margin-top:32px; } p { margin-bottom:16px; }
</style>
