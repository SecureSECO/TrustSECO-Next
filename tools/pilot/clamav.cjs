// Exact PyPI release artifacts are downloaded as data and streamed to a private clamd.
// Nothing is installed or executed. Each observer performs its own collection.
const crypto = require('node:crypto');
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
async function collectMalware(target, request, scan = command, fetchBytes = download) {
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
  let infected=0;const manifest=[],deadline=Date.now()+240000;
  for(const file of files){
    if(Date.now()>deadline)throw Error('ClamAV release scan deadline exceeded');
    const bytes=await fetchBytes(file.url,MAX_ARTIFACT);
    if(bytes.length!==file.size||hash(bytes)!==file.digests.sha256)throw Error('Artifact size or SHA-256 mismatch');
    const reply=await scan('INSTREAM',bytes),detected=verdict(reply);if(detected)infected++;
    manifest.push({filename:file.filename,sha256:file.digests.sha256,size:file.size,result:reply});
  }
  if(await scan('VERSION')!==engine)throw Error('ClamAV signatures changed during scan; retry complete release');
  const malware={schema:1,ecosystem:'PyPI',name:target.packageName,version:target.version,complete:true,engine,signatureAt,artifacts:files.length,infected,manifestHash:hash(JSON.stringify(manifest))};
  return {value:Math.round(infected/files.length*1000000),malware,observedAt:Math.floor(Date.now()/1000),evidence,evidenceHash:malware.manifestHash};
}
module.exports={collectMalware,verdict,command,download};
