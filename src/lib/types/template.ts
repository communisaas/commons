import type { TemplateScope } from './jurisdiction';
import type { GeoScope } from '$lib/core/agents/types';

// ============================================================================
// Power Landscape Types (Cycle 37)
// ============================================================================

/** Functional role a decision-maker plays in the decision */
export type RoleCategory = 'votes' | 'executes' | 'shapes' | 'funds' | 'oversees';

/** Group of decision-makers sharing the same functional role */
export interface RoleGroup {
	category: RoleCategory;
	label: string; // "VOTE ON IT", "EXECUTE IT", etc.
	memberIndices: number[]; // indices into decision_makers array
}

/**
 * Minimal template interface for CWC (Communicating With Congress) submission pipeline.
 * Used by cwc-client and cwc-generator to avoid unsafe casts with Prisma model types.
 * Contains only the fields accessed during CWC XML generation and submission.
 */
export interface CwcTemplate {
	id: string;
	title: string;
	description: string;
	message_body: string;
	delivery_config: unknown;
}

/**
 * Minimal template interface for email flow functions (analyzeEmailFlow, resolveTemplate, generateMailtoUrl).
 * Both Template and ComponentTemplate satisfy this interface, eliminating unsafe casts.
 */
export interface EmailFlowTemplate {
	id: string;
	slug: string;
	title: string;
	description: string;
	deliveryMethod: string;
	message_body?: string;
	preview?: string;
	subject?: string | null;
	recipient_config?: unknown;
	recipientEmails?: string[];
}

/** Lightweight debate summary for card-level rendering (browse page) */
export interface DebateSummary {
	status: 'active' | 'resolving' | 'resolved' | 'awaiting_governance' | 'under_appeal';
	winningStance?: string;
	uniqueParticipants: number;
	argumentCount: number;
	deadline?: string;
	stanceCounts?: { support: number; oppose: number; amend: number };
}

export interface Template {
	id: string;
	slug: string; // Required in database with unique constraint
	title: string;
	description: string;
	category: string;
	topics?: string[]; // Topic tags for search/filtering (1-5 lowercase strings)
	type: string;
	deliveryMethod: 'email' | 'email_attested' | 'certified' | 'direct' | 'cwc';
	subject?: string | null;
	message_body: string;
	sources?: Source[]; // Citation sources from message generation agent
	research_log?: string[]; // Agent's research process log
	delivery_config: unknown; // Json field in database
	cwc_config?: unknown | null; // Json? field in database - was missing
	recipient_config: unknown; // Json field in database

	// === ORG ENDORSEMENT (Perceptual Bridge) ===
	// When present, the template has organizational backing — institutional provenance
	endorsingOrg?: { name: string; slug: string; avatar: string | null } | null;
	// Coalition endorsements — multiple orgs can endorse the same template
	endorsingOrgs?: Array<{ name: string; slug: string; avatar: string | null }>;

	// === PERCEPTUAL ENCODING PROPERTIES ===
	// Visual weight encoding (0-1 scale for card size transformation)
	// Logarithmic scale: 1 send = 0.0, 10 = 0.33, 100 = 0.67, 1000+ = 1.0
	coordinationScale: number;
	// Temporal signal for "New" badge (created within 7 days)
	isNew: boolean;
	// Status signal: active debate exists for this template
	hasActiveDebate?: boolean;
	// Lightweight debate summary for card-level rendering
	debateSummary?: DebateSummary;

	campaign_id?: string | null;
	status: string; // String field with default "draft" - was missing
	is_public: boolean;

	// Civic reach counters (aggregate, privacy-preserving)
	send_count: number; // Verified sends
	verified_sends?: number; // Alias (Convex field name)
	unique_districts?: number; // Unique congressional districts reached

	// Geographic scope (populated by scope-filtering, not in Prisma Template model)
	applicable_countries?: string[];
	jurisdiction_level?: string | null;
	specific_locations?: string[];

	// Optional place scoping linked via separate table
	scope?: TemplateScope;

	// === NEW: Location-as-Context Properties (Phase 2025-01) ===
	// How geographically broad is the target/issue?
	geographic_scope?: 'international' | 'national' | 'state' | 'metro' | 'district' | 'local';

	// What location verification is required to participate?
	minimum_precision_required?: 'none' | 'country' | 'state' | 'county' | 'district';

	// What type of power structure is the target?
	target_type?: 'government' | 'corporate' | 'institutional' | 'labor' | 'advocacy';

	// Entity name (for corporate/institutional targets)
	target_entity?: string | null;
	preview: string;
	recipientEmails?: string[]; // Computed field - use extractRecipientEmails(recipient_config) instead

	// === MERGED VERIFICATION FIELDS (Phase 4 consolidation) ===
	// Verification status & process
	verification_status?: 'pending' | 'reviewing' | 'approved' | 'rejected' | null;
	country_code?: string | null; // From TemplateVerification
	severity_level?: number | null; // 1-10 scale

	// Content correction & backup
	correction_log?: Record<string, unknown> | null; // Grammar, clarity fixes applied
	original_content?: Record<string, unknown> | null; // Before corrections
	corrected_subject?: string | null;
	corrected_body?: string | null;

	// Multi-agent consensus & quality scores
	agent_votes?: Record<string, unknown> | null; // {openai: 0.8, gemini: 0.7}
	consensus_score?: number | null; // Weighted average
	quality_score?: number; // 0-100
	grammar_score?: number | null;
	clarity_score?: number | null;
	completeness_score?: number | null;

	// Reputation impact (quadratic)
	reputation_delta?: number; // Default 0
	reputation_applied?: boolean; // Default false

	// Enhanced timestamps (from verification)
	submitted_at?: Date | string | null; // When submitted for verification
	corrected_at?: Date | string | null; // When AI corrections applied
	reviewed_at?: Date | string | null; // When human/final review completed

	// Standard Prisma timestamps
	createdAt: Date | string; // Template creation timestamp
	updatedAt: Date | string; // Template last update timestamp
}

export interface TemplateCreationContext {
	channelId: 'certified' | 'direct' | 'cwc' | 'email_attested';
	channelTitle: string;
	isCongressional?: boolean;
	features?: Array<{
		icon: unknown;
		text: string;
	}>;
}

export interface TemplateFormData {
	objective: {
		rawInput: string; // User's unstructured initial input
		title: string;
		description: string;
		category: string;
		topics?: string[]; // Topic tags from AI or manual entry (1-5 lowercase strings)
		slug?: string;
		voiceSample?: string; // Emotional peak from rawInput - flows to downstream agents
		audienceGuidance?: string; // Optional user guidance for decision-maker targeting
		aiGenerated?: boolean; // Flag indicating content was AI-generated
	};
	audience: {
		decisionMakers: ProcessedDecisionMaker[];
		recipientEmails: string[];
		includesCongress: boolean;
		customRecipients: CustomRecipient[];
		/** Subject line DMs were resolved for — triggers re-resolution on mismatch */
		resolvedForSubject?: string;
	};
	content: {
		preview: string;
		variables: string[];
		sources?: Source[]; // Citation sources from message generation
		researchLog?: string[]; // Agent's research process log
		geographicScope?: GeoScope | null; // Geographic scope from message writer agent
		aiGenerated?: boolean; // Flag indicating message was AI-generated
		edited?: boolean; // Flag indicating user edited AI-generated message
		/** Subject line content was generated for — triggers re-generation on mismatch */
		generatedForSubject?: string;
	};
	review: Record<string, never>; // For validation purposes, no data to store
}

/**
 * Processed decision-maker with extracted provenance data
 */
export interface ProcessedDecisionMaker {
	name: string;
	title: string;
	organization: string;
	email?: string;
	provenance: string; // Full verification text from agent
	reasoning: string; // Extracted: why this person matters
	source?: string; // Extracted: verification URL (for person/position)
	source_url?: string; // Alias for source (used in some code paths)
	isAiResolved: boolean; // true = AI-resolved, false = manually added
	recencyCheck?: string; // Explicit recency verification text
	positionSourceDate?: string; // Date of verification source
	confidence?: number; // Confidence score 0.0-1.0 based on verification
	// Email grounding verification
	emailGrounded?: boolean; // true = email found in grounded search results
	emailSource?: string; // Specific URL where email was found (if grounded)
	emailSourceTitle?: string; // Title of email source page
	/** Free-form notes about alternative contact paths discovered by the agent */
	contactNotes?: string;
	/** true if discovered from page content rather than the initial identity list */
	discovered?: boolean;

	// === Power Landscape fields (Cycle 37) ===
	/** Factual accountability line from Phase 4 agent */
	accountabilityOpener?: string | null;
	/** Functional role in the decision */
	roleCategory?: RoleCategory;
	/** Relevance rank: 1 = most direct power */
	relevanceRank?: number;
	/** Specific votes, decisions, statements */
	publicActions?: string[];
	/** Issue-specific prompt for compose Zone 2 */
	personalPrompt?: string | null;

	// === Email Deliverability Verification ===
	/** SMTP verification status from Reacher probe */
	emailVerified?: 'deliverable' | 'risky' | 'unknown';
}

/**
 * Custom recipient added manually by user
 */
export interface CustomRecipient {
	email: string;
	name: string;
	title?: string; // Job title/position
	organization?: string;
}

/**
 * Source reference from message generation agent
 */
export interface Source {
	num: number; // Citation number [1], [2], etc.
	title: string; // Source title
	url: string; // Source URL
	type: 'journalism' | 'research' | 'government' | 'legal' | 'advocacy' | 'other'; // Source type
}

// ============================================================================
// RecipientConfig — Typed wrapper for Template.recipient_config JSON field
// ============================================================================

/** Typed representation of the `recipient_config` JSON blob on a Template. */
export interface RecipientConfig {
	decisionMakers?: ProcessedDecisionMaker[];
	roleGroups?: RoleGroup[];
	personalPrompt?: string;
	recipientEmails?: string[];
	includesCongress?: boolean;
	customRecipients?: Array<{ name: string; email: string; title?: string; organization?: string }>;
}

/** Parse an unknown recipient_config value into a typed RecipientConfig (graceful fallback). */
export function parseRecipientConfig(value: unknown): RecipientConfig {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return value as RecipientConfig;
	}
	return {};
}

// ============================================================================
// Multi-Target Delivery Types (Hackathon Implementation)
// ============================================================================

/**
 * Template recipient configuration for multi-target delivery
 * Templates can target Congress + external decision-makers in one action
 */
export interface TemplateRecipientConfig {
	type: 'multi-target';
	recipients: TemplateRecipient[];
}

/**
 * Individual recipient in a multi-target template
 */
export interface TemplateRecipient {
	type: 'congressional' | 'email';

	// Congressional recipients
	chamber?: 'house' | 'senate'; // undefined = both
	selection?: 'user_district' | 'all_congress' | 'specific_members';
	specific_bioguide_ids?: string[]; // For targeting specific members

	// Email recipients
	email?: string;
	name?: string; // Display name for UI
	organization?: string; // For context
}

// For UI components that only need a minimal user shape
export type MinimalUser = { id: string; name: string };

// ============================================================================
// Perceptual Decision-Maker Representation (2025-01-25)
// Power topology instead of categorization
// ============================================================================

/**
 * Power reach - how decision-makers are selected
 * Maps to user's spatial mental model of power distance
 */
export type PowerReach = 'district-based' | 'location-specific' | 'universal';

/**
 * Decision-maker identity (recognition > categorization)
 * Names are faster to recognize than roles or categories
 */
export interface DecisionMaker {
	/** Full name: "Mayor London Breed" */
	name: string;
	/** Short display name: "Mayor Breed" */
	shortName?: string;
	/** Role fallback: "Mayor" (if name unavailable) */
	role?: string;
	/** Organization context: "City of San Francisco" */
	organization?: string;
}

/**
 * Geographic location for spatial grounding
 * Users think spatially, not taxonomically
 */
export interface RecipientLocation {
	city?: string;
	state?: string;
	/** Composite jurisdiction: "San Francisco, CA" */
	jurisdiction?: string;
}

/**
 * Perceptual recipient configuration
 * Encodes power topology for direct recognition
 */
export interface PerceptualRecipientConfig {
	/** Power reach type */
	reach: PowerReach;
	/** Decision-maker identities (for recognition) */
	decisionMakers?: DecisionMaker[];
	/** Geographic context (spatial grounding) */
	location?: RecipientLocation;
	/** Email addresses (implementation detail) */
	emails?: string[];
	/** CWC API routing (congressional) */
	cwcRouting?: boolean;
}

/**
 * Single power level target
 * Used in both standalone and multi-level presentations
 */
export interface PowerLevelTarget {
	/** Primary text: "Your 3 representatives" or "Mayor Breed, Board of Supervisors" */
	primary: string;
	/** Secondary text: "+2 more" (if truncated) */
	secondary?: string | null;
	/** Icon name for peripheral category hint */
	icon: 'Capitol' | 'Building' | 'Users' | 'Mail';
	/** Visual emphasis for color coding */
	emphasis: 'federal' | 'state' | 'local' | 'neutral';
}

/**
 * Visual representation derived from recipient config
 * Optimized for peripheral scanning + recognition
 *
 * Perceptual Design:
 * - Single-level: One row, one color
 * - Multi-level: Vertical stack, each level maintains semantic color
 * - Peripheral detection: Row count = coordination breadth (~150ms recognition)
 */
export type TargetPresentation =
	| {
		/** Single power level */
		type: 'district-based' | 'location-specific' | 'universal';
		/** Primary text: "Your 3 representatives" or "Mayor Breed, SFMTA Board" */
		primary: string;
		/** Secondary text: "+2 more" (if truncated) */
		secondary?: string | null;
		/** Icon name for peripheral category hint */
		icon: 'Capitol' | 'Building' | 'Users' | 'Mail';
		/** Visual emphasis for color coding */
		emphasis: 'federal' | 'state' | 'local' | 'neutral';
		/** Coordination context: "CA-11" or "San Francisco" */
		coordinationContext?: string;
	}
	| {
		/** Multi-stakeholder coordination across power levels */
		type: 'multi-level';
		/** Array of power levels (federal, state, local, etc.) */
		targets: PowerLevelTarget[];
		/** Coordination context: "CA-11" or "San Francisco" */
		coordinationContext?: string;
		/** Primary text for first target (for compatibility) */
		primary?: string;
		/** Secondary text (for compatibility) */
		secondary?: string | null;
		/** Icon for first target (for compatibility) */
		icon?: 'Capitol' | 'Building' | 'Users' | 'Mail';
		/** Emphasis for first target (for compatibility) */
		emphasis?: 'federal' | 'state' | 'local' | 'neutral';
	};

// ============================================================================
// Progressive Template Sections (2025-01-12)
// ============================================================================

/**
 * Geographic precision level for template grouping
 */
export type PrecisionLevel = 'district' | 'city' | 'county' | 'state' | 'nationwide';

/**
 * Template group for section-based display
 * Templates are grouped by geographic precision tier
 */
export interface TemplateGroup {
	/** Section title (e.g., "In Your District", "Nationwide") */
	title: string;

	/** Templates in this tier */
	templates: Template[];

	/** Minimum relevance score for this tier (for internal sorting) */
	minScore: number;

	/** Precision level this group represents */
	level: PrecisionLevel;

	/** Number of people coordinating in this tier (for display) */
	coordinationCount: number;
}

/**
 * Preview card for next unlockable tier
 * Creates desire for next funnel step (GPS → verified address)
 */
export interface NextTierPreview {
	/** Number of templates in next tier */
	count: number;

	/** Geographic level (e.g., "city", "district") */
	level: string;

	/** Call-to-action text */
	cta: string;

	/** Button action text */
	action: string;

	/** Callback when user clicks */
	onClick: () => void;
}
