import fs from 'fs';
export function queuedPackages(network: string) {
    const file = process.env.PILOT_PACKAGE_QUEUE_FILE;
    if (!file || !fs.existsSync(file)) return [];
    const queue = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (queue.network !== network || !Array.isArray(queue.packages) || queue.packages.length > 500) throw Error('Invalid package queue');
    return queue.packages;
}
export function queueStatus(state: any) {
    const entries = (state.catalog || []).map((p: any) => {
        const r = state.rounds.find((r: any) => r.id === p.roundID);
        return {repository:p.repository, version:p.version, state: !r ? 'queued' : !r.closed ? 'collecting' : r.result.status === 'verified' ? 'verified' : r.result.status};
    });
    return {entries, ...(state.policy?.assignment === 'availability-beacon-v1' ? {availableContributors:state.availableContributors, waitingForContributors:state.availableContributors < 3} : {}), queued:entries.filter((e: any)=>e.state==='queued').length, collecting:entries.filter((e: any)=>e.state==='collecting').length, verified:entries.filter((e: any)=>e.state==='verified').length};
}
