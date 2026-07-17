/**
 * Cross-runtime budgets for caller-controlled template JSON.
 *
 * This module deliberately uses only web-standard APIs so the SvelteKit HTTP
 * boundary and the Convex mutation boundary can enforce one identical policy.
 */

export const MAX_TEMPLATE_AUTHORING_INPUT_BYTES = 16_384;
export const MAX_PUBLIC_TEMPLATE_INPUT_BYTES = 12_288;
export const MAX_TEMPLATE_CONFIG_BYTES = 8_192;
export const MAX_GEOGRAPHIC_SCOPE_BYTES = 1_024;
export const MAX_PUBLIC_TEMPLATE_SCOPES = 100;
export const MAX_PUBLIC_TEMPLATE_JURISDICTIONS = 100;

export const TEMPLATE_AUTHORING_STRUCTURE_BUDGET = {
	maxBytes: MAX_TEMPLATE_AUTHORING_INPUT_BYTES,
	maxDepth: 8,
	maxNodes: 1_024,
	maxContainerEntries: 200
} as const;

export const PUBLIC_TEMPLATE_INPUT_STRUCTURE_BUDGET = {
	maxBytes: MAX_PUBLIC_TEMPLATE_INPUT_BYTES,
	maxDepth: 8,
	maxNodes: 768,
	maxContainerEntries: 200
} as const;

export const TEMPLATE_CONFIG_STRUCTURE_BUDGET = {
	maxBytes: MAX_TEMPLATE_CONFIG_BYTES,
	maxDepth: 8,
	maxNodes: 512,
	maxContainerEntries: 128
} as const;

export const GEOGRAPHIC_SCOPE_STRUCTURE_BUDGET = {
	maxBytes: MAX_GEOGRAPHIC_SCOPE_BYTES,
	maxDepth: 2,
	maxNodes: 7,
	maxContainerEntries: 6
} as const;

export interface JsonStructureBudget {
	maxBytes: number;
	maxDepth: number;
	maxNodes: number;
	maxContainerEntries: number;
}

export type JsonBudgetFailureReason =
	| 'invalid_json_value'
	| 'non_finite_number'
	| 'non_plain_object'
	| 'cycle'
	| 'max_depth'
	| 'max_nodes'
	| 'max_container_entries'
	| 'max_bytes';

export type JsonBudgetResult =
	| { ok: true; bytes: number; nodes: number; depth: number }
	| {
			ok: false;
			reason: JsonBudgetFailureReason;
			actual?: number;
			limit?: number;
	  };

const encoder = new TextEncoder();

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

/** Validate JSON shape first, then enforce compact UTF-8 serialized bytes. */
export function validateBoundedJson(value: unknown, budget: JsonStructureBudget): JsonBudgetResult {
	let nodes = 0;
	let deepest = 0;
	const ancestors = new Set<object>();

	function visit(current: unknown, depth: number): JsonBudgetResult | null {
		nodes += 1;
		deepest = Math.max(deepest, depth);
		if (nodes > budget.maxNodes) {
			return { ok: false, reason: 'max_nodes', actual: nodes, limit: budget.maxNodes };
		}
		if (depth > budget.maxDepth) {
			return { ok: false, reason: 'max_depth', actual: depth, limit: budget.maxDepth };
		}

		if (current === null || typeof current === 'string' || typeof current === 'boolean') {
			return null;
		}
		if (typeof current === 'number') {
			return Number.isFinite(current) ? null : { ok: false, reason: 'non_finite_number' };
		}
		if (typeof current !== 'object') {
			return { ok: false, reason: 'invalid_json_value' };
		}
		if (!Array.isArray(current) && !isPlainObject(current)) {
			return { ok: false, reason: 'non_plain_object' };
		}
		if (ancestors.has(current)) return { ok: false, reason: 'cycle' };

		const children = Array.isArray(current) ? current : Object.values(current);
		if (children.length > budget.maxContainerEntries) {
			return {
				ok: false,
				reason: 'max_container_entries',
				actual: children.length,
				limit: budget.maxContainerEntries
			};
		}

		ancestors.add(current);
		for (const child of children) {
			const failure = visit(child, depth + 1);
			if (failure) {
				ancestors.delete(current);
				return failure;
			}
		}
		ancestors.delete(current);
		return null;
	}

	try {
		const structuralFailure = visit(value, 1);
		if (structuralFailure) return structuralFailure;
		const serialized = JSON.stringify(value);
		if (serialized === undefined) return { ok: false, reason: 'invalid_json_value' };
		const bytes = encoder.encode(serialized).byteLength;
		if (bytes > budget.maxBytes) {
			return { ok: false, reason: 'max_bytes', actual: bytes, limit: budget.maxBytes };
		}
		return { ok: true, bytes, nodes, depth: deepest };
	} catch {
		return { ok: false, reason: 'invalid_json_value' };
	}
}

export interface TemplateAuthoringBudgetInput {
	title: unknown;
	slug?: unknown;
	description?: unknown;
	messageBody: unknown;
	preview: unknown;
	type: unknown;
	deliveryMethod: unknown;
	domain?: unknown;
	topics?: unknown;
	sources?: unknown;
	researchLog?: unknown;
	deliveryConfig?: unknown;
	cwcConfig?: unknown;
	recipientConfig?: unknown;
	geographicScope?: unknown;
	scopes?: unknown;
	jurisdictions?: unknown;
	contentHash?: unknown;
	status?: unknown;
	isPublic?: unknown;
}

export type TemplateInputBudgetScope =
	| 'configs'
	| 'geographic_scope'
	| 'authoring_input'
	| 'public_input';

export type TemplateInputBudgetResult =
	| { ok: true }
	| {
			ok: false;
			scope: TemplateInputBudgetScope;
			reason: JsonBudgetFailureReason | 'invalid_geographic_scope';
			actual?: number;
			limit?: number;
	  };

function failureFor(
	scope: TemplateInputBudgetScope,
	result: Exclude<JsonBudgetResult, { ok: true }>
): TemplateInputBudgetResult {
	return { ...result, scope };
}

function encodedLength(value: string): number {
	return encoder.encode(value).byteLength;
}

function isOptionalBoundedString(value: unknown, maxBytes: number): boolean {
	return value === undefined || (typeof value === 'string' && encodedLength(value) <= maxBytes);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
	const allowedKeys = new Set(allowed);
	return Object.keys(value).every((key) => allowedKeys.has(key));
}

/** Validate the discriminated GeoScope union and its human-readable labels. */
export function validateGeographicScope(value: unknown): TemplateInputBudgetResult {
	const bounded = validateBoundedJson(value, GEOGRAPHIC_SCOPE_STRUCTURE_BUDGET);
	if (!bounded.ok) return failureFor('geographic_scope', bounded);
	if (!isPlainObject(value) || typeof value.type !== 'string') {
		return { ok: false, scope: 'geographic_scope', reason: 'invalid_geographic_scope' };
	}

	if (value.type === 'international') {
		return hasOnlyKeys(value, ['type'])
			? { ok: true }
			: { ok: false, scope: 'geographic_scope', reason: 'invalid_geographic_scope' };
	}

	if (value.type === 'nationwide') {
		if (!hasOnlyKeys(value, ['type', 'country', 'displayName'])) {
			return { ok: false, scope: 'geographic_scope', reason: 'invalid_geographic_scope' };
		}
		return typeof value.country === 'string' &&
			/^[A-Z]{2}$/.test(value.country) &&
			isOptionalBoundedString(value.displayName, 200)
			? { ok: true }
			: { ok: false, scope: 'geographic_scope', reason: 'invalid_geographic_scope' };
	}

	if (value.type === 'subnational') {
		if (
			!hasOnlyKeys(value, [
				'type',
				'country',
				'subdivision',
				'subdivisionName',
				'locality',
				'displayName'
			])
		) {
			return { ok: false, scope: 'geographic_scope', reason: 'invalid_geographic_scope' };
		}
		return typeof value.country === 'string' &&
			/^[A-Z]{2}$/.test(value.country) &&
			isOptionalBoundedString(value.subdivision, 32) &&
			isOptionalBoundedString(value.subdivisionName, 200) &&
			isOptionalBoundedString(value.locality, 200) &&
			isOptionalBoundedString(value.displayName, 200)
			? { ok: true }
			: { ok: false, scope: 'geographic_scope', reason: 'invalid_geographic_scope' };
	}

	return { ok: false, scope: 'geographic_scope', reason: 'invalid_geographic_scope' };
}

/** Enforce aggregate config, full-document, and public-projection input budgets. */
export function validateTemplateInputBudgets(
	input: TemplateAuthoringBudgetInput,
	options: { includePublicInput?: boolean } = {}
): TemplateInputBudgetResult {
	const configs = {
		deliveryConfig: input.deliveryConfig ?? {},
		cwcConfig: input.cwcConfig ?? {},
		recipientConfig: input.recipientConfig ?? {}
	};
	for (const config of Object.values(configs)) {
		if (!isPlainObject(config)) {
			return { ok: false, scope: 'configs', reason: 'non_plain_object' };
		}
	}
	const configBudget = validateBoundedJson(configs, TEMPLATE_CONFIG_STRUCTURE_BUDGET);
	if (!configBudget.ok) return failureFor('configs', configBudget);

	if (input.geographicScope !== undefined) {
		const geographicScope = validateGeographicScope(input.geographicScope);
		if (!geographicScope.ok) return geographicScope;
	}
	for (const [value, limit] of [
		[input.scopes, MAX_PUBLIC_TEMPLATE_SCOPES],
		[input.jurisdictions, MAX_PUBLIC_TEMPLATE_JURISDICTIONS]
	] as const) {
		if (value !== undefined && (!Array.isArray(value) || value.length > limit)) {
			return {
				ok: false,
				scope: 'public_input',
				reason: 'max_container_entries',
				actual: Array.isArray(value) ? value.length : undefined,
				limit
			};
		}
	}

	const publicInput = {
		slug: input.slug ?? '',
		title: input.title,
		description: input.description ?? '',
		domain: input.domain ?? '',
		topics: input.topics ?? [],
		type: input.type,
		deliveryMethod: input.deliveryMethod,
		messageBody: input.messageBody,
		preview: input.preview,
		...configs,
		geographicScope: input.geographicScope ?? null,
		scopes: input.scopes ?? [],
		jurisdictions: input.jurisdictions ?? []
	};
	const authoringInput = {
		...publicInput,
		sources: input.sources ?? [],
		researchLog: input.researchLog ?? [],
		contentHash: input.contentHash ?? '',
		status: input.status ?? '',
		isPublic: input.isPublic ?? false
	};

	const authoringBudget = validateBoundedJson(authoringInput, TEMPLATE_AUTHORING_STRUCTURE_BUDGET);
	if (!authoringBudget.ok) return failureFor('authoring_input', authoringBudget);

	if (options.includePublicInput !== false) {
		const publicBudget = validateBoundedJson(publicInput, PUBLIC_TEMPLATE_INPUT_STRUCTURE_BUDGET);
		if (!publicBudget.ok) return failureFor('public_input', publicBudget);
	}

	return { ok: true };
}
