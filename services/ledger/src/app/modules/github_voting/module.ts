import { Modules, cryptography } from 'klayr-sdk';
import { ValidatorsMethod } from 'klayr-framework/dist-node/modules/validators';
import { ValidatorStore } from 'klayr-framework/dist-node/modules/pos/stores/validator';
import { PoSModule } from 'klayr-framework/dist-node/modules/pos';
import { VotingState, equalVoting, rotateCommittee, ROTATION_BLOCKS } from './policy';
import { VotingStore, key } from './store';
import { VotingEndpoint } from './endpoint';
import { RecordCommand } from './command';
import { VotingMethod } from './method';

const { address } = cryptography;
export class GithubVotingModule extends Modules.BaseModule {
    public get name() { return 'githubVoting'; }
    public method=new VotingMethod(this.stores,this.events);
    public endpoint=new VotingEndpoint(this.stores,this.offchainStores);
    private seats=4;
    private readonly pos: PoSModule;
    public async init(args: Modules.ModuleInitArgs) {
        return Promise.resolve().then(() => {
        if(args.genesisConfig.bftBatchSize<4)throw Error('GitHub rotation requires at least four consensus seats');
        this.seats=Math.min(4,args.genesisConfig.bftBatchSize);
        });
    }
    public constructor(governor: string, network: string, validators: ValidatorsMethod, pos: PoSModule) {
        super(); this.pos = pos; this.stores.register(VotingStore,new VotingStore(this.name,0));
        this.commands=[new RecordCommand(this.stores,this.events,governor,network,validators,pos)];
        const original=validators.setValidatorsParams.bind(validators);
        const originalAfter=pos.afterTransactionsExecute.bind(pos);
        // Use the SDK's existing epoch transition and BFT handover, replacing
        // only selection/weight after an explicit on-chain activation.
        this.pos.afterTransactionsExecute=async context=>{
            const ctx=context.getMethodContext(); const store=this.stores.get(VotingStore);
            if (!await store.has(ctx,key)) return originalAfter(context);
            // Retain SDK productivity, bans and stake bookkeeping, but suppress
            // its stake-based schedule. The real setter is called once below.
            const previous=await validators.getValidatorsParams(ctx);
            await originalAfter({...context,setNextValidators:()=>undefined});
            if (!await pos.method.isEndOfRound(ctx,context.header.height)) return undefined;
            const state=JSON.parse((await store.get(ctx,key)).json) as VotingState;
            const eligible: string[]=[];
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
