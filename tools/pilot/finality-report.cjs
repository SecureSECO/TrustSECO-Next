// Read-only network diagnostic. Run with the ledger image's installed API client.
// Supply one RPC URL per validator; compare two reports to measure progress.
const {createWSClient}=require('@klayr/api-client');
const watchdog=setTimeout(()=>{console.error('Finality diagnostic timed out after 45 seconds');process.exit(1)},45000);
const clients=[];
(async()=>{
 const urls=process.argv.slice(2);
 if(!urls.length)throw Error('Supply validator RPC URLs');
 const nodes=await Promise.all(urls.map(async endpoint=>{
  try{
   const client=await createWSClient(endpoint);clients.push(client);
   const info=await client.node.getNodeInfo();
   const [peers,stats,block,generator,eligible]=await Promise.all([
    client.invoke('network_getConnectedPeers'),client.invoke('network_getStats'),
    client.invoke('chain_getLastBlock'),client.invoke('generator_getStatus'),
    client.invoke('pos_getValidatorsByStake',{limit:-1})]);
   return {client,endpoint,chainID:info.chainID,height:info.height,finalizedHeight:info.finalizedHeight,
    lagBlocks:info.height-info.finalizedHeight,syncing:info.syncing,tip:info.lastBlockID,
    peers:peers.length,peerBans:stats.banning,bftPrevotedHeight:block.header.maxHeightPrevoted,
    generators:generator.status.map(g=>({address:g.address,enabled:g.enabled,height:g.height})),
    validators:eligible.validators.map(v=>({name:v.name,address:v.address,lastGeneratedHeight:v.lastGeneratedHeight,isBanned:v.isBanned,consecutiveMissedBlocks:v.consecutiveMissedBlocks}))};
  }catch(error){return {endpoint,error:error.message}}
 }));
 const complete=nodes.every(n=>!n.error)&&new Set(nodes.map(n=>n.chainID)).size===1;
 const commonFinalizedHeight=complete?Math.min(...nodes.map(n=>n.finalizedHeight)):null;
 if(commonFinalizedHeight!==null){
  await Promise.all(nodes.map(async n=>{
   const block=await n.client.invoke('chain_getBlockByHeight',{height:commonFinalizedHeight});
   n.commonFinalizedBlockID=block.header.id;
  }));
 }
 console.log(JSON.stringify({at:new Date().toISOString(),complete,commonFinalizedHeight,
  sameFinalizedBlock:complete&&new Set(nodes.map(n=>n.commonFinalizedBlockID)).size===1,
  // Tips may differ by one block during collection; compare finalized IDs first.
  sameTip:complete&&new Set(nodes.map(n=>n.tip)).size===1,
  nodes:nodes.map(({client,...node})=>node)},null,2));
 if(!complete)process.exitCode=1;
})().catch(error=>{console.error(error.message);process.exitCode=1}).finally(async()=>{
 await Promise.allSettled(clients.map(c=>c.disconnect()));clearTimeout(watchdog);
});
