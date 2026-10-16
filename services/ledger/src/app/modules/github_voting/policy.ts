import { createPublicKey, verify } from 'crypto';
import { cryptography } from 'klayr-sdk';
import { joinProof } from '../pilot/policy';

const { address, bls } = cryptography;

export interface Voter {
    enabled?: boolean;
    githubId: string; member: string; address: string; generatorKey: string; blsKey: string;
    eventId: string; payload: string; signature: string; height: number;
}
export interface VotingState { bootstrap: string[]; voters: Voter[]; queue?: string[]; lastRotationHeight?: number }

// Shapes of signed JSON at the protocol boundary. Existing runtime checks below
// remain authoritative; these types do not change admission or consensus rules.
export interface VotingEvent {
    id: string; kind: string; actor: string; network: string;
    githubId: string; member: string; accountCreatedAt: number; key: string;
    joinPayload: string; joinSignature: string; enabled: boolean;
}
export interface ValidatorBundle {
    generatorKey: string; blsKey: string; proofOfPossession: string; address: string;
}
export interface ValidatorJoin { validator: ValidatorBundle; validatorSignature: string }

export const MAX_VOTERS = 101;
export const ROTATION_BLOCKS = 16;
const check = (ok: unknown, message: string): void => { if (!ok) throw Error(message); };

/** GitHub is checked by the admission service, never during deterministic block execution. */
export function validateRegistration(state: VotingState, payload: string, signature: string, governor: string, network: string, at: number, height: number): Voter {
    check(typeof payload === 'string' && Buffer.byteLength(payload) <= 12000, 'Invalid registration payload');
    const e = JSON.parse(payload) as VotingEvent;
    check(e.kind === 'register-validator' && e.actor === 'governor' && e.network === network, 'Wrong validator admission domain');
    check(typeof e.id === 'string' && e.id.length > 0 && e.id.length <= 200, 'Invalid event ID');
    check(verify(null, Buffer.from(`TrustSECO-community-v1\n${  payload}`), governor, Buffer.from(signature, 'base64')), 'Invalid admission signature');
    check(/^[1-9][0-9]{0,19}$/.test(e.githubId), 'Numeric GitHub ID required');
    check(/^[a-z0-9][a-z0-9-]{0,38}$/.test(e.member) && !['governor','constructor','prototype'].includes(e.member), 'Invalid GitHub login');
    check(Number.isSafeInteger(e.accountCreatedAt) && e.accountCreatedAt >= 0 && e.accountCreatedAt <= at - 180 * 86400, 'GitHub account must be 180 days old');
    check(createPublicKey(e.key).asymmetricKeyType === 'ed25519', 'Ed25519 identity required');
    joinProof(e.joinPayload, e.joinSignature, e.key, network, e.member, at);
    const join = JSON.parse(e.joinPayload) as ValidatorJoin;
    const bundle = join.validator;
    check(bundle && /^[a-f0-9]{64}$/.test(bundle.generatorKey) && /^[a-f0-9]{96}$/.test(bundle.blsKey) && /^[a-f0-9]{192}$/.test(bundle.proofOfPossession), 'Invalid validator bundle');
    check(bls.popVerify(Buffer.from(bundle.blsKey, 'hex'), Buffer.from(bundle.proofOfPossession, 'hex')), 'Invalid BLS proof');
    const validatorAddress = address.getKlayr32AddressFromPublicKey(Buffer.from(bundle.generatorKey, 'hex'));
    check(bundle.address === validatorAddress, 'Validator address mismatch');
    const generator = createPublicKey({key:{kty:'OKP',crv:'Ed25519',x:Buffer.from(bundle.generatorKey,'hex').toString('base64url')},format:'jwk'});
    const binding = JSON.stringify({network,login:e.member,publicKey:e.key,validator:bundle});
    check(verify(null, Buffer.from(`TrustSECO-validator-binding-v1\n${binding}`), generator, Buffer.from(join.validatorSignature,'base64')), 'Invalid generator ownership proof');
    check(state.bootstrap.length + state.voters.length < MAX_VOTERS, 'Voting network capacity reached');
    check(!state.bootstrap.includes(validatorAddress) && !state.voters.some(v => v.githubId === e.githubId || v.address === validatorAddress || v.generatorKey === bundle.generatorKey || v.blsKey === bundle.blsKey || v.eventId === e.id), 'GitHub account or validator already registered');
    return {githubId:e.githubId, member:e.member, address:validatorAddress, generatorKey:bundle.generatorKey, blsKey:bundle.blsKey, eventId:e.id, payload, signature, height};
}

export function equalVoting(addresses: string[]) {
    check(addresses.length > 0 && addresses.length <= MAX_VOTERS && new Set(addresses).size === addresses.length, 'Invalid voting set');
    return {threshold: BigInt(Math.floor(2 * addresses.length / 3) + 1), validators: addresses.map(a => ({address:address.getAddressFromKlayr32Address(a),bftWeight:BigInt(1)})).sort((a,b)=>Buffer.compare(a.address,b.address))};
}

/** Ordered on-chain queue: a new identity joins the tail, never buys a preferred seat. */
export function rotateCommittee(queue: string[], seats: number, rotate: boolean) {
    check(Number.isSafeInteger(seats) && seats >= 4 && seats <= MAX_VOTERS, 'Invalid seat count');
    check(queue.length <= MAX_VOTERS && new Set(queue).size === queue.length, 'Invalid rotation queue');
    const next = [...queue];
    if (rotate && next.length > seats) next.push(next.shift()!);
    // Do not silently lower quorum when the eligible pool cannot fill the committee.
    return {queue:next, committee:next.length >= seats ? next.slice(0,seats) : null};
}

export function validateAvailability(state: VotingState, payload: string, signature: string, network: string) {
    const e=JSON.parse(payload) as VotingEvent; const voter=state.voters.find(v=>v.member===e.actor);
    check(e.kind==='validator-availability' && e.network===network && typeof e.enabled==='boolean' && voter, 'Invalid validator availability');
    const identity=(JSON.parse(voter!.payload) as VotingEvent).key;
    check(verify(null,Buffer.from(`TrustSECO-community-v1\n${payload}`),identity,Buffer.from(signature,'base64')), 'Invalid validator signature');
    return {voter:voter!,enabled:e.enabled};
}
