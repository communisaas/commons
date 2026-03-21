import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/core/db';
import { TEMPLATE_LIST_SELECT } from '$lib/core/db/template-select';
import {
	createApiError,
	createValidationError,
	type StructuredApiResponse,
	type ApiError
} from '$lib/types/errors';
import type { Prisma as _Prisma, Prisma } from '@prisma/client';
import type { InputJsonValue } from '@prisma/client/runtime/library';
import type { UnknownRecord } from '$lib/types/any-replacements';
import { moderateTemplate } from '$lib/core/server/moderation';
import { generateBatchEmbeddings } from '$lib/core/search/gemini-embeddings';
import { z } from 'zod';
import { createHash } from 'crypto';

// Import GeoScope for agent-extracted geographic scope
import type { GeoScope } from '$lib/core/agents/types';

/** Content-addressable fingerprint: same title + body = same template */
function contentHash(title: string, body: string): string {
	return createHash('sha256').update(`${title}\0${body}`).digest('hex').slice(0, 40);
}

/** Sanitize slug: lowercase, alphanumeric + hyphens only, max 100 chars */
function sanitizeSlug(slug: string | undefined): string | undefined {
	if (!slug) return undefined;
	return slug
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 100) || undefined;
}

// Validation schema for template creation - matches Prisma schema field names
interface CreateTemplateRequest {
	title: string;
	slug?: string; // AI-generated slug (sanitized before use)
	message_body: string;
	sources?: Array<{ num: number; title: string; url: string; type: string }>; // Citation sources from AI agent
	research_log?: string[]; // Agent's research process log
	category?: string;
	topics?: string[]; // Topic tags from AI (1-5 lowercase strings for search/filtering)
	type: string;
	deliveryMethod: string; // Prisma field name (mapped to delivery_method in database)
	preview: string;
	description?: string;
	status?: string;
	is_public?: boolean;
	delivery_config?: UnknownRecord;
	cwc_config?: UnknownRecord;
	recipient_config?: UnknownRecord;
	metrics?: UnknownRecord;
	geographic_scope?: GeoScope; // Agent-extracted geographic scope for TemplateScope creation
}

type ValidationError = ApiError;

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

	// Required fields validation
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
	}

	if (errors.length > 0) {
		return { isValid: false, errors };
	}

	// Return valid data with defaults
	const validData: CreateTemplateRequest = {
		title: templateData.title as string,
		slug: sanitizeSlug(templateData.slug as string) || undefined,
		message_body: templateData.message_body as string,
		sources:
			(templateData.sources as Array<{ num: number; title: string; url: string; type: string }>) ||
			[],
		research_log: (templateData.research_log as string[]) || [],
		preview: templateData.preview as string,
		type: templateData.type as string,
		deliveryMethod: templateData.deliveryMethod as string,
		category: (templateData.category as string) || 'General',
		topics: (templateData.topics as string[]) || [],
		description:
			(templateData.description as string) ||
			(templateData.preview as string)?.substring(0, 160) ||
			'',
		status: (templateData.status as string) || 'draft',
		is_public: Boolean(templateData.is_public) || false,
		delivery_config: (templateData.delivery_config as UnknownRecord) || {},
		cwc_config: (templateData.cwc_config as UnknownRecord) || {},
		recipient_config: (templateData.recipient_config as UnknownRecord) || {},
		metrics: (templateData.metrics as UnknownRecord) || {
			sent: 0,
			opened: 0,
			clicked: 0
		},
		geographic_scope: (templateData.geographic_scope as GeoScope) || undefined
	};

	return { isValid: true, errors: [], validData };
}

export const GET: RequestHandler = async () => {
	try {
		const dbTemplates = await db.template.findMany({
			where: { is_public: true },
			orderBy: { createdAt: 'desc' },
			select: TEMPLATE_LIST_SELECT,
		});

		const templateIds = dbTemplates.map((t) => t.id);

		// Parallelize independent queries
		const [activeDebates, rawScopes] = await Promise.all([
			(db as unknown as {
				debate: { findMany: (params: unknown) => Promise<{ template_id: string }[]> };
			}).debate.findMany({
				where: { status: 'active' },
				select: { template_id: true },
				distinct: ['template_id']
			}).catch(() => [] as { template_id: string }[]),

			(db as unknown as {
				templateScope: { findMany: (params: unknown) => Promise<UnknownRecord[]> };
			}).templateScope.findMany({
				where: { template_id: { in: templateIds } }
			}).catch(() => [] as UnknownRecord[]),
		]);

		const activeDebateTemplateIds = new Set(activeDebates.map((d) => d.template_id));

		// Group by template_id (a template may have multiple scopes)
		const scopesByTemplateId = new Map<string, UnknownRecord[]>();
		for (const s of rawScopes) {
			const tid = s.template_id as string;
			const arr = scopesByTemplateId.get(tid);
			if (arr) {
				arr.push(s);
			} else {
				scopesByTemplateId.set(tid, [s]);
			}
		}

		// Zod schema for metrics validation
		const MetricsSchema = z
			.object({
				opened: z.number().optional(),
				clicked: z.number().optional(),
				responded: z.number().optional(),
				total_districts: z.number().optional(),
				district_coverage_percent: z.number().optional(),
				personalization_rate: z.number().optional(),
				effectiveness_score: z.number().optional(),
				cascade_depth: z.number().optional(),
				viral_coefficient: z.number().optional(),
				onboarding_starts: z.number().optional(),
				onboarding_completes: z.number().optional(),
				auth_completions: z.number().optional(),
				shares: z.number().optional()
			})
			.passthrough();

		const formattedTemplates = dbTemplates.map((template) => {
			// Extract metrics from JSON field with validation
			let jsonMetrics = {};
			if (typeof template.metrics === 'string') {
				try {
					const parsed = JSON.parse(template.metrics);
					const result = MetricsSchema.safeParse(parsed);
					if (result.success) {
						jsonMetrics = result.data;
					} else {
						console.warn(
							`[Templates API] Invalid metrics for template ${template.id}:`,
							result.error.flatten()
						);
					}
				} catch (error) {
					console.warn(`[Templates API] Failed to parse metrics for template ${template.id}:`, error);
				}
			} else {
				const result = MetricsSchema.safeParse(template.metrics || {});
				if (result.success) {
					jsonMetrics = result.data;
				} else {
					console.warn(
						`[Templates API] Invalid metrics object for template ${template.id}:`,
						result.error.flatten()
					);
				}
			}

			// Calculate coordination scale (0-1 range, logarithmic for perceptual encoding)
			// 1 send = 0.0, 10 sends = 0.33, 100 sends = 0.67, 1000+ sends = 1.0
			const sendCount = template.verified_sends || 0;
			const coordinationScale = Math.min(1.0, Math.log10(Math.max(1, sendCount)) / 3);

			// Determine if template is "new" (created in last 7 days)
			const createdAt = new Date(template.createdAt);
			const now = new Date();
			const daysSinceCreation = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
			const isNew = daysSinceCreation <= 7;

			return {
				id: template.id,
				slug: template.slug,
				title: template.title,
				description: template.description,
				category: template.category,
				topics: (template.topics as string[]) || [],
				type: template.type,
				deliveryMethod: template.deliveryMethod,
				subject: template.title,
				message_body: template.message_body,
				preview: template.preview,
				// Org endorsement: institutional provenance for the perceptual bridge
				endorsingOrg: template.org
					? { name: template.org.name, slug: template.org.slug, avatar: template.org.avatar }
					: null,
				endorsingOrgs: (template.endorsements ?? [])
					.filter((e: { org: { slug: string } }) => e.org.slug !== template.org?.slug)
					.map((e: { org: { name: string; slug: string; avatar: string | null } }) => ({
						name: e.org.name, slug: e.org.slug, avatar: e.org.avatar
					})),

				// === PERCEPTUAL ENCODING PROPERTIES ===
				coordinationScale, // 0-1 scale for visual weight (card size)
				isNew, // Temporal signal for "New" badge
				hasActiveDebate: activeDebateTemplateIds.has(template.id), // Status signal for deliberation

				// === AGGREGATE METRICS (consistent with schema) ===
				verified_sends: template.verified_sends, // Integer field from schema
				unique_districts: template.unique_districts, // Integer field from schema
				send_count: template.verified_sends, // Frontend compatibility (mapped from verified_sends)

				// === METRICS OBJECT (backward compatibility + JSON fields) ===
				metrics: {
					// Aggregate fields (single source of truth)
					sent: template.verified_sends, // Use schema field as source of truth
					districts_covered: template.unique_districts, // Use schema field as source of truth

					// JSON-only metrics (not in schema as integers)
					opened: (jsonMetrics as { opened?: number }).opened || 0,
					clicked: (jsonMetrics as { clicked?: number }).clicked || 0,
					responded: (jsonMetrics as { responded?: number }).responded || 0,

					// Congressional-specific (fallback to JSON if not in aggregate)
					total_districts: (jsonMetrics as { total_districts?: number }).total_districts || 435,
					district_coverage_percent:
						(jsonMetrics as { district_coverage_percent?: number }).district_coverage_percent ||
						(template.unique_districts ? Math.round((template.unique_districts / 435) * 100) : 0),

					// AI/Analytics metrics from JSON
					personalization_rate:
						(jsonMetrics as { personalization_rate?: number }).personalization_rate || 0,
					effectiveness_score: (jsonMetrics as { effectiveness_score?: number })
						.effectiveness_score,
					cascade_depth: (jsonMetrics as { cascade_depth?: number }).cascade_depth,
					viral_coefficient: (jsonMetrics as { viral_coefficient?: number }).viral_coefficient,

					onboarding_starts: (jsonMetrics as { onboarding_starts?: number }).onboarding_starts,
					onboarding_completes: (jsonMetrics as { onboarding_completes?: number })
						.onboarding_completes,
					auth_completions: (jsonMetrics as { auth_completions?: number }).auth_completions,
					shares: (jsonMetrics as { shares?: number }).shares
				},

				campaign_id: template.campaign_id,
				status: template.status,
				is_public: template.is_public,

				// Jurisdictions for location filtering (Phase 3)
				jurisdictions: template.jurisdictions || [],

				// Scope from TemplateScope table (singular — first scope for backward compat)
				scope: (scopesByTemplateId.get(template.id) ?? [])[0] || null,
				// Scopes array for ClientSideTemplateFilter hierarchical matching
				scopes: scopesByTemplateId.get(template.id) ?? [],

				recipientEmails: []
			};
		});

		const response: StructuredApiResponse = {
			success: true,
			data: formattedTemplates
		};

		return json(response);
	} catch (error) {
		console.error('Templates API error:', error);
		console.error('Error details:', {
			message: error instanceof Error ? error.message : 'Unknown error',
			stack: error instanceof Error ? error.stack : undefined,
			name: error instanceof Error ? error.name : undefined
		});

		const response: StructuredApiResponse = {
			success: false,
			error: createApiError('server', 'SERVER_DATABASE', 'Failed to fetch templates')
		};

		return json(response, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	try {
		// Parse request body
		let requestData: unknown;
		try {
			requestData = await request.json();
		} catch (error) {
			const response: StructuredApiResponse = {
				success: false,
				error: createApiError(
					'validation',
					'VALIDATION_INVALID_FORMAT',
					'Invalid JSON in request body'
				)
			};
			return json(response, { status: 400 });
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

		// validData is guaranteed to exist when isValid is true
		if (!validation.validData) {
			const response: StructuredApiResponse = {
				success: false,
				error: createApiError('validation', 'VALIDATION_MISSING_DATA', 'Validation passed but data is missing')
			};
			return json(response, { status: 400 });
		}
		const validData = validation.validData;

		// === 2-LAYER CONTENT MODERATION (Llama Guard 4 + Gemini) ===
		// Layer 1: Llama Guard 4 (MLCommons S1-S14 hazard taxonomy)
		//   - Elections (S13), Defamation (S5), specialized for civic content
		//   - 14,400 free requests/day via GROQ
		// Layer 2: Gemini 3 Flash (quality assessment)
		//   - Policy relevance, professionalism, congressional appropriateness
		let consensusResult;

		try {
			const moderationResult = await moderateTemplate({
				title: validData.title,
				message_body: validData.message_body
			});

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
				return json(response, { status: 400 });
			}

			// Convert to legacy format for backward compatibility with DB storage
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
			// Atomic: if moderation fails, don't create the template
			// This prevents slug consumption on failed publishes
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
			return json(response, { status: 503 });
		}

		const user = locals.user;

		if (user) {
			// Anti-astroturf gate: require verified identity OR sufficient reputation (G-03)
			// Prevents unverified accounts from flooding the template pool
			const isVerified = user.is_verified === true;
			const hasSufficientReputation = (user.trust_score ?? 0) >= 100;
			if (!isVerified && !hasSufficientReputation) {
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

			// Authenticated user - save to database
			try {
				// Content-addressable identity: same author + same content = same template
				const hash = contentHash(validData.title, validData.message_body);

				const existingByContent = await db.template.findFirst({
					where: { userId: user.id, content_hash: hash }
				});

				if (existingByContent) {
					// Idempotent: return the existing template as a success.
					// The user's intent was to publish, and it's published.
					const jsonMetrics =
						typeof existingByContent.metrics === 'object' && existingByContent.metrics !== null
							? (existingByContent.metrics as Record<string, number>)
							: ({} as Record<string, number>);

					const response: StructuredApiResponse = {
						success: true,
						data: { template: {
							id: existingByContent.id,
							slug: existingByContent.slug,
							title: existingByContent.title,
							description: existingByContent.description,
							category: existingByContent.category,
							topics: (existingByContent.topics as string[]) || [],
							type: existingByContent.type,
							deliveryMethod: existingByContent.deliveryMethod,
							subject: existingByContent.title,
							message_body: existingByContent.message_body,
							preview: existingByContent.preview,
							coordinationScale: 0,
							isNew: false,
							verified_sends: existingByContent.verified_sends,
							unique_districts: existingByContent.unique_districts,
							send_count: jsonMetrics.sent || 0,
							metrics: {
								sent: jsonMetrics.sent || 0,
								districts_covered: jsonMetrics.districts_covered || 0,
								opened: jsonMetrics.opened || 0,
								clicked: jsonMetrics.clicked || 0,
								responded: jsonMetrics.responded || 0,
								total_districts: jsonMetrics.total_districts || 435,
								district_coverage_percent: jsonMetrics.district_coverage_percent || 0,
								personalization_rate: 0
							},
							delivery_config: existingByContent.delivery_config,
							cwc_config: existingByContent.cwc_config,
							recipient_config: existingByContent.recipient_config,
							campaign_id: existingByContent.campaign_id,
							status: existingByContent.status,
							is_public: existingByContent.is_public,
							jurisdiction_level: null,
							applicable_countries: null,
							specific_locations: null,
							jurisdictions: [],
							scope: null,
							scopes: [],
							createdAt: existingByContent.createdAt,
							updatedAt: existingByContent.updatedAt
						} }
					};

					return json(response);
				}

				// Use pre-sanitized slug if provided, otherwise generate from title
				const slug = validData.slug?.trim()
					? validData.slug.trim()
					: validData.title
							.toLowerCase()
							.replace(/[^a-z0-9\s-]/g, '')
							.replace(/\s+/g, '-')
							.substring(0, 100);

				const existingTemplate = await db.template.findUnique({
					where: { slug }
				});

				if (existingTemplate) {
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

				// Create template with optional TemplateScope in a transaction
				const newTemplate = await db.$transaction(async (tx) => {
					// Step 1: Create the template
					const template = await tx.template.create({
						data: {
							title: validData.title,
							description: validData.description || '',
							message_body: validData.message_body,
							sources: validData.sources || [],
							research_log: validData.research_log || [],
							category: validData.category || 'General',
							topics: validData.topics || [],
							type: validData.type,
							deliveryMethod: validData.deliveryMethod,
							preview: validData.preview,
							delivery_config: (validData.delivery_config || {}) as InputJsonValue,
							cwc_config: (validData.cwc_config || {}) as InputJsonValue,
							recipient_config: (validData.recipient_config || {}) as InputJsonValue,
							metrics: (validData.metrics || {}) as InputJsonValue,
							// Auto-publish if moderation passes - no manual review needed
							status: consensusResult?.approved ? 'published' : 'draft',
							is_public: consensusResult?.approved ?? false,
							slug,
							content_hash: hash,
							// Use Prisma relation connect syntax instead of scalar userId
							user: { connect: { id: user.id } },
							// Consolidated verification fields with defaults
							verification_status: consensusResult?.approved ? 'approved' : 'pending',
							country_code: 'US',
							reputation_applied: false,
							// Multi-agent consensus tracking via consensus_approved boolean
							consensus_approved: consensusResult?.approved ?? false
						}
					});

					// Step 2: Create TemplateScope if geographic_scope was extracted
					if (validData.geographic_scope && validData.geographic_scope.type !== 'international') {
						const geo = validData.geographic_scope;

						// Derive DB fields from GeoScope discriminated union
						let countryCode = 'US';
						let regionCode: string | null = null;
						let localityCode: string | null = null;
						let scopeLevel = 'country';
						let displayText = 'Nationwide';

						if (geo.type === 'nationwide') {
							countryCode = geo.country;
							displayText = geo.country;
						} else if (geo.type === 'subnational') {
							countryCode = geo.country;
							if (geo.subdivision) {
								regionCode = geo.subdivision;
								scopeLevel = 'region';
								displayText = geo.subdivision;
							}
							if (geo.locality) {
								localityCode = geo.locality;
								scopeLevel = 'locality';
								displayText = geo.locality + (geo.subdivision ? `, ${geo.subdivision}` : '');
							}
						}

						await tx.templateScope.create({
							data: {
								template_id: template.id,
								country_code: countryCode,
								region_code: regionCode,
								locality_code: localityCode,
								display_text: displayText,
								scope_level: scopeLevel,
								confidence: 1.0,
								extraction_method: 'gemini_inline',
								power_structure_type: null,
								audience_filter: null,
								scope_notes: null,
								validated_against: null
							}
						});
					}

					return template;
				});

				// Deferred work: CWC verification + embeddings run after response is sent.
				// These are non-user-facing side effects that inflate response latency
				// and cause client timeouts when external APIs (Gemini, GROQ) are slow.
				const templateId = newTemplate.id;
				const isPublic = newTemplate.is_public;
				const isCwc = validData.deliveryMethod === 'cwc';

				if (isCwc || isPublic) {
					// Deferred work: runs after response is sent.
					// On Vercel, waitUntil keeps the function alive until the promise resolves.
					// Without it, the serverless function may terminate before Gemini returns.
					const deferredWork = (async () => {
						if (isCwc) {
							try {
								await db.template.update({
									where: { id: templateId },
									data: {
										verification_status: 'pending',
										country_code: 'US',
										reputation_applied: false
									}
								});
								console.log(`[deferred] CWC verification set for template ${templateId}`);
							} catch (error) {
								console.error('[deferred] CWC verification failed:', error);
							}
						}

						if (isPublic) {
							try {
								const locationText = `${newTemplate.title} ${newTemplate.description || ''} ${newTemplate.category}`;
								const topicText = `${newTemplate.title} ${newTemplate.description || ''} ${newTemplate.message_body}`;

								const embeddings = await generateBatchEmbeddings(
									[locationText, topicText],
									{ taskType: 'RETRIEVAL_DOCUMENT' }
								);

								const locationVec = `[${embeddings[0].join(',')}]`;
								const topicVec = `[${embeddings[1].join(',')}]`;

								await db.$executeRaw`
									UPDATE "Template"
									SET location_embedding = ${locationVec}::vector,
										topic_embedding = ${topicVec}::vector,
										embedding_version = 'v1',
										embeddings_updated_at = NOW()
									WHERE id = ${templateId}
								`;

								console.log(`[deferred] Embeddings generated for template ${templateId}`);
							} catch (embeddingError) {
								console.error('[deferred] Embedding generation failed:', embeddingError);
							}
						}
					})();

					if (platform?.context?.waitUntil) {
						platform.context.waitUntil(deferredWork);
					} else {
						// Local dev / non-Vercel: fire-and-forget is fine
						deferredWork.catch(err => console.error('[deferred] Background work failed:', err));
					}
				}

				const response: StructuredApiResponse = {
					success: true,
					data: { template: (() => {
					// Transform to match GET response shape — client validates computed fields
					const jsonMetrics =
						typeof newTemplate.metrics === 'object' && newTemplate.metrics !== null
							? (newTemplate.metrics as Record<string, number>)
							: ({} as Record<string, number>);
					return {
						id: newTemplate.id,
						slug: newTemplate.slug,
						title: newTemplate.title,
						description: newTemplate.description,
						category: newTemplate.category,
						topics: (newTemplate.topics as string[]) || [],
						type: newTemplate.type,
						deliveryMethod: newTemplate.deliveryMethod,
						subject: newTemplate.title,
						message_body: newTemplate.message_body,
						preview: newTemplate.preview,
						coordinationScale: 0,
						isNew: true,
						verified_sends: 0,
						unique_districts: 0,
						send_count: 0,
						metrics: {
							sent: 0,
							districts_covered: 0,
							opened: jsonMetrics.opened || 0,
							clicked: jsonMetrics.clicked || 0,
							responded: jsonMetrics.responded || 0,
							total_districts: 435,
							district_coverage_percent: 0,
							personalization_rate: 0
						},
						delivery_config: newTemplate.delivery_config,
						cwc_config: newTemplate.cwc_config,
						recipient_config: newTemplate.recipient_config,
						campaign_id: newTemplate.campaign_id,
						status: newTemplate.status,
						is_public: newTemplate.is_public,
						jurisdiction_level: null,
						applicable_countries: null,
						specific_locations: null,
						jurisdictions: [],
						scope: null,
						scopes: [],
						createdAt: newTemplate.createdAt,
						updatedAt: newTemplate.updatedAt
					};
				})() }
				};

				return json(response);
			} catch (error) {
				console.error('Database error creating template:', error);
				console.error('Template creation error details:', {
					message: error instanceof Error ? error.message : 'Unknown error',
					stack: error instanceof Error ? error.stack : undefined
				});

				const response: StructuredApiResponse = {
					success: false,
					error: createApiError('server', 'SERVER_DATABASE', 'Failed to save template to database')
				};

				return json(response, { status: 500 });
			}
		} else {
			// Guest users cannot create templates - require authentication
			const response: StructuredApiResponse = {
				success: false,
				error: createApiError('auth', 'AUTH_REQUIRED', 'Authentication required to create templates')
			};
			return json(response, { status: 401 });
		}
	} catch (error) {
		console.error('Template POST error:', error);
		console.error('POST error details:', {
			message: error instanceof Error ? error.message : 'Unknown error',
			stack: error instanceof Error ? error.stack : undefined
		});

		const response: StructuredApiResponse = {
			success: false,
			error: createApiError('server', 'SERVER_INTERNAL', 'An unexpected error occurred')
		};

		return json(response, { status: 500 });
	}
};
