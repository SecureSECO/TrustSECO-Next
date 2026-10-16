import { Modules, Types } from 'klayr-sdk';
import { VotingState } from './policy';
import { VotingStore, key, receiptKey } from './store';

export class VotingEndpoint extends Modules.BaseEndpoint {
    public async event(c: Types.ModuleEndpointContext) {
        const {id} = c.params;
        if (typeof id!=='string' || !id.length || id.length>2000) throw Error('Event ID required');
        const store=this.stores.get(VotingStore); const k=receiptKey(id);
        return {event:await store.has(c,k)?JSON.parse((await store.get(c,k)).json) as Record<string, unknown>:null};
    }
    public async status(c: Types.ModuleEndpointContext) {
        const store = this.stores.get(VotingStore);
        return await store.has(c,key) ? {active:true,...(JSON.parse((await store.get(c,key)).json) as VotingState)} : {active:false,bootstrap:[],voters:[]};
    }
}
