import { verify, createHash } from 'crypto';
import { Modules, StateMachine, Types } from 'klayr-sdk';
import { address } from '@klayr/cryptography';
import { ValidatorsMethod } from 'klayr-framework/dist-node/modules/validators';
import { ValidatorStore } from 'klayr-framework/dist-node/modules/pos/stores/validator';
import { PoSModule } from 'klayr-framework/dist-node/modules/pos';
import { NameStore } from 'klayr-framework/dist-node/modules/pos/stores/name';
import { VotingState, validateRegistration, equalVoting, rotateCommittee, validateAvailability, ROTATION_BLOCKS } from './policy';

const key = Buffer.alloc(0);
const receiptKey = (id:string) => Buffer.from('receipt:'+createHash('sha256').update(id).digest('hex'));
class VotingStore extends Modules.BaseStore<{json:string}> {
    public schema = {$id:'/githubVoting/state',type:'object',required:['json'],properties:{json:{dataType:'string',fieldNumber:1}}};
}
class VotingEndpoint extends Modules.BaseEndpoint {
    public async event(c: Types.ModuleEndpointContext) {
        const id=c.params.id;
        if (typeof id!=='string' || !id.length || id.length>2000) throw Error('Event ID required');
        const store=this.stores.get(VotingStore), k=receiptKey(id);
        return {event:await store.has(c,k)?JSON.parse((await store.get(c,k)).json):null};
    }
    public async status(c: Types.ModuleEndpointContext) {
        const store = this.stores.get(VotingStore);
        return await store.has(c,key) ? {active:true,...JSON.parse((await store.get(c,key)).json)} : {active:false,bootstrap:[],voters:[]};
    }
}
class VotingMethod extends Modules.BaseMethod {}
class RecordCommand extends Modules.BaseCommand {
    public schema = {$id:'/githubVoting/record',type:'object',required:['payload','signature'],properties:{payload:{dataType:'string',fieldNumber:1,maxLength:12000},signature:{dataType:'string',fieldNumber:2,maxLength:256}}};
    public constructor(stores: Modules.NamedRegistry, events: Modules.NamedRegistry, private readonly governor: string, private readonly network: string, private readonly validators: ValidatorsMethod, private readonly pos: Modules.BaseModule) { super(stores,events); }
    private async validate(c: StateMachine.CommandVerifyContext<{payload:string;signature:string}> | StateMachine.CommandExecuteContext<{payload:string;signature:string}>) {
        const {payload,signature}=c.params, e=JSON.parse(payload), store=this.stores.get(VotingStore);
        if (typeof e.id!=='string' || !e.id.length || e.id.length>200) throw Error('Invalid event ID');
        if (await store.has(c,receiptKey(e.id))) throw Error('Duplicate voting event');
        if (e.kind === 'activate-github-voting') {
            if (e.actor!=='governor' || e.network!==this.network || !verify(null,Buffer.from('TrustSECO-community-v1\n'+payload),this.governor,Buffer.from(signature,'base64'))) throw Error('Invalid voting activation');
            if (await store.has(c,key)) throw Error('GitHub voting already active');
            if (typeof e.id!=='string' || !e.id.length || e.id.length>200) throw Error('Invalid event ID');
            return null;
        }
        if (!await store.has(c,key)) throw Error('GitHub voting is not activated');
        const state: VotingState=JSON.parse((await store.get(c,key)).json);
        if (e.kind==='validator-availability') return validateAvailability(state,payload,signature,this.network);
        const voter=validateRegistration(state,payload,signature,this.governor,this.network,c.header.timestamp,c.header.height);
        if (await this.pos.stores.get(ValidatorStore).has(c,address.getAddressFromKlayr32Address(voter.address))) throw Error('Validator address already exists');
        if (await this.pos.stores.get(NameStore).has(c,Buffer.from('gh_'+voter.githubId))) throw Error('Validator name already exists');
        return voter;
    }
    public async verify(c: StateMachine.CommandVerifyContext<{payload:string;signature:string}>) { await this.validate(c); return {status:StateMachine.VerifyStatus.OK}; }
    public async execute(c: StateMachine.CommandExecuteContext<{payload:string;signature:string}>) {
        const voter=await this.validate(c), store=this.stores.get(VotingStore);
        const event=JSON.parse(c.params.payload);
        await store.set(c,receiptKey(event.id),{json:JSON.stringify({...c.params,id:event.id,kind:event.kind,height:c.header.height,at:c.header.timestamp})});
        if (!voter) {
            const current=await this.validators.getValidatorsParams(c.getMethodContext());
            const bootstrap=current.validators.map(v=>address.getKlayr32AddressFromAddress(v.address));
            equalVoting(bootstrap);
            await store.set(c,key,{json:JSON.stringify({bootstrap,voters:[],queue:bootstrap,lastRotationHeight:c.header.height,activation:{...c.params,eventId:JSON.parse(c.params.payload).id,height:c.header.height}})});
            return;
        }
        const state: VotingState=JSON.parse((await store.get(c,key)).json);
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
        const bundle=JSON.parse(JSON.parse(c.params.payload).joinPayload).validator;
        await this.validators.registerValidatorKeys(c.getMethodContext(),a,Buffer.from(voter.blsKey,'hex'),Buffer.from(voter.generatorKey,'hex'),Buffer.from(bundle.proofOfPossession,'hex'));
        // Pinned Klayr 0.12.3 PoS bookkeeping: native rewards and misbehavior
        // accounting require an account even though GitHub voting is not stake weighted.
        await this.pos.stores.get(ValidatorStore).set(c,a,{name:'gh_'+voter.githubId,totalStake:BigInt(0),selfStake:BigInt(0),lastGeneratedHeight:c.header.height,isBanned:false,reportMisbehaviorHeights:[],consecutiveMissedBlocks:0,commission:10000,lastCommissionIncreaseHeight:c.header.height,sharingCoefficients:[]});
        await this.pos.stores.get(NameStore).set(c,Buffer.from('gh_'+voter.githubId),{validatorAddress:a});
        state.voters.push(voter);
        state.queue=(state.queue ?? [...state.bootstrap,...state.voters.slice(0,-1).map(v=>v.address)]).concat(voter.address);
        await store.set(c,key,{json:JSON.stringify(state)});
    }
}

export class GithubVotingModule extends Modules.BaseModule {
    public get name() { return 'githubVoting'; }
    public method=new VotingMethod(this.stores,this.events);
    public endpoint=new VotingEndpoint(this.stores,this.offchainStores);
    private seats=4;
    public async init(args: Modules.ModuleInitArgs) {
        if(args.genesisConfig.bftBatchSize<4)throw Error('GitHub rotation requires at least four consensus seats');
        this.seats=Math.min(4,args.genesisConfig.bftBatchSize);
    }
    public constructor(governor: string, network: string, validators: ValidatorsMethod, pos: PoSModule) {
        super(); this.stores.register(VotingStore,new VotingStore(this.name,0));
        this.commands=[new RecordCommand(this.stores,this.events,governor,network,validators,pos)];
        const original=validators.setValidatorsParams.bind(validators);
        const originalAfter=pos.afterTransactionsExecute.bind(pos);
        // Use the SDK's existing epoch transition and BFT handover, replacing
        // only selection/weight after an explicit on-chain activation.
        pos.afterTransactionsExecute=async context=>{
            const ctx=context.getMethodContext(), store=this.stores.get(VotingStore);
            if (!await store.has(ctx,key)) return originalAfter(context);
            // Retain SDK productivity, bans and stake bookkeeping, but suppress
            // its stake-based schedule. The real setter is called once below.
            const previous=await validators.getValidatorsParams(ctx);
            await originalAfter({...context,setNextValidators:()=>{}});
            if (!await pos.method.isEndOfRound(ctx,context.header.height)) return;
            const state:VotingState=JSON.parse((await store.get(ctx,key)).json);
            const eligible:string[]=[];
            for (const a of state.queue ?? [...state.bootstrap,...state.voters.filter(v=>v.enabled!==false).map(v=>v.address)]) {
                const account=await pos.stores.get(ValidatorStore).get(ctx,address.getAddressFromKlayr32Address(a));
                if (!account.isBanned) eligible.push(a);
            }
            const advance=context.header.height-(state.lastRotationHeight ?? 0)>=ROTATION_BLOCKS;
            const rotation=rotateCommittee(eligible,this.seats,advance);
            if(!rotation.committee) {
                // Preserve the previous threshold; insufficient participation must
                // not create a smaller committee that can finalize alone.
                return original(ctx,context,previous.preCommitThreshold,previous.certificateThreshold,previous.validators);
            }
            state.queue=rotation.queue;
            if(advance)state.lastRotationHeight=context.header.height;
            await store.set(ctx,key,{json:JSON.stringify(state)});
            const next=equalVoting(rotation.committee);
            return original(ctx,context,next.threshold,next.threshold,next.validators);
        };
    }
    public metadata(): Modules.ModuleMetadata { return {...this.baseMetadata(),endpoints:[{name:'status'},{name:'event'}]}; }
}
