/* Internal store, endpoint and command form one module. */
/* eslint-disable class-methods-use-this, @typescript-eslint/member-ordering, max-classes-per-file */
import { Modules, StateMachine, Types } from 'klayr-sdk';
import { applyEvent, initialState, view, CommunityState } from './policy';

const index = Buffer.alloc(0);
class CommunityStore extends Modules.BaseStore<{ json: string }> {
    public schema = { $id: '/community/store', type: 'object', required: ['json'], properties: { json: { dataType: 'string', fieldNumber: 1 } } };
}
class RecordCommand extends Modules.BaseCommand {
    public schema = { $id: '/community/record', type: 'object', required: ['payload', 'signature'], properties: { payload: { dataType: 'string', fieldNumber: 1, maxLength: 12000 }, signature: { dataType: 'string', fieldNumber: 2, maxLength: 256 } } };
    public async verify(context: StateMachine.CommandVerifyContext<{payload: string; signature: string}>): Promise<StateMachine.VerificationResult> {
        // Full state-dependent validation runs again during execution in canonical transaction order.
        const state = await this.stores.get(CommunityStore).get(context, index);
        applyEvent(JSON.parse(state.json) as CommunityState, context.params.payload, context.params.signature, context.header.timestamp, context.header.height);
        return { status: StateMachine.VerifyStatus.OK };
    }
    public async execute(context: StateMachine.CommandExecuteContext<{payload: string; signature: string}>): Promise<void> {
        const store = this.stores.get(CommunityStore); const state = await store.get(context, index);
        const next = applyEvent(JSON.parse(state.json) as CommunityState, context.params.payload, context.params.signature, context.header.timestamp, context.header.height);
        await store.set(context, index, {json: JSON.stringify(next)});
    }
}
class CommunityEndpoint extends Modules.BaseEndpoint {
    public async snapshot(context: Types.ModuleEndpointContext) {
        const state = await this.stores.get(CommunityStore).get(context, index);
        return view(JSON.parse(state.json) as CommunityState, context.header.timestamp);
    }
}
class CommunityMethod extends Modules.BaseMethod {}
export class CommunityModule extends Modules.BaseModule {
    public method = new CommunityMethod(this.stores, this.events);
    public endpoint = new CommunityEndpoint(this.stores, this.offchainStores);
    public commands = [new RecordCommand(this.stores, this.events)];
    public constructor(private readonly governor: string) { super(); this.stores.register(CommunityStore, new CommunityStore(this.name, 0)); }
    public metadata(): Modules.ModuleMetadata { return { endpoints: [{ name: 'snapshot' }], commands: this.commands.map(c => ({name: c.name, params: c.schema})), events: [], assets: [], stores: [] }; }
    public async initGenesisState(context: StateMachine.GenesisBlockExecuteContext): Promise<void> {
        await this.stores.get(CommunityStore).set(context, index, {json: JSON.stringify(initialState(this.governor))});
    }
}
