const crypto = require("node:crypto");
const KEV =
  "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
// Libraries.io's existing queue spelling Pypi names the same registry as OSV's PyPI.
function canonicalEcosystem(value) {
  return typeof value === "string" && value.toLowerCase() === "pypi" ? "PyPI" : value;
}
function severity(score) {
  return score === 0
    ? "none"
    : score < 4
    ? "low"
    : score < 7
    ? "medium"
    : score < 9
    ? "high"
    : "critical";
}
function cvss(vectors) {
  const lib = require(require.resolve("@pandatix/js-cvss", {
    paths: [__dirname, process.cwd()],
  }));
  for (const version of ["4.0", "3.1", "3.0"]) {
    const candidates = vectors.filter(
      (v) =>
        typeof v.score === "string" &&
        v.score.startsWith("CVSS:" + version + "/")
    );
    const values = [];
    for (const v of candidates)
      try {
        const Type = lib["CVSS" + version.replace(".", "")],
          obj = new Type(v.score);
        const score = version === "4.0" ? obj.Score() : obj.BaseScore();
        if (Number.isFinite(score) && score >= 0 && score <= 10)
          values.push({
            score,
            scoreVersion: version,
            vector: v.score,
            severity: severity(score),
          });
      } catch {}
    if (values.length)
      return values.sort(
        (a, b) => b.score - a.score || a.vector.localeCompare(b.vector)
      )[0];
  }
  return { score: null, scoreVersion: null, vector: null, severity: "unknown" };
}
async function collectSecurity(target, request) {
  const ecosystem = canonicalEcosystem(target.packagePlatform),
    name = target.packageName,
    version = target.version;
  if (
    ![
      "PyPI",
      "npm",
      "Go",
      "crates.io",
      "Maven",
      "NuGet",
      "RubyGems",
      "Packagist",
      "Hex",
      "Pub",
    ].includes(ecosystem) ||
    typeof name !== "string" ||
    !name ||
    typeof version !== "string" ||
    !version ||
    version === "latest"
  )
    throw Error(
      "Explicit supported OSV ecosystem, package and exact version required"
    );
  const canonicalName = (n) =>
    ecosystem === "PyPI" && typeof n === "string"
      ? n.toLowerCase().replace(/[-_.]+/g, "-")
      : n;
  const raw = [];
  let page_token;
  const tokens = new Set();
  do {
    const page = await request("https://api.osv.dev/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        package: { ecosystem, name },
        version,
        ...(page_token ? { page_token } : {}),
      }),
    });
    if (
      !page ||
      typeof page !== "object" ||
      (page.vulns !== undefined && !Array.isArray(page.vulns))
    )
      throw Error("Invalid OSV response");
    raw.push(...(page.vulns || []));
    if (raw.length > 100)
      throw Error("Advisory bound exceeded; no partial assessment submitted");
    page_token = page.next_page_token;
    if (
      page_token &&
      (typeof page_token !== "string" ||
        tokens.has(page_token) ||
        tokens.size >= 20)
    )
      throw Error("Invalid or excessive OSV pagination");
    if (page_token) tokens.add(page_token);
  } while (page_token);
  const kev = await request(KEV);
  if (
    !Array.isArray(kev?.vulnerabilities) ||
    !Number.isInteger(kev.count) ||
    kev.count !== kev.vulnerabilities.length ||
    !kev.vulnerabilities.every((v) => typeof v.cveID === "string")
  )
    throw Error("Incomplete KEV response");
  const exploited = new Set(kev.vulnerabilities.map((v) => v.cveID));
  const rows = [];
  for (const v of raw) {
    if (v.withdrawn) continue;
    if (
      typeof v.id !== "string" ||
      !idPattern.test(v.id) ||
      !Array.isArray(v.affected)
    )
      throw Error("Malformed OSV advisory");
    const affected = v.affected.filter(
      (a) =>
        a.package?.ecosystem === ecosystem &&
        canonicalName(a.package?.name) === canonicalName(name)
    );
    if (!affected.length)
      throw Error("OSV returned an advisory for a different package");
    const aliases = [...new Set([v.id, ...(v.aliases || [])])].sort();
    if (!aliases.every((id) => typeof id === "string" && idPattern.test(id)))
      throw Error("Invalid advisory aliases");
    // OSV's exact-version query determines applicability; never invent a union of version ranges.
    rows.push({
      id: v.id,
      aliases,
      ...cvss(
        affected.some((a) => a.severity?.length)
          ? affected.flatMap((a) => a.severity || [])
          : v.severity || []
      ),
      kev: aliases.some((id) => exploited.has(id)),
    });
  }
  // Merge connected alias sets, including transitive duplicate provider records.
  let groups = [];
  for (const row of rows) {
    const matches = groups.filter((g) =>
      g.aliases.some((id) => row.aliases.includes(id))
    );
    const all = [row, ...matches];
    groups = groups.filter((g) => !matches.includes(g));
    const aliases = [...new Set(all.flatMap((g) => g.aliases))].sort();
    const selected = all.sort(
      (a, b) => (b.score ?? -1) - (a.score ?? -1) || a.id.localeCompare(b.id)
    )[0];
    groups.push({
      ...selected,
      id: aliases[0],
      aliases,
      kev: all.some((g) => g.kev),
    });
  }
  groups.sort((a, b) => a.id.localeCompare(b.id));
  const security = {
    schema: 1,
    ecosystem,
    name,
    version,
    complete: true,
    advisories: groups,
  };
  if (Buffer.byteLength(JSON.stringify(security)) > 9000)
    throw Error("Security snapshot exceeds signed event bound; no truncation");
  return {
    value: groups.length,
    security,
    observedAt: Math.floor(Date.now() / 1000),
    evidence: "https://api.osv.dev/v1/query",
    evidenceHash: crypto
      .createHash("sha256")
      .update(JSON.stringify({ raw, kev }))
      .digest("hex"),
  };
}
async function collectStackOverflow(target, request) {
  const tag = target.stackOverflowTag;
  if (typeof tag !== "string" || !/^[a-z0-9][a-z0-9.+#-]{0,59}$/.test(tag))
    throw Error("Explicit Stack Overflow tag required");
  const now = Math.floor(Date.now() / 1000),
    end = Math.floor(now / 86400) * 86400;
  const root = "https://api.stackexchange.com/2.3";
  const info = await request(
    root + "/tags/" + encodeURIComponent(tag) + "/info?site=stackoverflow"
  );
  if (
    !Array.isArray(info?.items) ||
    !info.items.some((t) => t.name === tag) ||
    info.error_id ||
    info.backoff
  )
    throw Error("Stack Overflow tag unavailable or rate limited");
  const base =
    root +
    "/questions?site=stackoverflow&filter=total&fromdate=" +
    (end - 30 * 86400) +
    "&todate=" +
    (end - 1);
  const total = await request(base),
    matched = await request(base + "&tagged=" + encodeURIComponent(tag));
  if (
    total.error_id ||
    matched.error_id ||
    total.backoff ||
    matched.backoff ||
    !Number.isSafeInteger(total.total) ||
    total.total <= 0 ||
    !Number.isSafeInteger(matched.total) ||
    matched.total < 0 ||
    matched.total > total.total
  )
    throw Error("Invalid Stack Overflow totals");
  // Millionths of one percentage point preserves fractions in the integer-only ledger.
  return {
    value: Math.round((matched.total / total.total) * 100000000),
    observedAt: now,
    evidence: base + "&tagged=" + encodeURIComponent(tag),
    evidenceHash: crypto
      .createHash("sha256")
      .update(JSON.stringify({ total, matched }))
      .digest("hex"),
  };
}
module.exports = { canonicalEcosystem, collectSecurity, collectStackOverflow, cvss, KEV };
