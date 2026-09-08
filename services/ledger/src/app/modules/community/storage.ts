import { CommunityState, Round } from './policy';

export const legacyKey = Buffer.alloc(0);
export const layoutKey = Buffer.from('layout:v1');
export interface JsonStore<C> {
    has(ctx: C, key: Buffer): Promise<boolean>;
    get(ctx: C, key: Buffer): Promise<{json: string}>;
    set(ctx: C, key: Buffer, value: {json: string}): Promise<void>;
    del(ctx: C, key: Buffer): Promise<void>;
}
interface Layout { version: 1; governor: string; members: number; rounds: number; incidents: number; audit: number }
type StoredRound = Omit<Round, 'observations'> & { observationCount: number };
/** Numeric positions preserve canonical array order; IDs remain in the signed records. */
function records(state: CommunityState): Map<string, string> {
    const result = new Map<string, string>();
    const put = (key: string, value: unknown) => result.set(key, JSON.stringify(value));
    put('layout:v1', {version:1, governor:state.governor, members:state.members.length, rounds:state.rounds.length, incidents:state.incidents.length, audit:state.audit.length});
    state.members.forEach((m,i)=>put(`member:${i}`,m));
    state.rounds.forEach((r,i)=>{
        const {observations,...round}=r;
        put(`round:${i}`, {...round,observationCount:observations.length});
        observations.forEach((o,j)=>put(`observation:${i}:${j}`,o));
    });
    state.incidents.forEach((incident,i)=>put(`incident:${i}`,incident));
    state.audit.forEach((event,i)=>put(`audit:${i}`,event));
    return result;
}
export async function loadState<C>(store: JsonStore<C>, ctx: C): Promise<CommunityState> {
    if (!await store.has(ctx, layoutKey)) return JSON.parse((await store.get(ctx, legacyKey)).json) as CommunityState;
    const meta = JSON.parse((await store.get(ctx, layoutKey)).json) as Layout;
    if (meta.version !== 1) throw new Error('Unsupported community storage layout');
    const read = async <T>(key: string): Promise<T> => JSON.parse((await store.get(ctx, Buffer.from(key))).json) as T;
    const state: CommunityState = {governor:meta.governor,members:[],rounds:[],incidents:[],audit:[]};
    for(let i=0;i<meta.members;i+=1) state.members.push(await read(`member:${i}`));
    for(let i=0;i<meta.rounds;i+=1){
        const {observationCount,...r}=await read<StoredRound>(`round:${i}`);
        const round: Round={...r,observations:[]};
        for(let j=0;j<observationCount;j+=1)round.observations.push(await read(`observation:${i}:${j}`));
        state.rounds.push(round);
    }
    for(let i=0;i<meta.incidents;i+=1)state.incidents.push(await read(`incident:${i}`));
    for(let i=0;i<meta.audit;i+=1)state.audit.push(await read(`audit:${i}`));
    return state;
}
export async function saveState<C>(store: JsonStore<C>, ctx: C, previous: CommunityState, next: CommunityState): Promise<void> {
    if(!await store.has(ctx,layoutKey)){
        await store.set(ctx,legacyKey,{json:JSON.stringify(next)});
        return;
    }
    const oldRecords=records(previous);const newRecords=records(next);
    for(const key of oldRecords.keys())if(!newRecords.has(key))throw new Error('Community history must not be deleted');
    for(const [key,json] of newRecords)if(oldRecords.get(key)!==json)await store.set(ctx,Buffer.from(key),{json});
}
/** Called inside a block's atomic state transition at the agreed activation height. */
export async function migrateState<C>(store: JsonStore<C>,ctx: C): Promise<boolean>{
    if(await store.has(ctx,layoutKey))return false;
    const state=await loadState(store,ctx);
    for(const [key,json] of records(state))await store.set(ctx,Buffer.from(key),{json});
    await store.del(ctx,legacyKey);
    return true;
}
