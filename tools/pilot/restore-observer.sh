#!/bin/sh
# Restore a NEW non-signing observer, never a replacement signing validator.
set -eu
backup_dir="${1:?Absolute backup directory required}"
volume="${2:?New Docker volume name required}"
docker_bin="${DOCKER_BIN:-docker}"
case "$backup_dir" in /*) ;; *) echo 'Absolute backup directory required' >&2; exit 1;; esac
if "$docker_bin" volume inspect "$volume" >/dev/null 2>&1; then
  echo 'Refusing to overwrite an existing volume' >&2; exit 1
fi
(cd "$backup_dir" && shasum -a 256 -c ledger.sha256)
"$docker_bin" run --rm --platform linux/amd64 -v "$backup_dir:/backup:ro" -v "$volume:/restore" trustseco-pilot-ledger sh -c '
  test -z "$(ls -A /restore)"
  tar --exclude="*/data/generator.db" --exclude="*/tmp" --exclude="*/logs" -xzf /backup/ledger.tar.gz -C /restore
  test -z "$(find /restore -type d -name generator.db -print)"
'
echo 'Observer volume restored without generator keys. Start with an empty keys.json and verify generator_getStatus returns an empty status array before treating recovery as successful.'
