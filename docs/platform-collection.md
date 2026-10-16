# Stack Overflow and ClamAV collection

## Stack Overflow

The popularity collector was operational, but 39 of the initial 40 package entries lacked an explicit tag. `tools/pilot/stackoverflow-tags.json` now records 35 reviewed package-specific mappings and their public tag-wiki sources. Explicit queue mappings take precedence. Repository and registry identities must match; names are not guessed. Cloudpickle has no tag returned by the API, and broad tags for DuckDB, TOML, Invoke and build were deliberately excluded. Unavailable means unavailable, not zero.

Each observer caches tag metadata for a day and the shared, fixed-date question denominator for an hour. Tagged queries remain fresh. API backoff and quota exhaustion pause further Stack Exchange requests. Collection measures the last 30 complete UTC days using the existing integer percentage-point scale.

## ClamAV

The pilot now schedules `vs_virus_ratio` using `clamav-pypi-v1`. The older spider was not running in the pilot and used a shell download pipeline. The new Node collector downloads exact-version PyPI distributions as data, validates their lengths and SHA-256 digests, and streams them to a private ClamAV daemon. No package is installed or executed.

Every listed release artifact must complete scanning: maximum 100 artifacts, 64 MiB each, 512 MiB total, with bounded network and scan time. Unsupported artifacts, encrypted archives, scan limits, download failures and missing or older-than-seven-day signatures fail closed. Large releases may therefore remain unavailable; they are never reported as clean after a partial scan.

The signed snapshot includes package/version, engine and signature version/date, artifact count, infected-artifact count and the SHA-256 of the canonical artifact/result manifest. Agreement requires identical complete reports, not merely equal ratios. The ratio is infected distribution artifacts / all scanned distribution artifacts, encoded in millionths; it is not the ratio of files inside archives.

Confirmed detections prevent a normal trust score until a complete confirmed rescan clears them. A failed or pending refresh cannot erase a previous detection. Clean scans add no positive points and do not replace the mandatory OSV/CISA evidence. A zero result states no detections in the scanned artifacts, not proof of safety.

The package overview shows scan details and explicit collection notices. The local fixture workers share one daemon, host and signature database; this is not evidence of independent operators. Other operators need their own daemon (`CLAMAV_HOST`, TCP 3310), private networking, identical scanning limits and maintained signatures. The compose service publishes no host port, has a 2 GiB memory limit and one CPU, and persists signatures with freshclam updates. The image is pinned by digest.

Sources: [Stack Exchange throttling](https://api.stackexchange.com/docs/throttle), [PyPI JSON API](https://docs.pypi.org/api/json/), [ClamAV scanning](https://docs.clamav.net/manual/Usage/Scanning.html), [ClamAV Docker](https://docs.clamav.net/manual/Installing/Docker.html).
