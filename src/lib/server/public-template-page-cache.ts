import { getCachedPublicData } from '$lib/server/public-discovery-cache';

export const PUBLIC_TEMPLATE_PAGE_AGGREGATE_FRESH_MS = 60_000;
export const PUBLIC_TEMPLATE_PAGE_ARGUMENT_CAP = 25;
export const PUBLIC_TEMPLATE_PAGE_AGGREGATE_MAX_BYTES = 640 * 1024;

type NullableCount = number | null;

export type PublicTemplatePageMessageMetrics = {
	districtCounts: Record<string, number>;
	totalDistricts: number;
};

export type PublicTemplatePagePositionMetrics = {
	counts: {
		support: NullableCount;
		oppose: NullableCount;
		districts: NullableCount;
	};
	engagement: {
		template_id: string;
		districts: Array<{
			district_code: string;
			support: number;
			oppose: number;
			total: number;
			support_percent: number;
		}>;
		aggregate: {
			total_districts: NullableCount;
			total_positions: NullableCount;
			total_support: NullableCount;
			total_oppose: NullableCount;
		};
	} | null;
};

export type PublicTemplatePageDebateSummary = {
	_id: string;
	_creationTime: number;
	templateId: string;
	debateIdOnchain: string | number | null;
	propositionText: string;
	propositionHash: string;
	actionDomain: string;
	deadline: number | string;
	jurisdictionSize: number;
	status: 'active' | 'resolving' | 'resolved' | 'awaiting_governance' | 'under_appeal';
	argumentCount: NullableCount;
	uniqueParticipants: NullableCount;
	totalStake: number;
	winningArgumentIndex: number | null;
	winningStance: string | null;
	resolvedAt: number | null;
	resolutionMethod: string | null;
	aiResolution: {
		source?: string;
		minerCount?: number;
		evaluatedAt?: string;
	} | null;
	aiSignatureCount: number | null;
	appealDeadline: number | null;
	governanceJustification: string | null;
	arguments: Array<{
		_id: string;
		_creationTime: number;
		argumentIndex: number;
		stance: 'SUPPORT' | 'OPPOSE' | 'AMEND';
		body: string;
		amendmentText: string | null;
		stakeAmount: number;
		engagementTier: number;
		weightedScore: number;
		totalStake: number;
		coSignCount: number | null;
		aiScores: {
			reasoning: number;
			accuracy: number;
			evidence: number;
			constructiveness: number;
			feasibility: number;
		} | null;
		aiWeighted: number | null;
		finalScore: number | null;
		modelAgreement: number | null;
	}>;
};

export type PublicTemplatePageAggregate = {
	templateId: string;
	messageMetrics: PublicTemplatePageMessageMetrics;
	debate: PublicTemplatePageDebateSummary | null;
	positionMetrics: PublicTemplatePagePositionMetrics;
};

function record(value: unknown, code: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`PUBLIC_TEMPLATE_PAGE_CACHE_INVALID:${code}`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new Error(`PUBLIC_TEMPLATE_PAGE_CACHE_INVALID:${code}-prototype`);
	}
	return value as Record<string, unknown>;
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[], code: string) {
	const allowed = new Set(allowedKeys);
	if (Object.keys(value).some((key) => !allowed.has(key))) {
		throw new Error(`PUBLIC_TEMPLATE_PAGE_CACHE_INVALID:${code}-unknown-key`);
	}
}

function boundedString(value: unknown, maximumBytes: number, code: string): string {
	if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > maximumBytes) {
		throw new Error(`PUBLIC_TEMPLATE_PAGE_CACHE_INVALID:${code}`);
	}
	return value;
}

function boundedIdentifier(value: unknown, maximumBytes: number, code: string): string {
	const identifier = boundedString(value, maximumBytes, code);
	if (identifier.length === 0) {
		throw new Error(`PUBLIC_TEMPLATE_PAGE_CACHE_INVALID:${code}`);
	}
	return identifier;
}

function optionalBoundedString(
	value: unknown,
	maximumBytes: number,
	code: string
): string | undefined {
	return value === undefined ? undefined : boundedString(value, maximumBytes, code);
}

function nullableBoundedString(value: unknown, maximumBytes: number, code: string): string | null {
	return value === null ? null : boundedString(value, maximumBytes, code);
}

function finiteNumber(value: unknown, code: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`PUBLIC_TEMPLATE_PAGE_CACHE_INVALID:${code}`);
	}
	return value;
}

function nonnegativeInteger(value: unknown, code: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new Error(`PUBLIC_TEMPLATE_PAGE_CACHE_INVALID:${code}`);
	}
	return value as number;
}

function nullableNonnegativeInteger(value: unknown, code: string): NullableCount {
	return value === null ? null : nonnegativeInteger(value, code);
}

function nullableFiniteNumber(value: unknown, code: string): number | null {
	return value === null ? null : finiteNumber(value, code);
}

function publicMessageMetrics(value: unknown, strict: boolean): PublicTemplatePageMessageMetrics {
	const metrics = record(value, 'message-metrics');
	if (strict) hasOnlyKeys(metrics, ['districtCounts', 'totalDistricts'], 'message-metrics');
	if (metrics.viewerDistrictCount !== undefined && metrics.viewerDistrictCount !== 0) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_CACHE_INVALID:viewer-message-metric');
	}
	const rawDistricts = record(metrics.districtCounts, 'message-districts');
	if (Object.keys(rawDistricts).length > 20) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_CACHE_INVALID:message-district-cap');
	}
	const districtCounts: Record<string, number> = {};
	for (const [district, count] of Object.entries(rawDistricts).sort(([a], [b]) =>
		a.localeCompare(b)
	)) {
		districtCounts[boundedString(district, 200, 'message-district')] = nonnegativeInteger(
			count,
			'message-count'
		);
	}
	return {
		districtCounts,
		totalDistricts: nonnegativeInteger(metrics.totalDistricts, 'message-total-districts')
	};
}

function publicAiScores(value: unknown, strict: boolean) {
	if (value === null || value === undefined) return null;
	const scores = record(value, 'argument-ai-scores');
	const keys = ['reasoning', 'accuracy', 'evidence', 'constructiveness', 'feasibility'] as const;
	if (strict) hasOnlyKeys(scores, keys, 'argument-ai-scores');
	return {
		reasoning: finiteNumber(scores.reasoning, 'argument-ai-reasoning'),
		accuracy: finiteNumber(scores.accuracy, 'argument-ai-accuracy'),
		evidence: finiteNumber(scores.evidence, 'argument-ai-evidence'),
		constructiveness: finiteNumber(scores.constructiveness, 'argument-ai-constructiveness'),
		feasibility: finiteNumber(scores.feasibility, 'argument-ai-feasibility')
	};
}

function publicDebateArgument(value: unknown, strict: boolean) {
	const argument = record(value, 'argument');
	const keys = [
		'_id',
		'_creationTime',
		'argumentIndex',
		'stance',
		'body',
		'amendmentText',
		'stakeAmount',
		'engagementTier',
		'weightedScore',
		'totalStake',
		'coSignCount',
		'aiScores',
		'aiWeighted',
		'finalScore',
		'modelAgreement'
	] as const;
	if (strict) hasOnlyKeys(argument, keys, 'argument');
	if (!['SUPPORT', 'OPPOSE', 'AMEND'].includes(String(argument.stance))) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_CACHE_INVALID:argument-stance');
	}
	return {
		_id: boundedIdentifier(argument._id, 128, 'argument-id'),
		_creationTime: finiteNumber(argument._creationTime, 'argument-created-at'),
		argumentIndex: nonnegativeInteger(argument.argumentIndex, 'argument-index'),
		stance: argument.stance as 'SUPPORT' | 'OPPOSE' | 'AMEND',
		// Convex constrains these fields by UTF-16 code units. Reserve four bytes
		// per code unit here so valid non-ASCII public arguments are not rejected
		// merely because the cache boundary measures serialized bytes.
		body: boundedString(argument.body, 32_000, 'argument-body'),
		amendmentText: nullableBoundedString(argument.amendmentText, 16_000, 'argument-amendment'),
		stakeAmount: finiteNumber(argument.stakeAmount, 'argument-stake'),
		engagementTier: nonnegativeInteger(argument.engagementTier, 'argument-tier'),
		weightedScore: finiteNumber(argument.weightedScore, 'argument-weighted-score'),
		totalStake: finiteNumber(argument.totalStake, 'argument-total-stake'),
		coSignCount: nullableNonnegativeInteger(argument.coSignCount, 'argument-cosign-count'),
		aiScores: publicAiScores(argument.aiScores, strict),
		aiWeighted: nullableFiniteNumber(argument.aiWeighted, 'argument-ai-weighted'),
		finalScore: nullableFiniteNumber(argument.finalScore, 'argument-final-score'),
		modelAgreement: nullableFiniteNumber(argument.modelAgreement, 'argument-model-agreement')
	};
}

function publicAiResolution(value: unknown, strict: boolean) {
	if (value === null || value === undefined) return null;
	const resolution = record(value, 'ai-resolution');
	if (strict) hasOnlyKeys(resolution, ['source', 'minerCount', 'evaluatedAt'], 'ai-resolution');
	const rawModels = Array.isArray(resolution.models) ? resolution.models.length : 0;
	const minerCount =
		resolution.minerCount === undefined
			? rawModels > 0
				? Math.min(rawModels, 16)
				: undefined
			: nonnegativeInteger(resolution.minerCount, 'ai-resolution-miner-count');
	return {
		...(optionalBoundedString(resolution.source, 128, 'ai-resolution-source') === undefined
			? {}
			: { source: String(resolution.source) }),
		...(minerCount === undefined ? {} : { minerCount }),
		...(optionalBoundedString(resolution.evaluatedAt, 128, 'ai-resolution-evaluated-at') ===
		undefined
			? {}
			: { evaluatedAt: String(resolution.evaluatedAt) })
	};
}

function publicDebate(
	value: unknown,
	templateId: string,
	strict: boolean
): PublicTemplatePageDebateSummary | null {
	if (value === null || value === undefined) return null;
	const debate = record(value, 'debate');
	const keys = [
		'_id',
		'_creationTime',
		'templateId',
		'debateIdOnchain',
		'propositionText',
		'propositionHash',
		'actionDomain',
		'deadline',
		'jurisdictionSize',
		'status',
		'argumentCount',
		'uniqueParticipants',
		'totalStake',
		'winningArgumentIndex',
		'winningStance',
		'resolvedAt',
		'resolutionMethod',
		'aiResolution',
		'aiSignatureCount',
		'appealDeadline',
		'governanceJustification',
		'arguments'
	] as const;
	if (strict) hasOnlyKeys(debate, keys, 'debate');
	const projectedTemplateId = boundedIdentifier(debate.templateId, 128, 'debate-template-id');
	if (projectedTemplateId !== templateId) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_CACHE_INVALID:debate-template-mismatch');
	}
	if (
		!['active', 'resolving', 'resolved', 'awaiting_governance', 'under_appeal'].includes(
			String(debate.status)
		)
	) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_CACHE_INVALID:debate-status');
	}
	if (
		!Array.isArray(debate.arguments) ||
		debate.arguments.length > PUBLIC_TEMPLATE_PAGE_ARGUMENT_CAP
	) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_CACHE_INVALID:argument-cap');
	}
	const deadline = debate.deadline;
	if (
		typeof deadline !== 'string' &&
		(typeof deadline !== 'number' || !Number.isFinite(deadline))
	) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_CACHE_INVALID:debate-deadline');
	}
	const projectedDeadline =
		typeof deadline === 'string' ? boundedString(deadline, 128, 'debate-deadline') : deadline;
	const debateIdOnchain = debate.debateIdOnchain;
	if (
		debateIdOnchain !== null &&
		typeof debateIdOnchain !== 'string' &&
		(typeof debateIdOnchain !== 'number' || !Number.isFinite(debateIdOnchain))
	) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_CACHE_INVALID:debate-onchain-id');
	}
	const projectedDebateIdOnchain =
		typeof debateIdOnchain === 'string'
			? boundedString(debateIdOnchain, 256, 'debate-onchain-id')
			: debateIdOnchain;
	return {
		_id: boundedIdentifier(debate._id, 128, 'debate-id'),
		_creationTime: finiteNumber(debate._creationTime, 'debate-created-at'),
		templateId: projectedTemplateId,
		debateIdOnchain: projectedDebateIdOnchain as string | number | null,
		propositionText: boundedString(debate.propositionText, 16_000, 'debate-proposition'),
		propositionHash: boundedString(debate.propositionHash, 512, 'debate-proposition-hash'),
		actionDomain: boundedString(debate.actionDomain, 512, 'debate-domain'),
		deadline: projectedDeadline,
		jurisdictionSize: nonnegativeInteger(debate.jurisdictionSize, 'debate-jurisdiction-size'),
		status: debate.status as PublicTemplatePageDebateSummary['status'],
		argumentCount: nullableNonnegativeInteger(debate.argumentCount, 'debate-argument-count'),
		uniqueParticipants: nullableNonnegativeInteger(
			debate.uniqueParticipants,
			'debate-participants'
		),
		totalStake: finiteNumber(debate.totalStake, 'debate-total-stake'),
		winningArgumentIndex: nullableNonnegativeInteger(
			debate.winningArgumentIndex,
			'debate-winning-index'
		),
		winningStance: nullableBoundedString(debate.winningStance, 64, 'debate-winning-stance'),
		resolvedAt: nullableFiniteNumber(debate.resolvedAt, 'debate-resolved-at'),
		resolutionMethod: nullableBoundedString(
			debate.resolutionMethod,
			128,
			'debate-resolution-method'
		),
		aiResolution: publicAiResolution(debate.aiResolution, strict),
		aiSignatureCount: nullableNonnegativeInteger(debate.aiSignatureCount, 'debate-signature-count'),
		appealDeadline: nullableFiniteNumber(debate.appealDeadline, 'debate-appeal-deadline'),
		governanceJustification: nullableBoundedString(
			debate.governanceJustification,
			8_000,
			'debate-governance-copy'
		),
		arguments: debate.arguments.map((argument) => publicDebateArgument(argument, strict))
	};
}

function publicPositionMetrics(
	value: unknown,
	templateId: string,
	strict: boolean
): PublicTemplatePagePositionMetrics {
	const metrics = record(value, 'position-metrics');
	if (strict) hasOnlyKeys(metrics, ['counts', 'engagement'], 'position-metrics');
	const counts = record(metrics.counts, 'position-counts');
	if (strict) hasOnlyKeys(counts, ['support', 'oppose', 'districts'], 'position-counts');
	let engagement: PublicTemplatePagePositionMetrics['engagement'] = null;
	if (metrics.engagement !== null && metrics.engagement !== undefined) {
		const raw = record(metrics.engagement, 'position-engagement');
		if (strict) hasOnlyKeys(raw, ['template_id', 'districts', 'aggregate'], 'position-engagement');
		const engagementTemplateId = boundedIdentifier(raw.template_id, 128, 'position-template-id');
		if (engagementTemplateId !== templateId) {
			throw new Error('PUBLIC_TEMPLATE_PAGE_CACHE_INVALID:position-template-mismatch');
		}
		if (!Array.isArray(raw.districts) || raw.districts.length > 20) {
			throw new Error('PUBLIC_TEMPLATE_PAGE_CACHE_INVALID:position-district-cap');
		}
		const aggregate = record(raw.aggregate, 'position-aggregate');
		if (strict) {
			hasOnlyKeys(
				aggregate,
				['total_districts', 'total_positions', 'total_support', 'total_oppose'],
				'position-aggregate'
			);
		}
		engagement = {
			template_id: engagementTemplateId,
			districts: raw.districts.map((value) => {
				const district = record(value, 'position-district');
				if (strict) {
					hasOnlyKeys(
						district,
						['district_code', 'support', 'oppose', 'total', 'support_percent'],
						'position-district'
					);
				}
				if (district.is_user_district !== undefined && district.is_user_district !== false) {
					throw new Error('PUBLIC_TEMPLATE_PAGE_CACHE_INVALID:viewer-position-metric');
				}
				const supportPercent = nonnegativeInteger(
					district.support_percent,
					'position-support-percent'
				);
				if (supportPercent > 100) {
					throw new Error('PUBLIC_TEMPLATE_PAGE_CACHE_INVALID:position-support-percent');
				}
				return {
					district_code: boundedString(district.district_code, 200, 'position-district-code'),
					support: nonnegativeInteger(district.support, 'position-support'),
					oppose: nonnegativeInteger(district.oppose, 'position-oppose'),
					total: nonnegativeInteger(district.total, 'position-total'),
					support_percent: supportPercent
				};
			}),
			aggregate: {
				total_districts: nullableNonnegativeInteger(
					aggregate.total_districts,
					'position-total-districts'
				),
				total_positions: nullableNonnegativeInteger(
					aggregate.total_positions,
					'position-total-positions'
				),
				total_support: nullableNonnegativeInteger(
					aggregate.total_support,
					'position-total-support'
				),
				total_oppose: nullableNonnegativeInteger(aggregate.total_oppose, 'position-total-oppose')
			}
		};
	}
	return {
		counts: {
			support: nullableNonnegativeInteger(counts.support, 'position-count-support'),
			oppose: nullableNonnegativeInteger(counts.oppose, 'position-count-oppose'),
			districts: nullableNonnegativeInteger(counts.districts, 'position-count-districts')
		},
		engagement
	};
}

function projectAggregate(value: unknown, strict: boolean): PublicTemplatePageAggregate {
	const aggregate = record(value, 'aggregate');
	if (strict) {
		hasOnlyKeys(
			aggregate,
			['templateId', 'messageMetrics', 'debate', 'positionMetrics'],
			'aggregate'
		);
	}
	const templateId = boundedIdentifier(aggregate.templateId, 128, 'template-id');
	const projected = {
		templateId,
		messageMetrics: publicMessageMetrics(aggregate.messageMetrics, strict),
		debate: publicDebate(aggregate.debate, templateId, strict),
		positionMetrics: publicPositionMetrics(aggregate.positionMetrics, templateId, strict)
	};
	if (
		new TextEncoder().encode(JSON.stringify(projected)).byteLength >
		PUBLIC_TEMPLATE_PAGE_AGGREGATE_MAX_BYTES
	) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_CACHE_INVALID:oversize');
	}
	return projected;
}

/** Build the cache candidate from bounded Convex outputs while dropping viewer fields. */
export function buildPublicTemplatePageAggregate(value: unknown): PublicTemplatePageAggregate {
	return projectAggregate(value, false);
}

/** Reconstruct an edge-cached value and reject every unknown nested key. */
export function readPublicTemplatePageAggregate(value: unknown): PublicTemplatePageAggregate {
	return projectAggregate(value, true);
}

/** Safe negative value used when any bounded origin projection is malformed. */
export function buildEmptyPublicTemplatePageAggregate(
	templateId: string
): PublicTemplatePageAggregate {
	return projectAggregate(
		{
			templateId,
			messageMetrics: { districtCounts: {}, totalDistricts: 0 },
			debate: null,
			positionMetrics: {
				counts: { support: null, oppose: null, districts: null },
				engagement: null
			}
		},
		true
	);
}

/**
 * Anonymous-only shared aggregate. Debate absence and zero metric states are
 * deliberate negative values cached for the same 60-second lease. Refresh is
 * blocking and never falls back past the SLA; authenticated viewer state is
 * structurally absent from this type and cache key.
 */
export function getCachedPublicTemplatePageAggregate(
	templateId: string,
	context: { url: URL; platform?: App.Platform },
	loader: () => Promise<unknown>
): Promise<PublicTemplatePageAggregate> {
	if (!/^[A-Za-z0-9_-]{1,128}$/.test(templateId)) {
		return Promise.reject(new Error('PUBLIC_TEMPLATE_PAGE_CACHE_INVALID:template-id'));
	}
	return getCachedPublicData(
		`public-template-page:${templateId}:v1`,
		{
			...context,
			freshForMs: PUBLIC_TEMPLATE_PAGE_AGGREGATE_FRESH_MS,
			refreshMode: 'blocking',
			r2Policy: 'none',
			projectCachedValue: readPublicTemplatePageAggregate,
			shouldFallbackToStale: () => false
		},
		async () => readPublicTemplatePageAggregate(await loader())
	);
}
