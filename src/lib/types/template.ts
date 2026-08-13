import type { TemplateScope } from './jurisdiction';
import type { GeoScope, Source } from '$lib/core/agents/types';
import type { InputWindow } from '$lib/core/agents/input-window';
import type { ActiveMessageJob } from '$lib/core/agents/message-job-recovery';
import type { ContactRouteVerdict } from '$lib/core/agents/contact-route-verdict';
import type {
	RouteProvenance,
	SeatRouteVerdict,
	StandingVerdict
} from '$lib/core/agents/seat-route';
import type { DeliveryTier } from '$lib/core/agents/target-class';
import type { GovernmentalClass } from '$lib/core/agents/governmental-class';
import type { TemplateDeliveryMethod } from '$convex/lib/templateDeliveryMethod';
import { parseRecipientConfigObject, recipientRosterFromConfig } from '$convex/lib/recipientRoster';

// ============================================================================
// Power Landscape Types
// ============================================================================

/** Functional role a decision-maker plays in the decision */
export type RoleCategory = 'votes' | 'executes' | 'shapes' | 'funds' | 'oversees';

/** Server-issued proof that a grounded agent result may cross the anonymous detail boundary. */
export interface PublicRecipientProvenance {
	version: 1;
	expiresAt: number;
	signature: string;
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
	recipient_count?: number;
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
	domain: string; // Civic domain synthesized from topics (e.g. "Parking & Municipal Revenue")
	domainHue?: number; // LLM-assigned hue angle (0-360) for domain color encoding
	topics?: string[]; // Topic tags — specific facets of the grievance (1-5 lowercase strings)
	type: string;
	deliveryMethod: TemplateDeliveryMethod;
	subject?: string | null;
	message_body: string;
	sources?: Source[]; // Citation sources from message generation agent
	research_log?: string[]; // Agent's research process log
	delivery_config: unknown; // Json field in database
	cwc_config?: unknown | null; // Json? field in database - was missing
	recipient_config: unknown; // Json field in database
	recipient_count?: number; // Anonymous-safe target cardinality; no addresses or raw config

	// === ORG ENDORSEMENT (Perceptual Bridge) ===
	// When present, the template has organizational backing — institutional provenance
	endorsingOrg?: { name: string; slug: string; avatar: string | null } | null;
	// Coalition endorsements — multiple orgs can endorse the same template
	endorsingOrgs?: Array<{ name: string; slug: string; avatar: string | null }>;
	// Authoritative total; endorsingOrgs is only a bounded newest-first sample.
	endorsementCount?: number;

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

	// Dimensional substrate per template (denormalized at
	// `incrementTemplateReach` time). 30-day rolling rhythm, top-K districts
	// (capped at 500 in storage; consumers truncate), tier breakdown 0-5.
	daily_arrivals?: number[];
	district_counts?: Array<{ code: string; count: number }>;
	district_counts_suppressed_districts?: number;
	district_counts_suppressed_count?: number;
	tier_counts?: number[];

	// Geographic scope (populated by scope-filtering; computed, not stored on the template row)
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
	// Anonymous discovery projections return an empty compatibility array;
	// explicit, uncached detail/send projections may populate it.
	recipientEmails?: string[];

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

	// Standard timestamps
	createdAt: Date | string; // Template creation timestamp
	updatedAt: Date | string; // Template last update timestamp
}

export interface TemplateCreationContext {
	channelId: 'direct' | 'certified' | 'cwc';
	channelTitle: string;
	isCongressional?: boolean;
	features?: Array<{
		icon: unknown;
		text: string;
	}>;
}

export interface TemplateDraftOrigin {
	source: 'studio';
	handoff: 'public-action-template';
	label: string;
	processId: string;
	processTitle: string;
	createdAt: number;
	effect: string;
	sourceRef: string;
	/** Human-readable geographic scope the handing-off process resolved. */
	scopeLabel?: string;
	/** The process's stated basis for that scope; absent when none was resolved. */
	scopeBasis?: string;
}

export interface TemplateFormData {
	objective: {
		rawInput: string; // User's unstructured initial input
		title: string;
		description: string;
		domain: string; // Civic domain from AI (e.g. "School Facilities", "Parking & Municipal Revenue")
		topics?: string[]; // Topic tags from AI — specific facets (1-5 lowercase strings)
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
		/** Subject the author explicitly acknowledged keeping stale DMs for. Suppresses
		 *  the stale banner WITHOUT rewriting resolvedForSubject's true provenance. */
		staleAckForSubject?: string;
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
		/** Subject the author explicitly acknowledged keeping the stale body for.
		 *  Suppresses the stale banner WITHOUT rewriting generatedForSubject. */
		staleAckForSubject?: string;
		/** Active/recoverable message generation job for tab hibernation recovery */
		activeMessageJob?: ActiveMessageJob | null;
		/** Draft-local provenance for resumed route handoffs such as Studio -> public action. */
		draftOrigin?: TemplateDraftOrigin | null;
	};
	review: Record<string, never>; // For validation purposes, no data to store
}

/**
 * The single source of blank-form defaults. Both the citizen creator's fresh
 * draft and the Studio handoff build on this object, so "unset" provably means
 * the same values on both surfaces. Returns a fresh object on every call.
 */
export function createEmptyTemplateFormData(rawInput = ''): TemplateFormData {
	return {
		objective: {
			rawInput,
			title: '',
			description: '',
			domain: '',
			slug: '',
			topics: [],
			voiceSample: '',
			aiGenerated: false
		},
		audience: {
			decisionMakers: [],
			recipientEmails: [],
			includesCongress: false,
			customRecipients: []
		},
		content: {
			preview: '',
			variables: [],
			sources: [],
			researchLog: [],
			geographicScope: null,
			aiGenerated: false,
			edited: false,
			draftOrigin: null
		},
		review: {}
	};
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
	/**
	 * The published deadline for submitting input to this decision maker, as a
	 * standalone fact. It is never folded into `confidence`, never scored, and
	 * never inferred — only a deadline a publisher actually wrote, read back off
	 * the page it was written on, may populate it. Absent means not resolved,
	 * and renderers print that rather than hiding the row's clock.
	 */
	inputWindow?: InputWindow;
	confidence?: number; // Confidence score 0.0-1.0 based on verification
	// Email verification
	emailGrounded?: boolean; // true = email found in grounded search results
	emailSource?: string; // Specific URL where email was found (if grounded)
	emailSourceTitle?: string; // Title of email source page
	/**
	 * Post-resolution registry observation derived only from the final address.
	 * Optional during provider/manual construction; the resolution agent fills it
	 * for every returned candidate before any safety policy may consume it.
	 */
	governmentalClass?: GovernmentalClass;
	/** Server-derived from grounding evidence. Never trusted from client input. */
	deliveryTier?: DeliveryTier;
	seatRoute?: SeatRouteVerdict;
	/** Typed reason this candidate does or does not carry a contact route.
	 *  A category, never a score. Absent on manually added recipients. */
	contactRoute?: ContactRouteVerdict;
	/** What this route is to the decision, plus the basis for saying so.
	 *  A category with a basis, never a score. */
	standing?: StandingVerdict;
	/** How the institution published this address, or the single reason none
	 *  was found. Never combined with `standing`. */
	routeProvenance?: RouteProvenance;
	/** True when the provider proposed an address for this candidate and the
	 *  address did not appear byte-for-byte in any page fetched this run. */
	emailClaimStripped?: boolean;
	/**
	 * MODEL CLAIM about what the address reaches, not a verified fact. A 'person'
	 * claim is uncorroborated and must never be rendered to a recipient or used as
	 * authority to address a named individual.
	 */
	emailReachesClaim?: 'person' | 'seat' | 'general';
	/** Verbatim office/function label, present only when the claim is 'seat' and the label byte-appeared in the grounding page. */
	emailReachesLabel?: string;
	/**
	 * Server-only evidence that this run found the email verbatim in a page it
	 * read. A cached contact may remain useful to the author, but it must not be
	 * granted an anonymous-public recipient attestation from legacy cache state.
	 */
	publicEmailGrounding?: {
		version: 1;
		method: 'page-read';
		source: string;
	};
	/** Free-form notes about alternative contact paths discovered by the agent */
	contactNotes?: string;
	/** true if discovered from page content rather than the initial identity list */
	discovered?: boolean;

	// === Power Landscape fields ===
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
	/** Author-bound, purpose-bound proof for anonymous public recipient projection. */
	publicRecipientProvenance?: PublicRecipientProvenance;

	// === Email Deliverability Verification ===
	/** Email verification status from MX check */
	emailVerified?: 'deliverable' | 'risky';
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

// Citation source from message generation — one definition, shared with the
// agent layer, re-exported here for the template-facing import sites.
export type { Source } from '$lib/core/agents/types';

// The published-deadline clock, defined once in the agent layer and re-exported
// here for the template-facing import sites.
export type { InputWindow } from '$lib/core/agents/input-window';

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
 * A decision-maker as it appears inside a persisted `recipient_config`.
 * Agent-resolved rows carry the full ProcessedDecisionMaker field set;
 * hand-authored rows carry only identity plus a human role label.
 * `name` is the only field guaranteed present.
 */
export type RecipientConfigDecisionMaker = Partial<ProcessedDecisionMaker> & {
	name: string;
	/** Human-readable position label used by hand-authored rows ("Mayor"). */
	role?: string;
	/** Short display name used by hand-authored rows ("Breed"). */
	shortName?: string;
};

/** The `recipient_config` JSON blob persisted on a template. */
export interface RecipientConfig {
	reach?: PowerReach;
	decisionMakers?: RecipientConfigDecisionMaker[];
	emails?: string[];
	cwcRouting?: boolean;
	chambers?: Array<'house' | 'senate'>;
	location?: RecipientLocation;
}

/**
 * Parse an unknown `recipient_config` value — a stored object or a JSON string —
 * into the typed blob. Anything unparseable yields an empty config.
 */
export function parseRecipientConfig(value: unknown): RecipientConfig {
	return parseRecipientConfigObject(value) as RecipientConfig;
}

/**
 * Addresses a persisted `recipient_config` reaches: the union across
 * `recipients`, `decisionMakers`, `customRecipients`, `emails` and
 * `recipientEmails` plus a top-level `email`, trimmed, empties dropped,
 * deduplicated, in first-seen order.
 *
 * The same arithmetic that produces the recipient count a sender is shown, so
 * the mailto `To:` line can never be narrower than the advertised number.
 */
export function recipientEmailsFromConfig(value: unknown): string[] {
	return recipientRosterFromConfig(value);
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

/**
 * An honest relatedness edge between two public templates, as exposed to the
 * client. Endpoints are template ids; embeddings never cross this boundary.
 *
 * - `twin`: a measured semantic twin — mean-centered template cosine that
 *   cleared the calibrated threshold and survived the leave-one-out check.
 *   Drawn solid. `score` is the (conservative) centered-cosine similarity.
 * - `family`: civic-family kinship — the two templates share a domain anchor.
 *   Drawn dashed. Taxonomic, so `score` is absent.
 * - `concept`: a shared tag-concept — the two templates carry tags that cluster
 *   tightly in mean-centered space (synonymous facets folded into one concept).
 *   Additive and subordinate, drawn in a third quiet style. Emitted only for
 *   tight clusters; absent at a corpus too thin to form any.
 */
export interface RelationEdge {
	/** One endpoint template id (the lexically-smaller of the pair). */
	a: string;
	/** The other endpoint template id. */
	b: string;
	/** The kind of relation this edge asserts. */
	kind: 'twin' | 'family' | 'concept';
	/** Centered-cosine similarity for measured twins; omitted for taxonomic kin. */
	score?: number;
}
