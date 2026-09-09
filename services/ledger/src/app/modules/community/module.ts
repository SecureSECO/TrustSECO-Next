/* Internal store, endpoint and command form one module. */
/* eslint-disable class-methods-use-this, @typescript-eslint/member-ordering, max-classes-per-file */
import { Modules, StateMachine, Types } from 'klayr-sdk';
import { applyEvent, initialState, view } from './policy';
import { loadState, saveState, migrateState, layoutKey } from './storage';

const index = Buffer.alloc(0);
class CommunityStore extends Modules.BaseStore<{ json: string }> {
    public schema = { $id: '/community/store', type: 'object', required: ['json'], properties: { json: { dataType: 'string', fieldNumber: 1 } } };
}
class RecordCommand extends Modules.BaseCommand {
    public schema = { $id: '/community/record', type: 'object', required: ['payload', 'signature'], properties: { payload: { dataType: 'string', fieldNumber: 1, maxLength: 12000 }, signature: { dataType: 'string', fieldNumber: 2, maxLength: 256 } } };
    public async verify(context: StateMachine.CommandVerifyContext<{payload: string; signature: string}>): Promise<StateMachine.VerificationResult> {
        // Full state-dependent validation runs again during execution in canonical transaction order.
        const state = await loadState(this.stores.get(CommunityStore), context);
        applyEvent(state, context.params.payload, context.params.signature, context.header.timestamp, context.header.height);
        return { status: StateMachine.VerifyStatus.OK };
    }
    public async execute(context: StateMachine.CommandExecuteContext<{payload: string; signature: string}>): Promise<void> {
        const store = this.stores.get(CommunityStore); const state = await loadState(store, context);
        const next = applyEvent(state, context.params.payload, context.params.signature, context.header.timestamp, context.header.height);
        await saveState(store, context, state, next);
    }
}
class CommunityEndpoint extends Modules.BaseEndpoint {
    public async snapshot(context: Types.ModuleEndpointContext) {
        const state = await loadState(this.stores.get(CommunityStore), context);
        return { ...view(state, context.header.timestamp), storageLayout: await this.stores.get(CommunityStore).has(context, layoutKey) ? 'individual-records-v1' : 'legacy-json' };
    }
}
class CommunityMethod extends Modules.BaseMethod {}
export class CommunityModule extends Modules.BaseModule {
    public method = new CommunityMethod(this.stores, this.events);
    public endpoint = new CommunityEndpoint(this.stores, this.offchainStores);
    public commands = [new RecordCommand(this.stores, this.events)];
    public constructor(private readonly governor: string, private readonly storageHeight = 0) { super(); this.stores.register(CommunityStore, new CommunityStore(this.name, 0)); }
    public async afterTransactionsExecute(context: StateMachine.BlockAfterExecuteContext): Promise<void> {
        if (this.storageHeight > 0 && context.header.height === this.storageHeight) {
            await migrateState(this.stores.get(CommunityStore), context);
        }
    }
    public metadata(): Modules.ModuleMetadata { return { endpoints: [{ name: 'snapshot' }], commands: this.commands.map(c => ({name: c.name, params: c.schema})), events: [], assets: [], stores: [] }; }
    public async initGenesisState(context: StateMachine.GenesisBlockExecuteContext): Promise<void> {
        await this.stores.get(CommunityStore).set(context, index, {json: JSON.stringify(initialState(this.governor))});
    }
}
