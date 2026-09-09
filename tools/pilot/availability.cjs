const network=require('./beacon-network.json');
const VERSION='availability-beacon-v1';
const LEASE_SECONDS=900;
async function assignmentEvent(state,identity) {
 if(state.policy?.assignment!==VERSION)return null;
 const lease=state.availability?.[identity.id];
 if(!lease||lease.until<=state.at+300)return {kind:'availability',until:state.at+LEASE_SECONDS};
 const finalized=state.ledger?.finalizedHeight;
 if(!Number.isSafeInteger(finalized))return null;
 for(const r of state.rounds){
  const a=r.assignment;
  if(r.closed||a?.version!==VERSION||a.seed||a.openedHeight>finalized||state.at<a.beaconTime||state.at>a.beaconDeadline)continue;
  let lastError;
  // Relays are replaceable transports. Consensus pins and verifies the actual network key.
  for(const origin of ['https://api.drand.sh','https://api2.drand.sh']){
   try{
    const response=await fetch(origin+'/'+network.hash+'/public/'+a.beaconRound,{redirect:'error',signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw Error('Randomness beacon is unavailable');
    const beacon=await response.json();
    if(beacon.round!==a.beaconRound||typeof beacon.signature!=='string'||!/^[a-f0-9]{96}$/.test(beacon.signature))throw Error('Unexpected randomness beacon response');
    return {kind:'assignment-beacon',round:r.id,beaconRound:a.beaconRound,beaconSignature:beacon.signature};
   }catch(e){lastError=e;}
  }
  throw Error('Waiting for the fixed randomness beacon; no replacement draw: '+lastError.message);
 }
 return null;
}
function canObserve(round,state,member){
 const a=round.assignment;
 return a?.version===VERSION&&a.assignedHeight!==null&&a.assignedHeight<=state.ledger?.finalizedHeight&&
  a.slots.some(slot=>!slot.replaced&&slot.member===member&&state.at>=slot.from&&state.at+45<slot.until);
}
module.exports={VERSION,LEASE_SECONDS,assignmentEvent,canObserve};
