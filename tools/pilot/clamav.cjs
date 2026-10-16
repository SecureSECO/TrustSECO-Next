// Exact PyPI release artifacts are downloaded as data and streamed to a private clamd.
// Nothing is installed or executed. Each observer performs its own collection.
const crypto = require('node:crypto');
const fs = require('node:fs'), path = require('node:path');
const INCONCLUSIVE_RETRY_MS = 6 * 3600000;
function inconclusive(file, reply, remaining = INCONCLUSIVE_RETRY_MS) {
  const error = Error('Inconclusive ClamAV scan of ' + JSON.stringify(file.filename) + ' (SHA-256 ' + file.digests.sha256 + '): ' + reply + '; no clean or malware verdict recorded');
  error.code = 'SCAN_INCONCLUSIVE'; error.retryAfterMs = Math.max(1000, remaining);
  return error;
}
function diagnosticFile(directory, file, engine) {
  return directory && path.join(directory, hash(JSON.stringify(['clamav-pypi-v1:limits-encrypted-broken',file.digests.sha256,engine])) + '.json');
}
function saveDiagnostic(directory, filename, record) {
  if (!directory) return;
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const entries=fs.readdirSync(directory).filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(f=>({file:path.join(directory,f),mtime:fs.statSync(path.join(directory,f)).mtimeMs})).sort((a,b)=>a.mtime-b.mtime);
  while(entries.length>=200)fs.unlinkSync(entries.shift().file);
  const temporary=filename+'.'+crypto.randomUUID()+'.tmp';
  fs.writeFileSync(temporary,JSON.stringify(record),{mode:0o600});fs.renameSync(temporary,filename);
}
const net = require('node:net');
const {once} = require('node:events');
const MAX_ARTIFACT = 64 * 1024 * 1024, MAX_RELEASE = 512 * 1024 * 1024;
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const normalize = name => name.toLowerCase().replace(/[-_.]+/g, '-');
async function download(url, limit) {
  const response = await fetch(url, {redirect:'error', signal:AbortSignal.timeout(60000)});
  if (!response.ok) throw Error('Artifact source unavailable: HTTP ' + response.status);
  let size = 0; const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) { throw Error('Artifact scan size limit exceeded'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function command(command, bytes, host = process.env.CLAMAV_HOST) {
  if (!host) return Promise.reject(Error('ClamAV unavailable: CLAMAV_HOST is not configured'));
  return new Promise((resolve,reject) => {
    const socket = net.createConnection({host,port:3310}); let result = '', settled = false;
    const finish = (error, value) => {if(settled)return;settled=true;socket.destroy();error?reject(error):resolve(value);};
    socket.setTimeout(120000,()=>finish(Error('ClamAV scan timed out')));
    socket.on('error',error=>finish(error));
    socket.on('data',chunk=>{result+=chunk.toString();if(result.length>8192)return finish(Error('ClamAV response exceeds bound'));if(result.includes('\0')||result.includes('\n'))finish(null,result.replace(/[\0\r\n]+$/g,''));});
    socket.on('end',()=>finish(Error('Incomplete ClamAV response')));
    socket.on('connect',async()=>{
      try {
        socket.write('z'+command+'\0');
        if(bytes) {
          for(let offset=0;offset<bytes.length;offset+=65536) {
            const chunk=bytes.subarray(offset,offset+65536),size=Buffer.alloc(4);size.writeUInt32BE(chunk.length);
            socket.write(size); if(!socket.write(chunk))await once(socket,'drain');
          }
          socket.write(Buffer.alloc(4));
        }
      }catch(error){finish(error);}
    });
  });
}
function verdict(reply) {
  if(reply === 'stream: OK')return false;
  if(/^stream: .+ FOUND$/.test(reply) && !/Heuristics\.Limits|Heuristics\.Encrypted|Heuristics\.Broken/i.test(reply))return true;
  throw Error('Incomplete ClamAV scan: '+reply);
}
async function collectMalware(target, request, scan = command, fetchBytes = download, options = {}) {
  if(String(target.packagePlatform).toLowerCase()!=='pypi'||typeof target.packageName!=='string'||!target.version||target.version==='latest')throw Error('Exact PyPI target required for ClamAV');
  const evidence='https://pypi.org/pypi/'+encodeURIComponent(target.packageName)+'/'+encodeURIComponent(target.version)+'/json';
  const metadata=await request(evidence);
  if(normalize(metadata.info?.name||'')!==normalize(target.packageName)||metadata.info?.version!==target.version||!Array.isArray(metadata.urls)||!metadata.urls.length||metadata.urls.length>100)throw Error('Incomplete or mismatched PyPI artifact manifest');
  const files=[...metadata.urls].sort((a,b)=>String(a.filename).localeCompare(String(b.filename)));
  let bytesTotal=0;const names=new Set();
  for(const file of files){
    const url=new URL(file.url);
    if(url.protocol!=='https:'||url.hostname!=='files.pythonhosted.org'||url.port||url.username||url.password||!url.pathname.startsWith('/packages/')||!['sdist','bdist_wheel'].includes(file.packagetype)||typeof file.filename!=='string'||names.has(file.filename)||!Number.isSafeInteger(file.size)||file.size<=0||file.size>MAX_ARTIFACT||!/^[a-f0-9]{64}$/.test(file.digests?.sha256||''))throw Error('Unsupported or incomplete PyPI artifact manifest');
    names.add(file.filename);bytesTotal+=file.size;
  }
  if(bytesTotal>MAX_RELEASE)throw Error('Release exceeds ClamAV collection size limit');
  const engine=await scan('VERSION');
  const fields=engine.split('/'),signatureAt=Math.floor(Date.parse(fields.slice(2).join('/'))/1000),now=Math.floor(Date.now()/1000);
  if(!/^ClamAV [\w.+-]+$/.test(fields[0])||!/^\d+$/.test(fields[1])||!Number.isSafeInteger(signatureAt)||signatureAt>now+300||now-signatureAt>7*86400)throw Error('ClamAV signatures missing or stale');
  // Check every persisted diagnostic before downloading any artifact in this release.
  for(const file of files) {
    const saved=diagnosticFile(options.directory,file,engine);
    if(saved && fs.existsSync(saved)) {
      const record=JSON.parse(fs.readFileSync(saved,'utf8'));
      if(record.sha256===file.digests.sha256 && record.engine===engine && record.retryAt>Date.now())throw inconclusive(file,record.result,record.retryAt-Date.now());
    }
  }
  let infected=0;const manifest=[],deadline=Date.now()+240000;
  for(const file of files){
    if(Date.now()>deadline)throw Error('ClamAV release scan deadline exceeded');
    const saved=diagnosticFile(options.directory,file,engine);
    const bytes=await fetchBytes(file.url,MAX_ARTIFACT);
    if(bytes.length!==file.size||hash(bytes)!==file.digests.sha256)throw Error('Artifact size or SHA-256 mismatch');
    const reply=await scan('INSTREAM',bytes);
    if(/Heuristics\.(Limits|Encrypted|Broken)/i.test(reply)) {
      const checkedAt=Date.now();
      saveDiagnostic(options.directory,saved,{status:'inconclusive',name:target.packageName,version:target.version,filename:file.filename,sha256:file.digests.sha256,engine,result:reply,checkedAt,retryAt:checkedAt+INCONCLUSIVE_RETRY_MS});
      throw inconclusive(file,reply);
    }
    let detected;
    try { detected=verdict(reply); } catch { const error=Error('ClamAV scan unavailable for '+JSON.stringify(file.filename)+': '+reply);error.retryAfterMs=300000;throw error; }
    if(detected)infected++;
    manifest.push({filename:file.filename,sha256:file.digests.sha256,size:file.size,result:reply});
  }
  if(await scan('VERSION')!==engine)throw Error('ClamAV signatures changed during scan; retry complete release');
  const malware={schema:1,ecosystem:'PyPI',name:target.packageName,version:target.version,complete:true,engine,signatureAt,artifacts:files.length,infected,manifestHash:hash(JSON.stringify(manifest))};
  return {value:Math.round(infected/files.length*1000000),malware,observedAt:Math.floor(Date.now()/1000),evidence,evidenceHash:malware.manifestHash};
}
module.exports={collectMalware,verdict,command,download};
