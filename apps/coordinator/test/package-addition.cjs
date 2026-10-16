const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {addQueuedPackage,queuedPackages}=require('../dist/package-queue');
test('queue addition preserves existing targets, is idempotent, and rejects invalid/conflicting mappings',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'trustseco-add-')),prior=process.env.PILOT_PACKAGE_QUEUE_FILE;
 const file=path.join(dir,'packages.json');process.env.PILOT_PACKAGE_QUEUE_FILE=file;
 const original={repository:'psf/requests',name:'requests',platform:'PyPI',version:'2.32.3'};
 fs.writeFileSync(file,JSON.stringify({network:'test',packages:[original]}));
 try {
  const entry={repository:'python-babel/babel',name:'babel',platform:'pypi',version:'2.18.0'};
  assert.throws(()=>addQueuedPackage('wrong',entry),/network/);
  assert.equal(addQueuedPackage('test',entry).alreadyAdded,false);
  assert.equal(addQueuedPackage('test',entry).alreadyAdded,true);
  assert.deepEqual(queuedPackages('test')[0],original);assert.equal(queuedPackages('test').length,2);
  for(const change of [{version:'latest'},{repository:'../babel'},{name:'../babel'},{version:''}])assert.throws(()=>addQueuedPackage('test',{...entry,...change}));
  assert.throws(()=>addQueuedPackage('test',{...entry,name:'other'}),/different registry mapping/);
  assert.equal(queuedPackages('test').length,2);
 }finally{if(prior===undefined)delete process.env.PILOT_PACKAGE_QUEUE_FILE;else process.env.PILOT_PACKAGE_QUEUE_FILE=prior;fs.rmSync(dir,{recursive:true,force:true});}
});
