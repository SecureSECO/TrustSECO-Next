// stdout is the reproducible LaTeX parameter block; redirect it into the paper repository.
const p = require("../../services/ledger/src/app/modules/scoring/policy.json");
console.log(
  "% Generated from TrustSECO scoring/policy.json; do not edit by hand."
);
const macro = (name, value) =>
  console.log("\\newcommand{\\" + name + "}{" + value + "}");
macro("TrustPolicy", p.version);
macro("TrustCoverage", p.minimumCoverage * 100);
macro("TrustFreshness", p.freshnessSeconds / 3600);
macro("TrustHistory", p.historySeconds / 86400);
macro("TrustRecovery", p.recoveryPointsPerDay);
macro("TrustWeights", p.features.map((f) => f.weight).join(","));
macro("TrustReferences", p.features.map((f) => f.reference).join(","));
macro("TrustMultipliers", p.severity.map((b) => b.multiplier).join(","));
macro("TrustHighCap", p.severity.find((b) => b.name === "high").ceiling);
macro(
  "TrustCriticalCap",
  p.severity.find((b) => b.name === "critical").ceiling
);
macro("TrustExploitedCap", p.knownExploitedCeiling);
