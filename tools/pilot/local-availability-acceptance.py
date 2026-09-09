#!/usr/bin/env python3
"""Controlled local-only acceptance run with six fixture identities and real Libraries.io data.
Requires the availability policy to be activated. Never reads or prints private keys.
Restores the six workers and existing publisher on exit. Do not run against UU.
"""
import json, pathlib, subprocess, time, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[2]
DOCKER = '/Applications/Docker.app/Contents/Resources/bin/docker'
COMPOSE = [DOCKER, 'compose', '-f', 'deploy/compose.pilot.yaml', '--profile', 'mining-test', '--profile', 'bulk-test']
IDS = ['test-' + x for x in 'abcdef']
WORKERS = ['worker-' + x for x in 'abcdef']
BASE = 'http://localhost:3005'
REPORT = ROOT / 'deploy/pilot-runtime/availability-acceptance.json'

def command(args):
    result = subprocess.run(args, cwd=ROOT, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr[-1200:] or result.stdout[-1200:])
    return result.stdout.strip()

def snapshot():
    with urllib.request.urlopen(BASE + '/api/pilot/snapshot', timeout=15) as r:
        s = json.load(r)
    if not s.get('testNetwork') or s['network'] != 'trustseco-8b7bb864' or s['policy']['assignment'] != 'availability-beacon-v1':
        raise RuntimeError('Expected the activated local fixture network')
    return s

def wait_for(description, predicate, timeout=1200):
    deadline = time.monotonic() + timeout
    last = 0
    while time.monotonic() < deadline:
        s = snapshot()
        if predicate(s):
            print(description + ': ready', flush=True)
            return s
        if time.monotonic() - last >= 45:
            print(description + ': waiting; ledger ' + str(s['ledger']), flush=True)
            last = time.monotonic()
        time.sleep(5)
    raise RuntimeError('Timed out: ' + description)

def signed(body, identity='governor'):
    service = 'package-publisher' if identity == 'governor' else 'worker-' + identity[-1]
    key = '/governor/identity.json' if identity == 'governor' else '/identity/identity.json'
    js = "require('/tools/client.cjs').durableEvent('http://localhost:3000',process.argv[1],JSON.parse(process.argv[2])).then(()=>console.log('Signed event recorded')).catch(e=>{console.error(e.message);process.exit(1)})"
    command(COMPOSE + ['run', '--rm', '--no-deps', service, 'node', '-e', js, key, json.dumps(body)])

def get_round(s, rid):
    return next((r for r in s['rounds'] if r['id'] == rid), None)

def open_round(rid, metric):
    signed(dict(kind='open', round=rid, package='pallets/flask', repository='pallets/flask', version='3.1.1',
                metric=metric, source='Libraries.io REST', method='libraries-project-v1',
                packagePlatform='PyPI', packageName='Flask', duration=300, bounty='300'))

def finalized(rid):
    return wait_for('Round ' + rid + ' closes and finalizes', lambda s: (r := get_round(s, rid)) is not None and r['closed'] and r['confirmationHeight'] <= s['ledger']['finalizedHeight'])

def available(s, wanted):
    return all(s.get('availability', {}).get(i, {}).get('until', 0) > s['at'] + 60 and
               s['availability'][i]['height'] <= s['ledger']['finalizedHeight'] for i in wanted)

def main():
    before = snapshot()
    if any(not r['closed'] for r in before['rounds']):
        raise RuntimeError('Existing work must finish before controlled acceptance')
    # This driver begins immediately after activation with no availability records.
    if any(l['until'] > before['at'] for l in before.get('availability', {}).values()):
        raise RuntimeError('Start with empty/expired availability records to test exactly three online')
    results = []
    try:
        command(COMPOSE + ['stop', 'package-publisher'] + WORKERS)
        command(COMPOSE + ['up', '-d'] + WORKERS[:2])
        two = wait_for('Two online contributors show insufficient availability', lambda s: available(s, IDS[:2]) and s['availableContributors'] == 2)
        assert all(r['closed'] for r in two['rounds'])
        results.append(dict(case='two online: insufficient contributors', available=two['availableContributors'], openRounds=0))
        command(COMPOSE + ['up', '-d'] + WORKERS[:3])
        wait_for('Three online contributor leases finalized', lambda s: available(s, IDS[:3]) and s['availableContributors'] == 3)
        rid = 'availability-acceptance-three-online'
        open_round(rid, 'lib_sourcerank')
        s = finalized(rid); r = get_round(s, rid)
        assert r['result']['status'] == 'verified', r['result']
        assert sorted(m['id'] for m in r['assignment']['pool']) == IDS[:3]
        assert len(r['observations']) == 3
        results.append(dict(case='six admitted, three online', round=rid, result=r['result'], pool=r['assignment']['pool'], confirmationHeight=r['confirmationHeight']))
        print('PASS: three online contributors collected live SourceRank and finalized agreement', flush=True)
        command(COMPOSE + ['up', '-d'] + WORKERS)
        wait_for('Six contributor leases finalized', lambda s: available(s, IDS))
        rid = 'availability-acceptance-reserve'
        open_round(rid, 'lib_release_count')
        command(COMPOSE + ['stop'] + WORKERS)
        s = wait_for('Fixed future beacon available after opening finality', lambda s: (r := get_round(s, rid)) is not None and r['assignment']['openedHeight'] <= s['ledger']['finalizedHeight'] and s['at'] >= r['assignment']['beaconTime'])
        a = get_round(s, rid)['assignment']
        network = json.loads((ROOT/'tools/pilot/beacon-network.json').read_text())
        with urllib.request.urlopen('https://api.drand.sh/' + network['hash'] + '/public/' + str(a['beaconRound']), timeout=20) as response:
            beacon = json.load(response)
        assert beacon['round'] == a['beaconRound']
        signed(dict(kind='assignment-beacon', round=rid, beaconRound=beacon['round'], beaconSignature=beacon['signature']), 'test-a')
        a = get_round(snapshot(), rid)['assignment']; missing = a['order'][0]; reserve = a['order'][3]
        command(COMPOSE + ['up', '-d'] + ['worker-' + i[-1] for i in IDS if i != missing])
        print('Keeping assigned observer ' + missing + ' offline; expected reserve ' + reserve, flush=True)
        s = finalized(rid); r = get_round(s, rid)
        assert r['result']['status'] == 'verified', r['result']
        assert missing not in [o['member'] for o in r['observations']]
        assert reserve in [o['member'] for o in r['observations']]
        assert any(slot['member'] == missing and slot['replaced'] for slot in r['assignment']['slots'])
        results.append(dict(case='assigned observer offline, reserve takeover', round=rid, missing=missing, reserve=reserve, result=r['result'], slots=r['assignment']['slots'], confirmationHeight=r['confirmationHeight']))
        REPORT.write_text(json.dumps(dict(network=s['network'],ledger=s['ledger'],cases=results),indent=2)+'\n')
        print('PASS: reserve collected live release count and finalized agreement. Report: ' + str(REPORT), flush=True)
    finally:
        command(COMPOSE + ['up', '-d'] + WORKERS + ['package-publisher'])

if __name__ == '__main__':
    main()
