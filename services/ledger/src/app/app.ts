import { Application, Types } from 'klayr-sdk';
import { registerModules } from './modules';
import { registerPlugins } from './plugins';
import { seedPeers } from './common/seed-peers';
import { readFileSync } from 'fs';
import { PoSModule } from 'klayr-framework/dist-node/modules/pos';
import { GithubVotingModule } from './modules/github_voting/module';

export const getApplication = (config: Types.PartialApplicationConfig): Application => {
	const configuredPeers = (config.network?.seedPeers ?? []).map(peer => {
		if (!peer || typeof peer.ip !== 'string' || typeof peer.port !== 'number') {
			throw new Error('Each configured seed peer requires an IP/hostname and numeric port');
		}
		return { ip: peer.ip, port: peer.port };
	});
	const peers = seedPeers(configuredPeers, {
		profile: process.env.TRUSTSECO_NETWORK,
		nodeAddress: process.env.TRUSTSECO_NODE_ADDRESS,
		seedPeers: process.env.TRUSTSECO_SEED_PEERS,
	});
	const { app, method } = Application.defaultApplication({ ...config, network: { ...config.network, version: `${(config.network?.version ?? '1.0').split('.')[0]}.1`, seedPeers: peers } });

	registerModules(app);
	if (process.env.TRUSTSECO_PILOT === 'true') {
		const pos = app.getRegisteredModules().find(module => module.name === 'pos');
		if (!pos) throw Error('PoS module required for GitHub voting');
		app.registerModule(new GithubVotingModule(readFileSync(process.env.PILOT_GOVERNOR_FILE!, 'utf8'), process.env.PILOT_NETWORK!, method.validator, pos as PoSModule));
	}
	registerPlugins(app);

	return app;
};
