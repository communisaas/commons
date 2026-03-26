import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// =============================================================================
// Commons Convex Schema
// Translated from prisma/schema.prisma with flattening rules applied.
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
//   - Prisma @default / @updatedAt → handled in mutations, not schema
//   - PII fields (encrypted_email, email_hash) → v.string()
//   - Vector embeddings → v.optional(v.array(v.float64())) + .vectorIndex()
// =============================================================================

export default defineSchema({
  // ===========================================================================
  // USERS & AUTH
  // ===========================================================================

  users: defineTable({
    // Auth (email kept as optional legacy — encrypted_email + email_hash canonical)
    email: v.optional(v.string()),
    name: v.optional(v.string()),
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

    // PII encryption at rest
    encryptedEmail: v.string(),
    encryptedName: v.optional(v.string()),
    emailHash: v.string(),
    encryptedProfile: v.optional(v.string()),

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

    // Profile
    role: v.optional(v.string()),
    organization: v.optional(v.string()),
    location: v.optional(v.string()),
    connection: v.optional(v.string()),
    profileCompletedAt: v.optional(v.number()),
    profileVisibility: v.string(), // 'private' | 'public'
  })
    .index("by_email", ["email"])
    .index("by_emailHash", ["emailHash"])
    .index("by_identityHash", ["identityHash"])
    .index("by_identityCommitment", ["identityCommitment"])
    .index("by_passkeyCredentialId", ["passkeyCredentialId"])
    .index("by_didKey", ["didKey"])
    .index("by_walletAddress", ["walletAddress"])
    .index("by_nearAccountId", ["nearAccountId"]),

  sessions: defineTable({
    userId: v.id("users"),
    expiresAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_expiresAt", ["expiresAt"]),

  accounts: defineTable({
    userId: v.id("users"),
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
    emailVerified: v.boolean(),
  })
    .index("by_userId", ["userId"])
    .index("by_provider_providerAccountId", ["provider", "providerAccountId"]),

  // ===========================================================================
  // TEMPLATES (with flattened jurisdictions + scopes)
  // ===========================================================================

  templates: defineTable({
    slug: v.string(),
    title: v.string(),
    description: v.string(),
    category: v.string(),
    topics: v.optional(v.any()), // JSON array of topic tags
    type: v.string(),
    deliveryMethod: v.string(),
    preview: v.string(),
    messageBody: v.string(),
    sources: v.optional(v.any()),
    researchLog: v.optional(v.any()),
    cachedSources: v.optional(v.any()),
    sourcesCachedAt: v.optional(v.number()),
    deliveryConfig: v.any(),
    cwcConfig: v.optional(v.any()),
    recipientConfig: v.any(),
    metrics: v.any(),
    campaignId: v.optional(v.string()),
    status: v.string(), // 'draft' | 'published' | etc.
    isPublic: v.boolean(),

    // Community metrics
    verifiedSends: v.number(),
    uniqueDistricts: v.number(),
    avgReputation: v.optional(v.float64()),
    endorsementCount: v.optional(v.number()),

    // Semantic embeddings (768-dim Gemini vectors)
    locationEmbedding: v.optional(v.array(v.float64())),
    topicEmbedding: v.optional(v.array(v.float64())),
    embeddingVersion: v.string(),
    embeddingsUpdatedAt: v.optional(v.number()),

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
    userId: v.optional(v.id("users")),

    // Org relationship
    orgId: v.optional(v.id("organizations")),

    // ── FLATTENED: TemplateJurisdiction[] ──
    // Array of jurisdiction objects (was separate table)
    jurisdictions: v.optional(v.array(v.object({
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
      coverageNotes: v.optional(v.string()),
    }))),

    // ── FLATTENED: TemplateScope[] ──
    // Array of geographic scope objects (was separate table)
    scopes: v.optional(v.array(v.object({
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
      longitude: v.optional(v.float64()),
    }))),
  })
    .index("by_slug", ["slug"])
    .index("by_userId", ["userId"])
    .index("by_orgId", ["orgId"])
    .index("by_verificationStatus", ["verificationStatus"])
    .index("by_countryCode", ["countryCode"])
    .index("by_userId_contentHash", ["userId", "contentHash"])
    .index("by_status", ["status"])
    .searchIndex("search_templates", {
      searchField: "title",
      filterFields: ["category", "status", "countryCode"],
    })
    .vectorIndex("by_topicEmbedding", {
      vectorField: "topicEmbedding",
      dimensions: 768,
      filterFields: ["category", "countryCode"],
    })
    .vectorIndex("by_locationEmbedding", {
      vectorField: "locationEmbedding",
      dimensions: 768,
      filterFields: ["countryCode"],
    }),

  // ===========================================================================
  // VERIFIABLE MESSAGES
  // ===========================================================================

  messages: defineTable({
    templateId: v.id("templates"),

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
    errorMessage: v.optional(v.string()),
  })
    .index("by_templateId", ["templateId"])
    .index("by_districtHash", ["districtHash"])
    .index("by_sentAt", ["sentAt"])
    .index("by_deliveryStatus", ["deliveryStatus"])
    .index("by_officeRead", ["officeRead"]),

  // ===========================================================================
  // USER → DECISION MAKER RELATIONS
  // ===========================================================================

  userDmRelations: defineTable({
    userId: v.id("users"),
    decisionMakerId: v.id("decisionMakers"),
    relationship: v.string(), // 'constituent' | 'voter' | 'resident'
    isActive: v.boolean(),
    assignedAt: v.number(),
    lastValidated: v.optional(v.number()),
    source: v.string(), // 'legacy' | 'shadow_atlas' | 'civic_api'
  })
    .index("by_userId", ["userId"])
    .index("by_decisionMakerId", ["decisionMakerId"])
    .index("by_userId_decisionMakerId", ["userId", "decisionMakerId"]),

  // ===========================================================================
  // ANALYTICS (aggregates + snapshots only)
  // ===========================================================================

  analytics: defineTable({
    // Record type discriminator
    recordType: v.string(), // 'aggregate' | 'snapshot'

    // ── Aggregate / Snapshot shared fields ──
    date: v.optional(v.number()), // epoch ms of day (aggregate)
    snapshotDate: v.optional(v.number()), // epoch ms of day (snapshot)

    // Metric dimensions
    metric: v.optional(v.string()),
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

    updatedAt: v.optional(v.number()),
  })
    .index("by_recordType", ["recordType"])
    .index("by_date", ["date"])
    .index("by_metric_date", ["metric", "date"])
    .index("by_templateId_date", ["templateId", "date"])
    .index("by_jurisdiction_date", ["jurisdiction", "date"])
    .index("by_snapshotDate", ["snapshotDate"]),

  // ===========================================================================
  // PRIVACY BUDGETS
  // ===========================================================================

  privacyBudgets: defineTable({
    userId: v.id("users"),
    metric: v.string(),
    epsilon: v.number(),
    consumed: v.number(),
    windowStart: v.number(),
    windowEnd: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_metric", ["userId", "metric"]),

  // ===========================================================================
  // ENCRYPTED DELIVERY DATA
  // ===========================================================================

  encryptedDeliveryData: defineTable({
    userId: v.id("users"),

    // XChaCha20-Poly1305 encrypted blob
    ciphertext: v.string(),
    nonce: v.string(),
    ephemeralPublicKey: v.string(),

    // TEE key
    teeKeyId: v.string(),

    // Metadata
    encryptionVersion: v.string(),
    updatedAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_userId", ["userId"])
    .index("by_teeKeyId", ["teeKeyId"]),

  // ===========================================================================
  // ZK PROOF SUBMISSIONS
  // ===========================================================================

  submissions: defineTable({
    pseudonymousId: v.string(),
    templateId: v.string(),

    // ZK proof data
    proofHex: v.string(),
    publicInputs: v.any(), // JSON array
    nullifier: v.string(),
    actionId: v.string(),

    // Idempotency
    idempotencyKey: v.optional(v.string()),

    // Witness encryption
    encryptedWitness: v.string(),
    encryptedMessage: v.optional(v.string()),
    witnessNonce: v.optional(v.string()),
    ephemeralPublicKey: v.optional(v.string()),
    teeKeyId: v.optional(v.string()),

    // Congressional delivery
    cwcSubmissionId: v.optional(v.string()),
    deliveryStatus: v.string(), // 'pending' | 'processing' | 'delivered' | 'partial' | 'failed'
    deliveryError: v.optional(v.string()),
    deliveredAt: v.optional(v.number()),

    // Blockchain verification
    verificationTxHash: v.optional(v.string()),
    verificationStatus: v.string(), // 'pending' | 'verified' | 'rejected'
    verifiedAt: v.optional(v.number()),
    blockNumber: v.optional(v.number()),

    // Reputation
    reputationDelta: v.optional(v.number()),
    reputationTxHash: v.optional(v.string()),

    // Witness expiry
    witnessExpiresAt: v.optional(v.number()),

    updatedAt: v.number(),
  })
    .index("by_nullifier", ["nullifier"])
    .index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_pseudonymousId", ["pseudonymousId"])
    .index("by_templateId", ["templateId"])
    .index("by_deliveryStatus", ["deliveryStatus"])
    .index("by_verificationStatus", ["verificationStatus"])
    .index("by_witnessExpiresAt", ["witnessExpiresAt"]),

  // ===========================================================================
  // VERIFICATION SESSIONS
  // ===========================================================================

  verificationSessions: defineTable({
    userId: v.id("users"),
    nonce: v.string(),
    challenge: v.string(),
    expiresAt: v.number(),
    status: v.string(), // 'pending' | 'verified' | 'expired' | 'failed'
    method: v.string(), // 'self.xyz' | 'didit'
  })
    .index("by_nonce", ["nonce"])
    .index("by_userId_creationTime", ["userId"])
    .index("by_expiresAt", ["expiresAt"]),

  // ===========================================================================
  // DISTRICT CREDENTIALS
  // ===========================================================================

  districtCredentials: defineTable({
    userId: v.id("users"),
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
  })
    .index("by_userId_expiresAt", ["userId", "expiresAt"])
    .index("by_congressionalDistrict", ["congressionalDistrict"]),

  // ===========================================================================
  // RATE LIMITS
  // ===========================================================================

  rateLimits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key_windowStart", ["key", "windowStart"])
    .index("by_windowStart", ["windowStart"]),

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
    expiresAt: v.optional(v.number()),
  })
    .index("by_category", ["category"])
    .index("by_publishedAt", ["publishedAt"])
    .index("by_relevanceScore", ["relevanceScore"])
    .index("by_expiresAt", ["expiresAt"])
    .searchIndex("search_intelligence", {
      searchField: "title",
      filterFields: ["category"],
    })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 768,
      filterFields: ["category"],
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
    lastAccessedAt: v.optional(v.number()),
  })
    .index("by_sourceUrlHash", ["sourceUrlHash"])
    .index("by_sourceUrl", ["sourceUrl"])
    .index("by_documentType", ["documentType"])
    .index("by_expiresAt", ["expiresAt"]),

  // ===========================================================================
  // RESOLVED CONTACTS
  // ===========================================================================

  resolvedContacts: defineTable({
    orgKey: v.string(),
    name: v.optional(v.string()),
    title: v.optional(v.string()),
    email: v.optional(v.string()),
    emailSource: v.optional(v.string()),
    verificationStatus: v.optional(v.string()),
    verifiedAt: v.optional(v.number()),
    resolvedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_orgKey_title", ["orgKey", "title"])
    .index("by_expiresAt", ["expiresAt"]),

  // ===========================================================================
  // SUPPRESSED EMAILS
  // ===========================================================================

  suppressedEmails: defineTable({
    email: v.string(),
    emailHash: v.optional(v.string()),
    domain: v.string(),
    reason: v.string(), // 'smtp_invalid' | 'smtp_disabled' | 'full_inbox' | 'bounce_report' | 'dns_no_mx'
    source: v.string(), // 'verification' | 'user_report'
    reportedBy: v.optional(v.string()),
    reacherData: v.optional(v.any()),
    expiresAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_emailHash", ["emailHash"])
    .index("by_domain", ["domain"])
    .index("by_expiresAt", ["expiresAt"]),

  // ===========================================================================
  // BOUNCE REPORTS
  // ===========================================================================

  bounceReports: defineTable({
    email: v.string(),
    emailHash: v.optional(v.string()),
    encryptedEmail: v.optional(v.string()),
    domain: v.string(),
    reportedBy: v.string(),
    probeResult: v.optional(v.string()),
    resolved: v.boolean(),
  })
    .index("by_email_resolved", ["email", "resolved"])
    .index("by_emailHash_resolved", ["emailHash", "resolved"])
    .index("by_reportedBy", ["reportedBy"]),

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
    expiresAt: v.number(),
  })
    .index("by_traceId", ["traceId"])
    .index("by_userId", ["userId"])
    .index("by_endpoint", ["endpoint"])
    .index("by_eventType", ["eventType"])
    .index("by_expiresAt", ["expiresAt"]),

  // ===========================================================================
  // STAKED DELIBERATION — DEBATES
  // ===========================================================================

  debates: defineTable({
    templateId: v.id("templates"),

    // On-chain identifiers
    debateIdOnchain: v.string(),
    actionDomain: v.string(),
    propositionHash: v.string(),

    // Proposition content
    propositionText: v.string(),

    // Debate parameters
    deadline: v.number(),
    jurisdictionSize: v.number(),
    status: v.string(), // 'active' | 'resolving' | 'resolved' | 'awaiting_governance' | 'under_appeal'

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

    updatedAt: v.number(),
  })
    .index("by_templateId", ["templateId"])
    .index("by_status", ["status"])
    .index("by_status_deadline", ["status", "deadline"])
    .index("by_debateIdOnchain", ["debateIdOnchain"]),

  debateArguments: defineTable({
    debateId: v.id("debates"),
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
    verifiedAt: v.optional(v.number()),
  })
    .index("by_debateId", ["debateId"])
    .index("by_debateId_argumentIndex", ["debateId", "argumentIndex"])
    .index("by_debateId_nullifierHash", ["debateId", "nullifierHash"])
    .index("by_weightedScore", ["weightedScore"])
    .index("by_verificationStatus", ["verificationStatus"]),

  debateNullifiers: defineTable({
    debateId: v.id("debates"),
    nullifierHash: v.string(),
    actionType: v.string(), // 'argument' | 'cosign'

    // On-chain verification
    verificationStatus: v.string(), // 'pending' | 'verified' | 'rejected'
    cosignWeight: v.optional(v.number()),
    argumentId: v.optional(v.string()),
    txHash: v.optional(v.string()),
  })
    .index("by_debateId", ["debateId"])
    .index("by_debateId_nullifierHash", ["debateId", "nullifierHash"])
    .index("by_verificationStatus", ["verificationStatus"]),

  // ===========================================================================
  // SHADOW ATLAS REGISTRATION
  // ===========================================================================

  shadowAtlasRegistrations: defineTable({
    userId: v.id("users"),
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
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_identityCommitment", ["identityCommitment"])
    .index("by_registrationStatus", ["registrationStatus"]),

  // ===========================================================================
  // VERIFICATION AUDIT
  // ===========================================================================

  verificationAudits: defineTable({
    userId: v.id("users"),
    verificationMethod: v.string(),
    result: v.string(), // 'success' | 'failure' | 'expired'
    errorCode: v.optional(v.string()),
    ipHash: v.optional(v.string()),
  })
    .index("by_userId", ["userId"]),

  // ===========================================================================
  // SUBMISSION RETRY QUEUE
  // ===========================================================================

  submissionRetries: defineTable({
    submissionId: v.id("submissions"),
    nullifier: v.string(),
    proofHex: v.string(),
    publicInputs: v.any(),
    verifierDepth: v.number(),
    retryCount: v.number(),
    nextRetryAt: v.number(),
    status: v.string(), // 'pending' | 'succeeded' | 'exhausted'
    lastError: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_submissionId", ["submissionId"])
    .index("by_status_nextRetryAt", ["status", "nextRetryAt"])
    .index("by_nullifier", ["nullifier"]),

  // ===========================================================================
  // POWER LANDSCAPE — POSITION REGISTRATION
  // ===========================================================================

  positionRegistrations: defineTable({
    templateId: v.id("templates"),
    identityCommitment: v.string(),
    stance: v.string(), // 'support' | 'oppose'
    districtCode: v.optional(v.string()),
    registeredAt: v.number(),
  })
    .index("by_templateId", ["templateId"])
    .index("by_templateId_identityCommitment", ["templateId", "identityCommitment"]),

  positionDeliveries: defineTable({
    registrationId: v.id("positionRegistrations"),
    recipientName: v.string(),
    recipientKey: v.optional(v.string()),
    recipientEmail: v.optional(v.string()),
    deliveryMethod: v.string(), // 'cwc' | 'email' | 'recorded'
    deliveryStatus: v.string(), // 'pending' | 'delivered' | 'failed'
    deliveredAt: v.optional(v.number()),
  })
    .index("by_registrationId", ["registrationId"]),

  // ===========================================================================
  // COMMUNITY FIELD CONTRIBUTIONS
  // ===========================================================================

  communityFieldContributions: defineTable({
    epochDate: v.string(), // "2026-03-02"
    epochNullifier: v.string(),
    cellTreeRoot: v.string(),
    proofHash: v.string(),
    verificationStatus: v.string(), // 'pending' | 'verified' | 'rejected'
  })
    .index("by_epochDate", ["epochDate"])
    .index("by_epochDate_epochNullifier", ["epochDate", "epochNullifier"])
    .index("by_verificationStatus", ["verificationStatus"]),

  // ===========================================================================
  // ORG LAYER
  // ===========================================================================

  // organizations: includes flattened AnSync data as JSON field
  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    avatar: v.optional(v.string()),

    // Billing
    billingEmail: v.optional(v.string()),
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
    campaignCount: v.optional(v.number()),
    memberCount: v.optional(v.number()),
    sentEmailCount: v.optional(v.number()),
    onboardingState: v.optional(v.object({
      hasDescription: v.boolean(),
      hasIssueDomains: v.boolean(),
      hasSupporters: v.boolean(),
      hasCampaigns: v.boolean(),
      hasTeam: v.boolean(),
      hasSentEmail: v.boolean(),
    })),

    // Public profile
    mission: v.optional(v.string()),
    websiteUrl: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    isPublic: v.boolean(),

    updatedAt: v.number(),

    // ── FLATTENED: AnSync settings ──
    // Action Network sync config (was separate `an_sync` table)
    anSync: v.optional(v.object({
      apiKey: v.string(),
      status: v.string(), // 'idle' | 'running' | 'completed' | 'failed'
      syncType: v.string(), // 'full' | 'incremental'
      totalResources: v.number(),
      processedResources: v.number(),
      currentResource: v.optional(v.string()),
      imported: v.number(),
      updated: v.number(),
      skipped: v.number(),
      errors: v.optional(v.any()),
      lastSyncAt: v.optional(v.number()),
      startedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
    })),
  })
    .index("by_slug", ["slug"])
    .index("by_stripeCustomerId", ["stripeCustomerId"])
    .index("by_identityCommitment", ["identityCommitment"])
    .index("by_walletAddress", ["walletAddress"])
    .searchIndex("search_organizations", {
      searchField: "name",
      filterFields: ["countryCode", "isPublic"],
    }),

  orgMemberships: defineTable({
    userId: v.id("users"),
    orgId: v.id("organizations"),
    role: v.string(), // 'owner' | 'editor' | 'member'
    joinedAt: v.number(),
    invitedBy: v.optional(v.string()),
  })
    .index("by_userId_orgId", ["userId", "orgId"])
    .index("by_orgId", ["orgId"]),

  orgInvites: defineTable({
    orgId: v.id("organizations"),
    role: v.string(),
    token: v.string(),
    expiresAt: v.number(),
    accepted: v.boolean(),
    invitedBy: v.string(),

    // PII encryption at rest
    encryptedEmail: v.string(),
    emailHash: v.string(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_token", ["token"])
    .index("by_emailHash", ["emailHash"]),

  orgResolvedContacts: defineTable({
    orgId: v.id("organizations"),
    orgKey: v.string(),
    name: v.string(),
    title: v.string(),
    email: v.string(),
    emailSource: v.optional(v.string()),
    resolvedAt: v.number(),
    expiresAt: v.number(),
    resolvedBy: v.optional(v.string()),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_orgKey_title", ["orgId", "orgKey", "title"])
    .index("by_expiresAt", ["expiresAt"]),

  orgNetworks: defineTable({
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    ownerOrgId: v.id("organizations"),
    status: v.string(), // 'active' | 'suspended'
    applicableCountries: v.array(v.string()),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_ownerOrgId", ["ownerOrgId"]),

  orgNetworkMembers: defineTable({
    networkId: v.id("orgNetworks"),
    orgId: v.id("organizations"),
    role: v.string(), // 'admin' | 'member'
    status: v.string(), // 'active' | 'pending' | 'removed'
    joinedAt: v.number(),
    invitedBy: v.optional(v.string()),
  })
    .index("by_networkId", ["networkId"])
    .index("by_orgId", ["orgId"])
    .index("by_networkId_orgId", ["networkId", "orgId"])
    .index("by_orgId_status", ["orgId", "status"])
    .index("by_networkId_status", ["networkId", "status"]),

  templateEndorsements: defineTable({
    templateId: v.id("templates"),
    orgId: v.id("organizations"),
    endorsedAt: v.number(),
    endorsedBy: v.optional(v.string()),
  })
    .index("by_templateId", ["templateId"])
    .index("by_orgId", ["orgId"])
    .index("by_templateId_orgId", ["templateId", "orgId"]),

  // ===========================================================================
  // SUPPORTERS & TAGS
  // ===========================================================================

  supporters: defineTable({
    orgId: v.id("organizations"),
    name: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    country: v.optional(v.string()),
    phone: v.optional(v.string()),

    // PII encryption at rest
    encryptedEmail: v.string(),
    emailHash: v.string(),

    // ZK identity binding
    identityCommitment: v.optional(v.string()),

    // Verification state
    verified: v.boolean(),
    emailStatus: v.string(), // 'subscribed' | 'unsubscribed' | 'bounced' | 'complained'
    smsStatus: v.string(), // 'none' | 'subscribed' | 'unsubscribed' | 'stopped'

    // Import tracking
    source: v.optional(v.string()), // 'csv' | 'action_network' | 'organic' | 'widget'
    importedAt: v.optional(v.number()),

    // Flexible data
    customFields: v.optional(v.any()),

    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_emailHash", ["orgId", "emailHash"])
    .index("by_emailStatus", ["emailStatus"])
    .index("by_smsStatus", ["smsStatus"])
    .index("by_source", ["source"])
    .index("by_identityCommitment", ["identityCommitment"]),

  tags: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_name", ["orgId", "name"]),

  supporterTags: defineTable({
    supporterId: v.id("supporters"),
    tagId: v.id("tags"),
  })
    .index("by_supporterId", ["supporterId"])
    .index("by_tagId", ["tagId"])
    .index("by_supporterId_tagId", ["supporterId", "tagId"]),

  // ===========================================================================
  // SEGMENTS
  // ===========================================================================

  segments: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    description: v.optional(v.string()),
    filters: v.any(), // { logic: 'AND'|'OR', conditions: [] }
    cachedCount: v.optional(v.number()),
    countedAt: v.optional(v.number()),
    createdBy: v.id("users"),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_name", ["orgId", "name"]),

  // ===========================================================================
  // CAMPAIGNS
  // ===========================================================================

  campaigns: defineTable({
    orgId: v.id("organizations"),
    type: v.string(), // 'LETTER' | 'EVENT' | 'FORM'
    title: v.string(),
    body: v.optional(v.string()),
    status: v.string(), // 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETE'

    // Target resolution
    targets: v.optional(v.any()),

    // Template linkage
    templateId: v.optional(v.string()),

    // Debate market
    debateEnabled: v.boolean(),
    debateThreshold: v.number(),
    debateId: v.optional(v.id("debates")),

    // Fundraising
    goalAmountCents: v.optional(v.number()),
    raisedAmountCents: v.number(),
    donorCount: v.number(),
    donationCurrency: v.optional(v.string()),

    // Geographic targeting
    targetJurisdiction: v.optional(v.string()),
    targetCountry: v.string(),

    // Intelligence loop
    billId: v.optional(v.id("bills")),
    position: v.optional(v.string()), // 'support' | 'oppose'

    // Denormalized counters
    actionCount: v.optional(v.number()),
    verifiedActionCount: v.optional(v.number()),

    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_status", ["status"])
    .index("by_debateId", ["debateId"]),

  campaignActions: defineTable({
    campaignId: v.id("campaigns"),
    supporterId: v.optional(v.id("supporters")),

    verified: v.boolean(),
    engagementTier: v.number(), // 0-4
    districtHash: v.optional(v.string()),
    messageHash: v.optional(v.string()),

    // Agentic delegation
    delegated: v.boolean(),
    delegationGrantId: v.optional(v.string()),

    sentAt: v.number(),
  })
    .index("by_campaignId", ["campaignId"])
    .index("by_campaignId_verified", ["campaignId", "verified"])
    .index("by_campaignId_districtHash", ["campaignId", "districtHash"]),

  campaignDeliveries: defineTable({
    campaignId: v.id("campaigns"),
    actionId: v.optional(v.id("campaignActions")),
    targetEmail: v.string(),
    targetName: v.string(),
    targetTitle: v.string(),
    targetDistrict: v.optional(v.string()),
    status: v.string(), // 'queued' | 'sent' | 'delivered' | 'bounced' | 'opened'
    sentAt: v.optional(v.number()),
    sesMessageId: v.optional(v.string()),
    packetSnapshot: v.optional(v.any()),
    packetDigest: v.optional(v.string()),
    proofWeight: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_campaignId", ["campaignId"])
    .index("by_actionId", ["actionId"])
    .index("by_status", ["status"]),

  // ===========================================================================
  // EMAIL BLASTS (with flattened email_batch)
  // ===========================================================================

  emailBlasts: defineTable({
    orgId: v.id("organizations"),
    campaignId: v.optional(v.string()),

    subject: v.string(),
    bodyHtml: v.string(),
    fromName: v.string(),
    fromEmail: v.string(),

    status: v.string(), // 'draft' | 'sending' | 'sent' | 'failed'

    // Recipient targeting
    recipientFilter: v.optional(v.any()),
    totalRecipients: v.number(),

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

    // A/B testing
    isAbTest: v.boolean(),
    abTestConfig: v.optional(v.any()),
    abVariant: v.optional(v.string()),
    abParentId: v.optional(v.string()),
    abWinnerPickedAt: v.optional(v.number()),

    // ── FLATTENED: EmailBatch[] ──
    // Batches as array (was separate email_batch table)
    batches: v.optional(v.array(v.object({
      batchIndex: v.number(),
      status: v.string(), // 'pending' | 'sending' | 'sent' | 'failed'
      sentCount: v.number(),
      failedCount: v.number(),
      error: v.optional(v.string()),
      sentAt: v.optional(v.number()),
    }))),
  })
    .index("by_orgId", ["orgId"])
    .index("by_status", ["status"])
    .index("by_abParentId", ["abParentId"]),

  emailEvents: defineTable({
    blastId: v.id("emailBlasts"),
    recipientEmail: v.string(),
    eventType: v.string(), // 'open' | 'click' | 'bounce' | 'complaint'
    linkUrl: v.optional(v.string()),
    linkIndex: v.optional(v.number()),
    timestamp: v.number(),
  })
    .index("by_blastId", ["blastId"])
    .index("by_blastId_eventType", ["blastId", "eventType"])
    .index("by_recipientEmail", ["recipientEmail"]),

  // ===========================================================================
  // SUBSCRIPTIONS
  // ===========================================================================

  subscriptions: defineTable({
    // Polymorphic owner
    userId: v.optional(v.id("users")),
    orgId: v.optional(v.id("organizations")),

    plan: v.string(), // 'pro' | 'org'
    planDescription: v.optional(v.string()),
    priceCents: v.number(),

    status: v.string(), // 'active' | 'past_due' | 'canceled' | 'trialing'
    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number(),

    // Payment method
    paymentMethod: v.string(), // 'stripe' | 'crypto'

    // Stripe
    stripeSubscriptionId: v.optional(v.string()),

    // Crypto
    payingAddress: v.optional(v.string()),
    paymentChain: v.optional(v.string()),
    paymentToken: v.optional(v.string()),
    lastTxHash: v.optional(v.string()),
    lastVerifiedAt: v.optional(v.number()),

    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_orgId", ["orgId"])
    .index("by_stripeSubscriptionId", ["stripeSubscriptionId"]),

  // ===========================================================================
  // API KEYS
  // ===========================================================================

  apiKeys: defineTable({
    orgId: v.id("organizations"),
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
    createdBy: v.optional(v.string()),
  })
    .index("by_orgId", ["orgId"])
    .index("by_keyHash", ["keyHash"]),

  // ===========================================================================
  // EVENTS
  // ===========================================================================

  events: defineTable({
    orgId: v.id("organizations"),
    campaignId: v.optional(v.id("campaigns")),

    title: v.string(),
    description: v.optional(v.string()),
    eventType: v.string(), // 'IN_PERSON' | 'VIRTUAL' | 'HYBRID'

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
    attendeeCount: v.number(),
    verifiedAttendees: v.number(),

    // Verification
    checkinCode: v.optional(v.string()),
    requireVerification: v.boolean(),

    status: v.string(), // 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED'

    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_status", ["orgId", "status"])
    .index("by_startAt", ["startAt"])
    .index("by_checkinCode", ["checkinCode"]),

  // eventRsvps: includes flattened EventAttendance fields
  eventRsvps: defineTable({
    eventId: v.id("events"),
    supporterId: v.optional(v.id("supporters")),

    encryptedEmail: v.string(),
    emailHash: v.string(),
    name: v.string(),
    status: v.string(), // 'GOING' | 'MAYBE' | 'NOT_GOING' | 'WAITLISTED'
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
  })
    .index("by_eventId", ["eventId"])
    .index("by_eventId_emailHash", ["eventId", "emailHash"])
    .index("by_eventId_status", ["eventId", "status"]),

  // ===========================================================================
  // FUNDRAISING — DONATIONS
  // ===========================================================================

  donations: defineTable({
    orgId: v.id("organizations"),
    campaignId: v.id("campaigns"),
    supporterId: v.optional(v.id("supporters")),

    email: v.string(), // plaintext during transition
    name: v.string(), // plaintext during transition
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

    status: v.string(), // 'pending' | 'completed' | 'failed' | 'refunded'

    districtHash: v.optional(v.string()),
    engagementTier: v.number(),

    completedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_campaignId", ["campaignId"])
    .index("by_supporterId", ["supporterId"])
    .index("by_status", ["status"])
    .index("by_stripeSessionId", ["stripeSessionId"])
    .index("by_stripePaymentIntentId", ["stripePaymentIntentId"]),

  // ===========================================================================
  // AUTOMATION — WORKFLOWS
  // ===========================================================================

  workflows: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    description: v.optional(v.string()),
    trigger: v.any(), // { type: 'donation_completed' | ... }
    steps: v.any(), // Array of step objects
    enabled: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_enabled", ["enabled"]),

  workflowExecutions: defineTable({
    workflowId: v.id("workflows"),
    supporterId: v.optional(v.id("supporters")),

    triggerEvent: v.any(), // snapshot of trigger
    status: v.string(), // 'pending' | 'running' | 'completed' | 'failed' | 'paused'
    currentStep: v.number(),
    nextRunAt: v.optional(v.number()),
    error: v.optional(v.string()),
    completedAt: v.optional(v.number()),
  })
    .index("by_workflowId", ["workflowId"])
    .index("by_supporterId", ["supporterId"])
    .index("by_status", ["status"])
    .index("by_nextRunAt", ["nextRunAt"])
    .index("by_status_nextRunAt", ["status", "nextRunAt"]),

  workflowActionLogs: defineTable({
    executionId: v.id("workflowExecutions"),
    stepIndex: v.number(),
    actionType: v.string(), // 'send_email' | 'add_tag' | 'remove_tag' | 'delay' | 'condition'
    result: v.any(),
    createdAt: v.number(),
  })
    .index("by_executionId", ["executionId"]),

  // ===========================================================================
  // SMS + PATCH-THROUGH CALLING
  // ===========================================================================

  smsBlasts: defineTable({
    orgId: v.id("organizations"),
    campaignId: v.optional(v.id("campaigns")),

    body: v.string(),
    fromNumber: v.string(),

    recipientFilter: v.optional(v.any()),
    totalRecipients: v.number(),

    sentCount: v.number(),
    deliveredCount: v.number(),
    failedCount: v.number(),

    status: v.string(), // 'draft' | 'sending' | 'sent' | 'failed'

    sentAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_status", ["status"]),

  smsMessages: defineTable({
    blastId: v.id("smsBlasts"),
    supporterId: v.id("supporters"),
    to: v.string(),
    body: v.string(),
    twilioSid: v.optional(v.string()),
    status: v.string(), // 'queued' | 'sent' | 'delivered' | 'failed'
    errorCode: v.optional(v.string()),
  })
    .index("by_blastId", ["blastId"])
    .index("by_supporterId", ["supporterId"])
    .index("by_twilioSid", ["twilioSid"]),

  patchThroughCalls: defineTable({
    orgId: v.id("organizations"),
    campaignId: v.optional(v.id("campaigns")),
    supporterId: v.id("supporters"),

    callerPhone: v.string(),
    targetPhone: v.string(),
    targetName: v.optional(v.string()),
    targetTitle: v.optional(v.string()),

    twilioCallSid: v.optional(v.string()),
    districtHash: v.optional(v.string()),

    status: v.string(), // 'initiated' | 'in-progress' | 'completed' | 'failed'
    duration: v.optional(v.number()),

    completedAt: v.optional(v.number()),
  })
    .index("by_orgId", ["orgId"])
    .index("by_campaignId", ["campaignId"])
    .index("by_supporterId", ["supporterId"])
    .index("by_status", ["status"])
    .index("by_twilioCallSid", ["twilioCallSid"]),

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
    subject: v.string(),
  })
    .index("by_aiMethod_correctionType", ["aiMethod", "correctionType"]),

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

    updatedAt: v.number(),
  })
    .index("by_externalId", ["externalId"])
    .index("by_jurisdiction_status", ["jurisdiction", "status"])
    .index("by_statusDate", ["statusDate"])
    .searchIndex("search_bills", {
      searchField: "title",
      filterFields: ["jurisdiction", "status"],
    })
    .vectorIndex("by_topicEmbedding", {
      vectorField: "topicEmbedding",
      dimensions: 768,
      filterFields: ["jurisdiction"],
    }),

  orgBillRelevances: defineTable({
    orgId: v.id("organizations"),
    billId: v.id("bills"),
    score: v.float64(), // 0.0-1.0
    matchedOn: v.array(v.string()),
  })
    .index("by_orgId_billId", ["orgId", "billId"])
    .index("by_orgId_score", ["orgId", "score"]),

  legislativeAlerts: defineTable({
    orgId: v.id("organizations"),
    billId: v.id("bills"),
    type: v.string(), // 'new_bill' | 'status_change' | 'vote_scheduled' | 'amendment'
    title: v.string(),
    summary: v.string(),
    urgency: v.string(), // 'low' | 'normal' | 'high' | 'critical'
    status: v.string(), // 'pending' | 'seen' | 'acted' | 'dismissed'
    actionTaken: v.optional(v.string()),
    seenAt: v.optional(v.number()),
  })
    .index("by_orgId_billId_type", ["orgId", "billId", "type"])
    .index("by_orgId_status", ["orgId", "status"]),

  legislativeActions: defineTable({
    billId: v.id("bills"),
    decisionMakerId: v.optional(v.id("decisionMakers")),
    externalId: v.optional(v.string()),
    name: v.string(),
    action: v.string(), // 'voted_yes' | 'voted_no' | 'abstained' | 'sponsored' | 'co-sponsored' | 'statement'
    detail: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    occurredAt: v.number(),
  })
    .index("by_billId", ["billId"])
    .index("by_decisionMakerId", ["decisionMakerId"])
    .index("by_occurredAt", ["occurredAt"])
    .index("by_decisionMakerId_occurredAt", ["decisionMakerId", "occurredAt"]),

  // accountabilityReceipts: includes flattened ReportResponse[]
  accountabilityReceipts: defineTable({
    decisionMakerId: v.id("decisionMakers"),
    dmName: v.string(),
    billId: v.id("bills"),
    orgId: v.id("organizations"),
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
    causalityClass: v.string(), // 'pending' | etc.

    // Decision-maker action
    dmAction: v.optional(v.string()),
    alignment: v.float64(),
    actionSourceUrl: v.optional(v.string()),

    // Anchoring
    anchorCid: v.optional(v.string()),
    anchorRoot: v.optional(v.string()),

    // Metadata
    status: v.string(), // 'pending' | etc.
    updatedAt: v.number(),

    // ── FLATTENED: ReportResponse[] ──
    // Decision-maker responses (was separate report_response table)
    responses: v.optional(v.array(v.object({
      type: v.string(), // 'opened' | 'clicked_verify' | 'replied' | etc.
      detail: v.optional(v.string()),
      confidence: v.string(),
      occurredAt: v.number(),
    }))),
  })
    .index("by_decisionMakerId", ["decisionMakerId"])
    .index("by_decisionMakerId_proofDeliveredAt", ["decisionMakerId", "proofDeliveredAt"])
    .index("by_billId", ["billId"])
    .index("by_orgId", ["orgId"])
    .index("by_orgId_billId_decisionMakerId", ["orgId", "billId", "decisionMakerId"])
    .index("by_status", ["status"])
    .index("by_causalityClass", ["causalityClass"])
    .index("by_deliveryId", ["deliveryId"]),

  orgIssueDomains: defineTable({
    orgId: v.id("organizations"),
    label: v.string(),
    embedding: v.optional(v.array(v.float64())),
    description: v.optional(v.string()),
    weight: v.float64(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_label", ["orgId", "label"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 768,
      filterFields: ["orgId"],
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
    institution: v.optional(v.object({
      type: v.string(), // 'legislature' | 'executive_branch' | 'agency' | 'corporation' | etc.
      name: v.string(),
      jurisdiction: v.optional(v.string()),
      jurisdictionLevel: v.optional(v.string()),
      parentId: v.optional(v.string()), // self-reference for institution hierarchy
      websiteUrl: v.optional(v.string()),
    })),

    // ── FLATTENED: legislative_channel ──
    // Legislative channel delivery config (was separate legislative_channel table)
    legislativeChannel: v.optional(v.object({
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
      lastVerified: v.optional(v.number()),
    })),
  })
    .index("by_type", ["type"])
    .index("by_jurisdiction_jurisdictionLevel", ["jurisdiction", "jurisdictionLevel"])
    .index("by_party", ["party"])
    .index("by_lastName", ["lastName"])
    .index("by_active", ["active"])
    .searchIndex("search_decisionMakers", {
      searchField: "name",
      filterFields: ["type", "jurisdiction", "active"],
    }),

  externalIds: defineTable({
    decisionMakerId: v.id("decisionMakers"),
    system: v.string(), // 'bioguide' | 'openstates' | 'wikidata' | etc.
    value: v.string(),
  })
    .index("by_decisionMakerId_system", ["decisionMakerId", "system"])
    .index("by_system_value", ["system", "value"]),

  orgDmFollows: defineTable({
    orgId: v.id("organizations"),
    decisionMakerId: v.id("decisionMakers"),
    reason: v.string(), // 'manual' | etc.
    alertsEnabled: v.boolean(),
    note: v.optional(v.string()),
    followedBy: v.optional(v.string()),
    followedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_decisionMakerId", ["decisionMakerId"])
    .index("by_orgId_decisionMakerId", ["orgId", "decisionMakerId"]),

  orgBillWatches: defineTable({
    orgId: v.id("organizations"),
    billId: v.id("bills"),
    reason: v.string(), // 'manual' | 'alert' | 'campaign'
    position: v.optional(v.string()), // 'support' | 'oppose'
    addedBy: v.optional(v.string()),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_billId", ["orgId", "billId"]),

  // ===========================================================================
  // SCORECARD SNAPSHOTS
  // ===========================================================================

  scorecardSnapshots: defineTable({
    decisionMakerId: v.id("decisionMakers"),

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
    snapshotHash: v.string(),
  })
    .index("by_decisionMakerId", ["decisionMakerId"])
    .index("by_periodEnd", ["periodEnd"])
    .index("by_composite", ["composite"])
    .index("by_decisionMakerId_periodEnd_methodologyVersion", [
      "decisionMakerId",
      "periodEnd",
      "methodologyVersion",
    ]),

  // ===========================================================================
  // AGENTIC DELEGATION
  // ===========================================================================

  delegationGrants: defineTable({
    userId: v.id("users"),

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

    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_status", ["status"]),

  delegatedActions: defineTable({
    grantId: v.id("delegationGrants"),

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
    status: v.string(), // 'completed' | 'reviewed' | 'rejected' | 'failed'
  })
    .index("by_grantId", ["grantId"]),

  delegationReviews: defineTable({
    grantId: v.id("delegationGrants"),
    actionId: v.optional(v.string()),

    // What needs review
    targetId: v.string(),
    targetTitle: v.string(),
    reasoning: v.string(),
    proofWeight: v.float64(),

    // User decision
    decision: v.optional(v.string()), // 'approve' | 'reject'
    decidedAt: v.optional(v.number()),
  })
    .index("by_grantId", ["grantId"])
    .index("by_decision", ["decision"]),
});
