import fs from 'fs';
import path from 'path';
const tools = fs.existsSync(path.join(__dirname, '../tools/pilot/collection-plan.cjs')) ? path.join(__dirname, '../tools/pilot') : path.join(__dirname, '../../../tools/pilot');
const { summary } = require(path.join(tools, 'collection-plan.cjs'));
export function queuedPackages(network: string) {
    const file = process.env.PILOT_PACKAGE_QUEUE_FILE;
    if (!file || !fs.existsSync(file)) return [];
    const queue = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (queue.network !== network || !Array.isArray(queue.packages) || queue.packages.length > 500) throw Error('Invalid package queue');
    return queue.packages;
}
export function queueStatus(state: any) {
    if (state.policy?.collection === 'scheduled-v1') return summary(state, state.catalog || []);
    const entries = (state.catalog || []).map((p: any) => {
        const r = state.rounds.find((r: any) => r.id === p.roundID);
        return {repository:p.repository, version:p.version, state: !r ? 'queued' : !r.closed ? 'collecting' : r.result.status === 'verified' ? 'verified' : r.result.status};
    });
    return {entries, ...(state.policy?.assignment === 'availability-beacon-v1' ? {availableContributors:state.availableContributors, waitingForContributors:state.availableContributors < 3} : {}), queued:entries.filter((e: any)=>e.state==='queued').length, collecting:entries.filter((e: any)=>e.state==='collecting').length, verified:entries.filter((e: any)=>e.state==='verified').length};
}
