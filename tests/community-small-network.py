import runpy,time
m=runpy.run_path('tests/community-demo.py');send=m['send'];snapshot=m['snapshot']
if snapshot()['audit']:raise RuntimeError('Small-network demo requires an empty prototype ledger')
for actor in ['alice','bob','carol','dana']:send('governor','enrol',member=actor)
print('Simulated contributors enrolled',flush=True)
send('governor','open',round='small-network',package='demo/two-versus-three',metric='github_stars',source='GitHub fixture',method='prototype-v1',duration=120)
for actor,value in [('alice',100),('bob',101)]:send(actor,'observe',round='small-network',value=value,source='GitHub fixture',method='prototype-v1')
r=snapshot()['rounds'][0];assert r['result']['status']=='pending';print('PASS: two contributors remain unconfirmed',flush=True)
send('carol','observe',round='small-network',value=102,source='GitHub fixture',method='prototype-v1')
assert snapshot()['rounds'][0]['result']['status']=='verified';print('PASS: three compatible contributors establish provisional agreement',flush=True)
m['close']('small-network');print('PASS: round closed with verified agreement',flush=True)
