const fs = require('node:fs'), path = require('node:path');
const sources = ['github', 'libraries'];
class Credentials {
  constructor(directory) { fs.mkdirSync(directory,{recursive:true,mode:0o700});fs.chmodSync(directory,0o700);this.file=path.join(directory,'credentials.json'); }
  read() { return fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{}; }
  status() { const saved=this.read();return Object.fromEntries(sources.map(s=>[s,{configured:!!saved[s],check:saved[s+'Check']||null}])); }
  save(source,token) {
    if(!sources.includes(source)) throw Error('Unknown data source');
    if(typeof token!=='string'||token.length>1024|| (token && !/^[A-Za-z0-9_\-]+$/.test(token))) throw Error('Enter a valid API key');
    const saved=this.read();if(token)saved[source]=token;else delete saved[source];delete saved[source+'Check'];this.write(saved);return this.status();
  }
  write(saved){fs.writeFileSync(this.file+'.tmp',JSON.stringify(saved),{mode:0o600});fs.chmodSync(this.file+'.tmp',0o600);fs.renameSync(this.file+'.tmp',this.file);}
  async check(source) {
    if(!sources.includes(source))throw Error('Unknown data source');
    const saved=this.read(),token=saved[source];if(!token)throw Error('Save an API key first');
    let result;
    try {
      const url=source==='github'?'https://api.github.com/user':'https://libraries.io/api/github/pallets/flask?api_key='+encodeURIComponent(token);
      const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{'User-Agent':'TrustSECO',Accept:'application/json',...(source==='github'?{Authorization:'Bearer '+token}:{})}});
      if(!response.ok)result={ok:false,message:response.status===401?'Credential rejected':response.status===403||response.status===429?'Access denied or rate limited':'Service returned HTTP '+response.status};
      else {const data=await response.json();const valid=source==='github'?typeof data.login==='string':data.full_name?.toLowerCase()==='pallets/flask';result={ok:valid,message:valid?'Connection successful':'Unexpected service response'};}
    } catch {result={ok:false,message:'Could not reach the service; try again later'};}
    result.checkedAt=new Date().toISOString();
    const current=this.read();if(current[source]===token){current[source+'Check']=result;this.write(current);}return result;
  }
}
module.exports={Credentials};
