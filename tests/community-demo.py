"""Populate the isolated localhost:3004 prototype with explicitly simulated evidence."""
import json,time,urllib.request,uuid
BASE='http://localhost:3004/api/community'
def snapshot():
    with urllib.request.urlopen(BASE+'/snapshot',timeout=15) as r:return json.load(r)
def send(actor,kind,**fields):
    req=urllib.request.Request(BASE+'/event',data=json.dumps(dict(actor=actor,kind=kind,**fields)).encode(),headers={'Content-Type':'application/json','X-Community-Demo':'1'})
    with urllib.request.urlopen(req,timeout=20) as r:result=json.load(r)
    for _ in range(90):
        s=snapshot()
        if any(a['id']==result['eventId'] for a in s['audit']):return result['eventId']
        time.sleep(1)
    raise RuntimeError('Event was not included: '+str(result))
def close(round_id):
    for _ in range(240):
        s=snapshot();r=next(x for x in s['rounds'] if x['id']==round_id)
        if s['at']>r['closesAt']:break
        time.sleep(1)
    return send('governor','close',round=round_id)
def main():
    s=snapshot()
    if s['audit']:raise RuntimeError('Demo requires an empty prototype ledger; refusing to duplicate its scenarios')
    for actor in ['alice','bob','carol','dana']:send('governor','enrol',member=actor)
    print('Four simulated contributors enrolled',flush=True)
    rounds=[]
    for i in range(1,6):
        rid='fixture-error-'+str(i);rounds.append(rid)
        send('governor','open',round=rid,package='demo/stars-case-'+str(i),metric='github_stars',source='GitHub fixture',method='prototype-v1',duration=120)
        for actor,value in [('alice',100),('bob',101),('carol',102),('dana',900)]:send(actor,'observe',round=rid,value=value,source='GitHub fixture',method='prototype-v1')
        print('Collected compatible observations and an outlier for '+rid,flush=True)
    incident=None
    for i,rid in enumerate(rounds,1):
        close(rid);s=snapshot();r=next(x for x in s['rounds'] if x['id']==rid)
        assert r['result']['status']=='verified' and len(r['result']['conflicts'])==1
        assert next(m for m in s['members'] if m['id']=='dana')['incidents']==i-1
        obs=next(o for o in r['observations'] if o['member']=='dana')
        incident=send('governor','substantiate',round=rid,observation=obs['id'],cause=rid,evidence='fixture://community-demo/'+rid,reason='Simulated independent case: fixture baseline 100 stars, observed 900. This is a signed reviewer attestation, not an automatically proven real-world error.')
        member=next(m for m in snapshot()['members'] if m['id']=='dana');assert member['standing']==('active' if i<3 else 'review' if i<5 else 'suspended')
        print('Incident '+str(i)+': Dana is '+member['standing'],flush=True)
    send('dana','appeal',incident=incident,reason='Demo appeal: please review the source and observation time. Awaiting reviewer decision.')
    send('governor','open',round='suspended-submission',package='demo/suspended-contributor',metric='github_stars',source='GitHub fixture',method='prototype-v1',duration=45)
    send('dana','observe',round='suspended-submission',value=100,source='GitHub fixture',method='prototype-v1')
    close('suspended-submission')
    s=snapshot();r=next(x for x in s['rounds'] if x['id']=='suspended-submission')
    assert r['result']['status']=='expired' and not r['observations'][0]['eligible']
    assert next(m for m in s['members'] if m['id']=='dana')['rewardEligibleObservations']==0
    with open('/tmp/trustseco-community-demo-result.json','w') as f:json.dump({'events':len(s['audit']),'members':s['members'],'rounds':[{ 'id':r['id'],'result':r['result']} for r in s['rounds']]},f,indent=2)
    print('PASS: signed ledger events, 3/5 escalation, appeal and suspension exclusion',flush=True)
if __name__=='__main__':main()
