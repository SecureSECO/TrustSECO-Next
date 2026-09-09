#!/usr/bin/env python3
"""Local service acceptance: both live providers, archive lookup, one-validator outage/rejoin.
Uses existing fixture services. Never reads private keys. Leaves normal mining running.
"""
import json, pathlib, subprocess, time, urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[2]
DOCKER='/Applications/Docker.app/Contents/Resources/bin/docker'
COMPOSE=[DOCKER,'compose','-f','deploy/compose.pilot.yaml','--profile','mining-test','--profile','bulk-test']
BASE='http://localhost:3005'
REPORT=ROOT/'deploy/pilot-runtime/collection-acceptance.json'
def command(args):
    p=subprocess.run(args,cwd=ROOT,text=True,capture_output=True)
    if p.returncode: raise RuntimeError(p.stderr[-1200:] or p.stdout[-1200:])
    return p.stdout
def get(path):
    with urllib.request.urlopen(BASE+path,timeout=20) as r:return json.load(r)
def snapshot():
    s=get('/api/pilot/snapshot')
    assert s.get('testNetwork') and s['network']=='trustseco-8b7bb864' and s['policy'].get('collection')=='scheduled-v1'
    return s
def wait(description,predicate,timeout=1800):
    end=time.monotonic()+timeout;last=0
    while time.monotonic()<end:
        try:
            s=snapshot()
            if predicate(s):print(description+': ready',flush=True);return s
            if time.monotonic()-last>45:print(description+': waiting '+str(s['ledger']),flush=True);last=time.monotonic()
        except (OSError,ValueError) as e:print('Read retry: '+str(e),flush=True)
        time.sleep(5)
    raise RuntimeError('Timed out: '+description)
def main():
    before=snapshot();baseline={r['id'] for r in before['rounds']}
    queue=get('/api/dlt/collection-queue');assert queue['total']==480 and queue['maxConcurrent']==4
    old=get('/api/pilot/audit?before=1')['events'][0]
    assert not any(a['id']==old['id'] for a in before['audit'])
    from urllib.parse import quote
    assert get('/api/pilot/event?id='+quote(old['id'],safe=''))['event']==old
    results={'network':before['network'],'targetCount':480,'archivedEventLookup':True,'auditCount':before['auditCount'],'recentAuditCount':len(before['audit'])}
    services=['worker-'+x for x in 'abcdef']+['package-publisher']
    command(COMPOSE+['up','-d']+services)
    def verified(s):return [r for r in s['rounds'] if r['id'] not in baseline and r['closed'] and r['result']['status']=='verified' and r['confirmationHeight']<=s['ledger']['finalizedHeight']]
    s=wait('New observations from both providers reach agreement and finality',lambda s: {'GitHub REST','Libraries.io REST'} <= {r['source'] for r in verified(s)})
    results['liveVerified']=[{'round':r['id'],'repository':r['escrow']['repository'],'metric':r['metric'],'source':r['source'],'value':r['result']['value'],'observers':[o['member'] for o in r['observations']],'confirmationHeight':r['confirmationHeight']} for r in verified(s)]
    print('PASS: both providers have live finalized evidence',flush=True)
    start=s['ledger']['finalizedHeight']
    try:
        command(COMPOSE+['stop','validator4']);print('Validator 4 stopped; retaining all signing state',flush=True)
        s=wait('Three validators continue finalizing during mining',lambda s:s['ledger']['finalizedHeight']>=start+5,timeout=600)
        results['validatorOutage']={'beforeFinalizedHeight':start,'afterFinalizedHeight':s['ledger']['finalizedHeight']}
    finally:command(COMPOSE+['start','validator4'])
    results['queueAtEnd']={k:v for k,v in get('/api/dlt/collection-queue').items() if k!='entries'}
    results['scope']='Local fixture operators on one Mac. A completed sample and process-outage check, not independent-host acceptance or completion of all 480 targets.'
    REPORT.write_text(json.dumps(results,indent=2)+'\n')
    print('Saved local acceptance evidence; verify all four validators rejoin: '+str(REPORT),flush=True)
if __name__=='__main__':main()
