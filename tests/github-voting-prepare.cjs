// Fresh disposable runtime only; mount it at /runtime in the candidate ledger image.
const fs=require('node:fs'),{execFileSync}=require('node:child_process');
execFileSync(process.execPath,['/tools/prepare-local.cjs'],{stdio:'inherit',env:{...process.env,PILOT_CHAIN_ID:'19c5e001'}});
const config=JSON.parse(fs.readFileSync('/runtime/shared/config.json'));
config.genesis.blockTime=3;config.system.logLevel='error';
fs.writeFileSync('/runtime/shared/config.json',JSON.stringify(config));
fs.mkdirSync('/runtime/bootstrap',{mode:0o700});
const keys=[1,2,3,4].flatMap(i=>JSON.parse(fs.readFileSync('/runtime/validator'+i+'/keys.json')).keys);
fs.writeFileSync('/runtime/bootstrap/keys.json',JSON.stringify({keys}),{mode:0o600,flag:'wx'});
fs.mkdirSync('/runtime/reviewer',{mode:0o700});fs.mkdirSync('/runtime/fixtures',{mode:0o700});
const publicKey=execFileSync(process.execPath,['/tools/client.cjs','init','reviewer','/runtime/reviewer/identity.json']);
fs.writeFileSync('/runtime/fixtures/github-key.txt',publicKey);
// Config paths deliberately match the compose mounts. Mount shared at /pilot
// too when running the SDK genesis-block:create command afterwards.
console.log('Prepared disposable rotation runtime; create genesis before starting services.');
