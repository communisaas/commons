import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import {
	recipientFilterValidator,
	smsRecipientFilterValidator,
	eventRsvpStatus,
	emailBlastStatus,
	smsBlastStatus,
	smsMessageStatus,
	debateStatus,
	accountabilityCausalityClass,
	accountabilityResponseType
} from './_validators';
import { campaignReadModelStateValidator } from './lib/campaignReadModel';
import { shadowAtlasEngagementStateValidator } from './lib/shadowAtlasEngagement';
import { shadowAtlasTree1OperationStateValidator } from './lib/shadowAtlasRegistration';

// =============================================================================
// Commons Convex Schema
//
// Flattened child tables:
//   template_jurisdiction + template_scope → nested in `templates`
//   template_campaign → DROPPED (redundant with campaign.templateId)
//   email_batch → flattened into `emailBlasts` (batches as array)
//   event_attendance → merged into `eventRsvps` (checkedInAt, verified, etc.)
//   institution → folded into `decisionMakers`
//   report_response → folded into `accountabilityReceipts`
//   an_sync → folded into org settings (JSON on `organizations`)
//   legislative_channel → folded into `decisionMakers`
//
// Separated tables (un-flattened for unbounded growth):
//   campaign_delivery → `campaignDeliveries` (1 action → 0-8 deliveries)
//   workflow_action_log → `workflowActionLogs` (unbounded per execution)
//   privacy_budget → `privacyBudgets` (was discriminated in `analytics`)
//
// Conventions:
//   - camelCase table names
//   - `_id` and `_creationTime` are automatic (no `id`/`createdAt` fields)
//   - DateTime → v.number() (epoch ms)
//   - FK relations → v.id("tableName")
//   - Defaults / updatedAt → handled in mutations, not schema
//   - PII fields (encrypted_email, email_hash) → v.string()
//   - Vector embeddings → v.optional(v.array(v.float64())) + .vectorIndex()
// =============================================================================

export default defineSchema({
	// ===========================================================================
	// USERS & AUTH
	// ===========================================================================

	users: defineTable({
		// Auth
		tokenIdentifier: v.optional(v.string()),
		avatar: v.optional(v.string()),
		updatedAt: v.number(),

		// Verification
		isVerified: v.boolean(),
		verificationMethod: v.optional(v.string()),
		verifiedAt: v.optional(v.number()),

		// Sybil resistance
		identityHash: v.optional(v.string()),
		identityFingerprint: v.optional(v.string()),
		birthYear: v.optional(v.number()),

		// Cross-provider identity deduplication
		identityCommitment: v.optional(v.string()),
		// Durable Tree-3 lease, one-write reservation, and short proof snapshot.
		// This lives on the user row so the authenticated primary-key lookup and
		// state transition remain one serializable document operation.
		shadowAtlasEngagement: v.optional(shadowAtlasEngagementStateValidator),
		// Durable Tree-1 register/replace entitlement. The operation remains on
		// the user row after commit so a lost HTTP response cannot mint a second
		// external write when the browser retries the same leaf.
		shadowAtlasTree1Operation: v.optional(shadowAtlasTree1OperationStateValidator),

		// Document type
		documentType: v.optional(v.string()), // 'passport' | 'drivers_license' | 'national_id'

		// User secret derivation
		encryptedEntropy: v.optional(v.string()),

		// Authority & trust
		authorityLevel: v.number(), // 1-5
		trustTier: v.number(), // 0-5

		// Passkey / WebAuthn
		passkeyCredentialId: v.optional(v.string()),
		passkeyPublicKeyJwk: v.optional(v.any()), // JSON
		passkeyPublicKey: v.optional(v.string()), // Base64url COSE public key bytes
		passkeyCounter: v.optional(v.number()),
		passkeyTransports: v.optional(v.array(v.string())),
		passkeyDeviceType: v.optional(v.string()),
		passkeyBackedUp: v.optional(v.boolean()),
		passkeyAaguid: v.optional(v.string()),
		didKey: v.optional(v.string()),
		passkeyCreatedAt: v.optional(v.number()),
		passkeyLastUsedAt: v.optional(v.number()),

		// Address attestation
		addressVerificationMethod: v.optional(v.string()),
		addressVerifiedAt: v.optional(v.number()),

		// Wallet
		walletAddress: v.optional(v.string()),
		walletType: v.optional(v.string()), // 'evm' | 'near'
		districtHash: v.optional(v.string()),

		// PII — plaintext (post-PII-elimination model)
		email: v.optional(v.string()),
		name: v.optional(v.string()),
		// Deprecated — server-held PII encryption was eliminated; these fields
		// are NEITHER written NOR read by current code. They remain in the
		// schema only because Convex schema removal requires clearing all
		// existing data first; the cleanup is bookkeeping, not load-bearing.
		encryptedEmail: v.optional(v.string()),
		encryptedName: v.optional(v.string()),
		emailHash: v.optional(v.string()),
		encryptedProfile: v.optional(v.string()),
		custodyMode: v.optional(v.string()),

		// NEAR account
		nearAccountId: v.optional(v.string()),
		nearPublicKey: v.optional(v.string()),
		encryptedNearPrivateKey: v.optional(v.string()),
		nearRecoveryPublicKey: v.optional(v.string()),
		nearDerivedScrollAddress: v.optional(v.string()),
		trustScore: v.number(),
		reputationTier: v.string(),

		// ZK verification
		districtVerified: v.boolean(),

		// Reputation fields
		templatesContributed: v.number(),
		templateAdoptionRate: v.float64(),
		peerEndorsements: v.number(),
		activeMonths: v.number(),

		// Verified-action count for reputation-tier promotion. Hybrid model:
		// incremented on-action inside createCampaignAction (registered verified
		// paths supplying userId), in the same transaction that derives and writes
		// reputationTier and stamps immutable action attribution. Optional because
		// pre-T10-1 rows didn't carry it; the explicit legacy repair treats missing as 0.
		actionCount: v.optional(v.number()),

		// Profile
		role: v.optional(v.string()),
		organization: v.optional(v.string()),
		location: v.optional(v.string()),
		connection: v.optional(v.string()),
		profileCompletedAt: v.optional(v.number()),
		profileVisibility: v.string(), // 'private' | 'public'

		// Stripe customer for individual (person-layer) paid authoring tiers.
		// Mirrors organizations.stripeCustomerId so the individual checkout can
		// find-or-create one Stripe customer per user and the webhook can resolve
		// the user from the customer. Org subs use organizations.stripeCustomerId.
		stripeCustomerId: v.optional(v.string())
	})
		.index('by_tokenIdentifier', ['tokenIdentifier'])
		.index('by_email', ['email'])
		.index('by_emailHash', ['emailHash'])
		.index('by_identityHash', ['identityHash'])
		.index('by_identityCommitment', ['identityCommitment'])
		.index('by_passkeyCredentialId', ['passkeyCredentialId'])
		.index('by_didKey', ['didKey'])
		.index('by_walletAddress', ['walletAddress'])
		.index('by_nearAccountId', ['nearAccountId'])
		.index('by_stripeCustomerId', ['stripeCustomerId']),

	sessions: defineTable({
		userId: v.id('users'),
		expiresAt: v.number()
	})
		.index('by_userId', ['userId'])
		.index('by_expiresAt', ['expiresAt']),

	// Compact authority read by the SvelteKit hook for every cookie-bearing
	// request. Keep this strict allowlist separate from the mutable/wide users
	// document so unrelated profile, billing, and reputation writes cannot
	// invalidate or inflate the global authentication path.
	userSessionAuthorities: defineTable({
		userId: v.id('users'),
		userCreatedAt: v.number(),
		// Optional only for historical users that predate plaintext-email repair.
		// The request boundary fails those rows closed until OAuth backfills email.
		email: v.optional(v.string()),
		tokenIdentifier: v.optional(v.string()),
		name: v.optional(v.string()),
		avatar: v.optional(v.string()),
		isVerified: v.boolean(),
		verificationMethod: v.optional(v.string()),
		verifiedAt: v.optional(v.number()),
		passkeyCredentialId: v.optional(v.string()),
		identityCommitment: v.optional(v.string()),
		documentType: v.optional(v.string()),
		districtHash: v.optional(v.string()),
		districtVerified: v.boolean(),
		addressVerifiedAt: v.optional(v.number()),
		trustScore: v.number(),
		walletAddress: v.optional(v.string()),
		version: v.number()
	}).index('by_userId', ['userId']),

	sessionAuthorityMigrations: defineTable({
		key: v.literal('v1'),
		status: v.union(
			v.literal('running'),
			v.literal('migrated'),
			v.literal('ready'),
			v.literal('blocked')
		),
		runToken: v.string(),
		cursor: v.optional(v.string()),
		scanComplete: v.boolean(),
		scanned: v.number(),
		written: v.number(),
		failureCode: v.optional(v.string()),
		failureUserId: v.optional(v.id('users')),
		startedAt: v.number(),
		completedAt: v.optional(v.number()),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	passkeyCeremonySessions: defineTable({
		userId: v.id('users'),
		email: v.optional(v.string()),
		type: v.string(), // 'registration' | 'authentication'
		challenge: v.string(),
		passkeyCredentialId: v.optional(v.string()),
		status: v.string(), // 'pending' | 'consumed' | 'expired'
		expiresAt: v.number(),
		consumedAt: v.optional(v.number()),
		updatedAt: v.number()
	})
		.index('by_userId', ['userId'])
		.index('by_expiresAt', ['expiresAt'])
		.index('by_challenge', ['challenge'])
		.index('by_status', ['status']),

	accounts: defineTable({
		userId: v.id('users'),
		type: v.string(),
		provider: v.string(),
		providerAccountId: v.string(),
		expiresAt: v.optional(v.number()),
		tokenType: v.optional(v.string()),
		scope: v.optional(v.string()),
		sessionState: v.optional(v.string()),

		// Encrypted tokens (AES-256-GCM)
		encryptedAccessToken: v.optional(v.any()),
		encryptedRefreshToken: v.optional(v.any()),
		encryptedIdToken: v.optional(v.any()),

		updatedAt: v.number(),

		// Sybil resistance
		emailVerified: v.boolean()
	})
		.index('by_userId', ['userId'])
		.index('by_provider_providerAccountId', ['provider', 'providerAccountId']),

	// ===========================================================================
	// TEMPLATES (with flattened jurisdictions + scopes)
	// ===========================================================================

	templates: defineTable({
		slug: v.string(),
		title: v.string(),
		description: v.string(),
		domain: v.optional(v.string()), // Civic domain synthesized from topics — optional for pre-migration documents
		category: v.optional(v.string()), // DEPRECATED: pre-migration field, replaced by domain. Kept for schema compat with existing documents.
		topics: v.optional(v.any()), // JSON array of topic tags
		type: v.string(),
		deliveryMethod: v.union(v.literal('cwc'), v.literal('email')),
		preview: v.string(),
		messageBody: v.string(),
		sources: v.optional(v.any()),
		researchLog: v.optional(v.any()),
		cachedSources: v.optional(v.any()),
		sourcesCachedAt: v.optional(v.number()),
		sourceCacheInputHash: v.optional(v.string()),
		deliveryConfig: v.any(),
		cwcConfig: v.optional(v.any()),
		recipientConfig: v.any(),
		// DEAD FIELD: no writer anywhere in convex/ or src/ sets
		// templates.campaignId. Two readers echo it null to the v1 API
		// contract for stability:
		//   - convex/templates.ts:1590 (public discovery payload)
		//   - src/lib/server/templates/authoring-response.ts (authoring endpoint)
		// All emit `campaign_id: ... ?? null`. Field removal requires
		// consumers to drop the key, then a schema deploy. Template→
		// campaign linkage goes the other way (campaigns.templateId).
		// See [[F22-templates-campaignId-dead]].
		campaignId: v.optional(v.string()),
		status: v.string(), // 'draft' | 'published' | etc.
		isPublic: v.boolean(),

		// Civic reach counters (incremented on delivery)
		verifiedSends: v.number(),
		uniqueDistricts: v.number(),
		deliveredDistricts: v.optional(v.array(v.string())), // bounded: max 435 congressional districts
		avgReputation: v.optional(v.float64()),
		endorsementCount: v.optional(v.number()),

		// Per-template dimensional aggregates, denormalized at delivery time so
		// the homepage TemplateList can render citation-scale Pulse / Ratio /
		// Rings inline per row without joining or re-aggregating per request.
		// Updated by submissions.incrementTemplateReach on each verified delivery.
		// dailyArrivals: rolling 30-day daily-bucketed counts (oldest first).
		// dailyArrivalsLastDay: epoch ms of the most recent day, used to detect
		// day-rollover and shift the array left when a new day arrives.
		// districtCounts: per-district send counts, capped at 500 entries (matches
		// deliveredDistricts cap). Read-time consumers truncate to top-N.
		// tierCounts: counts per identity tier, length 6 (index = tier 0-5).
		dailyArrivals: v.optional(v.array(v.number())),
		dailyArrivalsLastDay: v.optional(v.number()),
		districtCounts: v.optional(v.array(v.object({ code: v.string(), count: v.number() }))),
		tierCounts: v.optional(v.array(v.number())),

		// Semantic embeddings (768-dim Gemini vectors). All three are SERVER-ONLY:
		// consumed for vector search, relatedness twins, concept edges, and hue
		// projection. Public template queries (`list`, `search`, `listPublic`,
		// `getBySlugPublic`) return explicit allowlist projections that omit them,
		// so these fields never cross the client boundary.
		locationEmbedding: v.optional(v.array(v.float64())),
		topicEmbedding: v.optional(v.array(v.float64())),
		// Per-tag embeddings, generated the same way as topicEmbedding (one Gemini
		// vector per raw tag). Consumed to cluster tags into concepts and derive
		// concept edges; only concept labels and edge tuples cross out, never the
		// vectors (stripped by the same projection as the other embeddings).
		// Co-located with the template like topicEmbedding so the concept query
		// reads them without a join.
		tagEmbeddings: v.optional(
			v.array(v.object({ tag: v.string(), embedding: v.array(v.float64()) }))
		),
		embeddingVersion: v.string(),
		embeddingsUpdatedAt: v.optional(v.number()),
		// Topic-vector completion is tracked independently from tag-vector writes.
		// A shared timestamp let a tag-only backfill hide a still-missing topic
		// vector from the indexed repair queue.
		topicEmbeddingsUpdatedAt: v.optional(v.number()),
		domainHue: v.optional(v.float64()), // oklch hue angle (0-360) projected from topicEmbedding

		// Status & tracking
		verificationStatus: v.optional(v.string()), // 'pending' | 'approved' | 'rejected'
		countryCode: v.optional(v.string()),
		reviewedAt: v.optional(v.number()),
		reviewedBy: v.optional(v.string()),

		// Moderation
		flaggedByModeration: v.boolean(),
		consensusApproved: v.boolean(),

		// Reputation
		reputationDelta: v.float64(),
		reputationApplied: v.boolean(),

		// Content hash
		contentHash: v.optional(v.string()),

		updatedAt: v.number(),

		// User relationship
		userId: v.optional(v.id('users')),

		// Org relationship
		orgId: v.optional(v.id('organizations')),

		// ── FLATTENED: TemplateJurisdiction[] ──
		// Array of jurisdiction objects (was separate table)
		jurisdictions: v.optional(
			v.array(
				v.object({
					jurisdictionType: v.string(), // 'federal' | 'state' | 'county' | 'city' | 'school_district'
					congressionalDistrict: v.optional(v.string()),
					senateClass: v.optional(v.string()),
					stateCode: v.optional(v.string()),
					stateSenateDistrict: v.optional(v.string()),
					stateHouseDistrict: v.optional(v.string()),
					countyFips: v.optional(v.string()),
					countyName: v.optional(v.string()),
					cityName: v.optional(v.string()),
					cityFips: v.optional(v.string()),
					schoolDistrictId: v.optional(v.string()),
					schoolDistrictName: v.optional(v.string()),
					latitude: v.optional(v.float64()),
					longitude: v.optional(v.float64()),
					estimatedPopulation: v.optional(v.number()),
					coverageNotes: v.optional(v.string())
				})
			)
		),

		// ── FLATTENED: TemplateScope[] ──
		// Array of geographic scope objects (was separate table)
		scopes: v.optional(
			v.array(
				v.object({
					countryCode: v.string(),
					regionCode: v.optional(v.string()),
					localityCode: v.optional(v.string()),
					districtCode: v.optional(v.string()),
					displayText: v.string(),
					scopeLevel: v.string(), // 'country' | 'region' | 'locality' | 'district'
					powerStructureType: v.optional(v.string()),
					audienceFilter: v.optional(v.string()),
					scopeNotes: v.optional(v.string()),
					confidence: v.float64(),
					extractionMethod: v.string(),
					validatedAgainst: v.optional(v.string()),
					estimatedReach: v.optional(v.number()),
					latitude: v.optional(v.float64()),
					longitude: v.optional(v.float64())
				})
			)
		)
	})
		.index('by_slug', ['slug'])
		.index('by_userId', ['userId'])
		.index('by_orgId', ['orgId'])
		.index('by_verificationStatus', ['verificationStatus'])
		.index('by_countryCode', ['countryCode'])
		.index('by_userId_contentHash', ['userId', 'contentHash'])
		.index('by_status', ['status'])
		// One-time endorsement-counter reconciliation and its post-cutover health
		// check select legacy rows without scanning every embedding-heavy template.
		.index('by_endorsementCount', ['endorsementCount'])
		// Exact public-corpus selector used by the off-request relation snapshot
		// rebuild. Keeping both predicates in the index avoids hydrating drafts or
		// private templates (including their embedding-heavy fields) during the
		// nightly materialization pass.
		.index('by_status_isPublic', ['status', 'isPublic'])
		// Bounded embedding-repair batches select only public documents that have
		// never completed an embedding write. This keeps the admin/backfill path
		// off the full embedding-bearing public corpus.
		.index('by_status_isPublic_topicEmbeddingsUpdatedAt', [
			'status',
			'isPublic',
			'topicEmbeddingsUpdatedAt'
		])
		.searchIndex('search_templates', {
			searchField: 'title',
			filterFields: ['domain', 'status', 'countryCode']
		})
		.vectorIndex('by_topicEmbedding', {
			vectorField: 'topicEmbedding',
			dimensions: 768,
			filterFields: ['domain', 'countryCode']
		})
		.vectorIndex('by_locationEmbedding', {
			vectorField: 'locationEmbedding',
			dimensions: 768,
			filterFields: ['countryCode']
		}),

	// Short-lived provider-work lease for template authoring. The lease is
	// acquired before Groq admission so concurrent same-content or same-slug
	// requests cannot each spend provider capacity and race at createTemplate.
	templateAuthoringLeases: defineTable({
		userId: v.id('users'),
		contentHash: v.string(),
		slug: v.string(),
		token: v.string(),
		expiresAt: v.number()
	})
		.index('by_userId_contentHash', ['userId', 'contentHash'])
		.index('by_slug', ['slug'])
		.index('by_expiresAt', ['expiresAt']),

	// Embedding-free authenticated list plane. Every canonical template has
	// exactly one row after the explicit migration cutover. The 4 KiB writer
	// budget is enforced in `lib/templateListProjection.ts`; 51 maximum rows
	// therefore remain below the 256 KiB query ceiling even with system fields.
	templateListProjections: defineTable({
		templateId: v.id('templates'),
		templateCreatedAt: v.number(),
		userId: v.optional(v.id('users')),
		orgId: v.optional(v.id('organizations')),
		slug: v.string(),
		slugTruncated: v.boolean(),
		slugOriginalBytes: v.number(),
		title: v.string(),
		titleTruncated: v.boolean(),
		titleOriginalBytes: v.number(),
		description: v.string(), // deterministic UTF-8-safe list preview
		descriptionTruncated: v.boolean(),
		descriptionOriginalBytes: v.number(),
		domain: v.string(),
		domainTruncated: v.boolean(),
		domainOriginalBytes: v.number(),
		domainHue: v.optional(v.float64()),
		status: v.string(),
		isPublic: v.boolean(),
		verifiedSends: v.number(),
		templateUpdatedAt: v.number(),
		projectionVersion: v.number(),
		projectionBytes: v.number(),
		projectionWrittenAt: v.number()
	})
		.index('by_templateId', ['templateId'])
		.index('by_slug', ['slug'])
		.index('by_userId', ['userId', 'templateCreatedAt', 'templateId'])
		.index('by_orgId', ['orgId', 'templateCreatedAt', 'templateId']),

	// Durable, operator-visible migration/cutover gate for the authenticated
	// list plane. Readers fail closed until status is explicitly `ready`.
	templateListProjectionMigrations: defineTable({
		key: v.literal('v1'),
		status: v.union(
			v.literal('running'),
			v.literal('blocked'),
			v.literal('migrated'),
			v.literal('ready')
		),
		projectionVersion: v.optional(v.number()),
		runToken: v.string(),
		cursor: v.optional(v.string()),
		startedAt: v.number(),
		completedAt: v.optional(v.number()),
		scanned: v.number(),
		projected: v.number(),
		failureCode: v.optional(v.string()),
		failureTemplateId: v.optional(v.id('templates')),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	// ===========================================================================
	// MESSAGE GENERATION JOBS
	// ===========================================================================

	messageGenerationJobs: defineTable({
		jobId: v.string(),
		userId: v.id('users'),
		inputHash: v.string(),
		status: v.string(), // 'pending' | 'running' | 'completed' | 'failed' | 'expired'
		phase: v.optional(v.string()), // 'sources' | 'message' | 'complete'
		recoveryPublicKeyJwk: v.optional(v.any()),
		encryptedResult: v.optional(v.any()),
		encryptionMeta: v.optional(v.any()),
		errorCode: v.optional(v.string()),
		errorMessage: v.optional(v.string()),
		attempts: v.number(),
		createdAt: v.number(),
		updatedAt: v.number(),
		expiresAt: v.number()
	})
		.index('by_jobId', ['jobId'])
		.index('by_userId_inputHash', ['userId', 'inputHash'])
		.index('by_status_updatedAt', ['status', 'updatedAt'])
		.index('by_expiresAt', ['expiresAt']),

	// ===========================================================================
	// VERIFIABLE MESSAGES
	// ===========================================================================

	messages: defineTable({
		templateId: v.id('templates'),

		// Public message content
		content: v.string(),
		subject: v.optional(v.string()),

		// Cryptographic verification
		verificationProof: v.string(),
		districtHash: v.string(),
		reputationScore: v.number(),

		// Delivery tracking
		sentAt: v.number(),
		deliveredAt: v.optional(v.number()),
		officeRead: v.boolean(),
		officeResponded: v.boolean(),
		officeResponseTime: v.optional(v.number()),

		// Delivery metadata
		deliveryMethod: v.string(), // 'cwc' | 'email'
		cwcSubmissionId: v.optional(v.string()),
		deliveryStatus: v.string(), // 'pending' | 'delivered' | 'failed'
		// Same-transaction idempotency marker for the compact recipient-metrics
		// migration. No live writer currently inserts this legacy table.
		recipientMetricsVersion: v.optional(v.number()),
		errorMessage: v.optional(v.string())
	})
		.index('by_templateId', ['templateId'])
		.index('by_districtHash', ['districtHash'])
		.index('by_sentAt', ['sentAt'])
		.index('by_deliveryStatus', ['deliveryStatus'])
		.index('by_officeRead', ['officeRead']),

	// ===========================================================================
	// USER → DECISION MAKER RELATIONS
	// ===========================================================================

	userDmRelations: defineTable({
		userId: v.id('users'),
		decisionMakerId: v.id('decisionMakers'),
		relationship: v.string(), // 'constituent' | 'voter' | 'resident'
		isActive: v.boolean(),
		assignedAt: v.number(),
		lastValidated: v.optional(v.number()),
		source: v.string() // 'legacy' | 'shadow_atlas' | 'civic_api'
	})
		.index('by_userId', ['userId'])
		.index('by_decisionMakerId', ['decisionMakerId'])
		.index('by_userId_decisionMakerId', ['userId', 'decisionMakerId'])
		.index('by_userId_isActive_decisionMakerId', ['userId', 'isActive', 'decisionMakerId']),

	// ===========================================================================
	// ANALYTICS (aggregates + snapshots only)
	// ===========================================================================

	analytics: defineTable({
		// Record type discriminator
		recordType: v.string(), // 'aggregate' | 'snapshot'
		// Canonical identities are optional only during the bounded launch
		// migration. New aggregate and snapshot writers always populate exactly one
		// of these and fail closed on multiplicity.
		aggregateIdentity: v.optional(v.string()),
		snapshotIdentity: v.optional(v.string()),
		sourceAggregateId: v.optional(v.id('analytics')),
		planeVersion: v.optional(v.number()),

		// ── Aggregate / Snapshot shared fields ──
		date: v.optional(v.number()), // epoch ms of day (aggregate)
		snapshotDate: v.optional(v.number()), // epoch ms of day (snapshot)

		// Metric dimensions
		metric: v.optional(v.string()),
		dimensionKey: v.optional(v.string()), // composite: "templateId|jurisdiction|deliveryMethod|utmSource|errorType"
		templateId: v.optional(v.string()),
		jurisdiction: v.optional(v.string()),
		deliveryMethod: v.optional(v.string()),
		utmSource: v.optional(v.string()),
		errorType: v.optional(v.string()),

		// Aggregate fields
		count: v.optional(v.number()),
		noiseApplied: v.optional(v.float64()),
		epsilon: v.optional(v.float64()),

		// Snapshot fields
		noisyCount: v.optional(v.number()),
		epsilonSpent: v.optional(v.float64()),
		noiseSeed: v.optional(v.string()),

		updatedAt: v.optional(v.number())
	})
		.index('by_recordType', ['recordType'])
		.index('by_recordType_date', ['recordType', 'date'])
		.index('by_recordType_date_metric_dimension', ['recordType', 'date', 'metric', 'dimensionKey'])
		.index('by_aggregateIdentity', ['aggregateIdentity'])
		.index('by_snapshotIdentity', ['snapshotIdentity'])
		.index('by_date', ['date'])
		.index('by_metric_date', ['metric', 'date'])
		.index('by_metric_date_dimension', ['metric', 'date', 'dimensionKey'])
		.index('by_templateId_date', ['templateId', 'date'])
		.index('by_jurisdiction_date', ['jurisdiction', 'date'])
		.index('by_snapshotDate', ['snapshotDate']),

	// ===========================================================================
	// PRIVACY BUDGETS
	// ===========================================================================

	privacyBudgets: defineTable({
		// Optional only until analyticsSnapshotMigrations is activated. The
		// identity closes the historical by-window/metric `.first()` ambiguity;
		// spendIdentity binds the one composition charge to one durable daily run.
		budgetIdentity: v.optional(v.string()),
		spendIdentity: v.optional(v.string()),
		snapshotRunId: v.optional(v.id('analyticsSnapshotRuns')),
		userId: v.optional(v.id('users')), // null for system-level budget (cron snapshots)
		metric: v.string(), // "system" for global budget, or specific metric
		epsilon: v.number(), // budget limit for this window
		consumed: v.number(), // epsilon spent so far
		windowStart: v.number(), // epoch ms
		windowEnd: v.number(), // epoch ms
		updatedAt: v.number()
	})
		.index('by_userId_metric', ['userId', 'metric'])
		.index('by_windowStart_metric', ['windowStart', 'metric'])
		.index('by_budgetIdentity', ['budgetIdentity'])
		.index('by_spendIdentity', ['spendIdentity']),

	// Singleton cutover state for the analytics snapshot plane. Snapshot rows are
	// adopted first, then aggregates, then budget rows, so a legacy partial run
	// (snapshot plus surviving raw aggregate) is detected rather than published.
	analyticsSnapshotMigrations: defineTable({
		key: v.string(),
		status: v.union(
			v.literal('running'),
			v.literal('blocked'),
			v.literal('migrated'),
			v.literal('ready')
		),
		phase: v.union(
			v.literal('snapshots'),
			v.literal('aggregates'),
			v.literal('budgets'),
			v.literal('complete')
		),
		runToken: v.string(),
		cursor: v.optional(v.string()),
		scannedRows: v.number(),
		adoptedRows: v.number(),
		legacyRunsAdopted: v.number(),
		failureCode: v.optional(v.string()),
		startedAt: v.number(),
		completedAt: v.optional(v.number()),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	// One durable coordinator row per UTC snapshot date. Pages are materialized
	// before any source deletion; snapshot readers require status=ready, so a
	// partial page or cleanup never becomes externally visible.
	analyticsSnapshotRuns: defineTable({
		runIdentity: v.string(),
		snapshotDate: v.number(),
		status: v.union(v.literal('running'), v.literal('blocked'), v.literal('ready')),
		phase: v.union(v.literal('materialize'), v.literal('cleanup'), v.literal('complete')),
		runToken: v.string(),
		noiseSeed: v.string(),
		cursor: v.optional(v.string()),
		budgetClaimed: v.boolean(),
		snapshotsCreated: v.number(),
		aggregatesDeleted: v.number(),
		scannedRows: v.number(),
		restarts: v.number(),
		leaseExpiresAt: v.number(),
		legacyAdopted: v.optional(v.boolean()),
		failureCode: v.optional(v.string()),
		startedAt: v.number(),
		completedAt: v.optional(v.number()),
		updatedAt: v.number()
	})
		.index('by_runIdentity', ['runIdentity'])
		.index('by_snapshotDate', ['snapshotDate'])
		.index('by_noiseSeed', ['noiseSeed'])
		.index('by_legacyAdopted_budgetClaimed', ['legacyAdopted', 'budgetClaimed'])
		.index('by_status_leaseExpiresAt', ['status', 'leaseExpiresAt']),

	// ===========================================================================
	// ENCRYPTED DELIVERY DATA — legacy tombstone
	// ===========================================================================
	// Retired by Ground Vault PRF. Kept temporarily so historical rows can be
	// migrated or purged without deleting the table out from under deployments.
	// No active mutation should write or read this table.

	encryptedDeliveryData: defineTable({
		userId: v.id('users'),

		// XChaCha20-Poly1305 encrypted blob
		ciphertext: v.string(),
		nonce: v.string(),
		ephemeralPublicKey: v.string(),

		// TEE key
		teeKeyId: v.string(),

		// Metadata
		encryptionVersion: v.string(),
		updatedAt: v.number(),
		lastUsedAt: v.optional(v.number())
	})
		.index('by_userId', ['userId'])
		.index('by_teeKeyId', ['teeKeyId']),

	// ===========================================================================
	// GROUND VAULTS — encrypted address custody for government delivery
	// ===========================================================================

	groundVaults: defineTable({
		userId: v.id('users'),
		status: v.string(), // 'active' | 'locked' | 'rewrap_needed' | 'retired' | 'legacy_device_key'

		// Client-side encrypted normalized address payload
		ciphertext: v.string(),
		nonce: v.string(),
		schemaVersion: v.number(),
		encryptionVersion: v.string(),
		dekVersion: v.number(),

		// AEAD envelope contract. The server cannot inspect the encrypted payload,
		// so version/provenance metadata that affects decryption is duplicated here.
		aeadAssociatedData: v.string(),
		associatedDataHash: v.string(),
		resolveResultHash: v.optional(v.string()),
		resolveSigningKeyId: v.optional(v.string()),

		// Canonical links for the active ground artifact
		activeCredentialId: v.optional(v.id('districtCredentials')),
		activeGroundCellMetadataId: v.optional(v.id('groundCellMetadata')),

		// Lifecycle
		// Passthrough of verificationMethod from the persisting client —
		// see src/lib/core/identity/ground-vault-persistence.ts:276. The
		// previous comment claimed an 'address'|'mdl'|'migration'|'reentry'
		// enum but production writes any of the ADDRESS_VERIFICATION_METHODS
		// values ('shadow_atlas'|'civic_api'|'postal') verbatim plus
		// 'mdl'|'migration'|'reentry' from non-address paths. v.string() is
		// the honest typing; the field is observational, not constraint.
		createdByMethod: v.string(),
		migrationSource: v.optional(v.string()),
		retiredAt: v.optional(v.number()),
		retiredReason: v.optional(v.string()),
		lastUnlockedAt: v.optional(v.number()),
		updatedAt: v.number()
	})
		.index('by_userId', ['userId'])
		.index('by_userId_status', ['userId', 'status'])
		.index('by_activeCredentialId', ['activeCredentialId'])
		.index('by_activeGroundCellMetadataId', ['activeGroundCellMetadataId'])
		.index('by_status', ['status']),

	groundCellMetadata: defineTable({
		userId: v.id('users'),
		districtCredentialId: v.id('districtCredentials'),
		groundVaultId: v.optional(v.id('groundVaults')),

		// Disclosed location artifact. This is not plaintext address storage, but it
		// is still precise location metadata and must be treated accordingly.
		cellId: v.optional(v.string()),
		h3Cell: v.optional(v.string()),
		cellMapRoot: v.optional(v.string()),
		cellMapVersion: v.optional(v.string()),
		atlasRoot: v.optional(v.string()),
		atlasVersion: v.optional(v.string()),
		districtCommitment: v.optional(v.string()),
		districts: v.optional(v.array(v.string())),
		slotCount: v.optional(v.number()),

		// Resolution provenance
		source: v.string(), // 'address' | 'mdl' | 'shadow_atlas' | 'migration'
		confidence: v.optional(v.float64()),
		resolveResultHash: v.optional(v.string()),
		resolveSigningKeyId: v.optional(v.string()),

		// Lifecycle
		issuedAt: v.number(),
		expiresAt: v.optional(v.number()),
		retiredAt: v.optional(v.number()),
		updatedAt: v.number()
	})
		.index('by_userId_expiresAt', ['userId', 'expiresAt'])
		.index('by_districtCredentialId', ['districtCredentialId'])
		.index('by_groundVaultId', ['groundVaultId'])
		.index('by_cellId', ['cellId'])
		.index('by_h3Cell', ['h3Cell'])
		.index('by_districtCommitment', ['districtCommitment']),

	passkeyVaultWrappers: defineTable({
		userId: v.id('users'),
		groundVaultId: v.id('groundVaults'),

		// Duplicates current passkey credential id until passkeys are normalized into
		// a one-to-many credential table. Wrapper status is not auth status.
		passkeyCredentialId: v.string(),
		rpId: v.string(),

		// PRF/HKDF wrapping metadata
		prfSaltId: v.string(),
		prfSalt: v.string(),
		saltVersion: v.number(),
		wrappedDek: v.string(),
		wrapAlg: v.string(),
		hkdfInfo: v.string(),
		wrapperVersion: v.number(),
		status: v.string(), // 'active' | 'revoked' | 'rotated' | 'retired'

		// Lifecycle
		lastUsedAt: v.optional(v.number()),
		revokedAt: v.optional(v.number()),
		rotatedAt: v.optional(v.number()),
		updatedAt: v.number()
	})
		.index('by_userId', ['userId'])
		.index('by_groundVaultId', ['groundVaultId'])
		.index('by_passkeyCredentialId', ['passkeyCredentialId'])
		.index('by_userId_status', ['userId', 'status'])
		.index('by_groundVaultId_status', ['groundVaultId', 'status']),

	// ===========================================================================
	// ZK PROOF SUBMISSIONS
	// ===========================================================================

	submissions: defineTable({
		pseudonymousId: v.string(),
		// Polymorphic by design — accepts EITHER an Id<'templates'>
		// (the canonical case) OR a template slug. The handler at
		// convex/submissions.ts:1961-1962 disambiguates via
		// `ctx.db.normalizeId('templates', templateId)`; if the
		// normalize returns null, the string is treated as a slug and
		// looked up via the `by_slug` index. Keep as v.string() (not
		// v.id) — Convex Id validator rejects slug-shaped strings.
		templateId: v.string(),

		// ZK proof data
		proofHex: v.string(),
		// Stored shape is an OBJECT with named fields + a nested
		// publicInputsArray. The +server.ts boundary accepts either
		// `unknown[]` (bare array) or `{ publicInputsArray, actionDomain,
		// authorityLevel, ... }` from the client and forwards the
		// un-normalized value to Convex; the Convex-side reader at
		// convex/submissions.ts:1151 expects the object form
		// (`pi.publicInputsArray[i]`), so a bare-array submission
		// reaches the anchor cron as `public_inputs_array_missing`
		// and fails terminal. The named fields (actionDomain, etc.)
		// are cross-checked against the array positions at +server.ts
		// (e.g., :179-200 ensures rawInputsArray[27] === named
		// actionDomain) — the array indices encode the noir circuit
		// public-input ordering (idx 26=nullifier, 27=actionDomain,
		// 28=authorityLevel, ...). v.any() is the pragmatic compromise;
		// tightening to `v.object({publicInputsArray: v.array(v.string()),
		// actionDomain: v.string(), ...})` would close the divergence
		// but requires +server.ts to normalize at the boundary first.
		// See [[F39-publicInputs-normalize-at-boundary]].
		publicInputs: v.any(),
		nullifier: v.string(),
		actionId: v.string(),

		// Idempotency
		idempotencyKey: v.optional(v.string()),

		// Witness encryption
		encryptedWitness: v.string(),
		witnessNonce: v.optional(v.string()),
		ephemeralPublicKey: v.optional(v.string()),
		teeKeyId: v.optional(v.string()),

		// Congressional delivery
		cwcSubmissionId: v.optional(v.string()),
		deliveryStatus: v.string(), // 'pending' | 'processing' | 'delivered' | 'partial' | 'failed' | 'demo'
		deliveryError: v.optional(v.string()),
		deliveredAt: v.optional(v.number()),
		resolvedDistrict: v.optional(v.string()), // congressional district from TEE resolve
		// Attempt counter for CAS-guarded terminal writes. Each claimForDelivery
		// transition (pending|failed → processing) increments; terminal writes pass
		// expectedAttempts so resurrected old workers can't overwrite newer retries.
		deliveryAttempts: v.optional(v.number()),

		// Blockchain verification
		verificationTxHash: v.optional(v.string()),
		verificationStatus: v.string(), // 'pending' | 'verified' | 'rejected'
		verifiedAt: v.optional(v.number()),
		blockNumber: v.optional(v.number()),

		// Async on-chain anchor (AR.3). Runs AFTER delivery success as defense in
		// depth — the on-chain verifier contract independently verifies the proof.
		// 'divergent' means the TEE accepted a proof the chain rejected — P0 alert.
		// 'poisoned' is a terminal state after too many retries; requires operator.
		anchorStatus: v.optional(v.string()), // 'pending' | 'anchored' | 'failed' | 'divergent' | 'poisoned' | 'skipped_missing_env'
		anchorTxHash: v.optional(v.string()),
		anchorAt: v.optional(v.number()),
		anchorError: v.optional(v.string()),
		anchorAttempts: v.optional(v.number()),
		// Typed classifier from district-gate-client: 'success' | 'rpc_transient' |
		// 'contract_invalid_proof' | 'contract_other_revert' | 'relayer_config'.
		// The retry cron keys off this to avoid wasting gas on non-retriable outcomes
		// (relayer_config = operator fix; contract_invalid_proof = divergent/terminal).
		anchorResultKind: v.optional(v.string()),

		// Reputation
		reputationDelta: v.optional(v.number()),
		reputationTxHash: v.optional(v.string()),

		// Witness expiry
		witnessExpiresAt: v.optional(v.number()),
		// Completion marker for the bounded expiry queue. Cleanup clears the indexed
		// due time so an already-scrubbed wide submission can never pin page one.
		witnessCleanedAt: v.optional(v.number()),

		// F1 gate: Convex Id of the district credential that was active when this
		// submission was accepted. Re-checked at delivery enqueue (closes the TOCTOU
		// window between submissions.create and deliverToCongress). Optional for
		// backward compat with pre-fix submissions. We use the Id (not credentialHash)
		// because shadow_atlas / commitment-only credentials store credentialHash=""
		// which would bypass the delivery recheck.
		issuingCredentialId: v.optional(v.id('districtCredentials')),

		// User identity tier at submission time, denormalized from users.trustTier
		// at insertSubmission so per-template tier breakdowns can be computed
		// without joining (mirrors campaignActions.trustTier). Optional for
		// backward compat with pre-denormalization rows; backfill via cron.
		trustTier: v.optional(v.number()),

		updatedAt: v.number()
	})
		.index('by_nullifier', ['nullifier'])
		.index('by_idempotencyKey', ['idempotencyKey'])
		.index('by_pseudonymousId', ['pseudonymousId'])
		.index('by_templateId', ['templateId'])
		.index('by_deliveryStatus', ['deliveryStatus'])
		.index('by_verificationStatus', ['verificationStatus'])
		// Range scan on verifiedAt within a verification status — required by
		// `aggregateForHero` to avoid a full-table scan over all verified
		// submissions every homepage SSR.
		.index('by_verificationStatus_verifiedAt', ['verificationStatus', 'verifiedAt'])
		.index('by_anchorStatus', ['anchorStatus'])
		.index('by_deliveryStatus_updatedAt', ['deliveryStatus', 'updatedAt'])
		.index('by_anchorStatus_updatedAt', ['anchorStatus', 'updatedAt'])
		.index('by_anchorStatus_anchorResultKind_updatedAt', [
			'anchorStatus',
			'anchorResultKind',
			'updatedAt'
		])
		.index('by_witnessExpiresAt', ['witnessExpiresAt'])
		.index('by_issuingCredentialId', ['issuingCredentialId']),

	submissionDeliveryReceipts: defineTable({
		submissionId: v.id('submissions'),
		templateId: v.string(),

		// May be absent for pseudonymous proof submissions that intentionally avoid a
		// direct user FK in delivery/reporting paths.
		userId: v.optional(v.id('users')),
		pseudonymousId: v.optional(v.string()),

		// Recipient identity and transport
		recipientKey: v.string(),
		recipientName: v.optional(v.string()),
		recipientDistrict: v.optional(v.string()),
		chamber: v.optional(v.string()),
		provider: v.string(), // 'house_cwc' | 'senate_cwc' | 'demo'
		providerReceiptId: v.optional(v.string()),

		// Delivery lifecycle
		status: v.string(), // 'queued' | 'processing' | 'delivered' | 'failed' | 'demo'
		attempt: v.number(),
		errorCode: v.optional(v.string()),
		errorClass: v.optional(v.string()),
		deliveredAt: v.optional(v.number()),
		updatedAt: v.number()
	})
		.index('by_submissionId', ['submissionId'])
		.index('by_submissionId_recipientKey', ['submissionId', 'recipientKey'])
		.index('by_templateId', ['templateId'])
		.index('by_recipientKey', ['recipientKey'])
		.index('by_status', ['status'])
		.index('by_providerReceiptId', ['providerReceiptId']),

	// ===========================================================================
	// VERIFICATION SESSIONS
	// ===========================================================================

	verificationSessions: defineTable({
		userId: v.id('users'),
		nonce: v.string(),
		challenge: v.string(),
		expiresAt: v.number(),
		status: v.string(), // 'pending' | 'verified' | 'expired' | 'failed'
		method: v.string() // 'self.xyz' | 'didit'
	})
		.index('by_nonce', ['nonce'])
		.index('by_userId_creationTime', ['userId'])
		.index('by_expiresAt', ['expiresAt']),

	// ===========================================================================
	// DISTRICT CREDENTIALS
	// ===========================================================================

	districtCredentials: defineTable({
		userId: v.id('users'),
		credentialType: v.string(),
		congressionalDistrict: v.string(),
		stateSenateDistrict: v.optional(v.string()),
		stateAssemblyDistrict: v.optional(v.string()),
		verificationMethod: v.string(), // 'civic_api' | 'postal'
		issuedAt: v.number(),
		expiresAt: v.number(),
		revokedAt: v.optional(v.number()),
		credentialHash: v.string(),

		// Privacy-preserving district storage
		districtCommitment: v.optional(v.string()),
		slotCount: v.optional(v.number()),

		// H1 — trust-context snapshot at credential issuance.
		//
		// All four are STRICTLY OPTIONAL and MUST stay so. H0r CRITICAL: do not
		// backfill defaults for legacy rows. `undefined` means "this credential
		// pre-dates the field" — downstream surfaces (H6 outbound honesty) must
		// treat it as "unknown", NOT as a synonym for the field's "false/clean"
		// value. Backfilling `trustTier=3` retroactively manufactures mDL
		// attestation that never happened; backfilling `cellStraddles=false`
		// claims precision the credential never measured.
		//
		// trustTier:        effective tier conferred by this credential =
		//                   max(user.trustTier_pre, 2). Matches users.trustTier
		//                   immediately after the issuance mutation. Captures
		//                   credential-state at issuance and does NOT track
		//                   later upgrades or revocations.
		// cellStraddles:    G2 boundary-cell mark — client-supplied at issuance,
		//                   true iff Tree 2 slot[0] district disagreed with the
		//                   wallet-attested district. T0 / non-T3 paths leave
		//                   this undefined (the field is meaningless without a
		//                   real cellId).
		// cellAnchorMode:   G8 audit trail — one of CELL_ANCHOR_MODES. Tells
		//                   apart 'address-resolved' (T3+ from wallet ZIP) from
		//                   'random-fallback' (T0 anonymity-cell), 'recovery-*'
		//                   (recovery flow), 'legacy-inferred' / 'legacy-unknown'
		//                   (read-side backfill for pre-G8 rows — which we do
		//                   NOT write to the field; legacy rows stay undefined).
		// atlasVersion:     G6 atlas-rotation — version string of the atlas the
		//                   client used during issuance. H6 surfaces drift when
		//                   credential.atlasVersion < currentAtlasVersion.
		trustTier: v.optional(v.number()),
		cellStraddles: v.optional(v.boolean()),
		cellAnchorMode: v.optional(v.string()),
		atlasVersion: v.optional(v.string()),

		// B3 — district-resolution freshness provenance, snapshotted at issuance.
		// STRICTLY OPTIONAL, NEVER backfilled. `undefined` = the credential pre-dates
		// the field (NOT a synonym for fresh/stale). `null` is a real, distinct value:
		// "honestly unknown freshness at issuance" — NEVER fabricate a now()/borrowed
		// date, and NEVER copy one clock's value into the other.
		// boundaryAsOf:  when the BOUNDARY geometry was generated (atlas/TIGER publish
		//                time). null = resolver had no boundary clock.
		// officialsAsOf: when the OFFICIALS roster was generated — a distinct clock
		//                (elections vs census). null = manifest carried no officials
		//                freshness (today's degraded-but-honest state; A2 republish fills).
		// tigerVintage:  labels the BOUNDARY clock (e.g. "TIGER2024"); undefined when unknown.
		// resolutionConfidence: 0..1 confidence the resolver assigned at issuance.
		boundaryAsOf: v.optional(v.union(v.string(), v.null())),
		officialsAsOf: v.optional(v.union(v.string(), v.null())),
		tigerVintage: v.optional(v.string()),
		resolutionConfidence: v.optional(v.float64()),

		// F1 closure (Stage 5) — on-chain revocation propagation state.
		// Orthogonal to `revokedAt`: revokedAt marks the credential inactive for
		// submissions (Stage 1 server gate); revocationStatus tracks whether the
		// matching revocation nullifier has been written to RevocationRegistry on
		// Scroll L2. A credential is "active" for proof submission iff
		// revokedAt is undefined; revocationStatus only governs the on-chain sync.
		//   pending   — scheduled, not yet confirmed on chain
		//   confirmed — RevocationRegistry.emitRevocation tx mined
		//   failed    — retry budget exhausted; requires operator investigation
		revocationStatus: v.optional(
			v.union(v.literal('pending'), v.literal('confirmed'), v.literal('failed'))
		),
		// Tx hash of the on-chain revocation emit. Set only when
		// revocationStatus === "confirmed".
		revocationTxHash: v.optional(v.string()),
		// Retry counter for exponential-backoff scheduling. Incremented every time
		// the scheduled action fails. Cap at MAX_REVOCATION_ATTEMPTS (6).
		revocationAttempts: v.optional(v.number()),
		// Timestamp of the most recent revocation attempt (used by stuck-pending
		// detection cron to re-schedule emits older than 1 hour).
		revocationLastAttemptAt: v.optional(v.number())
	})
		.index('by_userId_expiresAt', ['userId', 'expiresAt'])
		.index('by_userId_issuedAt', ['userId', 'issuedAt'])
		.index('by_userId_revokedAt_issuedAt', ['userId', 'revokedAt', 'issuedAt'])
		.index('by_userId_districtCommitment', ['userId', 'districtCommitment'])
		.index('by_congressionalDistrict', ['congressionalDistrict'])
		.index('by_credentialHash', ['credentialHash'])
		.index('by_revokedAt_expiresAt', ['revokedAt', 'expiresAt'])
		.index('by_revocationStatus', ['revocationStatus'])
		.index('by_revocationStatus_revocationLastAttemptAt', [
			'revocationStatus',
			'revocationLastAttemptAt'
		])
		// Time-windowed scan for boundary-cell observability (`getBoundaryCellRate24h`).
		// Without this index, the cron does a full-table `.collect()` and
		// hits Convex's row-scan cap somewhere between 5K-16K active
		// credentials — the boundary alert dies precisely when there are
		// enough users for boundary mistakes to matter.
		.index('by_issuedAt', ['issuedAt']),

	// ===========================================================================
	// MDL PRESENTATION REUSE COOLDOWN
	// ===========================================================================

	mdlCredentialUses: defineTable({
		credentialHash: v.string(),
		userId: v.id('users'),
		identityCommitment: v.string(),
		nonce: v.string(),
		protocol: v.string(), // 'openid4vp' | 'org-iso-mdoc'
		sessionChannel: v.string(), // 'digital-credentials' | 'direct'
		firstSeenAt: v.number(),
		expiresAt: v.number()
	})
		.index('by_credentialHash', ['credentialHash'])
		.index('by_credentialHash_expiresAt', ['credentialHash', 'expiresAt'])
		.index('by_nonce', ['nonce'])
		.index('by_nonce_expiresAt', ['nonce', 'expiresAt'])
		.index('by_expiresAt', ['expiresAt']),

	// ===========================================================================
	// SPARSE MERKLE TREE STATE (— KG-2 closure)
	// ===========================================================================
	//
	// Persistent off-chain state for the Poseidon2 sparse Merkle tree backing
	// the on-chain RevocationRegistry. The contract trusts the relayer's
	// precomputed root verbatim; this is where that root is computed.
	//
	// smtNodes:
	//   Stores ONLY non-default (non-empty-subtree) nodes along the paths of
	//   inserted leaves. A node at (treeId, depth, pathKey) represents the
	//   subtree root at that position. Missing rows imply the empty-subtree
	//   constant for that depth — the lookup falls through to ZERO_HASH[depth].
	//
	//   Path-key encoding: at depth d, pathKey is the BN254-hex of the leaf
	//   key right-shifted by d (lower bits). For depth 0, pathKey == leaf key
	//   (the full 128-bit prefix of the nullifier; F-1.4 widened from 64 to 128
	//   on 2026-04-25). For depth 128, pathKey == 0 (the root has no positional
	//   information).
	//
	// smtRoots:
	//   One row per tree. `sequenceNumber` is monotonically incremented on
	//   every committed insert; serves as the optimistic-concurrency token —
	//   an SMT update mutation that finds a different sequence number than
	//   the caller's expected value MUST throw to force a recompute.
	smtNodes: defineTable({
		treeId: v.string(), // "revocation" today; reserved for future trees
		depth: v.number(), // 0 (leaf) to 128 (root); F-1.4 widened 2026-04-25
		pathKey: v.string(), // hex, no 0x prefix; canonicalized lowercase
		hash: v.string() // BN254 hex, 0x-prefixed
	}).index('by_tree_depth_path', ['treeId', 'depth', 'pathKey']),

	smtRoots: defineTable({
		treeId: v.string(),
		root: v.string(), // BN254 hex, 0x-prefixed
		leafCount: v.number(),
		sequenceNumber: v.number(), // monotonic, for optimistic concurrency
		lastUpdatedAt: v.number()
	}).index('by_treeId', ['treeId']),

	// Drift kill-switch state, separated from `smtRoots`. Keeping halt fields
	// on `smtRoots` would force `setRevocationHalt` to pre-seed a row with
	// `root: "0x0...0"` at genesis-pre-emit, which is NOT the canonical
	// Poseidon2 empty-tree root. Any caller that read `currentRoot` post-
	// clear-pre-first-emit would then get the wrong value. This table holds
	// halt state independently so the SMT canonical state stays clean.
	revocationFlags: defineTable({
		treeId: v.string(),
		isHalted: v.boolean(),
		haltedAt: v.optional(v.number()),
		haltedReason: v.optional(v.string())
	}).index('by_treeId', ['treeId']),

	// Append-only audit trail for halt set/clear events. Without this, the
	// only halt-clear record would be `console.warn`, which
	// goes to ephemeral, operator-mutable Convex function logs. Forensic
	// reconstruction of "who cleared the halt under which incident" was
	// impossible. This table is append-only by convention (no patch/delete code
	// path). Reads queryable for ops dashboards.
	revocationHaltAuditLog: defineTable({
		treeId: v.string(),
		action: v.union(v.literal('set'), v.literal('clear')),
		reason: v.string(),
		incidentRef: v.optional(v.string()),
		actor: v.string(), // "cron" for setRevocationHalt; deploy-key principal for clear
		timestamp: v.number(),
		previousReason: v.optional(v.string()),
		previousHaltedAt: v.optional(v.number())
	}).index('by_treeId_timestamp', ['treeId', 'timestamp']),

	// Reconciler skip counter — tracks consecutive missing_env / rpc_unavailable
	// / fetch_failed outcomes from `reconcileSMTRoot`. Reset to 0 on any non-skip
	// outcome (genesis, healthy, drift, critical). When the counter crosses
	// `RECONCILE_SKIP_ALERT_THRESHOLD`, the reconciler emits a Sentry alert so a
	// stuck cron (rotated `INTERNAL_API_SECRET`, dead RPC) can't fail silently
	// and let Convex SMT and on-chain RevocationRegistry diverge unboundedly.
	revocationReconcileState: defineTable({
		treeId: v.string(),
		consecutiveSkips: v.number(),
		lastSkipReason: v.optional(v.string()),
		lastSkipAt: v.optional(v.number()),
		updatedAt: v.number()
	}).index('by_treeId', ['treeId']),

	// ===========================================================================
	// RATE LIMITS
	// ===========================================================================

	rateLimits: defineTable({
		key: v.string(),
		windowStart: v.number(),
		count: v.number(),
		updatedAt: v.number()
	})
		.index('by_key_windowStart', ['key', 'windowStart'])
		.index('by_windowStart', ['windowStart']),

	// ===========================================================================
	// INTELLIGENCE
	// ===========================================================================

	intelligence: defineTable({
		category: v.string(), // 'news' | 'legislative' | 'regulatory' | 'corporate' | 'social'
		title: v.string(),
		source: v.string(),
		sourceUrl: v.string(),
		publishedAt: v.number(),
		snippet: v.string(),
		topics: v.array(v.string()),
		entities: v.array(v.string()),
		embedding: v.optional(v.array(v.float64())),
		relevanceScore: v.optional(v.float64()),
		sentiment: v.optional(v.string()), // 'positive' | 'negative' | 'neutral' | 'mixed'
		geographicScope: v.optional(v.string()),
		expiresAt: v.optional(v.number())
	})
		.index('by_category', ['category'])
		.index('by_publishedAt', ['publishedAt'])
		.index('by_relevanceScore', ['relevanceScore'])
		.index('by_expiresAt', ['expiresAt'])
		.searchIndex('search_intelligence', {
			searchField: 'title',
			filterFields: ['category']
		})
		.vectorIndex('by_embedding', {
			vectorField: 'embedding',
			dimensions: 768,
			filterFields: ['category']
		}),

	// ===========================================================================
	// PARSED DOCUMENT CACHE
	// ===========================================================================

	parsedDocumentCache: defineTable({
		sourceUrl: v.string(),
		sourceUrlHash: v.string(),
		documentType: v.string(), // 'legislative' | 'official' | 'media' | 'corporate' | 'academic'
		document: v.any(), // Full parsed document JSON
		updatedAt: v.number(),
		expiresAt: v.number(),
		hitCount: v.number(),
		lastAccessedAt: v.optional(v.number())
	})
		.index('by_sourceUrlHash', ['sourceUrlHash'])
		.index('by_sourceUrl', ['sourceUrl'])
		.index('by_documentType', ['documentType'])
		.index('by_expiresAt', ['expiresAt']),

	// ===========================================================================
	// RESOLVED CONTACTS
	// ===========================================================================

	resolvedContacts: defineTable({
		orgKey: v.string(),
		name: v.optional(v.string()),
		title: v.optional(v.string()),
		email: v.optional(v.string()),
		emailSource: v.optional(v.string()),
		verificationStatus: v.optional(
			v.union(v.literal('deliverable'), v.literal('risky'), v.literal('undeliverable'))
		),
		verifiedAt: v.optional(v.number()),
		resolvedAt: v.number(),
		expiresAt: v.number()
	})
		.index('by_orgKey_title', ['orgKey', 'title'])
		.index('by_expiresAt', ['expiresAt']),

	// ===========================================================================
	// SUPPRESSED EMAILS
	// ===========================================================================

	suppressedEmails: defineTable({
		emailHash: v.optional(v.string()),
		domain: v.string(),
		reason: v.string(), // 'smtp_invalid' | 'smtp_disabled' | 'full_inbox' | 'bounce_report' | 'dns_no_mx'
		source: v.string(), // 'verification' | 'user_report'
		reportedBy: v.optional(v.string()),
		reacherData: v.optional(v.any()),
		expiresAt: v.number()
	})
		.index('by_emailHash', ['emailHash'])
		.index('by_emailHash_expiresAt', ['emailHash', 'expiresAt'])
		.index('by_domain', ['domain'])
		.index('by_expiresAt', ['expiresAt']),

	// Global contact authority is the synchronous send-admission truth while
	// bounded fanout jobs converge denormalized supporter status rows. The
	// optional organization scope is used only for START: a global STOP remains
	// authoritative unless a newer org-scoped START explicitly restores consent.
	contactAuthorities: defineTable({
		channel: v.union(v.literal('email'), v.literal('sms')),
		contactHash: v.string(),
		scopeOrgId: v.optional(v.id('organizations')),
		state: v.union(
			v.literal('email_active'),
			v.literal('email_bounced'),
			v.literal('email_complained'),
			v.literal('email_suppressed'),
			v.literal('sms_allowed'),
			v.literal('sms_stopped')
		),
		softBounceCount: v.optional(v.number()),
		source: v.string(),
		sourceEventId: v.optional(v.string()),
		version: v.number(),
		projectionBytes: v.number(),
		updatedAt: v.number()
	}).index('by_channel_contactHash_scopeOrgId', ['channel', 'contactHash', 'scopeOrgId']),

	// One OCC-serialized logical clock for contact admission. Bulk dispatchers
	// capture the epoch while materializing a cohort and require the same value
	// at the final carrier boundary; any intervening STOP/START/bounce/complaint
	// invalidates the stale cohort before external send authority is exercised.
	contactAuthorityEpochs: defineTable({
		key: v.literal('global'),
		epoch: v.number(),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	// Durable provider/contact fanout. Ingress commits one compact job before it
	// acknowledges the signed provider request; workers advance only fixed-size
	// supporter cursor pages and leave explicit terminal failure evidence.
	contactFanoutJobs: defineTable({
		kind: v.union(
			v.literal('email_set_bounced'),
			v.literal('email_set_complained'),
			v.literal('email_soft_bounce'),
			v.literal('email_reset_soft_bounce'),
			v.literal('sms_stop'),
			v.literal('sms_start'),
			v.literal('sms_reply')
		),
		contactHash: v.string(),
		scopeOrgId: v.optional(v.id('organizations')),
		idempotencyKey: v.optional(v.string()),
		providerEventId: v.optional(v.string()),
		replyBody: v.optional(v.string()),
		replyToNumber: v.optional(v.string()),
		targetEmailStatus: v.optional(v.string()),
		targetSmsStatus: v.optional(v.string()),
		targetSoftBounceCount: v.optional(v.number()),
		authorityUpdatedAt: v.optional(v.number()),
		cursor: v.optional(v.string()),
		status: v.union(v.literal('pending'), v.literal('complete'), v.literal('failed')),
		priority: v.number(),
		attempts: v.number(),
		nextAttemptAt: v.number(),
		processedCount: v.number(),
		changedCount: v.number(),
		pageCount: v.number(),
		failureCode: v.optional(v.string()),
		lastError: v.optional(v.string()),
		payloadBytes: v.number(),
		createdAt: v.number(),
		updatedAt: v.number(),
		completedAt: v.optional(v.number())
	})
		.index('by_idempotencyKey', ['idempotencyKey'])
		.index('by_status_priority_nextAttemptAt', ['status', 'priority', 'nextAttemptAt'])
		.index('by_status_createdAt', ['status', 'createdAt'])
		.index('by_contactHash_status', ['contactHash', 'status']),

	// Append-only recovery evidence. Retrying a failed job clears its active
	// failure fields so the worker can resume, while this journal preserves why
	// it failed, how many attempts preceded it, and when an operator requeued it.
	contactFanoutJobEvents: defineTable({
		jobId: v.id('contactFanoutJobs'),
		type: v.union(
			v.literal('ingress_failed'),
			v.literal('worker_failed'),
			v.literal('operator_retry')
		),
		attempt: v.number(),
		failureCode: v.optional(v.string()),
		error: v.optional(v.string()),
		createdAt: v.number()
	})
		.index('by_jobId_createdAt', ['jobId', 'createdAt'])
		.index('by_type_createdAt', ['type', 'createdAt']),

	// Activation is a self-paged audit, not an optimistic flag: send admission
	// fails closed until every currently eligible supporter has the global hash
	// required for an exact authority lookup.
	contactAuthorityMigrations: defineTable({
		key: v.literal('contact-authority-v1'),
		status: v.union(v.literal('running'), v.literal('ready'), v.literal('blocked')),
		cursor: v.optional(v.string()),
		scanned: v.number(),
		failureCode: v.optional(v.string()),
		failureSourceId: v.optional(v.id('supporters')),
		startedAt: v.number(),
		completedAt: v.optional(v.number()),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	// ===========================================================================
	// BOUNCE REPORTS
	// ===========================================================================

	bounceReports: defineTable({
		emailHash: v.optional(v.string()),
		encryptedEmail: v.optional(v.string()),
		domain: v.string(),
		reportedBy: v.string(),
		probeResult: v.optional(v.string()),
		resolved: v.boolean()
	})
		.index('by_emailHash_resolved', ['emailHash', 'resolved'])
		.index('by_resolved', ['resolved'])
		.index('by_reportedBy', ['reportedBy'])
		.index('by_reportedBy_resolved', ['reportedBy', 'resolved'])
		.index('by_reportedBy_emailHash_resolved', ['reportedBy', 'emailHash', 'resolved']),

	// ===========================================================================
	// AGENT TRACE
	// ===========================================================================

	agentTraces: defineTable({
		traceId: v.string(),
		userId: v.optional(v.string()),
		endpoint: v.string(),
		eventType: v.string(),
		payload: v.any(),
		success: v.optional(v.boolean()),
		durationMs: v.optional(v.number()),
		costUsd: v.optional(v.float64()),
		expiresAt: v.number()
	})
		.index('by_traceId', ['traceId'])
		.index('by_userId', ['userId'])
		.index('by_endpoint', ['endpoint'])
		.index('by_eventType', ['eventType'])
		.index('by_expiresAt', ['expiresAt']),

	// ===========================================================================
	// STAKED DELIBERATION — DEBATES
	// ===========================================================================

	debates: defineTable({
		templateId: v.id('templates'),

		// On-chain identifiers
		debateIdOnchain: v.string(),
		actionDomain: v.string(),
		propositionHash: v.string(),

		// Proposition content
		propositionText: v.string(),

		// Debate parameters
		deadline: v.number(),
		jurisdictionSize: v.number(),
		status: debateStatus,

		// Aggregate metrics
		argumentCount: v.number(),
		uniqueParticipants: v.number(),
		totalStake: v.number(), // BigInt → number (may need string for large values)

		// Resolution
		winningArgumentIndex: v.optional(v.number()),
		winningStance: v.optional(v.string()),
		resolvedAt: v.optional(v.number()),
		resolvedFromChain: v.boolean(),

		// AI Resolution
		aiResolution: v.optional(v.any()),
		aiSignatureCount: v.optional(v.number()),
		aiPanelConsensus: v.optional(v.float64()),
		resolutionMethod: v.optional(v.string()),
		appealDeadline: v.optional(v.number()),
		governanceJustification: v.optional(v.string()),

		// Transaction
		txHash: v.optional(v.string()),

		// Proposer
		proposerAddress: v.string(),
		proposerBond: v.number(),

		// LMSR market state
		marketStatus: v.string(), // 'pre_market' | 'active' | 'resolved'
		marketLiquidity: v.optional(v.number()),
		currentPrices: v.optional(v.any()),
		currentEpoch: v.number(),
		tradeDeadline: v.optional(v.number()),
		resolutionDeadline: v.optional(v.number()),

		updatedAt: v.number()
	})
		.index('by_templateId', ['templateId'])
		.index('by_templateId_status', ['templateId', 'status'])
		.index('by_status', ['status'])
		.index('by_status_deadline', ['status', 'deadline'])
		.index('by_status_updatedAt', ['status', 'updatedAt'])
		.index('by_debateIdOnchain', ['debateIdOnchain']),

	debateArguments: defineTable({
		debateId: v.id('debates'),
		argumentIndex: v.number(),

		// Content
		stance: v.string(), // 'SUPPORT' | 'OPPOSE' | 'AMEND'
		body: v.string(),
		bodyHash: v.string(),
		amendmentText: v.optional(v.string()),
		amendmentHash: v.optional(v.string()),
		nullifierHash: v.optional(v.string()),

		// Scoring
		stakeAmount: v.number(),
		engagementTier: v.number(),
		weightedScore: v.number(),
		totalStake: v.number(),
		coSignCount: v.number(),

		// LMSR pricing
		currentPrice: v.optional(v.string()),
		priceHistory: v.optional(v.any()),
		positionCount: v.number(),

		// AI evaluation
		aiScores: v.optional(v.any()),
		aiWeighted: v.optional(v.number()),
		finalScore: v.optional(v.number()),
		modelAgreement: v.optional(v.float64()),

		// On-chain verification
		verificationStatus: v.string(), // 'pending' | 'verified' | 'rejected'
		verifiedAt: v.optional(v.number())
	})
		.index('by_debateId', ['debateId'])
		.index('by_debateId_argumentIndex', ['debateId', 'argumentIndex'])
		.index('by_debateId_nullifierHash', ['debateId', 'nullifierHash'])
		.index('by_debateId_weightedScore', ['debateId', 'weightedScore'])
		.index('by_debateId_stance_weightedScore', ['debateId', 'stance', 'weightedScore'])
		.index('by_weightedScore', ['weightedScore'])
		.index('by_verificationStatus', ['verificationStatus']),

	// Constant-read debate summary. The potentially large argument bodies remain
	// in cursor-paged debateArguments; only the current winner preview is copied.
	debateReadModels: defineTable({
		debateId: v.id('debates'),
		templateId: v.id('templates'),
		debateIdOnchain: v.string(),
		version: v.number(),
		revision: v.number(),
		status: debateStatus,
		argumentCount: v.number(),
		uniqueParticipants: v.number(),
		totalStake: v.number(),
		topArgument: v.optional(
			v.object({
				argumentId: v.id('debateArguments'),
				argumentIndex: v.number(),
				stance: v.string(),
				bodyPreview: v.string(),
				weightedScore: v.number(),
				totalStake: v.number(),
				coSignCount: v.number()
			})
		),
		updatedAt: v.number()
	})
		.index('by_debateId', ['debateId'])
		.index('by_templateId', ['templateId'])
		.index('by_debateIdOnchain', ['debateIdOnchain']),

	debateReadModelMigrations: defineTable({
		key: v.literal('v1'),
		status: v.union(
			v.literal('pending'),
			v.literal('running'),
			v.literal('migrated'),
			v.literal('ready'),
			v.literal('blocked')
		),
		cursor: v.optional(v.string()),
		scanned: v.number(),
		projected: v.number(),
		failureCode: v.optional(v.string()),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	debateNullifiers: defineTable({
		debateId: v.id('debates'),
		nullifierHash: v.string(),
		actionType: v.string(), // 'argument' | 'cosign'

		// On-chain verification
		verificationStatus: v.string(), // 'pending' | 'verified' | 'rejected'
		cosignWeight: v.optional(v.number()),
		// Migrated v.string() → v.id('debateArguments') 2026-05-26. The
		// writer at convex/debates.ts:575 has always passed argument._id
		// — the string typing was schema dishonesty. SEED_TABLES already
		// orders debateNullifiers before debateArguments per F10 sweep,
		// so clear-time FK semantics hold.
		argumentId: v.optional(v.id('debateArguments')),
		txHash: v.optional(v.string())
	})
		.index('by_debateId', ['debateId'])
		.index('by_debateId_nullifierHash', ['debateId', 'nullifierHash'])
		.index('by_verificationStatus', ['verificationStatus']),

	// ===========================================================================
	// SHADOW ATLAS REGISTRATION
	// ===========================================================================

	shadowAtlasRegistrations: defineTable({
		userId: v.id('users'),
		congressionalDistrict: v.string(),
		identityCommitment: v.string(),
		leafIndex: v.number(),
		merkleRoot: v.string(),
		merklePath: v.any(), // string[] of sibling hashes
		credentialType: v.string(), // 'three-tree'
		cellId: v.optional(v.string()),
		verificationMethod: v.string(), // 'mdl' | 'digital-credentials-api'
		verificationId: v.string(),
		verificationTimestamp: v.number(),
		registrationStatus: v.string(), // 'registered' | etc.
		expiresAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_userId', ['userId'])
		.index('by_identityCommitment', ['identityCommitment'])
		.index('by_registrationStatus', ['registrationStatus']),

	// ===========================================================================
	// VERIFICATION AUDIT
	// ===========================================================================

	verificationAudits: defineTable({
		userId: v.id('users'),
		verificationMethod: v.string(),
		result: v.string(), // 'success' | 'failure' | 'expired'
		errorCode: v.optional(v.string()),
		ipHash: v.optional(v.string())
	}).index('by_userId', ['userId']),

	// ===========================================================================
	// SUBMISSION RETRY QUEUE
	// ===========================================================================

	submissionRetries: defineTable({
		submissionId: v.id('submissions'),
		nullifier: v.string(),
		proofHex: v.string(),
		publicInputs: v.any(),
		verifierDepth: v.number(),
		retryCount: v.number(),
		nextRetryAt: v.number(),
		status: v.string(), // 'pending' | 'succeeded' | 'exhausted'
		lastError: v.optional(v.string()),
		updatedAt: v.number()
	})
		.index('by_submissionId', ['submissionId'])
		.index('by_status_nextRetryAt', ['status', 'nextRetryAt'])
		.index('by_nullifier', ['nullifier']),

	// ===========================================================================
	// POWER LANDSCAPE — POSITION REGISTRATION
	// ===========================================================================

	positionRegistrations: defineTable({
		templateId: v.id('templates'),
		identityCommitment: v.string(),
		stance: v.string(), // 'support' | 'oppose'
		districtCode: v.optional(v.string()),
		registeredAt: v.number(),
		// New writers set this in the same transaction as the compact aggregate;
		// legacy migration patches it only after applying the contribution.
		recipientMetricsVersion: v.optional(v.number())
	})
		.index('by_templateId', ['templateId'])
		.index('by_templateId_identityCommitment', ['templateId', 'identityCommitment']),

	positionDeliveries: defineTable({
		// Primary civic event keys — a delivery is a first-class action, independent
		// of stance declaration. Keyed on pseudonymousId per voter-protocol G-07
		// (ANTI-ASTROTURF-IMPLEMENTATION-PLAN.md): HMAC-SHA256(user.id, salt) breaks
		// the deanonymization vector while maintaining auditability. Stance
		// (positionRegistrations) is an optional overlay that becomes meaningful
		// when DEBATE markets provide truth-testing.
		pseudonymousId: v.optional(v.string()),
		templateId: v.optional(v.id('templates')),
		// Optional linkage to a stance registration — populated only when the user
		// has also declared a stance (DEBATE-era accountability weight).
		registrationId: v.optional(v.id('positionRegistrations')),
		recipientName: v.string(),
		encryptedRecipientName: v.optional(v.string()),
		recipientKey: v.optional(v.string()),
		recipientEmail: v.optional(v.string()),
		encryptedRecipientEmail: v.optional(v.string()),
		recipientEmailHash: v.optional(v.string()),
		deliveryMethod: v.string(), // 'cwc' | 'email' | 'recorded' | 'mailto_confirmed'
		deliveryStatus: v.string(), // 'pending' | 'delivered' | 'failed' | 'user_confirmed'
		deliveredAt: v.optional(v.number()),
		// Optional district attribution for coordination display, backfilled from
		// the user's Shadow Atlas registration at write time.
		districtCode: v.optional(v.string())
	})
		.index('by_registrationId', ['registrationId'])
		.index('by_registrationId_recipientKey', ['registrationId', 'recipientKey'])
		.index('by_templateId_pseudonymousId', ['templateId', 'pseudonymousId'])
		.index('by_templateId_pseudonymousId_recipientKey', [
			'templateId',
			'pseudonymousId',
			'recipientKey'
		])
		.index('by_templateId', ['templateId']),

	// Constant-read recipient-page metrics. The summary contains exact totals
	// and bounded top-20 display cohorts; raw messages/registrations are never
	// collected by request paths.
	templateRecipientMetrics: defineTable({
		templateId: v.id('templates'),
		version: v.number(),
		messageDeliveredCount: v.number(),
		messageVisibleDistrictCount: v.number(),
		messageTopDistricts: v.array(v.object({ districtHash: v.string(), count: v.number() })),
		positionCount: v.number(),
		positionSupport: v.number(),
		positionOppose: v.number(),
		positionDistrictCount: v.number(),
		positionTopDistricts: v.array(
			v.object({
				districtCode: v.string(),
				support: v.number(),
				oppose: v.number()
			})
		),
		updatedAt: v.number()
	}).index('by_templateId', ['templateId']),

	// Exact per-district rows make every append an O(1) increment and let a
	// viewer retrieve their own above-floor district even when it is outside the
	// bounded top-20 summary.
	templateMessageDistrictMetrics: defineTable({
		templateId: v.id('templates'),
		districtHash: v.string(),
		deliveredCount: v.number(),
		updatedAt: v.number()
	}).index('by_templateId_districtHash', ['templateId', 'districtHash']),

	templatePositionDistrictMetrics: defineTable({
		templateId: v.id('templates'),
		districtCode: v.string(),
		support: v.number(),
		oppose: v.number(),
		updatedAt: v.number()
	}).index('by_templateId_districtCode', ['templateId', 'districtCode']),

	// Durable two-phase migration and explicit reader cutover. Run tokens
	// supersede delayed continuations; `ready` is the only serving state.
	recipientMetricsMigrations: defineTable({
		key: v.literal('v1'),
		status: v.union(
			v.literal('running'),
			v.literal('blocked'),
			v.literal('migrated'),
			v.literal('ready')
		),
		runToken: v.string(),
		phase: v.union(v.literal('messages'), v.literal('positions'), v.literal('complete')),
		cursor: v.optional(v.string()),
		scannedMessages: v.number(),
		projectedMessages: v.number(),
		scannedPositions: v.number(),
		projectedPositions: v.number(),
		failureCode: v.optional(v.string()),
		failureSourceId: v.optional(v.string()),
		startedAt: v.number(),
		completedAt: v.optional(v.number()),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	// ===========================================================================
	// COMMUNITY FIELD CONTRIBUTIONS
	// ===========================================================================

	communityFieldContributions: defineTable({
		userId: v.id('users'),
		epochDate: v.string(), // "2026-03-02"
		epochNullifier: v.string(),
		cellTreeRoot: v.string(),
		proofHash: v.string(),
		verificationStatus: v.string() // 'pending' | 'verified' | 'rejected'
	})
		.index('by_epochDate', ['epochDate'])
		.index('by_epochDate_epochNullifier', ['epochDate', 'epochNullifier'])
		.index('by_verificationStatus', ['verificationStatus']),

	// ===========================================================================
	// ORG LAYER
	// ===========================================================================

	// organizations: includes flattened AnSync data as JSON field
	organizations: defineTable({
		name: v.string(),
		slug: v.string(),
		description: v.optional(v.string()),
		avatar: v.optional(v.string()),

		// Billing (PII encrypted)
		encryptedBillingEmail: v.optional(v.string()), // JSON-serialized EncryptedPii
		billingEmailHash: v.optional(v.string()), // HMAC-SHA256 for lookup
		stripeCustomerId: v.optional(v.string()),

		// Limits
		maxSeats: v.number(),
		maxTemplatesMonth: v.number(),
		dmCacheTtlDays: v.number(),

		// Org-level identity
		identityCommitment: v.optional(v.string()),
		walletAddress: v.optional(v.string()),
		walletType: v.optional(v.string()),

		// Country
		countryCode: v.string(),

		// Denormalized counters
		supporterCount: v.optional(v.number()),
		// Exact number of supporters with at least one verified action carrying a
		// non-empty normalized district hash. The supporter-audience projection
		// owns adoption and every first/last qualifying-action transition.
		districtVerifiedSupporterCount: v.optional(v.number()),
		campaignCount: v.optional(v.number()),
		// Exact ACTIVE+PAUSED tally. Legacy rows remain null until the bounded,
		// marker-safe migration reaches ready; hot writers maintain it thereafter.
		activeCampaignCount: v.optional(v.number()),
		campaignStatusCounts: v.optional(
			v.object({
				DRAFT: v.number(),
				ACTIVE: v.number(),
				PAUSED: v.number(),
				COMPLETE: v.number(),
				total: v.number()
			})
		),
		memberCount: v.optional(v.number()),
		sentEmailCount: v.optional(v.number()),
		// Exact current-period capacity held by durable delivery reservations.
		// Writers update the count and reservation row in one serializable
		// mutation; the period marker prevents a rollover from reusing stale holds.
		emailReservedCount: v.optional(v.number()),
		emailReservationPeriodStart: v.optional(v.number()),
		emailReservationState: v.optional(v.union(v.literal('ready'), v.literal('blocked'))),
		emailReservationFailureCode: v.optional(v.string()),
		smsSentCount: v.optional(v.number()),
		// Monotonic delivery totals above are converted into exact per-period
		// usage by subtracting these baselines. Their period marker must match
		// the subscription/calendar period before a plan check may serve.
		sentEmailPeriodBaseline: v.optional(v.number()),
		sentEmailPeriodBaselineAt: v.optional(v.number()),
		smsSentPeriodBaseline: v.optional(v.number()),
		smsSentPeriodBaselineAt: v.optional(v.number()),
		// Per-row cutover marker for the compact public directory. Optional only
		// while the cursor migration adopts legacy organizations.
		publicDirectoryVersion: v.optional(v.number()),

		// Scale-safe verified-action metering. The billing read counts verified
		// actions WITHIN the current period; the prior implementation collected
		// every verified action and filtered by sentAt in memory, which throws
		// past the per-query document cap and hard-locks the org on every submit
		// once it has >16K verified actions. This is a monotonic lifetime total
		// (only ever increments, never resets — so no never-reset bug) minus a
		// per-period baseline snapshotted at rollover: period_count = lifetime -
		// baseline. baselineAt records WHICH period the baseline belongs to so a
		// late/missed rollover can be detected and self-healed at read time.
		verifiedActionsLifetime: v.optional(v.number()),
		verifiedActionsPeriodBaseline: v.optional(v.number()),
		verifiedActionsPeriodBaselineAt: v.optional(v.number()),

		// Monotonic engagement-tier histogram for the dashboard tier breakdown.
		// 5-element array indexed by engagementTier (0-4): [New, Active,
		// Established, Veteran, Pillar]. engagementTier is set once at action
		// creation and never re-patched (no transition write exists anywhere on
		// campaignActions), so a monotonic counter can't drift — it is bumped
		// exactly once, next to verifiedActionsLifetime in createCampaignAction.
		// Backs getDashboardStats so the tier histogram is O(1) instead of a
		// full-table .collect() that throws past the per-query doc cap. Optional
		// so pre-existing orgs default cleanly (all tiers read as 0).
		actionTierCounts: v.optional(v.array(v.number())),

		// Denormalized per-supporter breakdown counters. Backs the verification
		// funnel + list-health summary without a full-table scan (the scan
		// throws past the per-query doc cap once an org's roster is large).
		// Every count is a per-supporter scalar tally — maintained on insert,
		// status transition, and delete via applySupporterStatsDelta. Excluded:
		// district-of-record cardinality (a set, not a per-row tally — a scalar
		// counter would double-count a supporter active in two districts). That
		// signal is served by a separate bounded query. Optional so pre-existing
		// orgs default cleanly (all counts read as 0 until first maintained write).
		supporterStats: v.optional(
			v.object({
				// Supporters with a backed identity commitment AND verified flag.
				identityVerified: v.number(),
				// Supporters carrying a postal code (address-resolution signal).
				postalResolved: v.number(),
				// Supporters carrying a phone (encryptedPhone or phoneHash present).
				phonePresent: v.number(),
				// emailStatus histogram.
				emailSubscribed: v.number(),
				emailUnsubscribed: v.number(),
				emailBounced: v.number(),
				emailComplained: v.number(),
				// smsStatus histogram.
				smsSubscribed: v.number(),
				// Exact intersection consumed by the unfiltered text-audience path.
				// Optional only across the live cutover: an absent value forces the
				// bounded cursor reader instead of being treated as zero.
				smsDispatchEligible: v.optional(v.number()),
				smsUnsubscribed: v.number(),
				smsStopped: v.number(),
				smsNone: v.number(),
				// Consent-evidence tallies (compliance posture).
				emailConsentEvidence: v.number(),
				emailSubscribedConsentEvidence: v.number(),
				smsConsentEvidence: v.number(),
				smsSubscribedConsentEvidence: v.number(),
				// Per-source acquisition tally. source is set at create and never
				// patched, so this map only grows on insert / shrinks on delete.
				sourceCounts: v.record(v.string(), v.number())
			})
		),
		onboardingState: v.optional(
			v.object({
				hasDescription: v.boolean(),
				hasIssueDomains: v.boolean(),
				hasSupporters: v.boolean(),
				hasCampaigns: v.boolean(),
				hasTeam: v.boolean(),
				hasSentEmail: v.boolean()
			})
		),

		// Public profile
		mission: v.optional(v.string()),
		websiteUrl: v.optional(v.string()),
		logoUrl: v.optional(v.string()),
		isPublic: v.boolean(),

		// White-label accent — Coalition-tier branding override (T7-7). Hex
		// string like '#0d9488'. Applied in CoalitionReport.svelte, the
		// campaign report email shell, and the embed widget (which already
		// reads `?accent=`). Custom sender domain (Layer b) and subdomain
		// routing (Layer c) are deferred per spec.
		brandingAccent: v.optional(v.string()),

		// Outbound white-label — Coalition-tier flag (D-10). When true, Commons
		// "powered by" chrome is suppressed on OUTBOUND surfaces only: the
		// report email footer, the embed widget footer, and the scorecard embed
		// footer. The /v/[hash] verification page deliberately KEEPS its Commons
		// attestation regardless — it is the independent third-party proof and
		// stripping it would gut the verification value. Default (undefined) =
		// false = current Commons branding everywhere. Gated alongside
		// brandingAccent + logoUrl in organizations.setBranding.
		whiteLabel: v.optional(v.boolean()),

		// Org-level PII encryption (passphrase-derived, multi-admin)
		orgKeyVerifier: v.optional(v.string()), // Sentinel encrypted with org key — verifies passphrase
		recoveryWrappedOrgKey: v.optional(v.string()), // Org key wrapped with recovery key — emergency recovery
		serverSealedOrgKey: v.optional(v.string()), // Org key wrapped with server wrapping key — for public ingestion
		piiVersion: v.optional(v.string()), // "legacy" | "migrating" | "org-1"

		updatedAt: v.number(),

		// ── FLATTENED: AnSync settings ──
		// Action Network sync config (was separate `an_sync` table)
		anSync: v.optional(
			v.object({
				apiKey: v.string(),
				adapterSource: v.optional(v.string()),
				credentialStoredAt: v.optional(v.number()),
				credentialVersion: v.optional(v.string()),
				credentialProbeCompletedAt: v.optional(v.number()),
				credentialProbeVersion: v.optional(v.string()),
				status: v.string(), // 'credential_stored' | 'idle' | 'running' | 'completed' | 'failed'
				syncType: v.string(), // 'credential-only' | 'credential-probe' | 'full' | 'incremental'
				totalResources: v.number(),
				processedResources: v.number(),
				currentResource: v.optional(v.string()),
				checkpoint: v.optional(v.string()), // adapter continuation cursor between bounded slices
				imported: v.number(),
				updated: v.number(),
				skipped: v.number(),
				errors: v.optional(v.any()),
				lastSyncAt: v.optional(v.number()),
				startedAt: v.optional(v.number()),
				completedAt: v.optional(v.number())
			})
		)
	})
		.index('by_slug', ['slug'])
		.index('by_stripeCustomerId', ['stripeCustomerId'])
		.index('by_identityCommitment', ['identityCommitment'])
		.index('by_walletAddress', ['walletAddress'])
		.searchIndex('search_organizations', {
			searchField: 'name',
			filterFields: ['countryCode', 'isPublic']
		}),

	// Strictly bounded public organization rows. Public readers page the stable
	// normalized name order and never hydrate the full organization document.
	publicOrganizationDirectory: defineTable({
		orgId: v.id('organizations'),
		slug: v.string(),
		name: v.string(),
		nameSort: v.string(),
		description: v.optional(v.string()),
		mission: v.optional(v.string()),
		logoUrl: v.optional(v.string()),
		avatar: v.optional(v.string()),
		supporterCount: v.number(),
		campaignCount: v.number(),
		memberCount: v.number(),
		updatedAt: v.number(),
		version: v.number()
	})
		.index('by_orgId', ['orgId'])
		.index('by_slug', ['slug'])
		.index('by_nameSort_orgId', ['nameSort', 'orgId']),

	publicOrganizationDirectoryMigrations: defineTable({
		key: v.literal('v1'),
		status: v.union(
			v.literal('pending'),
			v.literal('running'),
			v.literal('ready'),
			v.literal('failed')
		),
		token: v.string(),
		cursor: v.optional(v.string()),
		scanComplete: v.optional(v.boolean()),
		scanned: v.number(),
		processed: v.number(),
		written: v.number(),
		rejected: v.number(),
		total: v.number(),
		failureCode: v.optional(v.string()),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	orgMemberships: defineTable({
		userId: v.id('users'),
		orgId: v.id('organizations'),
		role: v.string(), // 'owner' | 'editor' | 'member'
		joinedAt: v.number(),
		invitedBy: v.optional(v.string())
	})
		.index('by_userId_orgId', ['userId', 'orgId'])
		.index('by_orgId', ['orgId'])
		.index('by_orgId_role', ['orgId', 'role']),

	orgInvites: defineTable({
		orgId: v.id('organizations'),
		role: v.string(),
		tokenHash: v.string(),
		expiresAt: v.number(),
		accepted: v.boolean(),
		invitedBy: v.string(),

		// PII encryption at rest
		encryptedEmail: v.string(),
		emailHash: v.string()
	})
		.index('by_orgId', ['orgId'])
		.index('by_tokenHash', ['tokenHash'])
		.index('by_emailHash', ['emailHash']),

	orgResolvedContacts: defineTable({
		orgId: v.id('organizations'),
		orgKey: v.string(),
		name: v.string(),
		title: v.string(),
		email: v.string(),
		emailSource: v.optional(v.string()),
		resolvedAt: v.number(),
		expiresAt: v.number(),
		resolvedBy: v.optional(v.string())
	})
		.index('by_orgId', ['orgId'])
		.index('by_orgId_orgKey_title', ['orgId', 'orgKey', 'title'])
		.index('by_expiresAt', ['expiresAt']),

	orgNetworks: defineTable({
		name: v.string(),
		slug: v.string(),
		description: v.optional(v.string()),
		ownerOrgId: v.id('organizations'),
		status: v.string(), // 'active' | 'suspended'
		applicableCountries: v.array(v.string()),
		// Founding charter — public when charterPublishedAt is set. Mission is the
		// short purpose statement; principles is the enumerated commitments list;
		// charterText is optional long-form prose. Founding cohort = members whose
		// joinedAt < charterPublishedAt; later joiners are not founders.
		// Publish-flow mutation MUST validate (no schema-level cap so authors can
		// iterate during draft): mission ≤ 500 chars, principles ≤ 20 items × 200
		// chars each, charterText ≤ 10000 chars, charterPublishedAt strictly
		// greater than max(founding-cohort joinedAt) so the strict-less-than
		// founder filter holds. Once charterPublishedAt is set, content fields
		// MUST be treated as append-only (any edit invalidates the charter hash).
		mission: v.optional(v.string()),
		principles: v.optional(v.array(v.string())),
		charterText: v.optional(v.string()),
		charterPublishedAt: v.optional(v.number()),
		coalitionMembershipRevision: v.optional(v.number()),
		// Exact active-roster count maintained on every membership transition.
		// Optional only for legacy networks, which may use the ready coalition
		// aggregate until a roster transition adopts the field.
		activeMemberCount: v.optional(v.number()),

		// Most recent computed coalition-packet attestation hash. Deterministic
		// SHA-256 over sorted (orgId, campaignId, packetDigest) tuples of all
		// active member orgs. Cached for /v/[hash] resolution + invalidated on
		// member roster change. T7-5.
		lastPacketHash: v.optional(v.string()),
		lastPacketComputedAt: v.optional(v.number()),

		updatedAt: v.number()
	})
		.index('by_slug', ['slug'])
		.index('by_ownerOrgId', ['ownerOrgId'])
		.index('by_lastPacketHash', ['lastPacketHash']),

	orgNetworkMembers: defineTable({
		networkId: v.id('orgNetworks'),
		orgId: v.id('organizations'),
		role: v.string(), // 'admin' | 'member'
		status: v.string(), // 'active' | 'pending' | 'removed'
		joinedAt: v.number(),
		invitedBy: v.optional(v.string())
	})
		.index('by_networkId', ['networkId'])
		.index('by_orgId', ['orgId'])
		.index('by_networkId_orgId', ['networkId', 'orgId'])
		.index('by_orgId_status', ['orgId', 'status'])
		.index('by_networkId_status', ['networkId', 'status'])
		.index('by_networkId_status_joinedAt', ['networkId', 'status', 'joinedAt']),

	// Incremental per-organization inputs and generation-swapped network
	// projections. Public coalition reads never scan raw supporters, actions,
	// receipts, or the full member roster.
	coalitionOrgMetricInputs: defineTable({
		orgId: v.id('organizations'),
		version: v.number(),
		revision: v.number(),
		totalSupporters: v.number(),
		verifiedSupporters: v.number(),
		totalCampaignActions: v.number(),
		verifiedCampaignActions: v.number(),
		messageHashedTotal: v.number(),
		tier1: v.number(),
		tier3: v.number(),
		tier4: v.number(),
		updatedAt: v.number()
	}).index('by_orgId', ['orgId']),

	coalitionOrgMetricDimensions: defineTable({
		orgId: v.id('organizations'),
		kind: v.union(
			v.literal('supporter_hash'),
			v.literal('country'),
			v.literal('action_district'),
			v.literal('action_message'),
			v.literal('action_hour')
		),
		key: v.string(),
		count: v.number(),
		updatedAt: v.number()
	})
		.index('by_orgId_kind_key', ['orgId', 'kind', 'key'])
		.index('by_orgId_kind', ['orgId', 'kind']),

	coalitionOrgPressureInputs: defineTable({
		orgId: v.id('organizations'),
		decisionMakerId: v.id('decisionMakers'),
		dmName: v.string(),
		canonicalSlug: v.optional(v.string()),
		maxProofWeight: v.float64(),
		verifiedActionEvidence: v.number(),
		districtSignalCount: v.number(),
		receiptCount: v.number(),
		latestReceiptAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_orgId_decisionMakerId', ['orgId', 'decisionMakerId'])
		.index('by_orgId', ['orgId']),

	coalitionOrgPressureBillInputs: defineTable({
		orgId: v.id('organizations'),
		decisionMakerId: v.id('decisionMakers'),
		billId: v.id('bills'),
		billTitle: v.string(),
		alignmentNumerator: v.float64(),
		alignmentWeight: v.float64(),
		dmAction: v.optional(v.string()),
		receiptCount: v.number(),
		latestReceiptAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_orgId_decisionMakerId_billId', ['orgId', 'decisionMakerId', 'billId'])
		.index('by_orgId', ['orgId']),

	coalitionNetworkAggregates: defineTable({
		networkId: v.id('orgNetworks'),
		version: v.number(),
		status: v.string(),
		activeGeneration: v.optional(v.number()),
		revision: v.number(),
		memberCount: v.number(),
		totalSupporters: v.number(),
		uniqueSupporters: v.number(),
		verifiedSupporters: v.number(),
		totalCampaignActions: v.number(),
		verifiedCampaignActions: v.number(),
		messageHashedTotal: v.number(),
		uniqueMessages: v.number(),
		districtCount: v.number(),
		districtSquareSum: v.float64(),
		hourCountXLogXSum: v.float64(),
		tier1: v.number(),
		tier3: v.number(),
		tier4: v.number(),
		stateDistribution: v.array(v.object({ code: v.string(), count: v.number() })),
		stateDistributionOtherCount: v.number(),
		gds: v.optional(v.float64()),
		ald: v.optional(v.float64()),
		temporalEntropy: v.optional(v.float64()),
		cai: v.optional(v.float64()),
		dirtyAt: v.optional(v.number()),
		refreshScheduledAt: v.optional(v.number()),
		failureCode: v.optional(v.string()),
		updatedAt: v.number()
	})
		.index('by_networkId', ['networkId'])
		.index('by_status', ['status']),

	coalitionNetworkMetricDimensions: defineTable({
		networkId: v.id('orgNetworks'),
		generation: v.number(),
		kind: v.union(
			v.literal('supporter_hash'),
			v.literal('country'),
			v.literal('action_district'),
			v.literal('action_message'),
			v.literal('action_hour')
		),
		key: v.string(),
		count: v.number(),
		updatedAt: v.number()
	})
		.index('by_networkId_generation_kind_key', ['networkId', 'generation', 'kind', 'key'])
		.index('by_networkId_generation_kind', ['networkId', 'generation', 'kind']),

	coalitionNetworkPressureRows: defineTable({
		networkId: v.id('orgNetworks'),
		generation: v.number(),
		decisionMakerId: v.id('decisionMakers'),
		canonicalSlug: v.optional(v.string()),
		dmName: v.string(),
		orgCount: v.number(),
		combinedProofWeight: v.float64(),
		verifiedActionEvidence: v.number(),
		districtSignalCount: v.number(),
		receiptCount: v.number(),
		bills: v.array(
			v.object({
				billId: v.string(),
				billTitle: v.string(),
				alignment: v.float64(),
				dmAction: v.optional(v.string()),
				receiptCount: v.number()
			})
		),
		latestReceiptAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_networkId_generation_decisionMakerId', [
			'networkId',
			'generation',
			'decisionMakerId'
		])
		.index('by_networkId_generation_combinedProofWeight', [
			'networkId',
			'generation',
			'combinedProofWeight'
		]),

	coalitionNetworkPressureBills: defineTable({
		networkId: v.id('orgNetworks'),
		generation: v.number(),
		decisionMakerId: v.id('decisionMakers'),
		billId: v.id('bills'),
		billTitle: v.string(),
		alignmentNumerator: v.float64(),
		alignmentWeight: v.float64(),
		dmAction: v.optional(v.string()),
		receiptCount: v.number(),
		latestReceiptAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_networkId_generation_decisionMakerId_billId', [
			'networkId',
			'generation',
			'decisionMakerId',
			'billId'
		])
		.index('by_networkId_generation', ['networkId', 'generation']),

	coalitionNetworkRebuilds: defineTable({
		networkId: v.id('orgNetworks'),
		status: v.string(),
		runToken: v.string(),
		targetGeneration: v.number(),
		phase: v.string(),
		memberOrgIds: v.array(v.id('organizations')),
		memberRevisions: v.array(v.number()),
		membershipRevision: v.number(),
		memberIndex: v.number(),
		kindIndex: v.number(),
		cursor: v.optional(v.string()),
		accumulator: v.any(),
		failureCode: v.optional(v.string()),
		startedAt: v.number(),
		completedAt: v.optional(v.number()),
		updatedAt: v.number()
	})
		.index('by_networkId', ['networkId'])
		.index('by_status', ['status']),

	coalitionMetricsMigrations: defineTable({
		key: v.string(),
		status: v.string(),
		runToken: v.string(),
		phase: v.string(),
		cursor: v.optional(v.string()),
		scannedSupporters: v.number(),
		projectedSupporters: v.number(),
		scannedActions: v.number(),
		projectedActions: v.number(),
		scannedReceipts: v.number(),
		projectedReceipts: v.number(),
		networksScheduled: v.number(),
		networksReady: v.number(),
		failureCode: v.optional(v.string()),
		failureSourceId: v.optional(v.string()),
		startedAt: v.number(),
		completedAt: v.optional(v.number()),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	publicNetworkCharters: defineTable({
		networkId: v.id('orgNetworks'),
		slug: v.string(),
		name: v.string(),
		applicableCountries: v.array(v.string()),
		mission: v.optional(v.string()),
		principles: v.array(v.string()),
		charterText: v.optional(v.string()),
		charterPublishedAt: v.number(),
		charterHash: v.string(),
		ownerOrg: v.optional(v.object({ name: v.string(), slug: v.string() })),
		founders: v.array(
			v.object({
				orgName: v.string(),
				orgSlug: v.string(),
				role: v.string(),
				joinedAt: v.number()
			})
		),
		projectionVersion: v.number(),
		payloadBytes: v.number(),
		createdAt: v.number()
	})
		.index('by_slug', ['slug'])
		.index('by_networkId', ['networkId']),

	networkCharterMigrations: defineTable({
		key: v.string(),
		status: v.string(),
		runToken: v.string(),
		cursor: v.optional(v.string()),
		scanned: v.number(),
		projected: v.number(),
		failureCode: v.optional(v.string()),
		failureSourceId: v.optional(v.string()),
		startedAt: v.number(),
		completedAt: v.optional(v.number()),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	templateEndorsements: defineTable({
		templateId: v.id('templates'),
		orgId: v.id('organizations'),
		endorsedAt: v.number(),
		endorsedBy: v.optional(v.string())
	})
		.index('by_templateId', ['templateId'])
		.index('by_orgId', ['orgId'])
		.index('by_templateId_orgId', ['templateId', 'orgId']),

	// ===========================================================================
	// SUPPORTERS & TAGS
	// ===========================================================================

	supporters: defineTable({
		orgId: v.id('organizations'),
		postalCode: v.optional(v.string()),
		stateCode: v.optional(v.string()),
		congressionalDistrict: v.optional(v.string()),
		country: v.optional(v.string()),

		// PII encryption at rest
		encryptedEmail: v.string(),
		emailHash: v.string(),
		encryptedName: v.optional(v.string()),
		encryptedPhone: v.optional(v.string()),
		phoneHash: v.optional(v.string()),
		encryptedCustomFields: v.optional(v.string()),

		// Cross-org bounce/complaint correlation (unkeyed SHA-256 of normalized email).
		// Paired `globalPhoneHash` enables TCPA STOP/START webhook lookup —
		// the inbound Twilio webhook only has the `From` phone (no org
		// context). Both producers in `convex/_orgHash.ts`.
		globalEmailHash: v.optional(v.string()),
		globalPhoneHash: v.optional(v.string()),
		coalitionMetricsVersion: v.optional(v.number()),

		// ZK identity binding
		identityCommitment: v.optional(v.string()),

		// Verification state
		verified: v.boolean(),
		emailStatus: v.string(), // 'subscribed' | 'unsubscribed' | 'bounced' | 'complained'
		smsStatus: v.string(), // 'none' | 'subscribed' | 'unsubscribed' | 'stopped'
		emailConsentSource: v.optional(v.string()),
		emailConsentedAt: v.optional(v.number()),
		emailConsentText: v.optional(v.string()),
		smsConsentSource: v.optional(v.string()),
		smsConsentedAt: v.optional(v.number()),
		smsConsentText: v.optional(v.string()),

		// Soft-bounce tally. Transient/Undetermined SES bounces increment this;
		// a successful Delivery resets it. Crosses threshold (=3) → emailStatus
		// flips to 'bounced' and a suppressedEmails row gets a 30-day TTL so
		// blast recipient resolution stops pulling this address. See
		// convex/webhooks.ts:recordSoftBounces.
		softBounceCount: v.optional(v.number()),

		// Import tracking
		source: v.optional(v.string()), // 'csv' | platform profile id | 'organic' | 'widget'
		importedAt: v.optional(v.number()),
		// Compact, versioned People-browser projection. These fields make every
		// list/export page proportional to its requested page size: no 10K roster
		// rebuild and no per-row supporterTags fan-out.
		browseSource: v.optional(v.string()),
		browseTagIds: v.optional(v.array(v.id('tags'))),
		supporterBrowseVersion: v.optional(v.number()),

		// Compact audience-filter read model. Launch-path email/SMS cohort
		// resolution reads these bounded arrays directly from each supporter page;
		// it never joins supporterTags or campaignActions per supporter. Exact
		// dimension counts live in supporterAudienceActionDimensions so action
		// insert/delete transitions can maintain the arrays transactionally.
		audienceCampaignIds: v.optional(v.array(v.id('campaigns'))),
		audienceDistrictHashes: v.optional(v.array(v.string())),
		audienceDistrictCodes: v.optional(v.array(v.string())),
		audienceMaxEngagementTier: v.optional(v.number()),
		audienceActionProjectionVersion: v.optional(v.number()),
		// A supporter whose distinct action dimensions exceed the product
		// envelope is never approximated. Action-context cohort builds fail closed
		// until an operator deliberately repairs or narrows the history.
		audienceActionProjectionOverflow: v.optional(v.boolean()),
		// Monotonic fanout checkpoints. Provider jobs may complete out of order;
		// a supporter row only accepts an authority snapshot newer than the last
		// one already projected for that channel.
		contactEmailAuthorityUpdatedAt: v.optional(v.number()),
		contactSmsAuthorityUpdatedAt: v.optional(v.number()),

		updatedAt: v.number()
	})
		.index('by_orgId', ['orgId'])
		.index('by_orgId_emailStatus', ['orgId', 'emailStatus'])
		.index('by_orgId_smsStatus', ['orgId', 'smsStatus'])
		.index('by_orgId_verified', ['orgId', 'verified'])
		.index('by_orgId_browseSource', ['orgId', 'browseSource'])
		.index('by_orgId_emailStatus_verified', ['orgId', 'emailStatus', 'verified'])
		.index('by_orgId_emailStatus_browseSource', ['orgId', 'emailStatus', 'browseSource'])
		.index('by_orgId_verified_browseSource', ['orgId', 'verified', 'browseSource'])
		.index('by_orgId_emailStatus_verified_browseSource', [
			'orgId',
			'emailStatus',
			'verified',
			'browseSource'
		])
		.index('by_orgId_emailHash', ['orgId', 'emailHash'])
		.index('by_orgId_phoneHash', ['orgId', 'phoneHash'])
		.index('by_globalEmailHash', ['globalEmailHash'])
		.index('by_globalEmailHash_emailStatus', ['globalEmailHash', 'emailStatus'])
		.index('by_globalPhoneHash', ['globalPhoneHash'])
		.index('by_globalPhoneHash_smsStatus', ['globalPhoneHash', 'smsStatus'])
		.index('by_globalPhoneHash_orgId', ['globalPhoneHash', 'orgId'])
		.index('by_globalPhoneHash_orgId_smsStatus', ['globalPhoneHash', 'orgId', 'smsStatus'])
		.index('by_emailStatus', ['emailStatus'])
		.index('by_smsStatus', ['smsStatus'])
		.index('by_source', ['source'])
		.index('by_identityCommitment', ['identityCommitment']),

	tags: defineTable({
		orgId: v.id('organizations'),
		name: v.string(),
		nameKey: v.optional(v.string()),
		// Exact count maintained by versioned supporterTag link transitions.
		supporterCount: v.optional(v.number())
	})
		.index('by_orgId', ['orgId'])
		.index('by_orgId_name', ['orgId', 'name'])
		.index('by_orgId_nameKey', ['orgId', 'nameKey']),

	supporterTags: defineTable({
		supporterId: v.id('supporters'),
		tagId: v.id('tags'),
		// Copied supporter ordering key + version marker for a real tag-anchored
		// database cursor. The version equality excludes unprojected legacy links.
		supporterCreatedAt: v.optional(v.number()),
		supporterBrowseVersion: v.optional(v.number())
	})
		.index('by_supporterId', ['supporterId'])
		.index('by_tagId', ['tagId'])
		.index('by_tagId_supporterBrowseVersion_supporterCreatedAt', [
			'tagId',
			'supporterBrowseVersion',
			'supporterCreatedAt'
		])
		.index('by_supporterId_tagId', ['supporterId', 'tagId']),

	supporterBrowseMigrations: defineTable({
		key: v.literal('supporter-browse-v1'),
		status: v.union(
			v.literal('running'),
			v.literal('blocked'),
			v.literal('migrated'),
			v.literal('ready')
		),
		runToken: v.string(),
		phase: v.union(
			v.literal('links'),
			v.literal('supporters'),
			v.literal('tags'),
			v.literal('complete')
		),
		cursor: v.optional(v.string()),
		scanned: v.number(),
		projected: v.number(),
		failureCode: v.optional(v.string()),
		failureSourceId: v.optional(v.string()),
		failurePhase: v.optional(v.string()),
		startedAt: v.number(),
		completedAt: v.optional(v.number()),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	// Exact multiplicities behind the compact supporter action projection.
	// One campaign action contributes at most five rows (campaign, district
	// hash, readable district code, engagement tier, verified-district marker). The compound index is a
	// logical uniqueness boundary used by every writer transition.
	supporterAudienceActionDimensions: defineTable({
		orgId: v.id('organizations'),
		supporterId: v.id('supporters'),
		kind: v.union(
			v.literal('campaign'),
			v.literal('district_hash'),
			v.literal('district_code'),
			v.literal('engagement_tier'),
			v.literal('verified_district_supporter')
		),
		value: v.string(),
		count: v.number(),
		updatedAt: v.number()
	})
		.index('by_supporter_kind_value', ['supporterId', 'kind', 'value'])
		.index('by_supporter_kind', ['supporterId', 'kind']),

	supporterAudienceActionMigrations: defineTable({
		// v1 rows remain valid during the marker-only v2 adoption. The active
		// reader/writer version is selected in lib/supporterAudience.ts.
		key: v.union(
			v.literal('supporter-audience-actions-v1'),
			v.literal('supporter-audience-actions-v2')
		),
		status: v.union(
			v.literal('running'),
			v.literal('migrated'),
			v.literal('ready'),
			v.literal('blocked')
		),
		cursor: v.optional(v.string()),
		scanned: v.number(),
		projected: v.number(),
		failureCode: v.optional(v.string()),
		failureSourceId: v.optional(v.string()),
		startedAt: v.number(),
		completedAt: v.optional(v.number()),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	// ===========================================================================
	// SEGMENTS
	// ===========================================================================

	segments: defineTable({
		orgId: v.id('organizations'),
		name: v.string(),
		description: v.optional(v.string()),
		filters: v.any(), // { logic: 'AND'|'OR', conditions: [] }
		cachedCount: v.optional(v.number()),
		countedAt: v.optional(v.number()),
		createdBy: v.id('users'),
		updatedAt: v.number()
	})
		.index('by_orgId', ['orgId'])
		.index('by_orgId_name', ['orgId', 'name']),

	// ===========================================================================
	// CAMPAIGNS
	// ===========================================================================

	campaigns: defineTable({
		orgId: v.id('organizations'),
		// Closed union — the enum has been stable since the org-layer
		// migration. Adding a new type requires a schema deploy +
		// matching read-side branches; that's the right friction.
		// LETTER/EVENT/FORM are the user-facing types; FUNDRAISER is the
		// donation-flow campaign carved out by convex/donations.ts (a
		// campaign that holds a goalAmountCents + receives stripe
		// payments). Brutalist sweep caught FUNDRAISER missing from the
		// initial union — donations.ts:622 inserts it directly.
		// CONGRESSIONAL is dispatched through the CWC delivery spine; its
		// authoring surface is gated by FEATURES.CONGRESSIONAL.
		type: v.union(
			v.literal('LETTER'),
			v.literal('EVENT'),
			v.literal('FORM'),
			v.literal('FUNDRAISER'),
			v.literal('CONGRESSIONAL')
		),
		title: v.string(),
		body: v.optional(v.string()),
		status: v.union(
			v.literal('DRAFT'),
			v.literal('ACTIVE'),
			v.literal('PAUSED'),
			v.literal('COMPLETE')
		),

		// Target resolution
		targets: v.optional(v.any()),

		// Template linkage. Migrated v.string() → v.id('templates') 2026-05-26.
		// The writer at convex/campaigns.ts:351 always wrote a templates Id
		// at runtime; the string typing forced campaigns.ts:117-119 to do
		// "look up by slug index or iterate" instead of a direct
		// `ctx.db.get(campaign.templateId)`. Existing rows pass v.id()
		// validation because the prior cast preserved Id-format strings.
		// Production migration: run backfill:normalizeCampaignTemplateIds
		// (see convex/backfill.ts) to clear any pre-migration non-Id strings.
		templateId: v.optional(v.id('templates')),

		// Debate market
		debateEnabled: v.boolean(),
		debateThreshold: v.number(),
		debateId: v.optional(v.id('debates')),

		// Fundraising
		goalAmountCents: v.optional(v.number()),
		raisedAmountCents: v.number(),
		// Counts donations completed, NOT unique donors. Field name is legacy
		// (renaming is a Convex migration); UI labels it "Donations" to match
		// the actual semantics. True unique-donor tracking is deferred to
		// Phase 9 substrate work — would need a (campaignId, supporterId)
		// composite index plus refund-aware decrement logic. (cure shipped).
		donorCount: v.number(),
		donationCurrency: v.optional(v.string()),
		donationReceiptPolicy: v.optional(
			v.object({
				mode: v.union(v.literal('confirmation_only'), v.literal('tax_acknowledgment_policy')),
				legalName: v.optional(v.string()),
				acknowledgmentText: v.optional(v.string()),
				configuredAt: v.number(),
				configuredBy: v.optional(v.id('users'))
			})
		),

		// Geographic targeting
		targetJurisdiction: v.optional(v.string()),
		targetCountry: v.string(),
		// Specific district code (e.g., "CA-11") and its centroid for boundary lookups
		districtCode: v.optional(v.string()),
		districtCentroid: v.optional(v.object({ lat: v.number(), lng: v.number() })),

		// Intelligence loop
		billId: v.optional(v.id('bills')),
		position: v.optional(v.string()), // 'support' | 'oppose'

		// Denormalized counters
		actionCount: v.optional(v.number()),
		verifiedActionCount: v.optional(v.number()),
		// Tier-3+ (document-verified, ZKP-grade) action count, maintained
		// by `createCampaignAction` on every verified insert with
		// trustTier >= 3. Without this denormalized counter,
		// `getCampaignForReport` would have to read every campaignAction
		// row just to count this subset in memory.
		tier3VerifiedActionCount: v.optional(v.number()),
		// Marks that this campaign's current status has been folded into the
		// organization activeCampaignCount. Enables exact concurrent migration.
		orgCounterVersion: v.optional(v.number()),

		updatedAt: v.number()
	})
		.index('by_orgId', ['orgId'])
		.index('by_orgId_type', ['orgId', 'type'])
		.index('by_orgId_type_status', ['orgId', 'type', 'status'])
		.index('by_orgId_status', ['orgId', 'status'])
		.index('by_status', ['status'])
		.index('by_debateId', ['debateId'])
		// Resolve the campaign that owns a given template — used by the
		// congressional delivery path to attribute a successful CWC send back to
		// the org campaign whose templateId matches the delivered submission.
		.index('by_templateId', ['templateId'])
		.index('by_templateId_debateId', ['templateId', 'debateId'])
		.index('by_templateId_orgId_status', ['templateId', 'orgId', 'status']),

	campaignActions: defineTable({
		campaignId: v.id('campaigns'),
		orgId: v.optional(v.id('organizations')), // Denormalized for billing queries
		supporterId: v.optional(v.id('supporters')),

		verified: v.boolean(),
		engagementTier: v.number(), // 0-4
		districtHash: v.optional(v.string()),
		districtCode: v.optional(v.string()),
		// H3 res-7 cell index (~5.16 km², neighborhood scale). Resolved during
		// district verification via latLngToCell(lat, lng, 7). Stored for
		// intra-district geographic visualization in verification packets.
		h3Cell: v.optional(v.string()),
		messageHash: v.optional(v.string()),

		// Identity verification level at time of action (0-5, from users.trustTier)
		trustTier: v.optional(v.number()),
		// How the message was composed: 'individual' | 'shared' | 'edited'
		compositionMode: v.optional(v.string()),

		// Shadow Atlas root version at action-time. Used by the verification
		// packet to compute drift counts when the atlas rotates — actions
		// stamped with the previous version aren't invalidated, but their
		// proportion of the campaign's total is surfaced as `driftCount` /
		// `driftPct` so consumers can see how much of a campaign predates a
		// rotation. Optional because pre-T10-9 rows didn't carry it.
		atlasVersion: v.optional(v.string()),

		// Agentic delegation
		delegated: v.boolean(),
		delegationGrantId: v.optional(v.string()),

		// Delivery-channel discriminator for cross-channel attribution. Now that
		// the channel taxonomy is fixed, the field is a closed union rather than a
		// bare string: 'congressional' (CWC / legislative delivery, written by
		// submissions.emitCongressionalAction), 'email' (direct email), 'sms', and
		// 'web' (on-site form / embed) are forward values for the remaining writers.
		// Optional: existing rows predate the field and read as undefined (treated
		// as unattributed). Adding a value requires a schema deploy + a matching
		// read-side branch — the right friction for a cross-channel discriminator.
		channel: v.optional(
			v.union(v.literal('congressional'), v.literal('email'), v.literal('sms'), v.literal('web'))
		),

		// Set only on congressional-channel rows: the submissions row whose
		// successful CWC delivery produced this attributed action. Lets
		// createCampaignAction dedup the congressional path (which has no
		// supporterId) on the submission instead of (campaignId, supporterId),
		// so an idempotent delivery retry never double-counts a campaign.
		congressionalSubmissionId: v.optional(v.id('submissions')),

		// Delivery completeness for multi-recipient channels (currently
		// congressional, where a send may target both House + Senate):
		// 'delivered' = every targeted recipient received the message;
		// 'partial' = at least one delivered AND at least one failed. Optional /
		// undefined for single-recipient channels and pre-field rows, which are
		// treated as fully delivered. Keeps the org ledger honest: a House-ok /
		// Senate-fail rollup is recorded as 'partial', not silently counted as a
		// full delivery.
		deliveryStatus: v.optional(v.union(v.literal('delivered'), v.literal('partial'))),
		readModelVersion: v.optional(v.number()),
		coalitionMetricsVersion: v.optional(v.number()),
		audienceActionProjectionVersion: v.optional(v.number()),

		sentAt: v.number()
	})
		.index('by_campaignId', ['campaignId'])
		.index('by_campaignId_verified', ['campaignId', 'verified'])
		.index('by_campaignId_districtHash', ['campaignId', 'districtHash'])
		.index('by_campaignId_supporterId', ['campaignId', 'supporterId'])
		.index('by_orgId_supporterId', ['orgId', 'supporterId'])
		.index('by_orgId_verified', ['orgId', 'verified'])
		// Range index for the billing self-heal: when the period baseline is
		// stale/missing, count THIS period's verified actions via a sentAt range
		// (bounded to one period's volume — never the lifetime table) instead of
		// an unbounded .collect().
		.index('by_orgId_verified_sentAt', ['orgId', 'verified', 'sentAt'])
		// Per-channel attribution queries (bounded per campaign).
		.index('by_campaignId_channel', ['campaignId', 'channel'])
		// Congressional-path dedup: a single-doc lookup for the action a given
		// submission already produced, so retries are idempotent.
		.index('by_campaignId_congressionalSubmissionId', ['campaignId', 'congressionalSubmissionId']),

	campaignDeliveries: defineTable({
		campaignId: v.id('campaigns'),
		// Denormalized ownership is the exact bounded source for plan-usage
		// repair. Legacy rows are adopted by the global plan-usage migration
		// before any organization can be projected ready.
		orgId: v.optional(v.id('organizations')),
		actionId: v.optional(v.id('campaignActions')),
		decisionMakerId: v.optional(v.id('decisionMakers')),
		billId: v.optional(v.id('bills')),
		targetEmail: v.string(),
		targetName: v.string(),
		encryptedTargetEmail: v.optional(v.string()),
		targetEmailHash: v.optional(v.string()),
		encryptedTargetName: v.optional(v.string()),
		targetTitle: v.string(),
		targetDistrict: v.optional(v.string()),
		status: v.string(), // 'queued' | 'sent' | 'delivered' | 'bounced' | 'opened'
		planUsageReservationId: v.optional(v.id('planUsageReservations')),
		sentAt: v.optional(v.number()),
		sesMessageId: v.optional(v.string()),
		// Append-only history of sesMessageIds that previously bound to
		// this row (cleared by collision-steal in updateDeliveryStatus).
		// Lets operators reconstruct webhook correlation during incident
		// response — the loser of a collision steal still carries its
		// original SES-assigned id here as forensic context. Bounded
		// length: collisions are rare (SES guarantees uniqueness; non-
		// collision writes never append) so the array stays single-digit
		// in normal operation.
		previousSesMessageIds: v.optional(v.array(v.string())),
		packetSnapshot: v.optional(v.any()),
		packetDigest: v.optional(v.string()),
		proofWeight: v.optional(v.number()),
		// Sender-side delivery rows become receipt-eligible only when they
		// are bound to both a Power target and a bill. This is readiness,
		// not a Merkle-anchored accountability receipt.
		receiptEligibility: v.optional(
			v.union(
				v.literal('eligible'),
				v.literal('missing_bill'),
				v.literal('unresolved_target'),
				v.literal('missing_bill_and_target')
			)
		),
		receiptBlockers: v.optional(v.array(v.string())),
		// Delivery-local response history for campaign report sends that do
		// not yet have a full accountabilityReceipt. When a receipt exists,
		// readers should prefer accountabilityReceipts.responses because it
		// carries the stronger proof packet context.
		responses: v.optional(
			v.array(
				v.object({
					type: accountabilityResponseType,
					detail: v.optional(v.string()),
					confidence: v.string(),
					occurredAt: v.number()
				})
			)
		),
		readModelVersion: v.optional(v.number()),
		createdAt: v.number()
	})
		.index('by_campaignId', ['campaignId'])
		.index('by_orgId_sentAt', ['orgId', 'sentAt'])
		.index('by_campaignId_status', ['campaignId', 'status'])
		.index('by_campaignId_targetEmail', ['campaignId', 'targetEmail'])
		.index('by_actionId', ['actionId'])
		.index('by_status', ['status'])
		// SES bounce/delivery webhook (`webhooks.handleDeliveryEvent`) uses
		// this to correlate inbound notifications to the queued delivery
		// row. Pre-index path was `.filter(q.eq("sesMessageId", ...))` —
		// O(n) over every campaign delivery, ever. With the index this is
		// a bounded read by SES MessageId, which is unique per send.
		.index('by_sesMessageId', ['sesMessageId']),

	// Compact campaign proof/analytics singleton. Every embedded list has a
	// hard cap in lib/campaignReadModel.ts.
	campaignReadModels: defineTable({
		campaignId: v.id('campaigns'),
		orgId: v.id('organizations'),
		state: campaignReadModelStateValidator
	})
		.index('by_campaignId', ['campaignId'])
		.index('by_orgId', ['orgId']),

	// Exact high-cardinality dimensions live outside the hot singleton. Each
	// action touches at most eight unique [campaign,kind,key] rows.
	campaignReadModelDimensions: defineTable({
		campaignId: v.id('campaigns'),
		kind: v.union(
			v.literal('district'),
			v.literal('cell'),
			v.literal('hour'),
			v.literal('day'),
			v.literal('day_verified'),
			v.literal('message'),
			v.literal('message_no_mode'),
			v.literal('atlas')
		),
		key: v.string(),
		count: v.number(),
		updatedAt: v.number()
	})
		.index('by_campaignId_kind_key', ['campaignId', 'kind', 'key'])
		.index('by_campaignId_kind', ['campaignId', 'kind']),

	campaignReadModelMigrations: defineTable({
		key: v.literal('v1'),
		status: v.union(
			v.literal('pending'),
			v.literal('running'),
			v.literal('migrated'),
			v.literal('ready'),
			v.literal('blocked')
		),
		phase: v.union(v.literal('actions'), v.literal('deliveries')),
		cursor: v.optional(v.string()),
		actionsScanned: v.number(),
		actionsAdopted: v.number(),
		deliveriesScanned: v.number(),
		deliveriesAdopted: v.number(),
		failureCode: v.optional(v.string()),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	campaignActiveCounterMigrations: defineTable({
		key: v.literal('v1'),
		status: v.union(
			v.literal('pending'),
			v.literal('running'),
			v.literal('migrated'),
			v.literal('ready'),
			v.literal('blocked')
		),
		cursor: v.optional(v.string()),
		scanned: v.number(),
		adopted: v.number(),
		activeCounted: v.number(),
		failureCode: v.optional(v.string()),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	// ===========================================================================
	// EMAIL BLASTS (with flattened email_batch)
	// ===========================================================================

	emailBlasts: defineTable({
		orgId: v.id('organizations'),
		// Migrated from v.optional(v.string()) on 2026-05-25 — the field has
		// always held a campaigns Id at runtime (compose route casts via
		// `as Id<'campaigns'>` after validating via campaigns.get); the
		// string typing was a legacy API-boundary artifact. Stripe is still
		// test-mode in Convex prod so no live blast traffic exists to
		// migrate; any pre-2026-05-25 dev rows must be cleared with
		// `npx convex run seed:clearSeed` before pushing schema.
		campaignId: v.optional(v.id('campaigns')),

		subject: v.string(),
		bodyHtml: v.string(),
		fromName: v.string(),
		fromEmail: v.string(),

		status: emailBlastStatus,
		planUsageReservationId: v.optional(v.id('planUsageReservations')),
		// One-shot, serializable grant immediately before the enclave POST. The
		// global contact-authority epoch and exact materialized cohort size are
		// committed with the grant so duplicate action invocations cannot exercise
		// carrier authority twice. Optional only for pre-grant/legacy rows.
		carrierAuthorityIssuedAt: v.optional(v.number()),
		carrierAuthorityEpoch: v.optional(v.number()),
		carrierAuthorityRecipientCount: v.optional(v.number()),

		// Recipient targeting. Closed shape (see convex/_validators.ts) so a
		// malformed write cannot widen a targeted blast to the entire
		// subscribed cohort — the failure mode the prior `v.any()` allowed.
		recipientFilter: v.optional(recipientFilterValidator),
		totalRecipients: v.number(),
		// Exact O(1) receipt cardinality authority. Optional only for legacy rows:
		// receipt writers fail closed when it is absent, so they never rebuild a
		// cohort-sized count inside a request transaction.
		receiptCount: v.optional(v.number()),

		// Verification context
		verificationContext: v.optional(v.any()),

		// Aggregate metrics
		totalSent: v.number(),
		totalBounced: v.number(),
		totalOpened: v.number(),
		totalClicked: v.number(),
		totalComplained: v.number(),

		sentAt: v.optional(v.number()),
		updatedAt: v.number(),

		// Scheduled / TEE-sealed sends
		scheduledAt: v.optional(v.number()), // Future send time (epoch ms)
		sealedOrgKey: v.optional(v.string()), // Org key sealed to TEE public key, deleted after send
		sendMode: v.optional(v.string()), // 'client-direct' | 'tee-sealed' | 'server'

		// A/B testing
		isAbTest: v.boolean(),
		abTestConfig: v.optional(v.any()),
		abVariant: v.optional(v.string()),
		abParentId: v.optional(v.string()),
		abWinnerPickedAt: v.optional(v.number()),

		// ── FLATTENED: EmailBatch[] ──
		// Batches as array (was separate email_batch table)
		batches: v.optional(
			v.array(
				v.object({
					batchIndex: v.number(),
					status: v.string(), // 'pending' | 'sending' | 'sent' | 'failed'
					sentCount: v.number(),
					failedCount: v.number(),
					error: v.optional(v.string()),
					sentAt: v.optional(v.number())
				})
			)
		)
	})
		.index('by_orgId', ['orgId'])
		.index('by_status', ['status'])
		.index('by_status_sendMode_scheduledAt', ['status', 'sendMode', 'scheduledAt'])
		.index('by_status_updatedAt', ['status', 'updatedAt'])
		// Range index for the billing period read: checkPlanLimits ranges
		// sentAt >= periodStart so it touches only this period's blasts, not the
		// org's entire blast history (one row per blast — same unbounded-collect
		// cliff the verified-action read already fixed via by_orgId_verified_sentAt).
		.index('by_orgId_sentAt', ['orgId', 'sentAt'])
		.index('by_orgId_abParentId', ['orgId', 'abParentId']),

	// Compact unresolved A/B winner read model. The picker never needs subject,
	// bodyHtml, recipient filters, or cohort hash arrays; keeping those fields
	// out prevents a bounded row scan from becoming a multi-megabyte I/O scan.
	emailAbWinnerCandidates: defineTable({
		blastId: v.id('emailBlasts'),
		orgId: v.id('organizations'),
		abParentId: v.string(),
		abVariant: v.optional(v.string()),
		totalSent: v.number(),
		totalOpened: v.number(),
		totalClicked: v.number(),
		sentAt: v.number(),
		winnerMetric: v.optional(v.union(v.literal('open'), v.literal('click'))),
		testDurationMs: v.number(),
		updatedAt: v.number()
	})
		.index('by_blastId', ['blastId'])
		.index('by_sentAt', ['sentAt']),

	emailAbTestCohorts: defineTable({
		orgId: v.id('organizations'),
		abParentId: v.string(),
		baseFilter: recipientFilterValidator,
		variantAEmailHashes: v.array(v.string()),
		variantBEmailHashes: v.array(v.string()),
		remainderEmailHashes: v.array(v.string()),
		totalCount: v.number(),
		testCount: v.number(),
		remainderCount: v.number(),
		remainderBlastId: v.optional(v.id('emailBlasts')),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_org_abParentId', ['orgId', 'abParentId'])
		.index('by_remainderBlastId', ['remainderBlastId']),

	emailEvents: defineTable({
		blastId: v.id('emailBlasts'),
		encryptedRecipientEmail: v.optional(v.string()),
		recipientEmailHash: v.optional(v.string()),
		eventType: v.string(), // 'open' | 'click' | 'bounce' | 'complaint'
		linkUrl: v.optional(v.string()),
		linkIndex: v.optional(v.number()),
		timestamp: v.number()
	})
		.index('by_blastId', ['blastId'])
		.index('by_blastId_eventType', ['blastId', 'eventType'])
		.index('by_blastId_recipientEmailHash', ['blastId', 'recipientEmailHash'])
		.index('by_blastId_recipientEmailHash_eventType', [
			'blastId',
			'recipientEmailHash',
			'eventType'
		])
		.index('by_blastId_recipientEmailHash_eventType_linkUrl', [
			'blastId',
			'recipientEmailHash',
			'eventType',
			'linkUrl'
		]),

	// Per-recipient send receipts — one row per (blast, recipient) at the moment
	// the SES Lambda dispatches the message. Closes (no durable
	// per-recipient receipt register). emailEvents records what happens AFTER
	// the send (open/click/bounce/complaint); emailDeliveryReceipts records
	// THAT a send was attempted, with which sesMessageId, and the immediate
	// outcome from SES. The (blastId, recipientEmailHash) tuple is logically
	// unique — writers MUST upsert via the by_blastId_recipientEmailHash index
	// rather than blind-insert (so retries don't double-write).
	emailDeliveryReceipts: defineTable({
		blastId: v.id('emailBlasts'),
		recipientEmailHash: v.string(),
		// Set ONLY when status === 'sent'. The `by_sesMessageId` index over an
		// optional field would group all `failed` rows under undefined; SNS
		// bounce-correlation lookups must filter by `status === 'sent'` before
		// dereferencing this field.
		sesMessageId: v.optional(v.string()),
		status: v.union(v.literal('sent'), v.literal('failed')),
		sentAt: v.number(),
		error: v.optional(v.string())
	})
		.index('by_blastId', ['blastId'])
		.index('by_blastId_recipientEmailHash', ['blastId', 'recipientEmailHash'])
		.index('by_sesMessageId', ['sesMessageId']),

	// ===========================================================================
	// SUBSCRIPTIONS
	// ===========================================================================

	subscriptions: defineTable({
		// Polymorphic owner
		userId: v.optional(v.id('users')),
		orgId: v.optional(v.id('organizations')),

		// Plan slug — canonical values at src/lib/server/billing/plans.ts.
		// Tightened from v.string() to a closed union 2026-05-26 to catch
		// silent downgrades at write time (the read-side fallback
		// `PLANS[plan] ?? PLANS.inactive` at convex/subscriptions.ts
		// degrades gracefully but observability is poor — a writer that
		// silently passes 'Organization' (capitalized) would never be
		// noticed by ops). Adding a new tier requires editing this union
		// + plans.ts in lockstep; that's the right friction. `inactive` is
		// the gated floor (unsubscribed/canceled), not a marketed tier.
		plan: v.union(
			v.literal('inactive'),
			// Org (org-layer) plans — keyed on orgId.
			v.literal('starter'),
			v.literal('organization'),
			v.literal('coalition'),
			// Individual (person-layer) paid authoring tiers — keyed on userId.
			// They buy ONLY authoring volume; the org-quota fields above are never
			// synced for these. See src/lib/server/billing/plans.ts INDIVIDUAL_PLANS.
			v.literal('voice'),
			v.literal('advocate')
		),
		planDescription: v.optional(v.string()),
		priceCents: v.number(),

		// Tightened in the same C12 sweep as `plan`. Brutalist caught the
		// asymmetry — args validators in subscriptions.ts had been
		// updated to use the union but the schema fields were left at
		// v.string() with comment-as-enum, defeating the closure.
		status: v.union(
			v.literal('active'),
			v.literal('past_due'),
			v.literal('canceled'),
			v.literal('trialing')
		),
		currentPeriodStart: v.number(),
		currentPeriodEnd: v.number(),

		paymentMethod: v.union(v.literal('stripe'), v.literal('crypto')),

		// Stripe
		stripeSubscriptionId: v.optional(v.string()),

		// Crypto
		payingAddress: v.optional(v.string()),
		paymentChain: v.optional(v.string()),
		paymentToken: v.optional(v.string()),
		lastTxHash: v.optional(v.string()),
		lastVerifiedAt: v.optional(v.number()),

		// Grace period tracking: set on first transition to past_due, cleared on recovery
		pastDueSince: v.optional(v.number()),
		pastDueExpiryScheduledAt: v.optional(v.number()),

		updatedAt: v.number()
	})
		.index('by_userId', ['userId'])
		.index('by_orgId', ['orgId'])
		.index('by_stripeSubscriptionId', ['stripeSubscriptionId'])
		.index('by_status_pastDueSince', ['status', 'pastDueSince']),

	// Bounded pre-activation proof that subscription owner and Stripe identity
	// cardinality are exact. All entitlement readers fail closed independently;
	// this singleton prevents launch readiness while legacy rows are malformed.
	subscriptionAuthorityMigrations: defineTable({
		key: v.literal('subscription-authority-v1'),
		status: v.union(v.literal('running'), v.literal('ready'), v.literal('blocked')),
		cursor: v.optional(v.string()),
		scanned: v.number(),
		failureCode: v.optional(v.string()),
		failureSourceId: v.optional(v.string()),
		startedAt: v.number(),
		completedAt: v.optional(v.number()),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	// Durable, one-page-at-a-time cutover for exact organization plan usage.
	// The migration holds one organization and one source cursor at a time;
	// activation is separate so every request fails closed until the projection
	// is globally exact.
	planUsageMigrations: defineTable({
		key: v.literal('v1'),
		status: v.union(
			v.literal('running'),
			v.literal('migrated'),
			v.literal('ready'),
			v.literal('blocked')
		),
		runToken: v.string(),
		phase: v.union(
			v.literal('campaignDeliveriesAdoption'),
			v.literal('emailBlastsAdoption'),
			v.literal('workflowEmailsAdoption'),
			v.literal('organizations'),
			v.literal('verifiedActions'),
			v.literal('emailBlasts'),
			v.literal('campaignDeliveries'),
			v.literal('workflowEmails'),
			v.literal('emailReservations'),
			v.literal('smsBlasts'),
			v.literal('complete')
		),
		organizationCursor: v.optional(v.string()),
		currentOrgId: v.optional(v.id('organizations')),
		sourceCursor: v.optional(v.string()),
		periodStart: v.optional(v.number()),
		verifiedActions: v.number(),
		emailsSent: v.number(),
		emailReserved: v.number(),
		smsSent: v.number(),
		verifiedLifetimeSnapshot: v.optional(v.number()),
		emailLifetimeSnapshot: v.optional(v.number()),
		emailReservedSnapshot: v.optional(v.number()),
		emailReservationPeriodSnapshot: v.optional(v.number()),
		smsLifetimeSnapshot: v.optional(v.number()),
		restarts: v.number(),
		scannedOrganizations: v.number(),
		projectedOrganizations: v.number(),
		scannedSourceRows: v.number(),
		failureCode: v.optional(v.string()),
		failureSourceId: v.optional(v.string()),
		startedAt: v.number(),
		completedAt: v.optional(v.number()),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	// Durable per-organization repair evidence for projection-only plan usage.
	// One bounded worker transaction advances exactly one source page. The
	// organization row remains the hot O(1) usage authority; this row records
	// why that authority is not ready, the period being rebuilt, and enough
	// cursor/snapshot state to resume without request-path history scans.
	planUsageRepairs: defineTable({
		orgId: v.id('organizations'),
		status: v.union(
			v.literal('pending'),
			v.literal('running'),
			v.literal('ready'),
			v.literal('blocked')
		),
		runToken: v.string(),
		periodStart: v.number(),
		phase: v.union(
			v.literal('verifiedActions'),
			v.literal('emailBlasts'),
			v.literal('campaignDeliveries'),
			v.literal('workflowEmails'),
			v.literal('emailReservations'),
			v.literal('smsBlasts'),
			v.literal('complete')
		),
		sourceCursor: v.optional(v.string()),
		verifiedActions: v.number(),
		emailsSent: v.number(),
		emailReserved: v.number(),
		smsSent: v.number(),
		verifiedLifetimeSnapshot: v.number(),
		emailLifetimeSnapshot: v.number(),
		emailReservedSnapshot: v.number(),
		emailReservationPeriodSnapshot: v.optional(v.number()),
		smsLifetimeSnapshot: v.number(),
		restarts: v.number(),
		scannedSourceRows: v.number(),
		repairedCounterFields: v.optional(v.array(v.string())),
		failureCode: v.optional(v.string()),
		failureSourceId: v.optional(v.string()),
		requestedAt: v.number(),
		scheduledAt: v.optional(v.number()),
		startedAt: v.optional(v.number()),
		completedAt: v.optional(v.number()),
		updatedAt: v.number()
	})
		.index('by_orgId', ['orgId'])
		.index('by_status_updatedAt', ['status', 'updatedAt']),

	// Durable quota holds bridge the non-transactional carrier boundary. A
	// reservation is immutable in identity/requested capacity; only its exact
	// sent/released/remaining partition advances. The organization scalar is the
	// O(1) admission authority, while this table is the repair/audit source.
	planUsageReservations: defineTable({
		reservationIdentity: v.string(),
		orgId: v.id('organizations'),
		resource: v.literal('email'),
		sourceType: v.union(
			v.literal('campaignDelivery'),
			v.literal('emailBlast'),
			v.literal('workflowEmail')
		),
		sourceId: v.string(),
		// Workflow email identities are the durable (execution, step) tuple.
		// Other source types leave this unset and use their document id alone.
		sourceStepIndex: v.optional(v.number()),
		periodStart: v.number(),
		requestedCount: v.number(),
		remainingCount: v.number(),
		sentCount: v.number(),
		releasedCount: v.number(),
		status: v.union(
			v.literal('active'),
			v.literal('blocked'),
			v.literal('settled'),
			v.literal('released')
		),
		leaseExpiresAt: v.number(),
		terminalReason: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
		settledAt: v.optional(v.number())
	})
		.index('by_identity', ['reservationIdentity'])
		.index('by_orgId_status_periodStart', ['orgId', 'status', 'periodStart'])
		.index('by_status_leaseExpiresAt', ['status', 'leaseExpiresAt']),

	// Append-only, operator-ingested carrier evidence for ambiguous outcomes.
	// Reconciliation derives the quota outcome from this audited row and the
	// reservation/source identity; it never accepts a naked count directly.
	planUsageCarrierEvidence: defineTable({
		evidenceIdentity: v.string(),
		reservationId: v.id('planUsageReservations'),
		orgId: v.id('organizations'),
		carrier: v.literal('ses'),
		carrierMessageIds: v.array(v.string()),
		absoluteSentCount: v.number(),
		absoluteFailedCount: v.number(),
		sourceType: v.union(
			v.literal('campaignDelivery'),
			v.literal('emailBlast'),
			v.literal('workflowEmail')
		),
		sourceId: v.string(),
		sourceStepIndex: v.optional(v.number()),
		sourceDigest: v.string(),
		operatorRef: v.string(),
		observedAt: v.number(),
		ingestedAt: v.number()
	})
		.index('by_identity', ['evidenceIdentity'])
		.index('by_reservationId', ['reservationId']),

	// ===========================================================================
	// API KEYS
	// ===========================================================================

	apiKeys: defineTable({
		orgId: v.id('organizations'),
		keyHash: v.string(),
		keyPrefix: v.string(),
		name: v.string(),
		scopes: v.array(v.string()), // ['read'] | ['read', 'write']

		// Usage tracking
		lastUsedAt: v.optional(v.number()),
		requestCount: v.number(),

		// Lifecycle
		revokedAt: v.optional(v.number()),
		expiresAt: v.optional(v.number()),
		createdBy: v.optional(v.string())
	})
		.index('by_orgId', ['orgId'])
		// Active-key cardinality is enforced transactionally by reading this
		// exact optional-field range before insert. Revoked history remains on
		// `by_orgId` and is separately hard-capped by the creation mutation.
		.index('by_orgId_revokedAt', ['orgId', 'revokedAt'])
		.index('by_keyHash', ['keyHash']),

	usageRecords: defineTable({
		orgId: v.id('organizations'),
		keyId: v.optional(v.id('apiKeys')),
		meter: v.union(
			v.literal('resolve_address'),
			// LATENT (2026-07-03): zero writers today — meter slots for future district/officials endpoints
			v.literal('resolve_district'),
			v.literal('resolve_officials')
		),
		quantity: v.number(),
		occurredAt: v.number(),
		requestId: v.string(), // idempotency key
		billingPeriodStart: v.number(),
		reportedToProvider: v.optional(v.boolean()),
		providerEventId: v.optional(v.string())
	})
		.index('by_requestId', ['requestId'])
		.index('by_reportedToProvider', ['reportedToProvider']),

	// O(1) running counter per (org, meter, billingPeriodStart). Maintained
	// transactionally alongside the `usageRecords` ledger insert in
	// `metering.recordUsage`, so the substrate-sale quota gate can read the
	// period total in a single document read rather than scanning the ledger —
	// the resolve allowances (up to 500,000/period) exceed Convex's 32,000-doc
	// transaction scan limit, so a `take(allowance+1)` count is impossible. The
	// ledger above remains the billing source of truth; this is a derived index.
	usagePeriodTotals: defineTable({
		orgId: v.id('organizations'),
		meter: v.union(
			v.literal('resolve_address'),
			// LATENT (2026-07-03): zero writers today — meter slots for future district/officials endpoints
			v.literal('resolve_district'),
			v.literal('resolve_officials')
		),
		billingPeriodStart: v.number(),
		count: v.number()
	}).index('by_orgId_meter_period', ['orgId', 'meter', 'billingPeriodStart']),

	// ===========================================================================
	// EVENTS
	// ===========================================================================

	events: defineTable({
		orgId: v.id('organizations'),
		campaignId: v.optional(v.id('campaigns')),

		title: v.string(),
		description: v.optional(v.string()),
		eventType: v.union(v.literal('IN_PERSON'), v.literal('VIRTUAL'), v.literal('HYBRID')),

		// When
		startAt: v.number(),
		endAt: v.optional(v.number()),
		timezone: v.string(),

		// Where (physical)
		venue: v.optional(v.string()),
		address: v.optional(v.string()),
		city: v.optional(v.string()),
		state: v.optional(v.string()),
		postalCode: v.optional(v.string()),
		latitude: v.optional(v.float64()),
		longitude: v.optional(v.float64()),

		// Where (virtual)
		virtualUrl: v.optional(v.string()),

		// Capacity
		capacity: v.optional(v.number()),
		waitlistEnabled: v.boolean(),

		// Aggregate counters
		rsvpCount: v.number(),
		goingCount: v.optional(v.number()),
		maybeCount: v.optional(v.number()),
		attendeeCount: v.number(),
		verifiedAttendees: v.number(),

		// Verification
		checkinCode: v.optional(v.string()),
		requireVerification: v.boolean(),

		status: v.union(
			v.literal('DRAFT'),
			v.literal('PUBLISHED'),
			v.literal('CANCELLED'),
			v.literal('COMPLETED')
		),

		updatedAt: v.number()
	})
		.index('by_orgId', ['orgId'])
		.index('by_orgId_status', ['orgId', 'status'])
		.index('by_startAt', ['startAt'])
		.index('by_checkinCode', ['checkinCode']),

	// eventRsvps: includes flattened EventAttendance fields
	eventRsvps: defineTable({
		eventId: v.id('events'),
		supporterId: v.optional(v.id('supporters')),

		encryptedEmail: v.string(),
		emailHash: v.string(),
		encryptedRsvpName: v.optional(v.string()),
		status: eventRsvpStatus,
		guestCount: v.number(),

		// Verification context
		districtHash: v.optional(v.string()),
		engagementTier: v.number(),

		updatedAt: v.number(),

		// ── FLATTENED: EventAttendance fields ──
		// Check-in / attendance data (was separate event_attendance table)
		checkedInAt: v.optional(v.number()),
		attendanceVerified: v.optional(v.boolean()),
		attendanceVerificationMethod: v.optional(v.string()), // 'mdl' | 'passkey' | 'checkin_code'
		attendanceIdentityCommitment: v.optional(v.string()),
		attendanceDistrictHash: v.optional(v.string()),
		// Distinguishes a "real" RSVP (user pre-registered for the event)
		// from a "walk-in" sentinel row inserted by `publicCheckIn` for
		// dedup purposes (the walk-in had no prior RSVP, but we need a row
		// keyed on emailHash to refuse a second counter-tick). Walk-ins
		// carry status="GOING" + checkedInAt + walkIn=true so the RSVP
		// roster query (`getRsvps`) can filter them out by default while
		// the dedup branch in `publicCheckIn` still finds them via
		// `by_eventId_emailHash`. The roster surface is staffer-facing
		// and showing rows with `encryptedEmail: ""` would crash
		// client-side decrypt.
		walkIn: v.optional(v.boolean())
	})
		.index('by_eventId', ['eventId'])
		.index('by_eventId_emailHash', ['eventId', 'emailHash'])
		.index('by_eventId_status', ['eventId', 'status']),

	// ===========================================================================
	// FUNDRAISING — DONATIONS
	// ===========================================================================

	donations: defineTable({
		orgId: v.id('organizations'),
		campaignId: v.id('campaigns'),
		supporterId: v.optional(v.id('supporters')),

		// PII encryption at rest
		emailHash: v.optional(v.string()),
		encryptedEmail: v.optional(v.string()),
		encryptedName: v.optional(v.string()),

		amountCents: v.number(),
		currency: v.string(),
		recurring: v.boolean(),
		recurringInterval: v.optional(v.string()), // 'month' | 'year'

		stripeSessionId: v.optional(v.string()),
		stripePaymentIntentId: v.optional(v.string()),
		stripeSubscriptionId: v.optional(v.string()),

		// Closed enum so consumers (UI filters, SDK clients, analytics)
		// see the full set at the type system level. Free-form
		// `v.string()` would allow drift between writers and readers.
		status: v.union(
			v.literal('pending'),
			v.literal('completed'),
			v.literal('failed'),
			v.literal('refunded')
		),

		// Baseline donor confirmation email outcome. This is deliberately
		// separate from accountabilityReceipts and tax acknowledgments.
		confirmationEmailStatus: v.optional(
			v.union(v.literal('sending'), v.literal('sent'), v.literal('skipped'), v.literal('failed'))
		),
		confirmationEmailAttemptedAt: v.optional(v.number()),
		confirmationEmailSentAt: v.optional(v.number()),
		confirmationEmailFailureReason: v.optional(v.string()),
		confirmationEmailProvider: v.optional(v.string()),
		confirmationEmailProviderMessageId: v.optional(v.string()),
		// Exactly-once marker for the writer-maintained confirmation register.
		// Optional only until the bounded migration reaches ready.
		confirmationSummaryVersion: v.optional(v.number()),

		districtHash: v.optional(v.string()),
		engagementTier: v.number(),

		completedAt: v.optional(v.number()),
		updatedAt: v.number()
	})
		.index('by_orgId', ['orgId'])
		.index('by_campaignId', ['campaignId'])
		.index('by_campaignId_status', ['campaignId', 'status'])
		.index('by_supporterId', ['supporterId'])
		.index('by_status', ['status'])
		.index('by_stripeSessionId', ['stripeSessionId'])
		.index('by_stripePaymentIntentId', ['stripePaymentIntentId']),

	donationConfirmationSummaries: defineTable({
		scopeKey: v.string(),
		orgId: v.id('organizations'),
		campaignId: v.optional(v.id('campaigns')),
		completed: v.number(),
		sent: v.number(),
		sending: v.number(),
		skipped: v.number(),
		failed: v.number(),
		notRecorded: v.number(),
		providerAccepted: v.number(),
		version: v.number(),
		updatedAt: v.number()
	})
		.index('by_scopeKey', ['scopeKey'])
		.index('by_orgId', ['orgId'])
		.index('by_campaignId', ['campaignId']),

	donationConfirmationSummaryMigrations: defineTable({
		key: v.literal('donation-confirmation-summary-v1'),
		status: v.union(
			v.literal('running'),
			v.literal('blocked'),
			v.literal('migrated'),
			v.literal('ready')
		),
		cursor: v.optional(v.string()),
		scanned: v.number(),
		projected: v.number(),
		failureCode: v.optional(v.string()),
		failureSourceId: v.optional(v.string()),
		startedAt: v.number(),
		completedAt: v.optional(v.number()),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	// ===========================================================================
	// AUTOMATION — WORKFLOWS
	// ===========================================================================

	workflows: defineTable({
		orgId: v.id('organizations'),
		name: v.string(),
		description: v.optional(v.string()),
		trigger: v.any(), // { type: 'donation_completed' | ... }
		steps: v.any(), // Array of step objects
		enabled: v.boolean(),
		// Exact total maintained on every workflowExecution insert.
		executionCount: v.optional(v.number()),
		executionCountVersion: v.optional(v.number()),
		updatedAt: v.number()
	})
		.index('by_orgId', ['orgId'])
		.index('by_enabled', ['enabled']),

	workflowExecutions: defineTable({
		workflowId: v.id('workflows'),
		supporterId: v.optional(v.id('supporters')),

		triggerEvent: v.any(), // snapshot of trigger
		// Status enum as a union literal so consumers (UI filters,
		// SDK clients, analytics queries) see the full set including
		// `partial_no_op` — a row that completed all steps but at
		// least one step was an unimplemented verb (the executor logs
		// success:false but advances currentStep so downstream delays
		// still fire). Plain `v.string()` left consumers free to filter
		// on a closed `completed` set and silently miss these rows.
		status: v.union(
			v.literal('pending'),
			v.literal('running'),
			v.literal('paused'),
			v.literal('completed'),
			v.literal('partial_no_op'),
			v.literal('failed')
		),
		currentStep: v.number(),
		nextRunAt: v.optional(v.number()),
		error: v.optional(v.string()),
		completedAt: v.optional(v.number()),
		// Exactly-once migration/writer marker for the parent count.
		workflowCountVersion: v.optional(v.number())
	})
		.index('by_workflowId', ['workflowId'])
		.index('by_supporterId', ['supporterId'])
		.index('by_status', ['status'])
		.index('by_nextRunAt', ['nextRunAt'])
		.index('by_status_nextRunAt', ['status', 'nextRunAt']),

	workflowExecutionCountMigrations: defineTable({
		key: v.literal('workflow-execution-count-v1'),
		status: v.union(
			v.literal('running'),
			v.literal('blocked'),
			v.literal('migrated'),
			v.literal('ready')
		),
		phase: v.union(v.literal('workflows'), v.literal('executions'), v.literal('complete')),
		cursor: v.optional(v.string()),
		scanned: v.number(),
		projected: v.number(),
		failureCode: v.optional(v.string()),
		failureSourceId: v.optional(v.string()),
		startedAt: v.number(),
		completedAt: v.optional(v.number()),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	workflowActionLogs: defineTable({
		executionId: v.id('workflowExecutions'),
		stepIndex: v.number(),
		actionType: v.string(), // 'send_email' | 'add_tag' | 'remove_tag' | 'delay' | 'condition'
		result: v.any(),
		createdAt: v.number()
	}).index('by_executionId', ['executionId']),

	// Durable carrier-boundary state for workflow send_email steps. An action
	// log is written after a step and therefore cannot serve as the pre-send
	// authority. This row is created with the quota reservation before SES.
	workflowEmailDispatches: defineTable({
		executionId: v.id('workflowExecutions'),
		stepIndex: v.number(),
		orgId: v.id('organizations'),
		// Optional for migration-adopted legacy evidence and terminal pre-authority
		// consent skips. Every dispatch that reaches `sending` must link a
		// reservation first.
		reservationId: v.optional(v.id('planUsageReservations')),
		status: v.union(
			v.literal('prepared'),
			v.literal('sending'),
			v.literal('sent'),
			v.literal('failed'),
			v.literal('blocked')
		),
		sesMessageId: v.optional(v.string()),
		sentAt: v.optional(v.number()),
		failureCode: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_executionId_stepIndex', ['executionId', 'stepIndex'])
		.index('by_orgId_sentAt', ['orgId', 'sentAt'])
		.index('by_status_updatedAt', ['status', 'updatedAt']),

	// ===========================================================================
	// SMS + PATCH-THROUGH CALLING
	// ===========================================================================

	smsBlasts: defineTable({
		orgId: v.id('organizations'),
		campaignId: v.optional(v.id('campaigns')),

		body: v.string(),
		fromNumber: v.string(),

		// Closed-shape per smsRecipientFilterValidator. Differs from
		// emailBlasts.recipientFilter — SMS uses tags/segments/excludeTags
		// matching the zod schema at src/routes/api/org/[slug]/sms/+server.ts:17-21.
		recipientFilter: v.optional(smsRecipientFilterValidator),
		totalRecipients: v.number(),

		sentCount: v.number(),
		deliveredCount: v.number(),
		failedCount: v.number(),

		status: smsBlastStatus,
		// Durable cursor for the browser dispatch enumerator. Each cohort query
		// scans one supporter page; recordDispatchBatch atomically advances this
		// cursor after the carrier batch is recorded, so the next batch never
		// rebuilds or offsets through the preceding cohort.
		dispatchCursor: v.optional(v.string()),
		dispatchScannedCount: v.optional(v.number()),
		dispatchComplete: v.optional(v.boolean()),
		recordedCount: v.optional(v.number()),

		sentAt: v.optional(v.number()),
		updatedAt: v.number()
	})
		.index('by_orgId', ['orgId'])
		.index('by_status', ['status'])
		// Range index for the billing period read — same rationale as
		// emailBlasts.by_orgId_sentAt: bound the sms-quota sum to the period's
		// blasts instead of collecting the org's whole blast history.
		.index('by_orgId_sentAt', ['orgId', 'sentAt']),

	smsMessages: defineTable({
		blastId: v.id('smsBlasts'),
		supporterId: v.id('supporters'),
		encryptedTo: v.optional(v.string()),
		toHash: v.optional(v.string()),
		body: v.string(),
		twilioSid: v.optional(v.string()),
		status: smsMessageStatus,
		errorCode: v.optional(v.string())
	})
		.index('by_blastId', ['blastId'])
		.index('by_blastId_supporterId', ['blastId', 'supporterId'])
		.index('by_supporterId', ['supporterId'])
		.index('by_twilioSid', ['twilioSid']),

	smsReplies: defineTable({
		orgId: v.id('organizations'),
		supporterId: v.optional(v.id('supporters')),
		blastId: v.optional(v.id('smsBlasts')),
		fromHash: v.optional(v.string()),
		toNumber: v.optional(v.string()),
		body: v.string(),
		twilioSid: v.optional(v.string()),
		receivedAt: v.number(),
		// Exactly-once marker for the writer-maintained organization summary.
		summaryVersion: v.optional(v.number())
	})
		.index('by_orgId', ['orgId'])
		.index('by_blastId', ['blastId'])
		.index('by_supporterId', ['supporterId'])
		.index('by_twilioSid', ['twilioSid']),

	smsReplySummaries: defineTable({
		orgId: v.id('organizations'),
		replyCount: v.number(),
		matchedSupporterCount: v.number(),
		linkedBlastCount: v.number(),
		latestReceivedAt: v.optional(v.number()),
		version: v.number(),
		updatedAt: v.number()
	}).index('by_orgId', ['orgId']),

	smsReplySummaryMigrations: defineTable({
		key: v.literal('sms-reply-summary-v1'),
		status: v.union(
			v.literal('running'),
			v.literal('blocked'),
			v.literal('migrated'),
			v.literal('ready')
		),
		cursor: v.optional(v.string()),
		scanned: v.number(),
		projected: v.number(),
		failureCode: v.optional(v.string()),
		failureSourceId: v.optional(v.string()),
		startedAt: v.number(),
		completedAt: v.optional(v.number()),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	patchThroughCalls: defineTable({
		orgId: v.id('organizations'),
		campaignId: v.optional(v.id('campaigns')),
		supporterId: v.id('supporters'),

		encryptedCallerPhone: v.optional(v.string()),
		encryptedTargetPhone: v.optional(v.string()),
		callerPhoneHash: v.optional(v.string()),
		targetPhoneHash: v.optional(v.string()),
		targetName: v.optional(v.string()),
		targetTitle: v.optional(v.string()),

		twilioCallSid: v.optional(v.string()),
		districtHash: v.optional(v.string()),

		status: v.string(), // 'initiated' | 'in-progress' | 'completed' | 'failed'
		duration: v.optional(v.number()),

		completedAt: v.optional(v.number())
	})
		.index('by_orgId', ['orgId'])
		.index('by_campaignId', ['campaignId'])
		.index('by_supporterId', ['supporterId'])
		.index('by_status', ['status'])
		.index('by_twilioCallSid', ['twilioCallSid']),

	// ===========================================================================
	// SCOPE CORRECTIONS
	// ===========================================================================

	scopeCorrections: defineTable({
		templateId: v.string(),
		aiExtracted: v.any(),
		aiConfidence: v.float64(),
		aiMethod: v.string(), // 'regex' | 'fuzzy' | 'geocoder' | 'llm'
		userCorrected: v.any(),
		correctionType: v.string(), // 'wrong_country' | 'wrong_region' | 'wrong_district' | 'too_broad' | 'too_specific'
		messageSnippet: v.string(),
		subject: v.string()
	}).index('by_aiMethod_correctionType', ['aiMethod', 'correctionType']),

	// ===========================================================================
	// INTELLIGENCE LOOP: BILLS & LEGISLATIVE MONITORING
	// ===========================================================================

	bills: defineTable({
		externalId: v.string(),
		jurisdiction: v.string(), // 'us-federal' | 'us-state-ca' | etc.
		jurisdictionLevel: v.string(), // 'federal' | 'state' | 'local'
		chamber: v.optional(v.string()), // 'house' | 'senate' | 'council'
		title: v.string(),
		summary: v.optional(v.string()),
		status: v.string(), // 'introduced' | 'committee' | 'floor' | 'passed' | 'failed' | 'signed' | 'vetoed'
		statusDate: v.number(),
		sponsors: v.optional(v.any()), // [{name, externalId, party}]
		committees: v.array(v.string()),
		sourceUrl: v.string(),
		fullTextUrl: v.optional(v.string()),

		// Relevance scoring
		topicEmbedding: v.optional(v.array(v.float64())),
		topics: v.array(v.string()),
		entities: v.array(v.string()),

		updatedAt: v.number()
	})
		.index('by_externalId', ['externalId'])
		.index('by_jurisdiction_status', ['jurisdiction', 'status'])
		.index('by_jurisdiction_status_statusDate', ['jurisdiction', 'status', 'statusDate'])
		.index('by_jurisdiction_statusDate', ['jurisdiction', 'statusDate'])
		.index('by_status_statusDate', ['status', 'statusDate'])
		.index('by_statusDate', ['statusDate'])
		.searchIndex('search_bills', {
			searchField: 'title',
			filterFields: ['jurisdiction', 'status']
		})
		.vectorIndex('by_topicEmbedding', {
			vectorField: 'topicEmbedding',
			dimensions: 768,
			filterFields: ['jurisdiction']
		}),

	orgBillRelevances: defineTable({
		orgId: v.id('organizations'),
		billId: v.id('bills'),
		score: v.float64(), // 0.0-1.0
		matchedOn: v.array(v.string())
	})
		.index('by_orgId_billId', ['orgId', 'billId'])
		.index('by_orgId_score', ['orgId', 'score']),

	legislativeAlerts: defineTable({
		orgId: v.id('organizations'),
		billId: v.id('bills'),
		type: v.string(), // 'new_bill' | 'status_change' | 'vote_scheduled' | 'amendment'
		title: v.string(),
		summary: v.string(),
		urgency: v.string(), // 'low' | 'normal' | 'high' | 'critical'
		status: v.string(), // 'pending' | 'seen' | 'acted' | 'dismissed'
		actionTaken: v.optional(v.string()),
		seenAt: v.optional(v.number())
	})
		.index('by_orgId_billId_type', ['orgId', 'billId', 'type'])
		.index('by_orgId_status', ['orgId', 'status']),

	legislativeActions: defineTable({
		billId: v.id('bills'),
		decisionMakerId: v.optional(v.id('decisionMakers')),
		externalId: v.optional(v.string()),
		name: v.string(),
		action: v.string(), // 'voted_yes' | 'voted_no' | 'abstained' | 'sponsored' | 'co-sponsored' | 'statement'
		detail: v.optional(v.string()),
		sourceUrl: v.optional(v.string()),
		occurredAt: v.number()
	})
		.index('by_billId', ['billId'])
		.index('by_decisionMakerId', ['decisionMakerId'])
		.index('by_occurredAt', ['occurredAt'])
		.index('by_decisionMakerId_occurredAt', ['decisionMakerId', 'occurredAt']),

	// accountabilityReceipts: includes flattened ReportResponse[]
	accountabilityReceipts: defineTable({
		decisionMakerId: v.id('decisionMakers'),
		dmName: v.string(),
		billId: v.id('bills'),
		orgId: v.id('organizations'),
		deliveryId: v.optional(v.string()),

		// Proof weight components
		verifiedCount: v.number(),
		totalCount: v.number(),
		gds: v.optional(v.float64()),
		ald: v.optional(v.float64()),
		cai: v.optional(v.float64()),
		temporalEntropy: v.optional(v.float64()),
		districtCount: v.number(),
		proofWeight: v.float64(),

		// Cryptographic binding
		attestationDigest: v.string(),
		packetDigest: v.string(),

		// Temporal chain
		proofDeliveredAt: v.number(),
		proofVerifiedAt: v.optional(v.number()),
		actionOccurredAt: v.optional(v.number()),
		causalityClass: accountabilityCausalityClass,

		// Decision-maker action
		dmAction: v.optional(v.string()),
		alignment: v.float64(),
		actionSourceUrl: v.optional(v.string()),

		// Anchoring
		anchorCid: v.optional(v.string()),
		anchorRoot: v.optional(v.string()),

		// Metadata. The in-tree campaign writer currently emits
		// `pending_response`, but legacy/external receipt pipelines may have
		// persisted additional states. Keep this open until migration evidence
		// enumerates those values; the compact projection still byte-bounds it.
		status: v.string(),
		coalitionMetricsVersion: v.optional(v.number()),
		updatedAt: v.number(),

		// ── FLATTENED: ReportResponse[] ──
		// Decision-maker responses (was separate report_response table).
		// type closed-shape per accountabilityResponseType — sources at
		// convex/campaigns.ts:536 (writer) + convex/legislation.ts:2667
		// (reader). Brutalist sweep caught the earlier "no writer in
		// this repo" comment as factually wrong — campaigns.recordResponse
		// is the in-tree writer.
		responses: v.optional(
			v.array(
				v.object({
					type: accountabilityResponseType,
					detail: v.optional(v.string()),
					confidence: v.string(),
					occurredAt: v.number()
				})
			)
		)
	})
		.index('by_decisionMakerId', ['decisionMakerId'])
		.index('by_decisionMakerId_proofDeliveredAt', ['decisionMakerId', 'proofDeliveredAt'])
		.index('by_billId', ['billId'])
		.index('by_orgId', ['orgId'])
		.index('by_orgId_billId_decisionMakerId', ['orgId', 'billId', 'decisionMakerId'])
		.index('by_status', ['status'])
		.index('by_causalityClass', ['causalityClass'])
		.index('by_deliveryId', ['deliveryId']),

	// Purpose-built accountability read plane. These rows contain only bounded
	// display/proof fields; raw response arrays and wide source documents never
	// cross profile, organization scorecard, public scorecard, or export reads.
	accountabilityReceiptProjections: defineTable({
		receiptId: v.id('accountabilityReceipts'),
		orgId: v.id('organizations'),
		campaignId: v.optional(v.id('campaigns')),
		deliveryId: v.optional(v.string()),
		decisionMakerId: v.id('decisionMakers'),
		billId: v.id('bills'),
		dmName: v.string(),
		billExternalId: v.string(),
		billTitle: v.string(),
		billStatus: v.string(),
		billJurisdiction: v.string(),
		publicEligible: v.boolean(),
		verifiedCount: v.number(),
		totalCount: v.number(),
		districtCount: v.number(),
		proofWeight: v.float64(),
		attestationDigest: v.string(),
		proofDeliveredAt: v.number(),
		proofVerifiedAt: v.optional(v.number()),
		actionOccurredAt: v.optional(v.number()),
		causalityClass: v.string(),
		dmAction: v.optional(v.string()),
		alignment: v.float64(),
		anchorCid: v.optional(v.string()),
		anchorRoot: v.optional(v.string()),
		status: v.string(),
		responseCount: v.number(),
		hasResponse: v.boolean(),
		deliveryOpened: v.boolean(),
		deliveryVerified: v.boolean(),
		replyReceived: v.boolean(),
		version: v.number(),
		projectionBytes: v.number(),
		updatedAt: v.number()
	})
		.index('by_receiptId', ['receiptId'])
		.index('by_decisionMakerId_proofDeliveredAt', [
			'decisionMakerId',
			'proofDeliveredAt',
			'receiptId'
		])
		.index('by_orgId_proofDeliveredAt', ['orgId', 'proofDeliveredAt', 'receiptId'])
		.index('by_orgId_campaignId_proofDeliveredAt', [
			'orgId',
			'campaignId',
			'proofDeliveredAt',
			'receiptId'
		])
		.index('by_orgId_decisionMakerId_proofDeliveredAt', [
			'orgId',
			'decisionMakerId',
			'proofDeliveredAt',
			'receiptId'
		])
		.index('by_decisionMakerId_publicEligible_proofDeliveredAt', [
			'decisionMakerId',
			'publicEligible',
			'proofDeliveredAt',
			'receiptId'
		])
		.index('by_decisionMakerId_billId_proofDeliveredAt', [
			'decisionMakerId',
			'billId',
			'proofDeliveredAt',
			'receiptId'
		]),

	accountabilityUserReceiptProjections: defineTable({
		supporterId: v.id('supporters'),
		identityCommitment: v.optional(v.string()),
		receiptId: v.id('accountabilityReceipts'),
		decisionMakerId: v.id('decisionMakers'),
		billId: v.id('bills'),
		dmName: v.string(),
		alignment: v.float64(),
		causalityClass: v.string(),
		proofDeliveredAt: v.number(),
		version: v.number(),
		projectionBytes: v.number(),
		updatedAt: v.number()
	})
		.index('by_identityCommitment_proofDeliveredAt', [
			'identityCommitment',
			'proofDeliveredAt',
			'receiptId'
		])
		.index('by_receiptId', ['receiptId'])
		.index('by_supporterId_proofDeliveredAt', ['supporterId', 'proofDeliveredAt', 'receiptId'])
		.index('by_identityCommitment_receiptId', ['identityCommitment', 'receiptId']),

	accountabilityOrganizationAggregates: defineTable({
		orgId: v.id('organizations'),
		receiptCount: v.number(),
		pendingCount: v.number(),
		responseLoggedCount: v.number(),
		anchorFieldCount: v.number(),
		proofWeightTotal: v.float64(),
		latestProofDeliveredAt: v.optional(v.number()),
		version: v.number(),
		projectionBytes: v.number(),
		updatedAt: v.number()
	}).index('by_orgId', ['orgId']),

	accountabilityOrgDmProjections: defineTable({
		orgId: v.id('organizations'),
		decisionMakerId: v.id('decisionMakers'),
		name: v.string(),
		type: v.string(),
		title: v.optional(v.string()),
		party: v.optional(v.string()),
		district: v.optional(v.string()),
		jurisdiction: v.optional(v.string()),
		photoUrl: v.optional(v.string()),
		followed: v.boolean(),
		followReason: v.optional(v.string()),
		note: v.optional(v.string()),
		alertsEnabled: v.optional(v.boolean()),
		followedAt: v.optional(v.number()),
		receiptCount: v.number(),
		alignedCount: v.number(),
		opposedCount: v.number(),
		pendingCount: v.number(),
		responseLoggedCount: v.number(),
		anchorFieldCount: v.number(),
		proofWeightTotal: v.float64(),
		latestProofDeliveredAt: v.optional(v.number()),
		version: v.number(),
		projectionBytes: v.number(),
		updatedAt: v.number()
	})
		.index('by_orgId_decisionMakerId', ['orgId', 'decisionMakerId'])
		.index('by_orgId_followed_decisionMakerId', ['orgId', 'followed', 'decisionMakerId']),

	accountabilityDecisionMakerAggregates: defineTable({
		decisionMakerId: v.id('decisionMakers'),
		publicReceiptCount: v.number(),
		publicVerifiedCount: v.number(),
		publicCausalReceiptCount: v.number(),
		uniquePublicBillCount: v.number(),
		publicProofWeightTotal: v.float64(),
		publicWeightedAlignmentTotal: v.float64(),
		latestProofDeliveredAt: v.optional(v.number()),
		version: v.number(),
		projectionBytes: v.number(),
		updatedAt: v.number()
	})
		.index('by_decisionMakerId', ['decisionMakerId'])
		.index('by_latestProofDeliveredAt', ['latestProofDeliveredAt', 'decisionMakerId']),

	accountabilityDecisionMakerBillProjections: defineTable({
		decisionMakerId: v.id('decisionMakers'),
		billId: v.id('bills'),
		publicReceiptCount: v.number(),
		version: v.number(),
		projectionBytes: v.number(),
		updatedAt: v.number()
	}).index('by_decisionMakerId_billId', ['decisionMakerId', 'billId']),

	accountabilityScorecardProjections: defineTable({
		decisionMakerId: v.id('decisionMakers'),
		latestSnapshotId: v.id('scorecardSnapshots'),
		periodStart: v.number(),
		periodEnd: v.number(),
		responsiveness: v.optional(v.float64()),
		alignment: v.optional(v.float64()),
		composite: v.optional(v.float64()),
		proofWeightTotal: v.float64(),
		deliveriesSent: v.number(),
		deliveriesOpened: v.number(),
		deliveriesVerified: v.number(),
		repliesReceived: v.number(),
		alignedVotes: v.number(),
		totalScoredVotes: v.number(),
		methodologyVersion: v.number(),
		snapshotHash: v.string(),
		version: v.number(),
		projectionBytes: v.number(),
		updatedAt: v.number()
	}).index('by_decisionMakerId', ['decisionMakerId']),

	accountabilityReadModelMigrations: defineTable({
		key: v.literal('v1'),
		status: v.union(
			v.literal('running'),
			v.literal('migrated'),
			v.literal('ready'),
			v.literal('blocked')
		),
		runToken: v.string(),
		phase: v.union(
			v.literal('receipts'),
			v.literal('follows'),
			v.literal('scorecards'),
			v.literal('complete')
		),
		cursor: v.optional(v.string()),
		scanComplete: v.boolean(),
		scanned: v.number(),
		projected: v.number(),
		userProjected: v.number(),
		failureCode: v.optional(v.string()),
		failureSourceId: v.optional(v.string()),
		failurePhase: v.optional(
			v.union(v.literal('receipts'), v.literal('follows'), v.literal('scorecards'))
		),
		startedAt: v.number(),
		completedAt: v.optional(v.number()),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	orgIssueDomains: defineTable({
		orgId: v.id('organizations'),
		label: v.string(),
		embedding: v.optional(v.array(v.float64())),
		description: v.optional(v.string()),
		weight: v.float64(),
		updatedAt: v.number()
	})
		.index('by_orgId', ['orgId'])
		.index('by_orgId_label', ['orgId', 'label'])
		.vectorIndex('by_embedding', {
			vectorField: 'embedding',
			dimensions: 768,
			filterFields: ['orgId']
		}),

	// ===========================================================================
	// DECISION MAKERS (with flattened Institution + legislative_channel)
	// ===========================================================================

	decisionMakers: defineTable({
		type: v.string(), // 'legislator' | 'executive' | 'board_member' | etc.
		title: v.optional(v.string()),
		name: v.string(),
		firstName: v.optional(v.string()),
		lastName: v.string(),
		party: v.optional(v.string()),
		jurisdiction: v.optional(v.string()),
		jurisdictionLevel: v.optional(v.string()), // 'federal' | 'state' | 'county' | 'municipal' | 'international' | 'private'
		district: v.optional(v.string()),
		phone: v.optional(v.string()),
		email: v.optional(v.string()),
		websiteUrl: v.optional(v.string()),
		officeAddress: v.optional(v.string()),
		photoUrl: v.optional(v.string()),
		active: v.boolean(),
		termStart: v.optional(v.number()),
		termEnd: v.optional(v.number()),
		lastSyncedAt: v.optional(v.number()),
		updatedAt: v.number(),

		// ── FLATTENED: Institution ──
		// Institution data (was separate institution table)
		institution: v.optional(
			v.object({
				type: v.string(), // 'legislature' | 'executive_branch' | 'agency' | 'corporation' | etc.
				name: v.string(),
				jurisdiction: v.optional(v.string()),
				jurisdictionLevel: v.optional(v.string()),
				parentId: v.optional(v.string()), // self-reference for institution hierarchy
				websiteUrl: v.optional(v.string())
			})
		),

		// ── FLATTENED: legislative_channel ──
		// Legislative channel delivery config (was separate legislative_channel table)
		legislativeChannel: v.optional(
			v.object({
				countryCode: v.string(),
				countryName: v.string(),
				legislatureName: v.string(),
				legislatureType: v.string(),
				accessMethod: v.string(),
				accessTier: v.number(),
				emailPattern: v.optional(v.string()),
				emailDomain: v.optional(v.string()),
				emailFormatNotes: v.optional(v.string()),
				apiEndpoint: v.optional(v.string()),
				apiAuthType: v.optional(v.string()),
				apiDocumentationUrl: v.optional(v.string()),
				rateLimitRequests: v.optional(v.number()),
				rateLimitDaily: v.optional(v.number()),
				formUrl: v.optional(v.string()),
				formRequiresCaptcha: v.boolean(),
				formMaxLength: v.optional(v.number()),
				primaryLanguage: v.string(),
				supportedLanguages: v.array(v.string()),
				requiresConstituent: v.boolean(),
				requiresRealAddress: v.boolean(),
				forbiddenWords: v.array(v.string()),
				messageGuidelines: v.optional(v.string()),
				population: v.optional(v.number()),
				internetPenetration: v.optional(v.float64()),
				democracyIndex: v.optional(v.float64()),
				isActive: v.boolean(),
				lastVerified: v.optional(v.number())
			})
		)
	})
		.index('by_type', ['type'])
		.index('by_email', ['email'])
		.index('by_jurisdiction_jurisdictionLevel', ['jurisdiction', 'jurisdictionLevel'])
		.index('by_party', ['party'])
		.index('by_lastName', ['lastName'])
		.index('by_active', ['active'])
		.searchIndex('search_decisionMakers', {
			searchField: 'name',
			filterFields: ['type', 'jurisdiction', 'active']
		}),

	externalIds: defineTable({
		decisionMakerId: v.id('decisionMakers'),
		system: v.string(), // 'bioguide' | 'openstates' | 'wikidata' | etc.
		value: v.string()
	})
		.index('by_decisionMakerId_system', ['decisionMakerId', 'system'])
		.index('by_system_value', ['system', 'value']),

	orgDmFollows: defineTable({
		orgId: v.id('organizations'),
		decisionMakerId: v.id('decisionMakers'),
		reason: v.string(), // 'manual' | etc.
		alertsEnabled: v.boolean(),
		note: v.optional(v.string()),
		followedBy: v.optional(v.string()),
		followedAt: v.number()
	})
		.index('by_orgId', ['orgId'])
		.index('by_decisionMakerId', ['decisionMakerId'])
		.index('by_orgId_decisionMakerId', ['orgId', 'decisionMakerId']),

	orgBillWatches: defineTable({
		orgId: v.id('organizations'),
		billId: v.id('bills'),
		reason: v.string(), // 'manual' | 'alert' | 'campaign'
		position: v.optional(v.string()), // 'support' | 'oppose'
		addedBy: v.optional(v.string())
	})
		.index('by_orgId', ['orgId'])
		.index('by_orgId_billId', ['orgId', 'billId']),

	// ===========================================================================
	// SCORECARD SNAPSHOTS
	// ===========================================================================

	scorecardSnapshots: defineTable({
		decisionMakerId: v.id('decisionMakers'),

		// Period
		periodStart: v.number(),
		periodEnd: v.number(),

		// Scores
		responsiveness: v.optional(v.float64()),
		alignment: v.optional(v.float64()),
		composite: v.optional(v.float64()),
		proofWeightTotal: v.float64(),

		// Input counts
		deliveriesSent: v.number(),
		deliveriesOpened: v.number(),
		deliveriesVerified: v.number(),
		repliesReceived: v.number(),
		alignedVotes: v.number(),
		totalScoredVotes: v.number(),

		// Methodology
		methodologyVersion: v.number(),

		// Attestation
		snapshotHash: v.string()
	})
		.index('by_decisionMakerId', ['decisionMakerId'])
		.index('by_periodEnd', ['periodEnd'])
		.index('by_composite', ['composite'])
		.index('by_decisionMakerId_periodEnd_methodologyVersion', [
			'decisionMakerId',
			'periodEnd',
			'methodologyVersion'
		]),

	// ===========================================================================
	// AGENTIC DELEGATION
	// ===========================================================================

	delegationGrants: defineTable({
		userId: v.id('users'),

		// Scope
		scope: v.string(), // 'campaign_sign' | 'debate_position' | 'message_generate' | 'full'

		// Constraints
		issueFilter: v.array(v.string()),
		orgFilter: v.array(v.string()),
		stanceProfileId: v.optional(v.string()),
		maxActionsPerDay: v.number(),
		requireReviewAbove: v.float64(),

		// Natural language policy
		policyText: v.string(),

		// Lifecycle
		expiresAt: v.optional(v.number()),
		revokedAt: v.optional(v.number()),
		status: v.string(), // 'active' | 'paused' | 'revoked' | 'expired'

		// Audit
		lastActionAt: v.optional(v.number()),
		totalActions: v.number(),

		updatedAt: v.number()
	})
		.index('by_userId', ['userId'])
		.index('by_status', ['status']),

	delegatedActions: defineTable({
		grantId: v.id('delegationGrants'),

		// What was done
		actionType: v.string(), // 'campaign_sign' | 'debate_position' | 'message_generate'
		targetId: v.string(),
		targetTitle: v.string(),

		// Decision reasoning
		reasoning: v.string(),
		relevanceScore: v.float64(),
		stanceAlignment: v.optional(v.float64()),

		// Result
		resultId: v.optional(v.string()),
		status: v.string() // 'completed' | 'reviewed' | 'rejected' | 'failed'
	}).index('by_grantId', ['grantId']),

	notifications: defineTable({
		userId: v.id('users'),
		type: v.string(),
		orgId: v.optional(v.id('organizations')),
		message: v.string(),
		read: v.boolean(),
		createdAt: v.number()
	}).index('by_userId', ['userId']),

	delegationReviews: defineTable({
		grantId: v.id('delegationGrants'),
		actionId: v.optional(v.string()),

		// What needs review
		targetId: v.string(),
		targetTitle: v.string(),
		reasoning: v.string(),
		proofWeight: v.float64(),

		// User decision
		decision: v.optional(v.string()), // 'approve' | 'reject'
		decidedAt: v.optional(v.number())
	})
		.index('by_grantId', ['grantId'])
		.index('by_grantId_decision', ['grantId', 'decision'])
		.index('by_decision', ['decision']),

	// ===========================================================================
	// WAITLIST — pre-launch beta interest capture
	// ===========================================================================

	waitlist: defineTable({
		email: v.string(),
		emailHash: v.string(), // SHA-256 of lowercased email — dedup index
		userId: v.optional(v.id('users')), // linked if authenticated at signup
		source: v.string(), // 'landing' | 'referral' | etc.
		status: v.string(), // 'waiting' | 'invited' | 'converted'
		invitedAt: v.optional(v.number()),
		convertedAt: v.optional(v.number()),
		updatedAt: v.number()
	})
		.index('by_emailHash', ['emailHash'])
		.index('by_status', ['status'])
		.index('by_userId', ['userId']),

	// Cross-tick pagination cursors for table-scanning cron actions.
	// Per-key (one row per sweep name). The `sweepStrandedPlaceholders`
	// cron uses this to resume from the previous tick's cursor instead
	// of restarting at null every 30 minutes — without the checkpoint,
	// for tables >10K rows the sweep would traverse the same prefix
	// forever and never reach new strandeds. Version 1 is a one-shot
	// migration: reaching `isDone` permanently tombstones the sweep.
	sweepCheckpoints: defineTable({
		key: v.string(),
		cursor: v.optional(v.string()),
		wrapCount: v.number(),
		// CAS authority prevents overlapping action ticks from rewinding the
		// cursor or falsely completing an older page after a newer save.
		cursorRevision: v.optional(v.number()),
		activeRunToken: v.optional(v.string()),
		// Legacy placeholder sweeps stay O(1) until an operator explicitly
		// activates the exact indexed/bounded implementation version.
		activeVersion: v.optional(v.number()),
		activatedAt: v.optional(v.number()),
		activationReference: v.optional(v.string()),
		completedVersion: v.optional(v.number()),
		completedAt: v.optional(v.number()),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	// Durable, compact outcome of the bounded hourly boundary-cell sample.
	// The monitor records an explicit capacity signal instead of scanning an
	// unbounded trailing-day credential range when launch volume exceeds one
	// reviewed page.
	boundaryCellMonitorState: defineTable({
		key: v.literal('rolling-24h-v1'),
		status: v.union(v.literal('complete'), v.literal('capacity_exceeded')),
		cutoff: v.number(),
		asOf: v.number(),
		scanned: v.number(),
		boundaryCount: v.number(),
		postH1Count: v.number(),
		totalRecent: v.number(),
		rate: v.optional(v.number()),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	// Registry mapping a Twilio destination number (an org's verified
	// outbound sender) to the org that owns it. The inbound Twilio
	// webhook resolves an incoming SMS's `To` field through this table
	// to scope STOP/START semantics to the org context that prompted
	// the user's reply — pre-registry, a START reply re-subscribed the
	// phone across EVERY org that had it as a supporter, even orgs the
	// user never knowingly engaged. Phone numbers stored as E.164
	// (`+E164`) for hash-stable cross-reference with smsBlasts.fromNumber.
	// `verifiedAt` tracks whether the org owner has confirmed
	// ownership of the number (initial placeholder pattern — registration
	// flow not yet wired). Unique-per-number is enforced
	// by the application layer (no native unique constraint in Convex);
	// the webhook treats multiple matches as ambiguous and
	// falls back to STOP-style cross-org behavior with a console.warn.
	orgTwilioNumbers: defineTable({
		orgId: v.id('organizations'),
		phoneNumber: v.string(),
		verifiedAt: v.optional(v.number()),
		updatedAt: v.number()
	})
		.index('by_phoneNumber', ['phoneNumber'])
		.index('by_orgId', ['orgId']),

	// ===========================================================================
	// WEBHOOKS — outbound event subscriptions for org developer integrations
	// ===========================================================================

	// Org-managed webhook subscriptions. Each row is one endpoint URL plus
	// the events it wants to receive. signingSecret + signingSecretPrevious
	// follow the dual-rotation pattern used elsewhere (UNSUBSCRIBE_SECRET,
	// BLAST_DISPATCH_SECRET) — on rotation, set secret to the new value and
	// move existing to secretPrevious. Receivers verify either is valid for
	// one rotation window then drop the previous.
	// failureCount is a running tally; orgWebhookDeliveries dead-letter
	// handling can trip a "disable after N failures" safety circuit.
	orgWebhooks: defineTable({
		orgId: v.id('organizations'),
		url: v.string(),
		events: v.array(v.string()), // event taxonomy: supporter.created, campaign_action.created, donation.completed, etc.
		signingSecret: v.string(), // HMAC-SHA256 secret used to sign payload
		signingSecretPrevious: v.optional(v.string()), // dual-rotation window
		enabled: v.boolean(),
		description: v.optional(v.string()),
		createdAt: v.number(),
		lastDeliveredAt: v.optional(v.number()),
		failureCount: v.number() // running count of consecutive failures
	})
		.index('by_orgId', ['orgId'])
		.index('by_orgId_enabled', ['orgId', 'enabled']),

	// Per-attempt delivery log for orgWebhooks. attempt 1..5; nextRetryAt
	// drives cron pickup for retries with 2^attempt*60s backoff. isDead is
	// set when attempts are exhausted — at that point the parent webhook is
	// auto-disabled and the org notified via email. Per-org index supports
	// the delivery-history UI; nextRetryAt index supports the retry cron's
	// "due now" query; isDead index supports cleanup + dashboards.
	orgWebhookDeliveries: defineTable({
		webhookId: v.id('orgWebhooks'),
		orgId: v.id('organizations'),
		event: v.string(),
		payload: v.string(), // JSON-serialized event payload (signed)
		statusCode: v.optional(v.number()), // HTTP response code from receiver
		attempt: v.number(),
		deliveredAt: v.optional(v.number()), // set on 2xx response
		nextRetryAt: v.optional(v.number()), // set on retry-able failure
		errorMessage: v.optional(v.string()),
		isDead: v.boolean()
	})
		.index('by_webhookId', ['webhookId'])
		.index('by_orgId', ['orgId'])
		.index('by_nextRetryAt', ['nextRetryAt'])
		.index('by_isDead', ['isDead']),

	// Durable singleton evidence that a legacy/bypassed organization exceeded
	// the hard subscription fan-out cap. queueEvent upserts at most one row per
	// org and schedules a one-subscription repair step; it never creates one
	// evidence row or one delivery per overflow subscription.
	orgWebhookOverflowEvidence: defineTable({
		orgId: v.id('organizations'),
		cap: v.number(),
		observedCountLowerBound: v.number(),
		firstObservedAt: v.number(),
		lastObservedAt: v.number(),
		repairScheduledAt: v.optional(v.number()),
		resolvedAt: v.optional(v.number()),
		removedSubscriptions: v.number()
	}).index('by_orgId', ['orgId']),

	// Lightweight event notification table — shared by webhook dispatch
	// (T9-3) and real-time SSE subscriptions v1 (T9-7). Each row is one
	// emitted event for one org. Polling consumers (SSE handler) query
	// by_orgId_emittedAt with a since-cursor for cursor-paginated reads.
	// Retain 7 days; daily cron purges older rows.
	orgEvents: defineTable({
		orgId: v.id('organizations'),
		event: v.string(),
		payload: v.string(), // JSON-serialized event payload (same shape as webhook payload)
		emittedAt: v.number()
	})
		.index('by_orgId_emittedAt', ['orgId', 'emittedAt'])
		.index('by_emittedAt', ['emittedAt']),

	// Persisted relatedness normalization (singleton, keyed like smtRoots/treeId).
	// Holds the public-corpus centroid — the genre common-mode that mean-centering
	// removes before scoring template twins — plus the calibrated centered-cosine
	// threshold that was in force when the centroid was fit. The template
	// relatedness query reads this instead of recomputing the centroid on every
	// call; a daily cron refits it so the normalization tracks the corpus as it
	// grows. One canonical row under `key: 'public'`. Recompute is pure Convex
	// compute — no external/recurring cost.
	relatednessCalibration: defineTable({
		key: v.string(), // singleton selector — always 'public'
		centroid: v.array(v.float64()),
		threshold: v.float64(),
		count: v.number(), // usable (embedded) templates the centroid was fit over
		dim: v.number(), // embedding dimensionality
		updatedAt: v.number()
	}).index('by_key', ['key']),

	// Compact, embedding-free producer input for public discovery. Only current
	// `(published, public)` templates have a row. The explicit template creation
	// timestamp preserves the homepage's newest-first order across idempotent
	// migrations and later source-row updates.
	publicTemplateDiscoverySources: defineTable({
		templateId: v.id('templates'),
		generation: v.string(),
		templateCreatedAt: v.number(),
		isCwc: v.boolean(),
		title: v.string(),
		domain: v.string(),
		countryCode: v.optional(v.string()),
		projectionVersion: v.number(),
		source: v.any(),
		sourceBytes: v.number(),
		updatedAt: v.number()
	})
		.index('by_templateId', ['templateId'])
		.index('by_generation_templateCreatedAt_templateId', [
			'generation',
			'templateCreatedAt',
			'templateId'
		])
		.index('by_generation_isCwc_templateCreatedAt_templateId', [
			'generation',
			'isCwc',
			'templateCreatedAt',
			'templateId'
		])
		.searchIndex('search_title', {
			searchField: 'title',
			filterFields: ['generation', 'domain', 'countryCode']
		}),

	// Purpose-bound public detail/send projection. Keeping this separate from
	// the 250-row discovery source scan makes repeated `/s/:slug` reads exact and
	// embedding-free without inflating homepage/relation rebuild I/O.
	publicTemplateDetailProjections: defineTable({
		templateId: v.id('templates'),
		slug: v.string(),
		userId: v.optional(v.id('users')),
		projectionVersion: v.number(),
		detail: v.any(),
		detailBytes: v.number(),
		updatedAt: v.number()
	})
		.index('by_templateId', ['templateId'])
		.index('by_slug', ['slug']),

	// Lightweight inventory/dirty coordinate for producer-published anonymous
	// template pages. The large detail, debate, and metric values deliberately do
	// not live here: an ordinary global list revision pages only these small rows
	// and rematerializes the handful whose per-template revision changed.
	publicTemplatePageArtifactCoordinates: defineTable({
		templateId: v.id('templates'),
		userId: v.optional(v.id('users')),
		generation: v.string(),
		slug: v.string(),
		projectionVersion: v.number(),
		artifactRevision: v.number(),
		detailUpdatedAt: v.number(),
		aggregateUpdatedAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_templateId', ['templateId'])
		.index('by_userId', ['userId'])
		.index('by_slug', ['slug'])
		.index('by_generation_slug', ['generation', 'slug']),

	// Relation/search vector plane. Keeping topic vectors in a keyed row means a
	// relation rebuild hydrates only the at-most-100 displayed IDs, never the
	// candidate corpus or the templates' unrelated authoring/config fields.
	publicTemplateTopicVectors: defineTable({
		templateId: v.id('templates'),
		generation: v.string(),
		embedding: v.array(v.float64()),
		embeddingVersion: v.string(),
		updatedAt: v.number()
	}).index('by_templateId', ['templateId']),

	// Gemini embeds a bare normalized tag, so one vector per exact tag is the
	// canonical representation. Template membership remains in the compact source
	// row; unused vocabulary rows are harmless reusable cache entries.
	publicTagEmbeddingVectors: defineTable({
		tag: v.string(),
		embedding: v.array(v.float64()),
		embeddingVersion: v.string(),
		updatedAt: v.number()
	}).index('by_tag', ['tag']),

	// Observable, self-paging source-plane cutover. `ready` is the irreversible
	// producer switch for this schema version; legacy template vectors remain in
	// place so code rollback is still possible.
	publicDiscoverySourceMigrations: defineTable({
		key: v.literal('v1'),
		// A ready row is valid only for the exact compact source/detail projection
		// contract currently served by request-path readers.
		projectionVersion: v.optional(v.number()),
		status: v.union(
			v.literal('running'),
			v.literal('migrated'),
			v.literal('ready'),
			v.literal('superseded')
		),
		runToken: v.string(),
		cursor: v.optional(v.string()),
		startedAt: v.number(),
		completedAt: v.optional(v.number()),
		listDirtyAtAtStart: v.optional(v.number()),
		relationsDirtyAtAtStart: v.optional(v.number()),
		scanned: v.number(),
		eligible: v.number(),
		sourcesWritten: v.number(),
		// Additive page-artifact cutover proof. Missing on pre-rollout rows so
		// activation/readiness fail closed until the bounded migration is rerun.
		pageArtifactCoordinatesWritten: v.optional(v.number()),
		topicVectorsWritten: v.number(),
		tagVectorsWritten: v.number(),
		rejected: v.number(),
		// Version-4 cutover integrity: unsigned legacy recipients remain private,
		// but their removal cannot be silently counted as a successful migration.
		recipientIntentTemplates: v.optional(v.number()),
		recipientIntentRecipients: v.optional(v.number()),
		recipientProjectedRecipients: v.optional(v.number()),
		recipientLossTemplates: v.optional(v.number()),
		recipientLossRecipients: v.optional(v.number()),
		recipientLossClassifiedTemplates: v.optional(v.number()),
		recipientLossClassifiedRecipients: v.optional(v.number()),
		failureCode: v.optional(v.string()),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	// One bounded audit row per migrated public template. Intent is represented
	// only by a SHA-256 coordinate and counts; raw unsigned recipient PII never
	// enters this operator-review plane.
	publicRecipientMigrationReviews: defineTable({
		templateId: v.id('templates'),
		projectionVersion: v.number(),
		runToken: v.string(),
		intentHash: v.string(),
		intentCount: v.number(),
		projectedCount: v.number(),
		disposition: v.union(
			v.literal('no_intent'),
			v.literal('re_attested'),
			v.literal('pending'),
			v.literal('intentionally_redacted')
		),
		operatorReference: v.optional(v.string()),
		classifiedAt: v.optional(v.number()),
		updatedAt: v.number()
	})
		.index('by_templateId', ['templateId'])
		.index('by_disposition', ['disposition'])
		.index('by_disposition_runToken', ['disposition', 'runToken']),

	// Materialized public relation results. Homepage reads must never hydrate the
	// embedding-heavy templates table: each list variant reads its matching compact
	// relation row and returns honest empty shapes until the first rebuild publishes
	// it. Both `all` and `excludeCwc` rows publish under one manifest revision.
	// `public` is retained only so the first deploy accepts the legacy singleton;
	// no current query or rebuild writes that key. `conceptEntries` is an array
	// instead of an object keyed by raw author tags so arbitrary tag strings never
	// become stored Convex field names.
	templateRelationSnapshots: defineTable({
		key: v.union(v.literal('public'), v.literal('all'), v.literal('excludeCwc')),
		// Publication revision shared with `publicDiscoveryManifest`. Optional so
		// the first deploy can migrate existing snapshot rows in place; every new
		// rebuild writes it before marking relations ready.
		revision: v.optional(v.number()),
		twinEdges: v.array(
			v.object({
				a: v.string(),
				b: v.string(),
				score: v.float64(),
				kind: v.literal('twin')
			})
		),
		conceptEdges: v.array(
			v.object({
				a: v.string(),
				b: v.string(),
				concept: v.string(),
				kind: v.literal('concept')
			})
		),
		conceptEntries: v.array(
			v.object({
				tag: v.string(),
				concept: v.string()
			})
		),
		sourceCap: v.number(),
		sourceTemplateCount: v.number(),
		embeddedTemplateCount: v.number(),
		// Optional for the additive v1 source-plane rollout. Every new rebuild
		// writes both fields; legacy rows remain readable during deployment.
		tagVectorCandidateCount: v.optional(v.number()),
		tagVectorCount: v.number(),
		tagVectorShedCount: v.optional(v.number()),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	// Materialized `templates.listPublic` payloads. One row retains the normal
	// public top-50 and one retains the feature-gated non-CWC top-50. Payloads are
	// already projected/enriched, so request-path reads never hydrate source
	// templates (and therefore never pay to read their server-only embeddings).
	publicTemplateSnapshots: defineTable({
		key: v.union(v.literal('all'), v.literal('excludeCwc')),
		// Optional only for the live v3→v4 migration. Every v4 rebuild writes 4,
		// and the pre-Pages readiness gate rejects legacy/missing versions.
		projectionVersion: v.optional(v.number()),
		// Both list variants receive the same revision in one transaction. Keep
		// optional during the live-row migration; every rebuild supplies it.
		revision: v.optional(v.number()),
		templates: v.any(),
		sourceCount: v.number(),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	// Small control-plane singleton for public discovery. Payloads remain in the
	// two bounded snapshot tables above; this row only states whether each family
	// has ever published successfully, which monotonically increasing revision is
	// current, and the independent coalescing state for bounded list and relation
	// refreshes.
	//
	// No row is the explicit cold-start state (`ready:false`, revision 0). A
	// successful rebuild over a legitimately empty corpus creates/updates this row
	// with `ready:true`, so consumers never have to infer readiness from `[]`.
	publicDiscoveryManifest: defineTable({
		key: v.literal('public'),
		listReady: v.boolean(),
		relationsReady: v.boolean(),
		listRevision: v.number(),
		relationsRevision: v.number(),
		// Monotonic payload fallback floors. Destructive invalidation retires the
		// current revision; every publication conservatively retires N-1. Optional
		// only for the bounded legacy migration/read fallback.
		listRetiredRevision: v.optional(v.number()),
		relationsRetiredRevision: v.optional(v.number()),
		// A retirement floor alone cannot distinguish an ordinary N→N+1 publish
		// from a destructive false→ready interval that completed between edge
		// observations. These per-family epochs advance only when ready authority is
		// withdrawn and survive the replacement publication. Optional only so live
		// pre-epoch rows project as epoch zero during the rolling migration.
		listWithdrawalEpoch: v.optional(v.number()),
		relationsWithdrawalEpoch: v.optional(v.number()),
		// At most one producer push may be queued. The action atomically claims
		// this token before I/O; a source commit racing the action can then enqueue
		// exactly one successor instead of losing or multiplying notifications.
		manifestControlPushToken: v.optional(v.string()),
		// Bounded, singleton evidence for the last completed producer-control
		// chain. Containment and exhausted retry envelopes remain observable after
		// the token is terminally cleared; a later successful producer delivery
		// replaces the evidence. No response body or unbounded attempt log is stored.
		manifestControlPushLastOutcome: v.optional(
			v.union(
				v.literal('succeeded'),
				v.literal('contained'),
				v.literal('attemptsExhausted'),
				v.literal('ageExhausted')
			)
		),
		manifestControlPushLastOutcomeAt: v.optional(v.number()),
		manifestControlPushLastOutcomeAttempt: v.optional(v.number()),
		manifestControlPushLastOutcomeStartedAt: v.optional(v.number()),
		listUpdatedAt: v.optional(v.number()),
		// Earliest clock-only transition still capable of changing a published
		// card (`isNew` expiry or rolling-arrival bucket shift). The daily native
		// backstop reads this scalar and skips the corpus while it is in the future.
		nextTemporalRebuildAt: v.optional(v.number()),
		temporalScheduleVersion: v.optional(v.number()),
		relationsUpdatedAt: v.optional(v.number()),
		listDirtyAt: v.optional(v.number()),
		listRefreshScheduledAt: v.optional(v.number()),
		// Durable priority belongs to the generation, not to a queued function's
		// arguments. `prompt` preserves the one-minute debounce but bypasses the
		// ordinary six-hour cost floor; `urgent` is destructive fail-closed work.
		listRefreshUrgency: v.optional(v.union(v.literal('prompt'), v.literal('urgent'))),
		relationsDirtyAt: v.optional(v.number()),
		relationsRefreshScheduledAt: v.optional(v.number()),
		relationsRefreshUrgency: v.optional(v.literal('urgent')),
		// Multi-mutation clear/reseed lease. While present, source writers roll
		// back and every rebuild path rejects unless it carries this exact token.
		// Operation and failure metadata are additive supervisor inputs; no reader
		// may infer that expiry alone authorizes unlocking or publishing.
		coordinatedRebuildToken: v.optional(v.string()),
		coordinatedRebuildStartedAt: v.optional(v.number()),
		coordinatedRebuildKind: v.optional(
			v.union(v.literal('clearSeed'), v.literal('reseedTemplates'))
		),
		coordinatedRebuildLeaseExpiresAt: v.optional(v.number()),
		coordinatedRebuildAttempt: v.optional(v.number()),
		// Exact event-driven watchdog coordinate. The scheduled mutation must carry
		// this timestamp together with the owner token and attempt; only an exact
		// match may consume the slot, re-arm it after a lease renewal, or stamp the
		// terminal failure. This keeps contained mode recoverable without a cron and
		// prevents duplicate/delayed jobs from multiplying successor work.
		coordinatedRebuildWatchdogScheduledAt: v.optional(v.number()),
		coordinatedRebuildRetryAt: v.optional(v.number()),
		coordinatedRebuildFailureAt: v.optional(v.number()),
		coordinatedRebuildFailureCode: v.optional(v.string()),
		// Durable producer-failure evidence. Scheduled rebuilds retain last-good
		// payloads, stamp the first-class failure state, and enqueue an alert action;
		// a later successful publication clears the corresponding pair.
		listFailureAt: v.optional(v.number()),
		listFailureCode: v.optional(v.string()),
		relationsFailureAt: v.optional(v.number()),
		relationsFailureCode: v.optional(v.string()),
		// One-time cutover progress for stamping valid legacy topic vectors with
		// the dedicated repair marker. Keeping this on the existing singleton
		// makes self-paging completion observable without another table or scan.
		topicEmbeddingMarkerMigrationStartedAt: v.optional(v.number()),
		topicEmbeddingMarkerMigrationCompletedAt: v.optional(v.number()),
		topicEmbeddingMarkerMigrationScanned: v.optional(v.number()),
		topicEmbeddingMarkerMigrationMarked: v.optional(v.number()),
		topicEmbeddingMarkerMigrationFailureCode: v.optional(v.string()),
		// Exact one-template-per-transaction reconciliation for the legacy
		// optional endorsement counter. A run token supersedes delayed jobs when
		// an operator resumes or restarts the chain.
		endorsementCountMigrationStatus: v.optional(
			v.union(v.literal('running'), v.literal('complete'), v.literal('blocked'))
		),
		endorsementCountMigrationRunToken: v.optional(v.string()),
		endorsementCountMigrationCursor: v.optional(v.string()),
		endorsementCountMigrationStartedAt: v.optional(v.number()),
		endorsementCountMigrationCompletedAt: v.optional(v.number()),
		endorsementCountMigrationScannedTemplates: v.optional(v.number()),
		endorsementCountMigrationRepairedTemplates: v.optional(v.number()),
		endorsementCountMigrationEndorsementsCounted: v.optional(v.number()),
		endorsementCountMigrationFailureCode: v.optional(v.string()),
		endorsementCountMigrationFailureTemplateId: v.optional(v.id('templates'))
	}).index('by_key', ['key']),

	// Compact read authority for the Pages manifest-control heartbeat. The wide
	// `publicDiscoveryManifest` row deliberately owns scheduler, failure, and
	// migration state; reading it for a ten-scalar edge coordinate would charge
	// all of that unrelated storage. This projection is activated by one bounded
	// migration and mirrored transactionally by every coordinate-changing writer.
	// Runtime code enforces a 4 KiB serialized-row ceiling before every write.
	publicDiscoveryManifestAuthority: defineTable({
		key: v.literal('public'),
		projectionVersion: v.literal(1),
		listReady: v.boolean(),
		listRetiredRevision: v.number(),
		listRevision: v.number(),
		listUpdatedAt: v.union(v.number(), v.null()),
		listWithdrawalEpoch: v.number(),
		relationsReady: v.boolean(),
		relationsRetiredRevision: v.number(),
		relationsRevision: v.number(),
		relationsUpdatedAt: v.union(v.number(), v.null()),
		relationsWithdrawalEpoch: v.number()
	}).index('by_key', ['key']),

	// Distributed lease for the Cloudflare admin embedding repair route. Pages
	// isolates do not share module memory, so the route claims this tiny row before
	// spending Gemini calls. An expiry makes an evicted worker self-recovering.
	embeddingBackfillLeases: defineTable({
		key: v.literal('topic'),
		token: v.string(),
		expiresAt: v.number()
	}).index('by_key', ['key'])
});
