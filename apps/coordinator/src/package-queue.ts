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

// Local operator catalogue edit. Collection still uses the publisher's signed ledger events.
export function addQueuedPackage(network: string, body: any) {
    const file = process.env.PILOT_PACKAGE_QUEUE_FILE;
    if (!file || !fs.existsSync(file)) throw Error('Package queue is not configured on this node');
    const repository = String(body?.repository || '').trim().toLowerCase();
    const name = String(body?.name || '').trim();
    const rawPlatform = String(body?.platform || '').trim();
    const platform = rawPlatform.toLowerCase() === 'pypi' ? 'PyPI' : rawPlatform.toLowerCase() === 'npm' ? 'NPM' : rawPlatform;
    const version = String(body?.version || '').trim();
    if (!/^[a-z0-9][a-z0-9.-]{0,99}\/[a-z0-9_.-]{1,100}$/.test(repository) || repository.split('/').some(v => v === '.' || v === '..')) throw Error('Enter a GitHub repository as owner/repository');
    if (!version || version.length > 100 || /[\s\x00-\x1f]/.test(version) || version.toLowerCase() === 'latest') throw Error('Enter an exact package version');
    require(path.join(tools, 'libraries.cjs')).targetPath({packagePlatform: platform, packageName: name, version});
    const queue = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (queue.network !== network || !Array.isArray(queue.packages)) throw Error('Package queue does not match this network');
    const existing = queue.packages.find((p: any) => p.repository.toLowerCase() === repository && p.version === version);
    if (existing) {
        if (existing.platform.toLowerCase() !== platform.toLowerCase() || existing.name !== name) throw Error('This repository version already has a different registry mapping');
        return {package: existing, alreadyAdded: true};
    }
    if (queue.packages.length >= 500) throw Error('This node’s package queue has reached its 500-package limit');
    const entry = {repository, name, platform, version, cataloguedAt: new Date().toISOString()};
    queue.packages.push(entry);
    const temporary = file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(queue, null, 2) + '\n', {mode: 0o600});
    fs.renameSync(temporary, file);
    return {package: entry, alreadyAdded: false};
}
