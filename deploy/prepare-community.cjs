// Execute inside the prototype ledger image, with /prototype mounted to a private directory.
const fs=require('fs');const crypto=require('crypto');const c=require('@klayr/cryptography');
(async()=>{
const out='/prototype';if(fs.existsSync(out+'/validators.json'))throw Error('Prototype identity already exists; refusing to overwrite');
const actors={};for(const id of ['governor','alice','bob','carol','dana']){const k=crypto.generateKeyPairSync('ed25519');actors[id]={publicKey:k.publicKey.export({type:'spki',format:'pem'}).toString(),privateKey:k.privateKey.export({type:'pkcs8',format:'pem'}).toString()}}
fs.writeFileSync(out+'/actors.json',JSON.stringify(actors),{mode:0o600});fs.writeFileSync(out+'/governor.pem',actors.governor.publicKey);
const assets=JSON.parse(fs.readFileSync('config/default/genesis_assets.json'));
const pos=assets.assets.find(a=>a.module==='pos').data;const template=pos.validators[0];const validators=[],keys=[];
for(let i=0;i<4;i++){
 const phrase=crypto.randomBytes(32).toString('hex');const priv=await c.ed.getPrivateKeyFromPhraseAndPath(phrase,"m/44'/134'/0'");const pub=c.ed.getPublicKeyFromPrivateKey(priv);
 const bls=c.bls.generatePrivateKey(crypto.randomBytes(32));const blspub=c.bls.getPublicKeyFromPrivateKey(bls);const address=c.address.getKlayr32AddressFromPublicKey(pub);
 validators.push({...template,address,name:'prototype_'+i,blsKey:blspub.toString('hex'),proofOfPossession:c.bls.popProve(bls).toString('hex'),generatorKey:pub.toString('hex')});
 keys.push({address,plain:{generatorKey:pub.toString('hex'),generatorPrivateKey:priv.toString('hex'),blsKey:blspub.toString('hex'),blsPrivateKey:bls.toString('hex')}});
}
validators.sort((a,b)=>Buffer.compare(c.address.getAddressFromKlayr32Address(a.address),c.address.getAddressFromKlayr32Address(b.address)));
pos.validators=validators;pos.stakers=[];pos.genesisData.initValidators=validators.map(v=>v.address);
const token=assets.assets.find(a=>a.module==='token').data;token.userSubstore=validators.map(v=>({address:v.address,tokenID:'7365703100000000',availableBalance:'100000000000000',lockedBalances:[]}));token.supplySubstore=[{tokenID:'7365703100000000',totalSupply:'400000000000000'}];
fs.writeFileSync(out+'/genesis_assets.json',JSON.stringify(assets));fs.writeFileSync(out+'/validators.json',JSON.stringify({keys}),{mode:0o600});fs.writeFileSync(out+'/empty.json','{"keys":[]}');fs.writeFileSync(out+'/transport.json',JSON.stringify({privateKey:keys[0].plain.generatorPrivateKey}),{mode:0o600});
const base=JSON.parse(fs.readFileSync('config/default/config.json'));base.genesis.chainID='73657031';base.genesis.blockTime=3;base.modules.pos={failSafeInactiveWindow:144000,numberActiveValidators:4,numberStandbyValidators:0};base.genesis.bftBatchSize=4;base.genesis.block.fromFile='/prototype/genesis_block.blob';base.generator.keys.fromFile='/prototype/validators.json';base.network.seedPeers=[];
fs.writeFileSync(out+'/config.json',JSON.stringify(base));base.generator.keys.fromFile='/prototype/empty.json';base.network.seedPeers=[{ip:'community-ledger',port:8000}];fs.writeFileSync(out+'/replica-config.json',JSON.stringify(base));
console.log('Created fresh prototype identities, four validators and separate chain ID 73657031.');

})().catch(e=>{console.error(e.message);process.exit(1)});
