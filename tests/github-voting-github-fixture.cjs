// Test preload ONLY. Production images/services never enable this fixture.
const fs=require('node:fs');
const realFetch=global.fetch;
global.fetch=async (url,options)=>{
  if(String(url).startsWith('https://api.github.com/users/reviewer')){
    const keys=String(url).includes('/ssh_signing_keys');
    return {ok:true,status:200,json:async()=>keys?[{key:fs.readFileSync('/fixtures/github-key.txt','utf8').trim()}]:{id:990001,login:'reviewer',type:'User',created_at:'2020-01-01T00:00:00Z'}};
  }
  return realFetch(url,options);
};
