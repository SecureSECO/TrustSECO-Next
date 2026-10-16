import { verify } from 'crypto';
import { Modules, StateMachine , cryptography } from 'klayr-sdk';
import { ValidatorsMethod } from 'klayr-framework/dist-node/modules/validators';
import { ValidatorStore } from 'klayr-framework/dist-node/modules/pos/stores/validator';
import { NameStore } from 'klayr-framework/dist-node/modules/pos/stores/name';
import { VotingEvent, ValidatorJoin, VotingState, validateRegistration, equalVoting, validateAvailability } from './policy';

import { VotingStore, key, receiptKey } from './store';

const { address } = cryptography;
export class RecordCommand extends Modules.BaseCommand {
    public schema = {$id:'/githubVoting/record',type:'object',required:['payload','signature'],properties:{payload:{dataType:'string',fieldNumber:1,maxLength:12000},signature:{dataType:'string',fieldNumber:2,maxLength:256}}};
    public constructor(stores: Modules.NamedRegistry, events: Modules.NamedRegistry, private readonly governor: string, private readonly network: string, private readonly validators: ValidatorsMethod, private readonly pos: Modules.BaseModule) { super(stores,events); }
    private async validate(c: StateMachine.CommandVerifyContext<{payload: string;signature: string}> | StateMachine.CommandExecuteContext<{payload: string;signature: string}>) {
        const {payload,signature}=c.params; const e=JSON.parse(payload) as VotingEvent; const store=this.stores.get(VotingStore);
        if (typeof e.id!=='string' || !e.id.length || e.id.length>200) throw Error('Invalid event ID');
        if (await store.has(c,receiptKey(e.id))) throw Error('Duplicate voting event');
        if (e.kind === 'activate-github-voting') {
            if (e.actor!=='governor' || e.network!==this.network || !verify(null,Buffer.from(`TrustSECO-community-v1\n${payload}`),this.governor,Buffer.from(signature,'base64'))) throw Error('Invalid voting activation');
            if (await store.has(c,key)) throw Error('GitHub voting already active');
            if (typeof e.id!=='string' || !e.id.length || e.id.length>200) throw Error('Invalid event ID');
            return null;
        }
        if (!await store.has(c,key)) throw Error('GitHub voting is not activated');
        const state=JSON.parse((await store.get(c,key)).json) as VotingState;
        if (e.kind==='validator-availability') return validateAvailability(state,payload,signature,this.network);
        const voter=validateRegistration(state,payload,signature,this.governor,this.network,c.header.timestamp,c.header.height);
        if (await this.pos.stores.get(ValidatorStore).has(c,address.getAddressFromKlayr32Address(voter.address))) throw Error('Validator address already exists');
        if (await this.pos.stores.get(NameStore).has(c,Buffer.from(`gh_${voter.githubId}`))) throw Error('Validator name already exists');
        return voter;
    }
    public async verify(c: StateMachine.CommandVerifyContext<{payload: string;signature: string}>) { await this.validate(c); return {status:StateMachine.VerifyStatus.OK}; }
    public async execute(c: StateMachine.CommandExecuteContext<{payload: string;signature: string}>) {
        const voter=await this.validate(c); const store=this.stores.get(VotingStore);
        const event=JSON.parse(c.params.payload) as VotingEvent;
        await store.set(c,receiptKey(event.id),{json:JSON.stringify({...c.params,id:event.id,kind:event.kind,height:c.header.height,at:c.header.timestamp})});
        if (!voter) {
            const current=await this.validators.getValidatorsParams(c.getMethodContext());
            const bootstrap=current.validators.map(v=>address.getKlayr32AddressFromAddress(v.address));
            equalVoting(bootstrap);
            await store.set(c,key,{json:JSON.stringify({bootstrap,voters:[],queue:bootstrap,lastRotationHeight:c.header.height,activation:{...c.params,eventId:event.id,height:c.header.height}})});
            return;
        }
        const state=JSON.parse((await store.get(c,key)).json) as VotingState;
        if ('enabled' in voter && 'voter' in voter) {
            const member=state.voters.find(v=>v.address===voter.voter.address)!;
            if((member.enabled!==false)===voter.enabled)return;
            member.enabled=voter.enabled;
            state.queue=(state.queue ?? [...state.bootstrap,...state.voters.map(v=>v.address)]).filter(a=>a!==member.address);
            if(voter.enabled)state.queue.push(member.address);
            await store.set(c,key,{json:JSON.stringify(state)});
            return;
        }
        const a=address.getAddressFromKlayr32Address(voter.address);
        const bundle=(JSON.parse(event.joinPayload) as ValidatorJoin).validator;
        await this.validators.registerValidatorKeys(c.getMethodContext(),a,Buffer.from(voter.blsKey,'hex'),Buffer.from(voter.generatorKey,'hex'),Buffer.from(bundle.proofOfPossession,'hex'));
        // Pinned Klayr 0.12.3 PoS bookkeeping: native rewards and misbehavior
        // accounting require an account even though GitHub voting is not stake weighted.
        await this.pos.stores.get(ValidatorStore).set(c,a,{name:`gh_${voter.githubId}`,totalStake:BigInt(0),selfStake:BigInt(0),lastGeneratedHeight:c.header.height,isBanned:false,reportMisbehaviorHeights:[],consecutiveMissedBlocks:0,commission:10000,lastCommissionIncreaseHeight:c.header.height,sharingCoefficients:[]});
        await this.pos.stores.get(NameStore).set(c,Buffer.from(`gh_${voter.githubId}`),{validatorAddress:a});
        state.voters.push(voter);
        state.queue=(state.queue ?? [...state.bootstrap,...state.voters.slice(0,-1).map(v=>v.address)]).concat(voter.address);
        await store.set(c,key,{json:JSON.stringify(state)});
    }
}
