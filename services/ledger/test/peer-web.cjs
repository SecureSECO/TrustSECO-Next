const test=require('node:test'),assert=require('node:assert/strict');
const {install,webURL}=require('../peer-web.cjs');
test('web URLs are optional and reject executable schemes and credentials',()=>{
 for(const x of [undefined,'','javascript:alert(1)','http://example.org','https://user:pass@example.org','https://example.org/?token=secret'])assert.equal(webURL(x),null);
 assert.equal(webURL('https://node.example/interface/'),'https://node.example/interface/');
});
test('node-owned advertisements support arbitrary hosts, skip legacy peers, cache and remove disconnected nodes',async()=>{
 const old=process.env.TRUSTSECO_WEB_URL;process.env.TRUSTSECO_WEB_URL='https://any-node.example/';
 try{
 let peers=[{ipAddress:'192.0.2.1',port:8000,networkVersion:'1.1'},{ipAddress:'192.0.2.2',port:8000,networkVersion:'1.0'},{ipAddress:'192.0.2.3',port:8000,networkVersion:'1.1'}],calls=[],handler;
 const n={_endpoint:{},registerEndpoint:(name,fn)=>{handler=fn},_p2p:{getConnectedPeers:()=>peers,requestFromPeer:async(packet,id)=>{calls.push(id);return {data:Buffer.from(JSON.stringify({webURL:id.startsWith('192.0.2.1')?'https://node-six.example/':null}))}}}};install(n);
 assert.equal(JSON.parse(handler()).webURL,'https://any-node.example/');
 let view=await n._endpoint.getWebInterfaces();assert.equal(view.local.webURL,'https://any-node.example/');assert.deepEqual(view.peers.map(x=>x.webURL),['https://node-six.example/',null,null]);assert.equal(calls.length,2);
 await n._endpoint.getWebInterfaces();assert.equal(calls.length,2);
 peers=[];assert.deepEqual((await n._endpoint.getWebInterfaces()).peers,[]);
 }finally{if(old===undefined)delete process.env.TRUSTSECO_WEB_URL;else process.env.TRUSTSECO_WEB_URL=old}
});
test('SDK network 1.1 stays compatible with 1.0',()=>{
 const {validatePeerCompatibility}=require('@klayr/p2p/dist-node/utils/validate');const chainID=Buffer.from('8b7bb864','hex');
 for(const [a,b]of [['1.0','1.1'],['1.1','1.0'],['2.0','2.1'],['2.1','2.0']])assert.equal(validatePeerCompatibility({sharedState:{chainID,networkVersion:a}},{chainID,networkVersion:b}).success,true);
});
