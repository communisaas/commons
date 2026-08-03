// CONVEX: Fully migrated — moderation (Groq) + embeddings (Gemini) stay in SvelteKit,
// all DB operations go through Convex serverQuery/serverMutation.
import { json } from '@sveltejs/kit';
import { ConvexError } from 'convex/values';
import type { RequestHandler } from './$types';
import { serverQuery, serverMutation } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import {
	getCachedPublicTemplates,
	PublicDiscoverySnapshotNotReadyError
} from '$lib/server/public-template-queries';
import { FEATURES } from '$lib/config/features';
import type { Id } from '$convex/_generated/dataModel';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import {
	createApiError,
	createValidationError,
	type StructuredApiResponse,
	type ApiError
} from '$lib/types/errors';
import type { UnknownRecord } from '$lib/types/any-replacements';
import { buildTemplateModerationContent, moderateTemplate } from '$lib/core/server/moderation';
import { generateBatchEmbeddings } from '$lib/core/search/gemini-embeddings';
import { projectToHue } from '$lib/utils/domain-hue-projection';
import { createHash } from 'crypto';
import type { GeoScope } from '$lib/core/agents/types';
import {
	MAX_GEOGRAPHIC_SCOPE_BYTES,
	MAX_PUBLIC_TEMPLATE_INPUT_BYTES,
	MAX_TEMPLATE_AUTHORING_INPUT_BYTES,
	MAX_TEMPLATE_CONFIG_BYTES,
	MAX_TEMPLATE_SLUG_CODE_POINTS,
	canonicalizeTemplateSlug,
	validateTemplateInputBudgets,
	type TemplateInputBudgetResult
} from '$convex/lib/templateInputBudget';
import {
	TEMPLATE_DELIVERY_METHODS,
	isTemplateDeliveryMethod
} from '$convex/lib/templateDeliveryMethod';
import { invalidatePublicTemplateCaches } from '$lib/server/public-template-detail-cache';
import { buildTemplateCreateResponse } from '$lib/server/templates/authoring-response';
import { enforceLLMRateLimit, rateLimitResponse } from '$lib/server/llm-cost-protection';
import { PROMPT_GUARD_MAX_CHARACTERS } from '$lib/core/server/moderation/prompt-guard-budget';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '$lib/server/bounded-json-request';

/** Content-addressable fingerprint: same title + body = same template */
function contentHash(title: string, body: string): string {
	return createHash('sha256').update(`${title}\0${body}`).digest('hex').slice(0, 40);
}

/** Resolve the exact slug that will be sent to Convex before enforcing byte budgets. */
function resolveTemplateSlug(title: string, requestedSlug: string | undefined): string {
	const requested = canonicalizeTemplateSlug(requestedSlug ?? '');
	return requested || canonicalizeTemplateSlug(title);
}

const TEMPLATE_SLUG_TAKEN = 'TEMPLATE_SLUG_TAKEN';
const TEMPLATE_AUTHORING_SLUG_INVALID = 'TEMPLATE_AUTHORING_SLUG_INVALID';

function isConvexErrorWithCode(error: unknown, code: string): boolean {
	if (!(error instanceof ConvexError)) return false;
	const data = error.data;
	return (
		data === code ||
		(data !== null &&
			typeof data === 'object' &&
			!Array.isArray(data) &&
			(data as { code?: unknown }).code === code)
	);
}

function isTemplateSlugTakenError(error: unknown): boolean {
	return isConvexErrorWithCode(error, TEMPLATE_SLUG_TAKEN);
}

function duplicateSlugResponse(): Response {
	const response: StructuredApiResponse = {
		success: false,
		error: createValidationError(
			'slug',
			'VALIDATION_DUPLICATE',
			'This link is already taken. Please choose a different one or customize your link.'
		)
	};
	return json(response, { status: 400 });
}

/** Validate and sanitize topics at the API boundary. */
function sanitizeTopics(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
		.map((t) => t.trim().toLowerCase().slice(0, 100))
		.slice(0, 5);
}

// Validation schema for template creation
interface CreateTemplateRequest {
	title: string;
	slug?: string;
	message_body: string;
	sources?: Array<{ num: number; title: string; url: string; type: string }>;
	research_log?: string[];
	domain?: string;
	topics?: string[];
	type: string;
	deliveryMethod: string;
	preview: string;
	description: string;
	status?: string;
	is_public?: boolean;
	delivery_config?: UnknownRecord;
	cwc_config?: UnknownRecord;
	recipient_config?: UnknownRecord;
	geographic_scope?: GeoScope;
}

type ValidationError = ApiError;

const SOURCE_TITLE_MAX_LENGTH = 500;
const SOURCE_URL_MAX_LENGTH = 2_048;
const SOURCE_TYPE_MAX_LENGTH = 64;
const RESEARCH_LOG_ENTRY_MAX_LENGTH = 1_000;
const MAX_TEMPLATE_CREATE_REQUEST_BYTES = 32 * 1024;
const TEMPLATE_CREATE_FIELDS = new Set([
	'title',
	'slug',
	'message_body',
	'sources',
	'research_log',
	'domain',
	'topics',
	'type',
	'deliveryMethod',
	'preview',
	'description',
	'status',
	'is_public',
	'delivery_config',
	'cwc_config',
	'recipient_config',
	'geographic_scope',
	'scopes',
	'jurisdictions',
	// Current TemplateCreator legacy response-model fields. They are ignored by
	// the writer but explicitly named so arbitrary ballast is still rejected.
	'subject',
	'campaign_id',
	'send_count',
	'coordinationScale',
	'isNew',
	'createdAt',
	'updatedAt',
	'applicable_countries',
	'jurisdiction_level',
	'specific_locations',
	'recipientEmails'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPublicHttpUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return (
			(parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
			!parsed.username &&
			!parsed.password
		);
	} catch {
		return false;
	}
}

/** Fail closed when a persisted trust score is missing, malformed, or non-finite. */
function hasTemplateCreationTrust(user: { is_verified?: unknown; trust_score?: unknown }): boolean {
	return (
		user.is_verified === true ||
		(typeof user.trust_score === 'number' &&
			Number.isFinite(user.trust_score) &&
			user.trust_score >= 100)
	);
}

function inputBudgetError(
	failure: Exclude<TemplateInputBudgetResult, { ok: true }>
): ValidationError {
	const excessive = new Set(['max_depth', 'max_nodes', 'max_container_entries', 'max_bytes']).has(
		failure.reason
	);
	const code = excessive ? 'VALIDATION_TOO_LONG' : 'VALIDATION_INVALID_FORMAT';

	switch (failure.scope) {
		case 'configs':
			return createValidationError(
				'recipient_config',
				code,
				`Combined template configuration must be structurally bounded and ≤${MAX_TEMPLATE_CONFIG_BYTES.toLocaleString()} UTF-8 bytes`
			);
		case 'geographic_scope':
			return createValidationError(
				'geographic_scope',
				code,
				`geographic_scope must match the supported GeoScope shape and be ≤${MAX_GEOGRAPHIC_SCOPE_BYTES.toLocaleString()} UTF-8 bytes`
			);
		case 'authoring_input':
			return createValidationError(
				'body',
				code,
				`Combined template content must be structurally bounded and ≤${MAX_TEMPLATE_AUTHORING_INPUT_BYTES.toLocaleString()} UTF-8 bytes`
			);
		case 'public_input':
			return createValidationError(
				'body',
				code,
				`Public template content must be structurally bounded and ≤${MAX_PUBLIC_TEMPLATE_INPUT_BYTES.toLocaleString()} UTF-8 bytes`
			);
	}
}

function validateTemplateData(data: unknown): {
	isValid: boolean;
	errors: ValidationError[];
	validData?: CreateTemplateRequest;
} {
	const errors: ValidationError[] = [];

	if (!data || typeof data !== 'object') {
		errors.push(createValidationError('body', 'VALIDATION_REQUIRED', 'Invalid request body'));
		return { isValid: false, errors };
	}

	const templateData = data as Record<string, unknown>;
	// The description default is resolved once: the moderation preflight, the
	// storage budget, the persisted row and the classified content must all read
	// the identical string.
	const rawPreview = typeof templateData.preview === 'string' ? templateData.preview : '';
	const resolvedDescription =
		(typeof templateData.description === 'string' ? templateData.description : '') ||
		rawPreview.substring(0, 160) ||
		'';
	const unknownField = Object.keys(templateData).find(
		(field) => !TEMPLATE_CREATE_FIELDS.has(field)
	);
	if (unknownField) {
		errors.push(
			createValidationError(
				'body',
				'VALIDATION_INVALID_FORMAT',
				`Unknown template field: ${unknownField}`
			)
		);
	}

	if (!templateData.title || typeof templateData.title !== 'string' || !templateData.title.trim()) {
		errors.push(
			createValidationError('title', 'VALIDATION_REQUIRED', 'Template title is required')
		);
	} else if (templateData.title.length > 200) {
		errors.push(
			createValidationError(
				'title',
				'VALIDATION_TOO_LONG',
				'Title must be less than 200 characters'
			)
		);
	}

	if (
		!templateData.message_body ||
		typeof templateData.message_body !== 'string' ||
		!templateData.message_body.trim()
	) {
		errors.push(
			createValidationError('message_body', 'VALIDATION_REQUIRED', 'Message content is required')
		);
	} else if (templateData.message_body.length > 10000) {
		errors.push(
			createValidationError(
				'message_body',
				'VALIDATION_TOO_LONG',
				'Message must be less than 10,000 characters'
			)
		);
	}

	if (
		typeof templateData.title === 'string' &&
		typeof templateData.message_body === 'string' &&
		buildTemplateModerationContent({
			title: templateData.title,
			message_body: templateData.message_body,
			description: resolvedDescription,
			preview: rawPreview
		}).length > PROMPT_GUARD_MAX_CHARACTERS
	) {
		errors.push(
			createValidationError(
				'message_body',
				'VALIDATION_TOO_LONG',
				`Combined title, description, preview, and message must be ≤${PROMPT_GUARD_MAX_CHARACTERS.toLocaleString()} characters for complete safety review`
			)
		);
	}

	if (
		!templateData.preview ||
		typeof templateData.preview !== 'string' ||
		!templateData.preview.trim()
	) {
		errors.push(
			createValidationError('preview', 'VALIDATION_REQUIRED', 'Preview text is required')
		);
	} else if (templateData.preview.length > 500) {
		errors.push(
			createValidationError(
				'preview',
				'VALIDATION_TOO_LONG',
				'Preview must be less than 500 characters'
			)
		);
	}

	if (!templateData.type || typeof templateData.type !== 'string') {
		errors.push(createValidationError('type', 'VALIDATION_REQUIRED', 'Template type is required'));
	}

	if (!templateData.deliveryMethod || typeof templateData.deliveryMethod !== 'string') {
		errors.push(
			createValidationError('deliveryMethod', 'VALIDATION_REQUIRED', 'Delivery method is required')
		);
	} else if (!isTemplateDeliveryMethod(templateData.deliveryMethod)) {
		errors.push(
			createValidationError(
				'deliveryMethod',
				'VALIDATION_INVALID_FORMAT',
				`deliveryMethod must be one of: ${TEMPLATE_DELIVERY_METHODS.join(', ')}`
			)
		);
	}

	for (const field of ['slug', 'description', 'domain'] as const) {
		if (templateData[field] !== undefined && typeof templateData[field] !== 'string') {
			errors.push(
				createValidationError(field, 'VALIDATION_INVALID_FORMAT', `${field} must be a string`)
			);
		}
	}

	for (const field of ['delivery_config', 'cwc_config', 'recipient_config'] as const) {
		if (templateData[field] !== undefined && !isRecord(templateData[field])) {
			errors.push(
				createValidationError(field, 'VALIDATION_INVALID_FORMAT', `${field} must be an object`)
			);
		}
	}

	for (const field of ['scopes', 'jurisdictions'] as const) {
		if (templateData[field] !== undefined && !Array.isArray(templateData[field])) {
			errors.push(
				createValidationError(field, 'VALIDATION_INVALID_FORMAT', `${field} must be an array`)
			);
		}
	}

	// bound remaining caller-supplied strings + arrays before
	// they hit Gemini moderation + Convex insert. type/deliveryMethod are
	// enum-like (downstream Convex validates the actual values); cap length
	// here for defense-in-depth.
	if (typeof templateData.type === 'string' && templateData.type.length > 64) {
		errors.push(
			createValidationError('type', 'VALIDATION_TOO_LONG', 'type must be ≤64 characters')
		);
	}
	if (typeof templateData.deliveryMethod === 'string' && templateData.deliveryMethod.length > 64) {
		errors.push(
			createValidationError(
				'deliveryMethod',
				'VALIDATION_TOO_LONG',
				'deliveryMethod must be ≤64 characters'
			)
		);
	}
	if (typeof templateData.description === 'string' && templateData.description.length > 1000) {
		errors.push(
			createValidationError(
				'description',
				'VALIDATION_TOO_LONG',
				'description must be ≤1,000 characters'
			)
		);
	}
	if (typeof templateData.domain === 'string' && templateData.domain.length > 200) {
		errors.push(
			createValidationError('domain', 'VALIDATION_TOO_LONG', 'domain must be ≤200 characters')
		);
	}
	if (templateData.sources !== undefined && !Array.isArray(templateData.sources)) {
		errors.push(
			createValidationError('sources', 'VALIDATION_INVALID_FORMAT', 'sources must be an array')
		);
	} else if (Array.isArray(templateData.sources)) {
		if (templateData.sources.length > 50) {
			errors.push(
				createValidationError('sources', 'VALIDATION_TOO_LONG', 'sources must have ≤50 entries')
			);
		}

		for (const [index, source] of templateData.sources.entries()) {
			if (
				!isRecord(source) ||
				typeof source.num !== 'number' ||
				!Number.isFinite(source.num) ||
				typeof source.title !== 'string' ||
				typeof source.url !== 'string' ||
				typeof source.type !== 'string'
			) {
				errors.push(
					createValidationError(
						'sources',
						'VALIDATION_INVALID_FORMAT',
						`sources[${index}] must contain a finite num and string title, url, and type`
					)
				);
				continue;
			}

			if (
				source.title.length > SOURCE_TITLE_MAX_LENGTH ||
				source.url.length > SOURCE_URL_MAX_LENGTH ||
				source.type.length > SOURCE_TYPE_MAX_LENGTH
			) {
				errors.push(
					createValidationError(
						'sources',
						'VALIDATION_TOO_LONG',
						`sources[${index}] exceeds the title, URL, or type length limit`
					)
				);
			}

			if (!isPublicHttpUrl(source.url)) {
				errors.push(
					createValidationError(
						'sources',
						'VALIDATION_INVALID_FORMAT',
						`sources[${index}].url must be an absolute http(s) URL without credentials`
					)
				);
			}
		}
	}
	if (templateData.research_log !== undefined && !Array.isArray(templateData.research_log)) {
		errors.push(
			createValidationError(
				'research_log',
				'VALIDATION_INVALID_FORMAT',
				'research_log must be an array'
			)
		);
	} else if (Array.isArray(templateData.research_log)) {
		if (templateData.research_log.length > 200) {
			errors.push(
				createValidationError(
					'research_log',
					'VALIDATION_TOO_LONG',
					'research_log must have ≤200 entries'
				)
			);
		}
		for (const [index, entry] of templateData.research_log.entries()) {
			if (typeof entry !== 'string') {
				errors.push(
					createValidationError(
						'research_log',
						'VALIDATION_INVALID_FORMAT',
						`research_log[${index}] must be a string`
					)
				);
			} else if (entry.length > RESEARCH_LOG_ENTRY_MAX_LENGTH) {
				errors.push(
					createValidationError(
						'research_log',
						'VALIDATION_TOO_LONG',
						`research_log[${index}] must be ≤${RESEARCH_LOG_ENTRY_MAX_LENGTH.toLocaleString()} characters`
					)
				);
			}
		}
	}

	if (errors.length > 0) {
		return { isValid: false, errors };
	}

	const prospectiveSlug = resolveTemplateSlug(
		templateData.title as string,
		templateData.slug as string | undefined
	);
	if (!prospectiveSlug) {
		return {
			isValid: false,
			errors: [
				createValidationError(
					'slug',
					'VALIDATION_INVALID_FORMAT',
					'Title or custom link must contain at least one letter or number'
				)
			]
		};
	}

	const budgetResult = validateTemplateInputBudgets({
		title: templateData.title,
		slug: prospectiveSlug,
		description: resolvedDescription,
		messageBody: templateData.message_body,
		preview: templateData.preview,
		type: templateData.type,
		deliveryMethod: templateData.deliveryMethod,
		domain: (templateData.domain as string) || '',
		topics: sanitizeTopics(templateData.topics),
		sources: templateData.sources || [],
		researchLog: templateData.research_log || [],
		deliveryConfig: templateData.delivery_config || {},
		cwcConfig: templateData.cwc_config || {},
		recipientConfig: templateData.recipient_config || {},
		geographicScope: templateData.geographic_scope,
		contentHash: contentHash(templateData.title as string, templateData.message_body as string),
		// Moderation may promote this request to published/public. Budget the
		// largest canonical mutation now so an exact-boundary request cannot pass
		// HTTP preflight and fail three bytes later at Convex.
		status: 'published',
		isPublic: true
	});
	if (!budgetResult.ok) {
		return { isValid: false, errors: [inputBudgetError(budgetResult)] };
	}

	const validData: CreateTemplateRequest = {
		title: templateData.title as string,
		slug: prospectiveSlug,
		message_body: templateData.message_body as string,
		sources:
			(templateData.sources as Array<{ num: number; title: string; url: string; type: string }>) ||
			[],
		research_log: (templateData.research_log as string[]) || [],
		preview: templateData.preview as string,
		type: templateData.type as string,
		deliveryMethod: templateData.deliveryMethod as string,
		domain: (templateData.domain as string) || '',
		topics: sanitizeTopics(templateData.topics),
		description: resolvedDescription,
		status: (templateData.status as string) || 'draft',
		is_public: Boolean(templateData.is_public) || false,
		delivery_config: (templateData.delivery_config as UnknownRecord) || {},
		cwc_config: (templateData.cwc_config as UnknownRecord) || {},
		recipient_config: (templateData.recipient_config as UnknownRecord) || {},
		geographic_scope: (templateData.geographic_scope as GeoScope) || undefined
	};

	return { isValid: true, errors: [], validData };
}

// GET fully migrated to Convex
export const GET: RequestHandler = async ({ url, platform }) => {
	const successHeaders = {
		// Browsers revalidate after one minute. If a route-scoped Cloudflare Worker
		// cache is enabled later, the more specific header preserves edge-only stale
		// resilience without forwarding that allowance to browsers. The current
		// Convex cost shield is the explicit Cache API/R2 state machine, not this
		// advisory front-of-Worker policy.
		'Cache-Control': 'public, max-age=60, must-revalidate',
		'Cloudflare-CDN-Cache-Control':
			'public, max-age=60, stale-while-revalidate=30, stale-if-error=3600'
	};
	const coldHeaders = {
		// A cold empty collection is compatible, but it is not a last-known-good
		// payload worth serving stale through a producer outage.
		'Cache-Control': 'public, max-age=60, must-revalidate'
	};

	try {
		const templates = await getCachedPublicTemplates({ url, platform }, !FEATURES.CONGRESSIONAL);
		const response: StructuredApiResponse = { success: true, data: templates };
		return json(response, { headers: successHeaders });
	} catch (error) {
		// Preserve the API's historical cold-start contract: before the first
		// snapshot publication, public discovery is an honest empty collection.
		if (error instanceof PublicDiscoverySnapshotNotReadyError) {
			const response: StructuredApiResponse = { success: true, data: [] };
			return json(response, { headers: coldHeaders });
		}

		console.error('[api/templates] Public discovery read failed:', error);
		const response: StructuredApiResponse = {
			success: false,
			error: createApiError(
				'server',
				'SERVER_DATABASE',
				'Public templates are temporarily unavailable'
			)
		};
		return json(response, {
			status: 503,
			headers: { 'Cache-Control': 'no-store' }
		});
	}
};

export const POST: RequestHandler = async (event) => {
	const { request, locals, platform } = event;
	try {
		const requestUrl = new URL(request.url);
		const invalidateDetailCaches = async (slug: string): Promise<void> => {
			try {
				await invalidatePublicTemplateCaches({ slug, url: requestUrl, platform });
			} catch (error) {
				console.warn('[api/templates] Public template cache invalidation failed', error);
			}
		};
		// Reject before parsing or invoking the two-provider moderation pipeline.
		// The global hook already caps this mutating route at 10 requests/day;
		// this early account/trust gate prevents distributed anonymous traffic from
		// turning even those rejected requests into external AI work.
		const requestUser = locals.user;
		if (!requestUser) {
			const response: StructuredApiResponse = {
				success: false,
				error: createApiError(
					'auth',
					'AUTH_REQUIRED',
					'Authentication required to create templates'
				)
			};
			return json(response, { status: 401 });
		}
		// `handleAuth` calls authOps.validateSession for every request and hydrates
		// these fields from the current Convex user document, not from JWT claims.
		if (!hasTemplateCreationTrust(requestUser)) {
			const response: StructuredApiResponse = {
				success: false,
				error: createApiError(
					'auth',
					'INSUFFICIENT_TRUST',
					'Template creation requires account verification. Please complete identity verification to create templates.'
				)
			};
			return json(response, { status: 403 });
		}

		// Parse request body
		let requestData: unknown;
		try {
			requestData = await readBoundedJsonRequest(request, MAX_TEMPLATE_CREATE_REQUEST_BYTES, {
				maxArrayItems: 200,
				maxDepth: 8,
				maxNodes: 1_024,
				// Let the shared template/config validators produce their field-specific
				// errors at 129 entries; this raw-shape ceiling only stops pathology.
				maxObjectKeys: 200,
				maxStringBytes: 12_000
			});
		} catch (error) {
			const boundedError =
				error instanceof BoundedJsonRequestError
					? error
					: new BoundedJsonRequestError('Invalid JSON in request body');
			const response: StructuredApiResponse = {
				success: false,
				error: createApiError(
					'validation',
					boundedError.status === 413 ? 'VALIDATION_TOO_LONG' : 'VALIDATION_INVALID_FORMAT',
					boundedError.message
				)
			};
			return json(response, { status: boundedError.status });
		}

		// Validate template data
		const validation = validateTemplateData(requestData);
		if (!validation.isValid) {
			const response: StructuredApiResponse = {
				success: false,
				errors: validation.errors
			};
			return json(response, { status: 400 });
		}

		if (!validation.validData) {
			const response: StructuredApiResponse = {
				success: false,
				error: createApiError(
					'validation',
					'VALIDATION_MISSING_DATA',
					'Validation passed but data is missing'
				)
			};
			return json(response, { status: 400 });
		}
		const validData = validation.validData;
		const user = requestUser;
		const hash = contentHash(validData.title, validData.message_body);
		const slug = resolveTemplateSlug(validData.title, validData.slug);
		const internalSecret = getInternalSecret();
		const authoringLeaseToken = crypto.randomUUID();
		let authoringLeaseOwned = false;
		const releaseAuthoringLease = async (): Promise<void> => {
			if (!authoringLeaseOwned) return;
			authoringLeaseOwned = false;
			await serverMutation(api.templates.releaseTemplateAuthoringLease, {
				_secret: internalSecret,
				userId: user.id as Id<'users'>,
				contentHash: hash,
				token: authoringLeaseToken
			}).catch((error: unknown) => {
				console.warn('[api/templates] Template authoring lease release failed:', error);
			});
		};

		// One OCC mutation combines duplicate/slug/quota preflight with the
		// provider-work lease. This avoids both check-then-spend races and a second
		// maximum-class Convex read on every successful authoring request.
		try {
			const preflight = await serverMutation(api.templates.claimTemplateAuthoringLease, {
				_secret: internalSecret,
				userId: user.id as Id<'users'>,
				contentHash: hash,
				slug,
				token: authoringLeaseToken
			});

			if (preflight.outcome === 'slug_taken') return duplicateSlugResponse();
			if (preflight.outcome === 'in_progress') {
				const retryAfter = Math.max(1, Math.ceil((preflight.retryAt - Date.now()) / 1_000));
				return json(
					{
						success: false,
						error: createApiError(
							'validation',
							'AUTHORING_IN_PROGRESS',
							'An identical template or link is already being checked.'
						)
					},
					{
						status: 409,
						headers: { 'Cache-Control': 'no-store', 'Retry-After': String(retryAfter) }
					}
				);
			}

			if (preflight.outcome === 'quota_exceeded') {
				if (preflight.code === 'TEMPLATE_QUOTA_EXCEEDED') {
					const response: StructuredApiResponse = {
						success: false,
						error: createApiError(
							'authorization',
							'TEMPLATE_QUOTA_EXCEEDED',
							'Monthly template quota exceeded'
						)
					};
					return json(response, { status: 403 });
				}

				const apiError = createApiError(
					'authorization',
					'AUTHORING_QUOTA_EXCEEDED',
					preflight.message ?? 'Monthly authoring quota exceeded'
				);
				const response: StructuredApiResponse = {
					success: false,
					error: apiError,
					errors: [apiError]
				};
				return json(response, { status: 403 });
			}

			if (preflight.outcome === 'duplicate') {
				const existingByContent = preflight.template;
				// Preserve the existing idempotent retry behavior: a duplicate may
				// enrich missing discovery metadata without re-running any provider.
				const incomingDomain = validData.domain || '';
				const incomingTopics = validData.topics || [];
				const existingDomain = existingByContent.domain || '';
				const existingTopics = (existingByContent.topics as string[]) || [];
				const needsMetadataPatch =
					(incomingDomain && incomingDomain !== existingDomain) ||
					(incomingTopics.length > 0 && existingTopics.length === 0);

				if (needsMetadataPatch) {
					await serverMutation(api.templates.patchMetadata, {
						templateId: existingByContent._id,
						...(incomingDomain ? { domain: incomingDomain } : {}),
						...(incomingTopics.length > 0 ? { topics: incomingTopics } : {})
					});
				}

				const response: StructuredApiResponse = {
					success: true,
					data: {
						template: buildTemplateCreateResponse(existingByContent, {
							domain: incomingDomain,
							topics: incomingTopics
						})
					}
				};

				await invalidateDetailCaches(existingByContent.slug);
				return json(response);
			}
			authoringLeaseOwned = true;
		} catch (error) {
			if (isConvexErrorWithCode(error, TEMPLATE_AUTHORING_SLUG_INVALID)) {
				const response: StructuredApiResponse = {
					success: false,
					error: createValidationError(
						'slug',
						'VALIDATION_INVALID_FORMAT',
						`This link must use lowercase letters and numbers separated by single hyphens (${MAX_TEMPLATE_SLUG_CODE_POINTS} characters max)`
					)
				};
				return json(response, { status: 400 });
			}
			console.error('Template authoring lease claim failed:', error);
			const response: StructuredApiResponse = {
				success: false,
				error: createApiError(
					'server',
					'SERVER_DATABASE',
					'Unable to coordinate template authoring'
				)
			};
			return json(response, { status: 503 });
		}

		let rateLimitCheck;
		try {
			rateLimitCheck = await enforceLLMRateLimit(event, 'template-authoring');
		} catch (error) {
			console.error('Template authoring admission failed:', error);
			await releaseAuthoringLease();
			return json(
				{
					success: false,
					error: createApiError(
						'server',
						'SERVER_DATABASE',
						'Template authoring capacity is temporarily unavailable'
					)
				},
				{ status: 503 }
			);
		}
		if (!rateLimitCheck.allowed) {
			await releaseAuthoringLease();
			return rateLimitResponse(rateLimitCheck);
		}

		// === 2-LAYER CONTENT MODERATION (Llama Guard 4 + Gemini) ===
		let consensusResult;

		try {
			const moderationResult = await moderateTemplate(
				{
					title: validData.title,
					message_body: validData.message_body,
					description: validData.description,
					preview: validData.preview
				},
				{ signal: event.request.signal }
			);

			if (!moderationResult.approved) {
				console.log('Moderation REJECTED template:', {
					rejection_reason: moderationResult.rejection_reason,
					hazards: moderationResult.safety?.hazards,
					summary: moderationResult.summary,
					latencyMs: moderationResult.latency_ms
				});

				const response: StructuredApiResponse = {
					success: false,
					error: createValidationError('message_body', 'CONTENT_FLAGGED', moderationResult.summary)
				};
				await releaseAuthoringLease();
				return json(response, { status: 400 });
			}

			const votes = [];
			if (moderationResult.prompt_guard) {
				votes.push({
					agent: 'prompt-guard',
					approved: moderationResult.prompt_guard.safe,
					confidence: 1.0 - moderationResult.prompt_guard.score,
					reasoning: moderationResult.prompt_guard.safe
						? 'No prompt injection detected'
						: `Injection detected (${(moderationResult.prompt_guard.score * 100).toFixed(1)}%)`,
					timestamp: moderationResult.prompt_guard.timestamp
				});
			}
			if (moderationResult.safety) {
				votes.push({
					agent: 'llama-guard',
					approved: moderationResult.safety.safe,
					confidence: moderationResult.safety.safe ? 1.0 : 0.0,
					reasoning: moderationResult.safety.reasoning,
					timestamp: moderationResult.safety.timestamp
				});
			}
			const approvedCount = votes.filter((v) => v.approved).length;
			const consensusType =
				approvedCount === votes.length ? 'unanimous' : approvedCount === 0 ? 'unanimous' : 'split';

			consensusResult = {
				approved: moderationResult.approved,
				consensus_type: consensusType,
				votes,
				final_confidence: moderationResult.safety?.safe ? 1.0 : 0.0,
				reasoning_summary: moderationResult.summary,
				timestamp: new Date().toISOString()
			};

			console.log('Moderation APPROVED template:', {
				safetyModel: moderationResult.safety?.model,
				latencyMs: moderationResult.latency_ms
			});
		} catch (moderationError) {
			console.error('Content moderation error:', moderationError);
			const errorMessage =
				moderationError instanceof Error ? moderationError.message : 'Content moderation failed';
			const response: StructuredApiResponse = {
				success: false,
				error: createApiError(
					'server',
					'MODERATION_FAILED',
					`Unable to verify content: ${errorMessage}. Please try again.`
				)
			};
			await releaseAuthoringLease();
			return json(response, { status: 503 });
		}

		try {
			// The create mutation owns slug uniqueness atomically along with quota
			// enforcement; avoid a redundant check-then-create query here.
			const newTemplate = await serverMutation(api.templates.createTemplate, {
				_secret: internalSecret,
				userId: user.id as Id<'users'>,
				title: validData.title,
				slug,
				description: validData.description,
				messageBody: validData.message_body,
				preview: validData.preview,
				type: validData.type,
				deliveryMethod: validData.deliveryMethod,
				domain: validData.domain || '',
				topics: validData.topics || [],
				sources: validData.sources || [],
				researchLog: validData.research_log || [],
				contentHash: hash,
				authoringLeaseToken,
				status: consensusResult?.approved ? 'published' : 'draft',
				isPublic: consensusResult?.approved ?? false,
				deliveryConfig: validData.delivery_config || {},
				cwcConfig: validData.cwc_config || {},
				recipientConfig: validData.recipient_config || {},
				consensusApproved: consensusResult?.approved ?? false,
				geographicScope: validData.geographic_scope
			});

			if (!newTemplate) {
				const response: StructuredApiResponse = {
					success: false,
					error: createApiError('server', 'SERVER_DATABASE', 'Template could not be created')
				};
				await releaseAuthoringLease();
				return json(response, { status: 500 });
			}
			authoringLeaseOwned = false;

			const templateId = newTemplate._id;
			const isNew = !newTemplate.deduplicated;
			const isPublic = isNew && newTemplate.isPublic;
			const isCwc = isNew && validData.deliveryMethod === 'cwc';

			// Deferred work: CWC verification + embedding generation
			if (isCwc || isPublic) {
				const deferredWork = (async () => {
					if (isCwc) {
						try {
							await serverMutation(api.templates.setCwcVerification, {
								_secret: getInternalSecret(),
								expectedUserId: user.id as Id<'users'>,
								templateId: templateId as Id<'templates'>,
								verificationStatus: 'pending',
								countryCode: 'US',
								reputationApplied: false
							});
							console.log(`[deferred] CWC verification set for template ${templateId}`);
						} catch (error) {
							console.error('[deferred] CWC verification failed:', error);
						}
					}

					// Embedding generation via Gemini, then write to Convex
					if (isPublic) {
						try {
							const locationText = `${newTemplate.title} ${newTemplate.description || ''} ${newTemplate.domain}`;
							const topicText = `${newTemplate.title} ${newTemplate.description || ''} ${newTemplate.messageBody}`;

							const embeddings = await generateBatchEmbeddings([locationText, topicText], {
								taskType: 'RETRIEVAL_DOCUMENT'
							});

							const domainHue = projectToHue(embeddings[1]);

							await serverMutation(api.templates.completePublicTemplateEmbeddings, {
								templateId: templateId as Id<'templates'>,
								expectedUserId: user.id as Id<'users'>,
								locationEmbedding: embeddings[0],
								topicEmbedding: embeddings[1],
								domainHue,
								_secret: getInternalSecret()
							});

							console.log(
								`[deferred] Embeddings generated for template ${templateId} (domainHue=${domainHue.toFixed(1)})`
							);
						} catch (embeddingError) {
							console.error('[deferred] Embedding generation failed:', embeddingError);
						}
					}
				})();

				if (platform?.context?.waitUntil) {
					platform.context.waitUntil(deferredWork);
				} else {
					deferredWork.catch((err) => {
						console.error('[deferred] Background work failed:', err);
					});
				}
			}

			const response: StructuredApiResponse = {
				success: true,
				data: {
					template: buildTemplateCreateResponse(newTemplate)
				}
			};

			await invalidateDetailCaches(newTemplate.slug);
			return json(response);
		} catch (error) {
			await releaseAuthoringLease();
			// Slug uniqueness belongs to the create transaction; translate its
			// stable conflict code without reintroducing a check-then-create race.
			if (isTemplateSlugTakenError(error)) {
				return duplicateSlugResponse();
			}

			if (error instanceof Error && error.message === 'TEMPLATE_QUOTA_EXCEEDED') {
				const response: StructuredApiResponse = {
					success: false,
					error: createApiError(
						'authorization',
						'TEMPLATE_QUOTA_EXCEEDED',
						'Monthly template quota exceeded'
					)
				};
				return json(response, { status: 403 });
			}

			// Individual AI-authoring cap. The coded prefix lets the client
			// distinguish this from the org quota and surface the at-cap upgrade
			// card (Voice/Advocate). The human message after the colon is the
			// plan-aware copy from decideIndividualAuthoring.
			if (error instanceof Error && error.message.startsWith('AUTHORING_QUOTA_EXCEEDED:')) {
				const message = error.message.slice('AUTHORING_QUOTA_EXCEEDED:'.length);
				const apiError = createApiError('authorization', 'AUTHORING_QUOTA_EXCEEDED', message);
				// Surface the code in BOTH `error` and `errors[]` so the api client
				// (which forwards `errors` onto ApiClientError) preserves the
				// AUTHORING_QUOTA_EXCEEDED code for the at-cap upgrade card; the
				// `error` message is the plan-aware copy shown inline.
				const response: StructuredApiResponse = {
					success: false,
					error: apiError,
					errors: [apiError]
				};
				return json(response, { status: 403 });
			}

			console.error('Database error creating template:', error);

			const response: StructuredApiResponse = {
				success: false,
				error: createApiError('server', 'SERVER_DATABASE', 'Failed to save template to database')
			};

			return json(response, { status: 500 });
		}
	} catch (error) {
		console.error('Template POST error:', error);

		const response: StructuredApiResponse = {
			success: false,
			error: createApiError('server', 'SERVER_INTERNAL', 'An unexpected error occurred')
		};

		return json(response, { status: 500 });
	}
};
