// CONVEX: Fully migrated — moderation (Groq) + embeddings (Gemini) stay in SvelteKit,
// all DB operations go through Convex serverQuery/serverMutation.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import {
	createApiError,
	createValidationError,
	type StructuredApiResponse,
	type ApiError
} from '$lib/types/errors';
import type { UnknownRecord } from '$lib/types/any-replacements';
import { moderateTemplate } from '$lib/core/server/moderation';
import { generateBatchEmbeddings } from '$lib/core/search/gemini-embeddings';
import { createHash } from 'crypto';
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

// Validation schema for template creation
interface CreateTemplateRequest {
	title: string;
	slug?: string;
	message_body: string;
	sources?: Array<{ num: number; title: string; url: string; type: string }>;
	research_log?: string[];
	category?: string;
	topics?: string[];
	type: string;
	deliveryMethod: string;
	preview: string;
	description?: string;
	status?: string;
	is_public?: boolean;
	delivery_config?: UnknownRecord;
	cwc_config?: UnknownRecord;
	recipient_config?: UnknownRecord;
	metrics?: UnknownRecord;
	geographic_scope?: GeoScope;
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

// GET fully migrated to Convex
export const GET: RequestHandler = async () => {
	const templates = await serverQuery(api.templates.listPublic, {});
	const response: StructuredApiResponse = { success: true, data: templates };
	return json(response);
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	try {
		// Parse request body
		let requestData: unknown;
		try {
			requestData = await request.json();
		} catch {
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

		if (!validation.validData) {
			const response: StructuredApiResponse = {
				success: false,
				error: createApiError('validation', 'VALIDATION_MISSING_DATA', 'Validation passed but data is missing')
			};
			return json(response, { status: 400 });
		}
		const validData = validation.validData;

		// === 2-LAYER CONTENT MODERATION (Llama Guard 4 + Gemini) ===
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
			return json(response, { status: 503 });
		}

		const user = locals.user;

		if (user) {
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

			try {
				const hash = contentHash(validData.title, validData.message_body);

				// Content hash dedup via Convex
				const existingByContent = await serverQuery(api.templates.findByContentHash, {
					userId: user.id,
					contentHash: hash
				});

				if (existingByContent) {
					const jsonMetrics =
						typeof existingByContent.metrics === 'object' && existingByContent.metrics !== null
							? (existingByContent.metrics as Record<string, number>)
							: ({} as Record<string, number>);

					const response: StructuredApiResponse = {
						success: true,
						data: { template: {
							id: existingByContent._id,
							slug: existingByContent.slug,
							title: existingByContent.title,
							description: existingByContent.description,
							category: existingByContent.category,
							topics: (existingByContent.topics as string[]) || [],
							type: existingByContent.type,
							deliveryMethod: existingByContent.deliveryMethod,
							subject: existingByContent.title,
							message_body: existingByContent.messageBody,
							preview: existingByContent.preview,
							coordinationScale: 0,
							isNew: false,
							verified_sends: existingByContent.verifiedSends ?? 0,
							unique_districts: existingByContent.uniqueDistricts ?? 0,
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
							delivery_config: existingByContent.deliveryConfig,
							cwc_config: existingByContent.cwcConfig,
							recipient_config: existingByContent.recipientConfig,
							campaign_id: existingByContent.campaignId ?? null,
							status: existingByContent.status,
							is_public: existingByContent.isPublic,
							jurisdiction_level: null,
							applicable_countries: null,
							specific_locations: null,
							jurisdictions: [],
							scope: null,
							scopes: [],
							createdAt: existingByContent._creationTime,
							updatedAt: existingByContent.updatedAt
						} }
					};

					return json(response);
				}

				const slug = validData.slug?.trim()
					? validData.slug.trim()
					: validData.title
							.toLowerCase()
							.replace(/[^a-z0-9\s-]/g, '')
							.replace(/\s+/g, '-')
							.substring(0, 100);

				// Slug uniqueness check via Convex
				const existingTemplate = await serverQuery(api.templates.findBySlug, { slug });

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

				// Create template via Convex (includes quota check + geographic scope)
				const newTemplate = await serverMutation(api.templates.createTemplate, {
					userId: user.id,
					title: validData.title,
					slug,
					description: validData.description || '',
					messageBody: validData.message_body,
					preview: validData.preview,
					type: validData.type,
					deliveryMethod: validData.deliveryMethod,
					category: validData.category || 'General',
					topics: validData.topics || [],
					sources: validData.sources || [],
					researchLog: validData.research_log || [],
					contentHash: hash,
					status: consensusResult?.approved ? 'published' : 'draft',
					isPublic: consensusResult?.approved ?? false,
					deliveryConfig: validData.delivery_config || {},
					cwcConfig: validData.cwc_config || {},
					recipientConfig: validData.recipient_config || {},
					metrics: validData.metrics || {},
					consensusApproved: consensusResult?.approved ?? false,
					geographicScope: validData.geographic_scope
				});

				const templateId = newTemplate._id;
				const isPublic = newTemplate.isPublic;
				const isCwc = validData.deliveryMethod === 'cwc';

				// Deferred work: CWC verification + embedding generation
				if (isCwc || isPublic) {
					const deferredWork = (async () => {
						if (isCwc) {
							try {
								await serverMutation(api.templates.setCwcVerification, {
									templateId: templateId as any,
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
								const locationText = `${newTemplate.title} ${newTemplate.description || ''} ${newTemplate.category}`;
								const topicText = `${newTemplate.title} ${newTemplate.description || ''} ${newTemplate.messageBody}`;

								const embeddings = await generateBatchEmbeddings(
									[locationText, topicText],
									{ taskType: 'RETRIEVAL_DOCUMENT' }
								);

								await serverMutation(api.templates.updateEmbeddings, {
									templateId: templateId as any,
									locationEmbedding: embeddings[0],
									topicEmbedding: embeddings[1]
								});

								console.log(`[deferred] Embeddings generated for template ${templateId}`);
							} catch (embeddingError) {
								console.error('[deferred] Embedding generation failed:', embeddingError);
							}
						}
					})();

					if (platform?.context?.waitUntil) {
						platform.context.waitUntil(deferredWork);
					} else {
						deferredWork.catch(err => {
							console.error('[deferred] Background work failed:', err);
						});
					}
				}

				const jsonMetrics =
					typeof newTemplate.metrics === 'object' && newTemplate.metrics !== null
						? (newTemplate.metrics as Record<string, number>)
						: ({} as Record<string, number>);

				const response: StructuredApiResponse = {
					success: true,
					data: { template: {
						id: newTemplate._id,
						slug: newTemplate.slug,
						title: newTemplate.title,
						description: newTemplate.description,
						category: newTemplate.category,
						topics: (newTemplate.topics as string[]) || [],
						type: newTemplate.type,
						deliveryMethod: newTemplate.deliveryMethod,
						subject: newTemplate.title,
						message_body: newTemplate.messageBody,
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
						delivery_config: newTemplate.deliveryConfig,
						cwc_config: newTemplate.cwcConfig,
						recipient_config: newTemplate.recipientConfig,
						campaign_id: newTemplate.campaignId ?? null,
						status: newTemplate.status,
						is_public: newTemplate.isPublic,
						jurisdiction_level: null,
						applicable_countries: null,
						specific_locations: null,
						jurisdictions: [],
						scope: null,
						scopes: [],
						createdAt: newTemplate._creationTime,
						updatedAt: newTemplate.updatedAt
					} }
				};

				return json(response);
			} catch (error) {
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

				console.error('Database error creating template:', error);

				const response: StructuredApiResponse = {
					success: false,
					error: createApiError('server', 'SERVER_DATABASE', 'Failed to save template to database')
				};

				return json(response, { status: 500 });
			}
		} else {
			const response: StructuredApiResponse = {
				success: false,
				error: createApiError('auth', 'AUTH_REQUIRED', 'Authentication required to create templates')
			};
			return json(response, { status: 401 });
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
