import { CVSS30, CVSS31, CVSS40 } from '@pandatix/js-cvss';
import policy = require('./policy.json');

export { policy };
/** Equivalent spelling in existing Libraries.io queue entries, not a registry remapping. */
export function canonicalEcosystem(value: string): string {
	return value.toLowerCase() === 'pypi' ? 'PyPI' : value;
}
export interface Advisory {
	id: string;
	aliases: string[];
	severity: string;
	score: number | null;
	vector: string | null;
	scoreVersion: string | null;
	kev: boolean;
}
export interface SecuritySnapshot {
	schema: 1;
	ecosystem: string;
	name: string;
	version: string;
	complete: true;
	advisories: Advisory[];
}
export interface Fact {
	metric: string;
	value: number;
	at: number;
}
export interface Frame {
	at: number;
	facts: Fact[];
	security?: SecuritySnapshot;
	securityAt?: number;
	correction?: boolean;
	blocked?: boolean;
}
function assert(ok: unknown, message: string): asserts ok {
	if (!ok) throw new Error(message);
}
function compareIds(a: string, b: string): number {
	if (a === b) return 0;
	return a < b ? -1 : 1;
}
/** Fail closed. Provenance and exact round target are checked by the caller. */
export function validateSecurity(input: unknown): SecuritySnapshot {
	const s = input as SecuritySnapshot;
	assert(
		s &&
			s.schema === 1 &&
			(s.complete as unknown) === true &&
			typeof s.ecosystem === 'string' &&
			typeof s.name === 'string' &&
			typeof s.version === 'string',
		'Complete security snapshot with exact package target required',
	);
	assert(
		s.ecosystem.length > 0 &&
			s.ecosystem.length <= 40 &&
			s.name.length > 0 &&
			s.name.length <= 200 &&
			s.version.length > 0 &&
			s.version !== 'latest',
		'Invalid security target',
	);
	assert(
		Array.isArray(s.advisories) && s.advisories.length <= 100,
		'Security snapshot exceeds bound; never truncate',
	);
	const seen = new Set<string>();
	const advisories = s.advisories
		.map(v => {
			assert(
				v &&
					typeof v.id === 'string' &&
					/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(v.id) &&
					Array.isArray(v.aliases) &&
					v.aliases.length <= 20 &&
					typeof v.kev === 'boolean',
				'Invalid advisory',
			);
			const aliases = [...new Set([v.id, ...v.aliases])].sort(compareIds);
			for (const id of aliases) {
				assert(
					typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(id) && !seen.has(id),
					'Duplicate advisory or alias',
				);
				seen.add(id);
			}
			assert(
				v.severity === 'unknown' || policy.severity.some(b => b.name === v.severity),
				'Invalid severity',
			);
			assert(
				v.score === null ||
					(Number.isFinite(v.score) &&
						v.score >= 0 &&
						v.score <= 10 &&
						Number.isInteger(v.score * 10)),
				'Invalid CVSS score',
			);
			if (v.score !== null)
				assert(
					policy.severity.some(
						b => b.name === v.severity && v.score !== null && v.score >= b.min && v.score <= b.max,
					),
					'CVSS score and severity mismatch',
				);
			assert(
				v.vector === null ||
					(typeof v.vector === 'string' && v.vector.length <= 300 && /^CVSS:[34]\./.test(v.vector)),
				'Invalid CVSS vector',
			);
			assert(
				v.scoreVersion === null || ['3.0', '3.1', '4.0'].includes(v.scoreVersion),
				'Unsupported CVSS version',
			);
			if (v.score !== null) {
				assert(
					v.vector !== null &&
						v.scoreVersion !== null &&
						v.vector.startsWith(`CVSS:${v.scoreVersion}/`),
					'CVSS vector and version required',
				);
				let calculated: number;
				if (v.scoreVersion === '4.0') calculated = new CVSS40(v.vector).Score();
				else if (v.scoreVersion === '3.1') calculated = new CVSS31(v.vector).BaseScore();
				else calculated = new CVSS30(v.vector).BaseScore();
				assert(calculated === v.score, 'CVSS vector and score mismatch');
			} else
				assert(
					v.severity === 'unknown' && v.vector === null && v.scoreVersion === null,
					'Unscored advisory must have unknown severity',
				);
			return {
				id: v.id,
				aliases,
				severity: v.severity,
				score: v.score,
				vector: v.vector,
				scoreVersion: v.scoreVersion,
				kev: v.kev,
			};
		})
		.sort((a, b) => compareIds(a.id, b.id));
	return {
		schema: 1,
		ecosystem: canonicalEcosystem(s.ecosystem),
		name: s.name,
		version: s.version,
		complete: true,
		advisories,
	};
}
export function normalize(x: number, reference: number, lower = false): number {
	assert(
		Number.isFinite(x) && x >= 0 && Number.isFinite(reference) && reference > 0,
		'Invalid normalized input',
	);
	return lower ? reference / (reference + x) : x / (reference + x);
}
export function assess(frame: Frame) {
	const contributions = policy.features.map(f => {
		const fact = frame.facts.find(x => x.metric === f.metric);
		const present =
			!!fact &&
			Number.isFinite(fact.value) &&
			fact.value >= 0 &&
			fact.at <= frame.at &&
			frame.at - fact.at <= policy.freshnessSeconds;
		let value = present ? fact.value / ('scale' in f ? Number(f.scale) : 1) : null;
		if (value !== null && f.direction.startsWith('age-'))
			value = value <= frame.at ? frame.at - value : null;
		const normalized =
			value === null ? null : normalize(value, f.reference, f.direction.endsWith('lower'));
		return {
			...f,
			value,
			normalized,
			contribution: normalized === null ? null : 100 * f.weight * normalized,
		};
	});
	const coverage = contributions.reduce(
		(sum, f) => sum + (f.normalized === null ? 0 : f.weight),
		0,
	);
	const baselineLower = contributions.reduce((sum, f) => sum + (f.contribution ?? 0), 0);
	const baselineUpper = Math.min(100, baselineLower + 100 * (1 - coverage));
	const freshSecurity =
		frame.security &&
		frame.securityAt !== undefined &&
		frame.securityAt <= frame.at &&
		frame.at - frame.securityAt <= policy.freshnessSeconds;
	const security = freshSecurity ? frame.security : undefined;
	let multiplier = 1;
	let ceiling = 100;
	let unknown = false;
	for (const v of security?.advisories ?? []) {
		const band = policy.severity.find(b => b.name === v.severity);
		if (!band) unknown = true;
		else {
			multiplier *= band.multiplier;
			ceiling = Math.min(ceiling, band.ceiling);
		}
		if (v.kev) ceiling = Math.min(ceiling, policy.knownExploitedCeiling);
	}
	const reasons: string[] = [];
	if (!security) reasons.push('Security evidence missing or stale');
	if (unknown) reasons.push('An applicable advisory has unknown severity');
	if (coverage + 1e-9 < policy.minimumCoverage)
		reasons.push('Insufficient fresh positive evidence');
	if (frame.blocked) reasons.push('Newer evidence is pending, disputed or unfinalized');
	// A partial baseline is a lower bound, never renormalized into a complete score.
	const target = reasons.length ? null : Math.min(baselineLower * multiplier, ceiling);
	return {
		policyVersion: policy.version,
		target,
		baselineLower,
		baselineUpper,
		coverage,
		multiplier,
		ceiling,
		contributions,
		reasons,
		advisories: security?.advisories ?? [],
		securityFresh: !!security,
		factTypeCount: contributions.filter(f => f.normalized !== null).length,
		totalFactTypes: policy.features.length,
		measurementCount: frame.facts.length,
	};
}
/** One project history across versions. Only fresh supported intervals earn recovery. */
export function recover(frames: Frame[]) {
	let score: number | null = null;
	let previous: Frame | undefined;
	let previousValid = false;
	let goodSeconds = 0;
	for (const frame of frames) {
		if (previous && frame.at < previous.at)
			throw new Error('Scoring history must be chronological');
		const a = assess(frame);
		const delta = previous ? frame.at - previous.at : 0;
		// Credit only the part of the interval supported by the previous snapshot.
		// Irrelevant metrics cannot shorten recovery; expired coverage cannot earn time.
		let supportedUntil = previous?.at ?? frame.at;
		if (previousValid && previous?.securityAt !== undefined) {
			const expiries = previous.facts
				.filter(f => policy.features.some(p => p.metric === f.metric))
				.map(f => f.at + policy.freshnessSeconds);
			expiries.push(previous.securityAt + policy.freshnessSeconds);
			for (const end of [...new Set(expiries)].sort((left, right) => left - right)) {
				if (end < previous.at) continue;
				if (assess({ ...previous, at: end }).target === null) break;
				supportedUntil = end;
				if (assess({ ...previous, at: end + 1 }).target === null) break;
			}
		}
		const earned =
			a.target !== null && previous
				? Math.max(0, Math.min(delta, supportedUntil - previous.at))
				: 0;
		if (a.target !== null) {
			goodSeconds += earned;
			if (score === null && goodSeconds >= policy.historySeconds) score = a.target;
			else if (score !== null)
				score =
					a.target <= score || frame.correction
						? a.target
						: Math.min(a.target, score + (policy.recoveryPointsPerDay * earned) / 86400);
		} else if (score !== null) {
			// Keep memory of the worst known ceiling through data loss and release changes.
			score = Math.min(score, a.ceiling, a.baselineUpper * a.multiplier);
		}
		previous = frame;
		previousValid = a.target !== null;
	}
	const last = frames.length ? assess(frames[frames.length - 1]) : null;
	let status = 'assessed';
	if (!last || last.target === null) status = 'incomplete';
	else if (score === null) status = 'insufficient-history';
	else if (score + 1e-8 < last.target) status = 'recovering';
	return {
		...last,
		score: last?.target != null ? score : null,
		historySeconds: goodSeconds,
		historyRequiredSeconds: policy.historySeconds,
		status,
	};
}
