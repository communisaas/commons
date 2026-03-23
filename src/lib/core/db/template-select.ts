/**
 * Shared Prisma select clause for template list views.
 * Excludes expensive columns never used by list rendering:
 * location_embedding, topic_embedding, research_log, content_hash,
 * embedding_version, embeddings_updated_at, avg_reputation,
 * reputation_delta, reputation_applied, flagged_by_moderation,
 * consensus_approved, verification_status, reviewed_at, reviewed_by,
 * userId.
 */
export const TEMPLATE_LIST_SELECT = {
	id: true,
	slug: true,
	title: true,
	description: true,
	category: true,
	topics: true,
	type: true,
	deliveryMethod: true,
	preview: true,
	message_body: true,
	sources: true,
	delivery_config: true,
	cwc_config: true,
	recipient_config: true,
	metrics: true,
	campaign_id: true,
	status: true,
	is_public: true,
	verified_sends: true,
	unique_districts: true,
	country_code: true,
	createdAt: true,
	updatedAt: true,
	jurisdictions: true,
	user: { select: { id: true, encrypted_name: true, avatar: true } },
	org: { select: { name: true, slug: true, avatar: true } },
	endorsements: {
		select: {
			org: { select: { name: true, slug: true, avatar: true } }
		},
		orderBy: { endorsedAt: 'asc' as const }
	},
} as const;
