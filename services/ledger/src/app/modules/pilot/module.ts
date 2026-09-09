/* eslint-disable max-classes-per-file, @typescript-eslint/member-ordering, class-methods-use-this */
import { Modules, StateMachine, Types } from 'klayr-sdk';
import { applyPilot, freshPilot, pilotView, settlePilot, verifiedInputs } from './policy';
import { initPilot, loadPilot, savePilot, recordedEvent, auditPage } from './storage';

class PilotStore extends Modules.BaseStore<{ json: string }> {
	public schema = {
		$id: '/pilot/store',
		type: 'object',
		required: ['json'],
		properties: { json: { dataType: 'string', fieldNumber: 1 } },
	};
}
class RecordCommand extends Modules.BaseCommand {
	public schema = {
		$id: '/pilot/record',
		type: 'object',
		required: ['payload', 'signature'],
		properties: {
			payload: { dataType: 'string', fieldNumber: 1, maxLength: 12000 },
			signature: { dataType: 'string', fieldNumber: 2, maxLength: 256 },
		},
	};
	public async verify(
		c: StateMachine.CommandVerifyContext<{ payload: string; signature: string }>,
	) {
		if (await recordedEvent(this.stores.get(PilotStore), c, (JSON.parse(c.params.payload) as {id: string}).id)) throw new Error('Duplicate event');
		applyPilot(
			await loadPilot(this.stores.get(PilotStore), c),
			c.params.payload,
			c.params.signature,
			c.header.timestamp,
			c.header.height,
		);
		return { status: StateMachine.VerifyStatus.OK };
	}
	public async execute(
		c: StateMachine.CommandExecuteContext<{ payload: string; signature: string }>,
	) {
		const store = this.stores.get(PilotStore);
		if (await recordedEvent(store, c, (JSON.parse(c.params.payload) as {id: string}).id)) throw new Error('Duplicate event');
		const old = await loadPilot(store, c);
		await savePilot(
			store,
			c,
			old,
			applyPilot(old, c.params.payload, c.params.signature, c.header.timestamp, c.header.height),
		);
	}
}
class PilotEndpoint extends Modules.BaseEndpoint {
	public async audit(c: Types.ModuleEndpointContext) { return auditPage(this.stores.get(PilotStore), c, c.params.before === undefined ? undefined : Number(c.params.before)); }
	public async event(c: Types.ModuleEndpointContext) { return {event: await recordedEvent(this.stores.get(PilotStore), c, c.params.id as string)}; }
	public async snapshot(c: Types.ModuleEndpointContext) {
		return pilotView(await loadPilot(this.stores.get(PilotStore), c), c.header.timestamp);
	}
	public async payouts(c: Types.ModuleEndpointContext) {
		const s = await loadPilot(this.stores.get(PilotStore), c);
		const before = c.params.before === undefined ? s.payouts.length + 1 : Number(c.params.before);
		if (!Number.isSafeInteger(before) || before < 1) throw new Error('Invalid cursor');
		const p = s.payouts
			.filter(x => Number(x.id) < before)
			.slice(-200)
			.reverse();
		return {
			payouts: p,
			nextCursor: p.length && Number(p[p.length - 1].id) > 1 ? p[p.length - 1].id : null,
			total: String(s.payouts.length),
			historicalBackfill: false,
		};
	}
	public async scoreInputs(c: Types.ModuleEndpointContext) {
		const { repository, version, finalizedHeight } = c.params;
		if (
			typeof repository !== 'string' ||
			typeof version !== 'string' ||
			!Number.isSafeInteger(finalizedHeight) ||
			Number(finalizedHeight) < 0 ||
			Number(finalizedHeight) > c.header.height
		)
			throw new Error('Invalid score request');
		return {
			facts: verifiedInputs(
				await loadPilot(this.stores.get(PilotStore), c),
				repository,
				version,
				Number(finalizedHeight),
			),
		};
	}
}
class PilotMethod extends Modules.BaseMethod {}
export class PilotModule extends Modules.BaseModule {
	public method = new PilotMethod(this.stores, this.events);
	public endpoint = new PilotEndpoint(this.stores, this.offchainStores);
	public commands = [new RecordCommand(this.stores, this.events)];
	public constructor(private readonly governor: string, private readonly network: string) {
		super();
		this.stores.register(PilotStore, new PilotStore(this.name, 0));
	}
	public metadata(): Modules.ModuleMetadata {
		return {
			endpoints: [{ name: 'audit' }, { name: 'event' }, { name: 'snapshot' }, { name: 'payouts' }, { name: 'scoreInputs' }],
			commands: this.commands.map(c => ({ name: c.name, params: c.schema })),
			events: [],
			assets: [],
			stores: [],
		};
	}
	public async initGenesisState(c: StateMachine.GenesisBlockExecuteContext) {
		await initPilot(this.stores.get(PilotStore), c, freshPilot(this.governor, this.network));
	}
	public async afterTransactionsExecute(c: StateMachine.BlockAfterExecuteContext) {
		const store = this.stores.get(PilotStore);
		const old = await loadPilot(store, c);
		await savePilot(store, c, old, settlePilot(old, c.header.timestamp, c.header.height));
	}
}
