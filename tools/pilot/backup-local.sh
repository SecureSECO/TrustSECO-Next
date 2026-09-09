#!/bin/sh
# Offline copy of one local validator's volume; the other three remain running.
set -eu
umask 077
cd "$(dirname "$0")/../.."
docker_bin="${DOCKER_BIN:-docker}"
backup_dir="${1:?Provide a new absolute backup directory}"
case "$backup_dir" in /*) ;; *) echo 'Use an absolute path' >&2; exit 1;; esac
test ! -e "$backup_dir"
mkdir -m 700 "$backup_dir"
compose_file=deploy/compose.pilot.yaml
validator_id=$("$docker_bin" compose -f "$compose_file" ps -q validator4)
ledger_volume=$("$docker_bin" inspect "$validator_id" --format '{{range .Mounts}}{{if eq .Destination "/root/.klayr"}}{{.Name}}{{end}}{{end}}')
test -n "$ledger_volume"
"$docker_bin" compose -f "$compose_file" stop validator4
trap '"$docker_bin" compose -f "$compose_file" start validator4 >/dev/null' EXIT
"$docker_bin" run --rm --platform linux/amd64 -v "$ledger_volume:/source:ro" -v "$backup_dir:/backup" trustseco-pilot-ledger sh -c 'umask 077; tar --exclude="*/tmp/sockets" -czf /backup/ledger.tar.gz -C /source .'
cp -R deploy/pilot-runtime/shared "$backup_dir/public-network"
"$docker_bin" image inspect trustseco-pilot-ledger --format '{{.Id}}' > "$backup_dir/ledger-image.txt"
(cd "$backup_dir" && shasum -a 256 ledger.tar.gz > ledger.sha256)
echo "Offline ledger backup created at $backup_dir. Back up private keys separately with operator-controlled encryption. Restore as a non-signing node first."
