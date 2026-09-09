const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixedPeers}=require('../dist/app/common/fixed-peers');
test('fixed trust is explicit and hostnames resolve before reaching the SDK',async()=>{
 assert.equal(await fixedPeers(undefined,undefined),undefined);
 const calls=[];const peers=await fixedPeers('one:8000,two:8000,TWO:8000','one:8000',async host=>{calls.push(host);return {address:'172.22.0.2',family:4};});
 assert.deepEqual(calls,['two']);assert.deepEqual(peers,[{ip:'172.22.0.2',port:8000}]);
 await assert.rejects(fixedPeers('bad:8000',undefined,async()=>{throw Error('DNS unavailable');}),/DNS/);
});
test('the installed SDK excludes an explicitly fixed peer from IP bans',()=>{
 const {PeerBook}=require('@klayr/p2p/dist-node/peer_book/peer_book');
 const p={ipAddress:'172.22.0.2',port:8000,peerId:'172.22.0.2:8000'};
 const book=new PeerBook({secret:1,sanitizedPeerLists:{blacklistedIPs:[],seedPeers:[],fixedPeers:[p],whitelisted:[],previousPeers:[]}});
 try{book.addBannedPeer(p.peerId,1000);assert.equal(book.bannedIPs.has(p.ipAddress),false);book.addBannedPeer('172.22.0.9:8000',1000);assert.equal(book.bannedIPs.has('172.22.0.9'),true);}finally{book.cleanUpTimers();}
});
