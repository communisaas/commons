/**
 * Single builder for the snake_case template payload returned by
 * `POST /api/templates`. Both success exits — duplicate-detected and
 * newly-created — receive the same Convex authoring projection and emit the
 * same key set in the same order, so the mapping lives here once.
 *
 * Key order is observable in the JSON body and the emitted key set is a client
 * contract, so every key is assigned unconditionally.
 */

/**
 * Structural shape of the Convex authoring projection. Deliberately permissive
 * so branded ids, JSON columns and optional counters assign without a cast.
 */
export interface TemplateAuthoringRecord {
	_id: string;
	_creationTime: number;
	slug: string;
	title: string;
	description: string;
	domain?: string;
	category?: string;
	topics?: unknown;
	type: string;
	deliveryMethod: string;
	messageBody: string;
	sources?: unknown;
	researchLog?: unknown;
	preview: string;
	verifiedSends?: number;
	uniqueDistricts?: number;
	deliveryConfig?: unknown;
	cwcConfig?: unknown;
	recipientConfig?: unknown;
	campaignId?: string | null;
	status: string;
	isPublic: boolean;
	scopes?: unknown[];
	updatedAt?: number;
	deduplicated: boolean;
}

/** The response payload contract: 32 keys, always present, in this order. */
export interface TemplateCreateResponse {
	id: string;
	slug: string;
	title: string;
	description: string;
	domain: string;
	topics: string[];
	type: string;
	deliveryMethod: string;
	subject: string;
	message_body: string;
	sources: unknown;
	research_log: unknown;
	preview: string;
	coordinationScale: number;
	isNew: boolean;
	verified_sends: number;
	unique_districts: number;
	send_count: number;
	delivery_config: unknown;
	cwc_config: unknown;
	recipient_config: unknown;
	campaign_id: string | null;
	status: string;
	is_public: boolean;
	jurisdiction_level: null;
	applicable_countries: null;
	specific_locations: null;
	jurisdictions: unknown[];
	scope: null;
	scopes: unknown[];
	createdAt: number;
	updatedAt: number | undefined;
}

/**
 * Map an authoring projection to the API payload.
 *
 * `requested` carries the domain and topics the caller submitted; a submitted
 * value wins over the stored one, which in turn wins over the deprecated
 * `category` column (except the placeholder `'General'`).
 */
export function buildTemplateCreateResponse(
	template: TemplateAuthoringRecord,
	requested: { domain?: string; topics?: string[] } = {}
): TemplateCreateResponse {
	const requestedTopics = requested.topics ?? [];
	const domain =
		(requested.domain ?? '') ||
		template.domain ||
		(template.category !== 'General' ? template.category : '') ||
		'';
	const topics =
		requestedTopics.length > 0 ? requestedTopics : ((template.topics as string[] | undefined) ?? []);
	const verifiedSends = template.verifiedSends ?? 0;

	return {
		id: template._id,
		slug: template.slug,
		title: template.title,
		description: template.description,
		domain,
		topics,
		type: template.type,
		deliveryMethod: template.deliveryMethod,
		subject: template.title,
		message_body: template.messageBody,
		sources: template.sources ?? [],
		research_log: template.researchLog ?? [],
		preview: template.preview,
		coordinationScale: 0,
		isNew: !template.deduplicated,
		verified_sends: verifiedSends,
		unique_districts: template.uniqueDistricts ?? 0,
		send_count: verifiedSends,
		delivery_config: template.deliveryConfig,
		cwc_config: template.cwcConfig,
		recipient_config: template.recipientConfig,
		campaign_id: template.campaignId ?? null,
		status: template.status,
		is_public: template.isPublic,
		jurisdiction_level: null,
		applicable_countries: null,
		specific_locations: null,
		jurisdictions: [],
		scope: null,
		// Fixed empty array: the authoring payload does not surface stored scopes.
		scopes: [],
		createdAt: template._creationTime,
		updatedAt: template.updatedAt
	};
}
