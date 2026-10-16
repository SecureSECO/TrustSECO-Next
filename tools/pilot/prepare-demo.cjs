// Select demo targets without changing chain history, identities or credentials.
const fs=require('node:fs'),path=require('node:path');
const file=process.argv[2];
if(!file)throw Error('Usage: node prepare-demo.cjs /path/to/packages.json');
const q=JSON.parse(fs.readFileSync(file));
if(!q.network||!Array.isArray(q.packages))throw Error('Existing network-bound queue required');
const preset=JSON.parse(fs.readFileSync(path.join(__dirname,'../../deploy/demo-packages.json')));
const backup=file+'.before-demo-'+Date.now();
fs.copyFileSync(file,backup,fs.constants.COPYFILE_EXCL);
fs.writeFileSync(file+'.tmp',JSON.stringify({...q,...preset,selection:preset.description},null,2)+'\n',{mode:0o600});
fs.renameSync(file+'.tmp',file);
console.log('Selected '+preset.packages.length+' demo packages. Previous queue: '+backup);
