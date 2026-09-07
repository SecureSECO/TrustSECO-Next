import { Application, Types } from 'klayr-sdk';
import { registerModules } from './modules';
import { registerPlugins } from './plugins';
import { seedPeers } from './common/seed-peers';

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
	const { app } = Application.defaultApplication({ ...config, network: { ...config.network, seedPeers: peers } });

	registerModules(app);
	registerPlugins(app);

	return app;
};
