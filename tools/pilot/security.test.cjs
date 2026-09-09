const { test } = require("node:test"),
  assert = require("node:assert/strict");
const {
  collectSecurity,
  collectStackOverflow,
  cvss,
} = require("./security.cjs");
const target = {
    packagePlatform: "PyPI",
    packageName: "Flask",
    version: "3.1.1",
  },
  vector = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H";
const vulnerability = (id = "GHSA-test", aliases = ["CVE-2026-1234"]) => ({
  id,
  aliases,
  affected: [{ package: { ecosystem: "PyPI", name: "Flask" } }],
  severity: [{ type: "CVSS_V3", score: vector }],
});
const kev = { count: 1, vulnerabilities: [{ cveID: "CVE-2026-1234" }] };
test("real calculator derives CVSS v3 and v4 scores and handles unknown", () => {
  assert.equal(cvss([{ score: vector }]).score, 9.8);
  assert.equal(cvss([{ score: "bad" }]).severity, "unknown");
  assert.equal(
    cvss([
      {
        score:
          "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H",
      },
    ]).score,
    10
  );
});
test("exact query, pagination, alias deduplication, KEV and withdrawn records", async () => {
  let calls = 0;
  const response = await collectSecurity(target, async (url, options) => {
    if (!options) return kev;
    const query = JSON.parse(options.body);
    assert.equal(query.version, target.version);
    assert.deepEqual(query.package, { ecosystem: "PyPI", name: "Flask" });
    calls++;
    return calls === 1
      ? { vulns: [vulnerability()], next_page_token: "next" }
      : {
          vulns: [
            vulnerability("CVE-2026-1234", ["GHSA-test"]),
            { ...vulnerability("withdrawn", []), withdrawn: "2025-01-01" },
          ],
        };
  });
  assert.equal(calls, 2);
  assert.equal(response.value, 1);
  assert.equal(response.security.advisories[0].kev, true);
  assert.equal(response.security.advisories[0].score, 9.8);
});
test("failed or incomplete responses are errors, a successful empty scan is zero", async () => {
  assert.equal(
    (await collectSecurity(target, async (u, o) => (o ? {} : kev))).value,
    0
  );
  for (const page of [
    { vulns: "bad" },
    { vulns: [{ ...vulnerability(), affected: [] }] },
    { vulns: Array.from({ length: 101 }, () => vulnerability()) },
  ])
    await assert.rejects(
      collectSecurity(target, async (u, o) => (o ? page : kev))
    );
  await assert.rejects(
    collectSecurity(target, async (u, o) =>
      o ? {} : { vulnerabilities: [], count: 1 }
    ),
    /Incomplete/
  );
  await assert.rejects(
    collectSecurity(target, async () => {
      throw Error("provider unavailable");
    }),
    /provider/
  );
  await assert.rejects(
    collectSecurity({ ...target, version: "latest" }, async () => ({})),
    /exact/
  );
});
test("package-specific severity takes precedence and absent severity stays unknown", async () => {
  const v = vulnerability();
  v.affected[0].severity = [
    { score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:N" },
  ];
  assert.equal(
    (await collectSecurity(target, async (u, o) => (o ? { vulns: [v] } : kev)))
      .security.advisories[0].severity,
    "medium"
  );
  delete v.severity;
  delete v.affected[0].severity;
  assert.equal(
    (await collectSecurity(target, async (u, o) => (o ? { vulns: [v] } : kev)))
      .security.advisories[0].severity,
    "unknown"
  );
});
test("Stack Overflow fractions and zero remain meaningful; unavailable tags never silently become zero", async () => {
  const run = (n) =>
    collectStackOverflow({ stackOverflowTag: "flask" }, async (url) =>
      url.includes("/tags/")
        ? { items: [{ name: "flask" }] }
        : { total: url.includes("&tagged=") ? n : 100000 }
    );
  assert.equal((await run(50)).value, 50000);
  assert.equal((await run(1)).value, 1000);
  assert.equal((await run(0)).value, 0);
  await assert.rejects(
    collectStackOverflow({}, async () => ({})),
    /Explicit/
  );
  await assert.rejects(
    collectStackOverflow({ stackOverflowTag: "flask" }, async () => ({
      items: [],
    })),
    /tag unavailable/
  );
});

test("PyPI package identities use standard name normalization, not fuzzy matching", async () => {
  const v = vulnerability();
  v.affected[0].package.name = "flask";
  assert.equal(
    (await collectSecurity(target, async (u, o) => (o ? { vulns: [v] } : kev)))
      .value,
    1
  );
  v.affected[0].package.name = "other-flask";
  await assert.rejects(
    collectSecurity(target, async (u, o) => (o ? { vulns: [v] } : kev)),
    /different package/
  );
});

test('collector accepts existing Pypi spelling and queries canonical OSV ecosystem',async()=>{
 const result=await collectSecurity({...target,packagePlatform:'Pypi'},async(u,o)=>{
  if(!o)return kev;assert.equal(JSON.parse(o.body).package.ecosystem,'PyPI');return {vulns:[]};
 });assert.equal(result.security.ecosystem,'PyPI');
});
