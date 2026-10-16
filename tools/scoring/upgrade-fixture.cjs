// Compare old/new binaries without touching chain data. Generated fixtures contain public
// keys and signed test events only; ephemeral private keys are never written out.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=process.cwd();
const {freshPilot,applyPilot,settlePilot,METRICS,DELAY}=require(path.join(root,'dist/app/modules/pilot/policy'));
if(process.argv[2]==='--generate'){
 const beacon=JSON.parse(fs.readFileSync(process.argv[3]));
 const network=require(path.join(root,'dist/app/modules/pilot/beacon-network.json'));
 const at=network.genesis_time+(beacon.round-1)*network.period-180;
 const keys=Object.fromEntries(['governor','a','b','c','d'].map(id=>[id,crypto.generateKeyPairSync('ed25519')]));
 const pub=id=>keys[id].publicKey.export({type:'spki',format:'pem'}).toString();let sequence=0;
 function envelope(actor,body){const payload=JSON.stringify({network:'upgrade-fixture',id:'upgrade-'+ ++sequence,actor,...body});return {payload,signature:crypto.sign(null,Buffer.from('TrustSECO-community-v1\n'+payload),keys[actor].privateKey).toString('base64')};}
 const event=(s,actor,body,time=at,height=1)=>{const e=envelope(actor,body);return applyPilot(s,e.payload,e.signature,time,height)};
 const fixtures=[];
 for(const metric of Object.keys(METRICS).filter(m=>m.startsWith('gh_')||m.startsWith('lib_'))){
  let s=freshPilot(pub('governor'),'upgrade-fixture','availability-beacon-v1');
  s.community.members=['a','b','c','d'].map(id=>({id,key:pub(id),operator:id,githubId:id,suspended:false,reinstatedAt:-1}));
  for(const id of ['a','b','c','d']){s.balances[id]='0';s=event(s,id,{kind:'availability',until:at+900});}
  const source=metric.startsWith('lib_')?'Libraries.io REST':'GitHub REST';
  const method=metric==='lib_contributor_count'?'libraries-repository-v1':metric.startsWith('lib_')?'libraries-project-v1':'github-rest-v1';
  s=event(s,'governor',{kind:'open',round:'round',repository:'pallets/flask',package:'pallets/flask',version:'3.1.1',metric,source,method,packagePlatform:'Pypi',packageName:'Flask',duration:900,bounty:'300'});
  s=event(s,'a',{kind:'assignment-beacon',round:'round',beaconRound:beacon.round,beaconSignature:beacon.signature},at+180,2);
  const committee=s.escrows.round.assignment.committee;
  const observation={kind:'observe',round:'round',value:100,source,method,observedAt:at+183};
  for(const member of committee.slice(0,2))s=event(s,member,{...observation,observedAt:at+181},at+181,3);
  const third=envelope(committee[2],observation);
  const observed=applyPilot(s,third.payload,third.signature,at+183,4);
  const closed=settlePilot(observed,at+901,5),paid=settlePilot(closed,at+901+DELAY,6);
  fixtures.push({metric,at,before:s,third,expected:{observed,closed,paid}});
 }
 process.stdout.write(JSON.stringify(fixtures));
}else if(process.argv[2]==='--verify'){
 const fixtures=JSON.parse(fs.readFileSync(process.argv[3]));
 for(const f of fixtures){
  const observed=applyPilot(f.before,f.third.payload,f.third.signature,f.at+183,4);
  const closed=settlePilot(observed,f.at+901,5),paid=settlePilot(closed,f.at+901+DELAY,6);
  assert.deepEqual({observed,closed,paid},f.expected,f.metric+' changed across upgrade');
 }
 console.log('PASS: '+fixtures.length+' old metric rounds retain identical observations, closure, escrow, audit and delayed settlement across binaries');
}else throw Error('Use --generate <beacon-fixture.json> on the old binary, then --verify <generated-fixtures.json> on the new binary');
