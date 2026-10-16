#!/bin/sh
set -eu
login=${1:?Usage: sh install-reviewer.sh your-lowercase-github-username}
case "$login" in ''|*[!a-z0-9-]*|governor|constructor|prototype) echo 'Use your lowercase personal GitHub username.' >&2; exit 1;; esac
command -v docker >/dev/null || { echo 'Install and start Docker first.' >&2; exit 1; }
docker info >/dev/null
if docker container inspect trustseco-reviewer >/dev/null 2>&1; then
  echo 'Your reviewer container already exists. Resume with: docker start trustseco-reviewer'
  echo 'Show its public key and status with: docker logs -f trustseco-reviewer'
  exit 0
fi
umask 077
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
cd "$work"
base=https://trustseco1.science.uu.nl/reviewer
curl -fSL "$base/reviewer.sha256" -o reviewer.sha256
curl -fSL "$base/reviewer.tar.gz" -o reviewer.tar.gz
if command -v sha256sum >/dev/null; then sha256sum -c reviewer.sha256; else shasum -a 256 -c reviewer.sha256; fi
docker load -i reviewer.tar.gz
docker run -d --platform linux/amd64 --name trustseco-reviewer --init \
  --restart unless-stopped --stop-timeout 300 \
  -v trustseco-reviewer:/reviewer trustseco-reviewer:uu-20261014 \
  https://trustseco1.science.uu.nl "$login"
echo 'Node started. Read its public signing key with: docker logs -f trustseco-reviewer'
echo 'Add that key as a Signing Key at https://github.com/settings/ssh/new'
echo 'An eligible GitHub account must be at least 180 days old. Admission is automatic.'
echo 'Stop cleanly with: docker stop trustseco-reviewer'
echo 'Keep the volume. Restart with: docker start trustseco-reviewer'
