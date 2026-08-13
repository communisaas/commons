/**
 * Gemini Decision-Maker Provider — 4-Stage Deterministic Pipeline
 *
 * Resolution using Gemini + Exa Search + Firecrawl:
 * - Phase 1: Role Discovery (structural reasoning, no search)
 * - Phase 2a: Parallel Identity Resolution (direct Exa searches + 1 extraction call)
 * - Stage 1: Parallel Contact Searches (Exa, no Gemini)
 * - Stage 2: Batch Page Selection (1 Gemini call)
 * - Stage 3: Parallel Page Reads (Firecrawl, no Gemini)
 * - Stage 4: Chunked Contact Synthesis (N Gemini calls, 3 identities per chunk)
 *
 * Stage 4 uses generate() with responseSchema for guaranteed JSON structure.
 * Each chunk has one explicitly classified transient retry, then falls back to
 * pre-extracted page email hints on failure. Partial success is preserved.
 *
 * Includes a ResolvedContact cache (14-day TTL) to skip repeat lookups.
 */

import { z } from 'zod';
import { generate, generateWithThoughts, GEMINI_CONFIG, extractTokenUsage } from '../gemini-client';
import {
	sumTokenUsage,
	emptyExternalCounts,
	sumExternalCounts,
	type TokenUsage,
	type ExternalApiCounts
} from '../types';
import {
	ROLE_DISCOVERY_PROMPT,
	buildRoleDiscoveryPrompt,
	IDENTITY_EXTRACTION_PROMPT,
	buildIdentityExtractionPrompt,
	type ResolvedIdentity,
	type CachedContactInfo,
	PAGE_SELECTION_PROMPT,
	buildPageSelectionPrompt,
	CONTACT_SYNTHESIS_PROMPT,
	buildContactSynthesisPrompt,
	renderRecordBlockSection,
	detectOrgTypes,
	generateDomainContext,
	type SynthesisRecordBlockFact
} from '../prompts/decision-maker';
import { getCachedContacts, upsertResolvedContacts, normalizeOrgKey } from '../utils/contact-cache';
import { resolveEmailReachesClaim } from '../utils/email-reaches';
import { capFanout, MAX_DECISION_MAKER_FANOUT } from '../cogs-fanout';
import {
	boundContactHintEmails,
	DECISION_MAKER_PROVIDER_LIMITS,
	truncateUtf8
} from '../provider-call-envelope';
import { selectSeatHopTargets } from '../seat-hop';
import { extractJsonFromGroundingResponse, isSuccessfulExtraction } from '../utils/grounding-json';
import * as exaSearchModule from '../exa-search';
import {
	isUsableContactEmail,
	searchWeb,
	readPage,
	prunePageContent,
	providerUrlLogLabel,
	type ExaPageContent
} from '../exa-search';
import {
	pageRetrievalBlocked,
	pageRetrievalOk,
	type PageRetrievalOutcome
} from '../retrieval-outcome';
import { normalizeContactRouteSource } from '../contact-route-verdict';
import { sanitizeProviderErrorMessage } from '../provider-error';
import { deriveDeliveryTier } from '../target-class';
import { classifyUrl, extractContactHints } from '../agents/decision-maker';
import type { ProcessedDecisionMaker } from '$lib/types/template';
import type {
	DecisionMakerProvider,
	ResolveContext,
	DecisionMakerResult,
	StreamingCallbacks
} from './types';

type ReadPageOutcome = (typeof import('../exa-search'))['readPageOutcome'];

type PageObservationState = {
	fetchedPages: Map<string, ExaPageContent>;
	blockedHosts: Set<string>;
	readSources: Set<string>;
};

function hostFromUrl(url: string): string | undefined {
	try {
		return new URL(url).hostname.toLowerCase() || undefined;
	} catch {
		return undefined;
	}
}

function sourceSetHasHost(sources: ReadonlySet<string>, host: string): boolean {
	for (const source of sources) {
		if (hostFromUrl(source) === host) return true;
	}
	return false;
}

function rememberBlockedHost(state: PageObservationState, url: string): void {
	const host = hostFromUrl(url);
	if (host && !sourceSetHasHost(state.readSources, host)) state.blockedHosts.add(host);
}

function rememberReadSource(state: PageObservationState, url: string): void {
	const source = normalizeContactRouteSource(url);
	if (!source) return;
	state.readSources.add(source);
	const host = hostFromUrl(source);
	if (host) state.blockedHosts.delete(host);
}

/**
 * Records the real Stage-3 producer outcome. A blocked/absent outcome can never
 * enter the byte-grounding corpus; only an ok page becomes a read source.
 */
export function recordContactPageOutcome(
	requestedUrl: string,
	outcome: PageRetrievalOutcome<ExaPageContent>,
	state: PageObservationState
): ExaPageContent | null {
	if (outcome.outcome === 'blocked') {
		rememberBlockedHost(state, requestedUrl);
		return null;
	}
	if (outcome.outcome === 'absent') return null;

	rememberReadSource(state, requestedUrl);
	rememberReadSource(state, outcome.page.url);
	state.fetchedPages.set(requestedUrl, outcome.page);
	return outcome.page;
}

function boundedSynthesisRecordBlocks(
	fact: ExaPageContent['recordBlocks']
): SynthesisRecordBlockFact {
	if (fact.state !== 'present') return fact;

	const records = [
		...fact.value.blocks.map(
			(block) =>
				`${block.address} | ${block.bindingScope} | ${block.names.join(', ') || '(office)'} | ${block.titleLine ?? ''}`
		),
		...fact.value.institutionBoundAddresses.map(
			(address) => `${address} | institution | (office) |`
		)
	];
	const retained = records
		.slice(0, DECISION_MAKER_PROVIDER_LIMITS.maxRecordBlocksPerPage)
		.map((record) => truncateUtf8(record, DECISION_MAKER_PROVIDER_LIMITS.maxRecordBlockBytes));

	return {
		state: 'present',
		value: {
			records: retained,
			truncated:
				fact.value.truncated ||
				records.length > DECISION_MAKER_PROVIDER_LIMITS.maxRecordBlocksPerPage
		}
	};
}

// The production reader always exposes the Fact-backed outcome API. The legacy
// fallback keeps provider adapters that only implement readPage conservative:
// a null page is BLOCKED, never manufactured into an ABSENT observation.
const readPageOutcome: ReadPageOutcome = Reflect.has(exaSearchModule, 'readPageOutcome')
	? (Reflect.get(exaSearchModule, 'readPageOutcome') as ReadPageOutcome)
	: async (url, options) => {
			const page = await readPage(url, options);
			return page
				? pageRetrievalOk(page)
				: pageRetrievalBlocked(url, 'transport', 'legacy_reader_returned_null');
		};

// ============================================================================
// Internal Types
// ============================================================================

/** A discovered role/position from Phase 1 */
interface DiscoveredRole {
	position: string;
	organization: string;
	jurisdiction: string;
	reasoning: string;
	search_query: string;
	guided?: boolean;
}

interface RoleDiscoveryResponse {
	roles: DiscoveredRole[];
}

/** A candidate from Phase 2 (person + contact info) */
interface Candidate {
	name: string;
	title: string;
	organization: string;
	reasoning: string;
	email: string;
	/** URL of the page where the agent read the email */
	email_source?: string;
	/** URL of the page where this person was mentioned (fallback when no email_source) */
	source_url?: string;
	recency_check: string;
	/** Alternative contact info when no email found */
	contact_notes?: string;
	/** Model-declared class of destination reached by the published address */
	reaches?: string;
	/** Verbatim office/function label supplied for a seat claim */
	reaches_label?: string;
	/** true if discovered from page content, not from the input identity list */
	discovered?: boolean;
	/** true if served from ResolvedContact cache — email already verified in prior run */
	cacheHit?: boolean;
}

/** Phase 2a identity resolution response */
interface IdentityResolutionResponse {
	identities: Array<{
		position: string;
		name: string;
		title: string;
		organization: string;
		search_evidence: string;
	}>;
}

interface PersonLookupResponse {
	decision_makers: Candidate[];
	research_summary: string;
}

/** Stage 2: Page selection response from Gemini */
interface PageSelectionResponse {
	page_selections: Array<{
		identity_index: number;
		person_name: string;
		organization: string;
		selected_pages: Array<{ url: string; reason: string; url_hint: string }>;
	}>;
}

// ============================================================================
// Zod Validation Schemas — runtime type guards for LLM JSON output
// ============================================================================

const CandidateSchema = z.object({
	name: z.string(),
	title: z.string(),
	organization: z.string(),
	reasoning: z.string(),
	email: z.string(),
	email_source: z.string().optional(),
	source_url: z.string().optional(),
	recency_check: z.string(),
	contact_notes: z.string().optional(),
	reaches: z.string().optional(),
	reaches_label: z.string().max(160).optional(),
	discovered: z.boolean().optional()
});

const PersonLookupResponseSchema = z.object({
	decision_makers: z.array(CandidateSchema),
	research_summary: z.string()
});

const PageSelectionResponseSchema = z.object({
	page_selections: z
		.array(
			z.object({
				identity_index: z
					.number()
					.int()
					.min(0)
					.max(MAX_DECISION_MAKER_FANOUT - 1),
				person_name: z.string().max(160),
				organization: z.string().max(200),
				selected_pages: z
					.array(
						z.object({
							url: z.string().max(512),
							reason: z.string().max(256),
							url_hint: z.string().max(64)
						})
					)
					.max(2)
			})
		)
		.max(MAX_DECISION_MAKER_FANOUT)
});

/**
 * A page-selection model may rank search hits, but it may not mint new paid
 * destinations. Accept at most two exact, normalized Exa URLs per identity and
 * cap the global unique-URL fanout before any Firecrawl call.
 */
export function allowlistedPageSelections(
	pageSelections: PageSelectionResponse['page_selections'],
	identitySearchResults: Array<{ hits: Array<{ url: string }> }>,
	maxPages: number
): Map<string, Set<number>> {
	const selected = new Map<string, Set<number>>();
	if (!Number.isSafeInteger(maxPages) || maxPages <= 0) return selected;

	const allowedByIdentity = identitySearchResults.map(
		(result) => new Set(result.hits.slice(0, 10).map((hit) => hit.url))
	);
	const acceptedByIdentity = new Map<number, number>();

	for (const selection of pageSelections.slice(0, identitySearchResults.length)) {
		const identityIndex = selection.identity_index;
		if (
			!Number.isSafeInteger(identityIndex) ||
			identityIndex < 0 ||
			identityIndex >= allowedByIdentity.length
		) {
			continue;
		}
		const allowed = allowedByIdentity[identityIndex];
		for (const page of selection.selected_pages.slice(0, 2)) {
			if ((acceptedByIdentity.get(identityIndex) ?? 0) >= 2) break;
			if (!allowed.has(page.url)) continue;
			if (!selected.has(page.url)) {
				if (selected.size >= maxPages) continue;
				selected.set(page.url, new Set());
			}
			const identities = selected.get(page.url)!;
			if (identities.has(identityIndex)) continue;
			identities.add(identityIndex);
			acceptedByIdentity.set(identityIndex, (acceptedByIdentity.get(identityIndex) ?? 0) + 1);
		}
	}

	return selected;
}

/**
 * Gemini-native responseSchema for Stage 4 synthesis.
 * Used with generate() for API-guaranteed JSON structure.
 */
const PERSON_LOOKUP_RESPONSE_SCHEMA = {
	type: 'object' as const,
	properties: {
		decision_makers: {
			type: 'array' as const,
			items: {
				type: 'object' as const,
				properties: {
					name: { type: 'string' as const },
					title: { type: 'string' as const },
					organization: { type: 'string' as const },
					reasoning: { type: 'string' as const },
					email: { type: 'string' as const },
					email_source: { type: 'string' as const },
					source_url: { type: 'string' as const },
					recency_check: { type: 'string' as const },
					contact_notes: { type: 'string' as const },
					reaches: { type: 'string' as const },
					reaches_label: { type: 'string' as const },
					discovered: { type: 'boolean' as const }
				},
				required: ['name', 'title', 'organization', 'reasoning', 'email', 'recency_check']
			}
		},
		research_summary: { type: 'string' as const }
	},
	required: ['decision_makers', 'research_summary']
};

/**
 * Gemini-native responseSchema for Phase 2b query planning.
 * Produces per-identity search strategies — a natural-language query
 * plus an optional list of domains to scope the Exa search to.
 */
const QUERY_PLAN_SCHEMA = {
	type: 'object' as const,
	properties: {
		plans: {
			type: 'array' as const,
			items: {
				type: 'object' as const,
				properties: {
					identity_index: { type: 'integer' as const },
					search_query: { type: 'string' as const },
					include_domains: {
						type: 'array' as const,
						items: { type: 'string' as const }
					},
					reasoning: { type: 'string' as const }
				},
				required: ['identity_index', 'search_query', 'include_domains', 'reasoning']
			}
		}
	},
	required: ['plans']
};

interface QueryPlan {
	identity_index: number;
	search_query: string;
	include_domains: string[];
	reasoning: string;
}

interface QueryPlanResponse {
	plans: QueryPlan[];
}

// ============================================================================
// Phase 2a: Parallel Identity Resolution
// ============================================================================

/**
 * Resolve identities by running parallel Exa searches (one per role)
 * then a single Gemini extraction call to pull names from results.
 *
 * NOT agentic — no function calling loop. Direct API calls + one extraction.
 * Wall clock: ~10s (vs ~40s for the old agentic approach).
 */
async function resolveIdentitiesFromSearch(
	roles: DiscoveredRole[],
	streaming?: StreamingCallbacks,
	signal?: AbortSignal
): Promise<{ identities: ResolvedIdentity[]; tokenUsage?: TokenUsage; exaSearchCount: number }> {
	const currentYear = new Date().getFullYear().toString();
	const currentDate = new Date().toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});

	// 1. Generate search queries — use Phase 1's search_query, fallback to position+org+year
	const queries = roles.map((r) =>
		(r.search_query || `${r.position} ${r.organization} ${currentYear}`).slice(0, 240)
	);

	console.debug(`[gemini-provider] Phase 2a: ${queries.length} parallel identity searches`);

	// 2. Parallel Exa searches — rate limiter handles throttling
	const searchResults = await Promise.allSettled(
		queries.map((q, i) =>
			searchWeb(q, { maxResults: 10, signal }).then((hits) => ({
				role: roles[i],
				hits
			}))
		)
	);

	// Pair each role with its results (empty array on failure)
	const roleResults = searchResults.map((result, i) => {
		if (result.status === 'fulfilled') {
			return {
				role: result.value.role,
				hits: result.value.hits.slice(0, 10).map((hit) => ({
					...hit,
					title: hit.title.slice(0, 240),
					url: hit.url.slice(0, 512)
				}))
			};
		}
		console.warn(
			`[gemini-provider] Phase 2a search failed for roleIndex=${i}:`,
			sanitizeProviderErrorMessage(result.reason)
		);
		return {
			role: roles[i],
			hits: [] as { url: string; title: string; publishedDate?: string; score?: number }[]
		};
	});

	const totalHits = roleResults.reduce((sum, rr) => sum + rr.hits.length, 0);
	console.debug(
		`[gemini-provider] Phase 2a: ${totalHits} total search hits across ${roles.length} roles`
	);

	if (signal?.aborted) {
		console.warn('[gemini-provider] Phase 2a aborted after searches');
		return {
			identities: roles.map((r) => ({
				position: r.position,
				name: 'UNKNOWN',
				title: r.position,
				organization: r.organization,
				search_evidence: 'Aborted before extraction'
			})),
			exaSearchCount: queries.length
		};
	}

	// 3. Single extraction call — generateWithThoughts, NOT agentic
	const extractionPrompt = buildIdentityExtractionPrompt(roleResults);
	const systemPrompt = IDENTITY_EXTRACTION_PROMPT.replace(/{CURRENT_DATE}/g, currentDate);

	console.debug('[gemini-provider] Phase 2a: Identity extraction call');

	const extractionResult = await generateWithThoughts<IdentityResolutionResponse>(
		extractionPrompt,
		{
			stage: 'decision-identity-extraction',
			systemInstruction: systemPrompt,
			temperature: 0.1,
			thinkingLevel: 'low',
			signal
		},
		streaming?.onThought ? (thought) => streaming.onThought!(thought, 'identity') : undefined
	);

	// 4. Parse + fallback
	const extraction = extractJsonFromGroundingResponse<IdentityResolutionResponse>(
		extractionResult.rawText || '{}'
	);

	if (isSuccessfulExtraction(extraction) && extraction.data?.identities?.length > 0) {
		const extractedIdentities = extraction.data.identities;
		const identities = normalizeAndCapIdentityFanout(extractedIdentities, roles.length);
		if (identities.length < extractedIdentities.length) {
			console.warn(
				`[gemini-provider] COGS-fanout guard: capped ${extractedIdentities.length} extracted identities → ${identities.length} (max ${Math.min(roles.length, MAX_DECISION_MAKER_FANOUT)})`
			);
		}
		console.debug(`[gemini-provider] Phase 2a extracted ${identities.length} identities`);
		return { identities, tokenUsage: extractionResult.tokenUsage, exaSearchCount: queries.length };
	}

	// Fallback: UNKNOWN identities from roles
	console.warn('[gemini-provider] Phase 2a extraction failed, falling back to UNKNOWN identities');
	return {
		identities: roles.map((r) => ({
			position: r.position,
			name: 'UNKNOWN',
			title: r.position,
			organization: r.organization,
			search_evidence: 'Identity extraction failed — using position from Phase 1'
		})),
		tokenUsage: extractionResult.tokenUsage,
		exaSearchCount: queries.length
	};
}

// ============================================================================
// Helpers — Shared utilities
// ============================================================================

/** Sentinel names that LLMs return instead of the instructed "UNKNOWN" string. */
const SENTINEL_NAMES = new Set([
	'vacant',
	'tbd',
	'n/a',
	'none',
	'open',
	'unfilled',
	'position open',
	'to be determined',
	'not available',
	'not found',
	'pending',
	'empty'
]);

/** Returns true if a name is a sentinel / non-person value that should be treated as UNKNOWN. */
export function isSentinelName(name: string): boolean {
	const normalized = name.toLowerCase().replace(/\s+/g, ' ').trim();
	return !normalized || normalized === 'unknown' || SENTINEL_NAMES.has(normalized);
}

/**
 * Normalize model-extracted identities and enforce the reviewed downstream
 * fanout at the untrusted model-output boundary. Phase 1 roles are capped too,
 * but the extraction model can return more rows than it received; allowing
 * those rows through would escape the exact provider-call reservation.
 */
export function normalizeAndCapIdentityFanout(
	identities: ResolvedIdentity[],
	roleCount: number
): ResolvedIdentity[] {
	if (!Number.isSafeInteger(roleCount) || roleCount < 0) {
		throw new RangeError('role count is outside the reviewed identity fanout');
	}
	const maxIdentities = Math.min(roleCount, MAX_DECISION_MAKER_FANOUT);
	return identities.slice(0, maxIdentities).map((id) => {
		if (isSentinelName(id.name)) {
			if (id.name !== 'UNKNOWN') {
				console.debug('[gemini-provider] Normalizing model-provided sentinel identity to UNKNOWN');
			}
			return { ...id, name: 'UNKNOWN' };
		}
		return id;
	});
}

/** Match Phase 1 reasoning to an identity by position+org, then org, then index */
function matchRoleReasoning(
	identity: ResolvedIdentity,
	roles: DiscoveredRole[],
	index: number
): string {
	return (
		roles.find(
			(r) =>
				r.position.toLowerCase() === identity.position.toLowerCase() &&
				r.organization.toLowerCase() === identity.organization.toLowerCase()
		)?.reasoning ||
		roles.find((r) => r.organization.toLowerCase() === identity.organization.toLowerCase())
			?.reasoning ||
		roles[index]?.reasoning ||
		''
	);
}

// ============================================================================
// Phase 2b (v2): Fan-Out + Synthesize — 4 deterministic stages
// ============================================================================

/**
 * Fallback: assign best-available email from pre-extracted page hints.
 * Used when synthesis parse fails for a chunk after retry.
 */
function fallbackFromPageHints(
	identity: ResolvedIdentity,
	globalIdx: number,
	reasoning: string,
	pages: Array<{
		url: string;
		title: string;
		text: string;
		contactHints: { emails: string[]; phones: string[]; socialUrls: string[] };
		attributedTo: number[];
	}>
): Candidate {
	// Primary: emails from pages attributed to this identity
	const hintEmails: string[] = [];
	for (const page of pages) {
		if (page.attributedTo.includes(globalIdx) && page.contactHints.emails.length > 0) {
			hintEmails.push(...page.contactHints.emails);
		}
	}
	// Secondary: emails from pages whose domain matches significant org words
	if (hintEmails.length === 0) {
		const orgWords = identity.organization
			.toLowerCase()
			.split(/\s+/)
			.filter((w) => w.length > 3);
		for (const page of pages) {
			if (page.contactHints.emails.length > 0) {
				let hostname = '';
				try {
					hostname = new URL(page.url).hostname.replace(/^www\./, '');
				} catch {
					/* skip */
				}
				const domainMatch =
					orgWords.some((w) => hostname.includes(w)) ||
					hostname
						.split('.')
						.some((part) => part.length > 3 && orgWords.some((w) => w.includes(part)));
				if (domainMatch) {
					hintEmails.push(...page.contactHints.emails);
				}
			}
		}
	}
	const bestEmail = hintEmails[0] || '';
	const emailSource = bestEmail
		? pages.find((p) => p.contactHints.emails.includes(bestEmail))?.url || ''
		: '';

	return {
		name: identity.name,
		title: identity.title,
		organization: identity.organization,
		reasoning,
		email: bestEmail,
		email_source: emailSource,
		recency_check: '',
		contact_notes: bestEmail
			? 'Contact extracted from page hints (synthesis fallback)'
			: 'Contact synthesis failed — no emails found in page hints'
	};
}

/**
 * Deterministic contact resolution pipeline.
 *
 * Replaces N parallel ReAct agent loops with 4 stages:
 * 1. Parallel contact searches (Exa, no Gemini)
 * 2. Batch page selection (1 Gemini call)
 * 3. Parallel page reads (Firecrawl, no Gemini)
 * 4. Chunked contact synthesis (N Gemini calls, 3 identities per chunk)
 *
 * Primary contact resolution pipeline.
 */
async function huntContactsFanOutSynthesize(
	identities: ResolvedIdentity[],
	cachedContacts: CachedContactInfo[],
	roles: DiscoveredRole[],
	issueContext?: { subjectLine: string; coreMessage: string; topics: string[] },
	streaming?: StreamingCallbacks,
	signal?: AbortSignal,
	/** Called per-identity as each candidate is resolved (for progressive UI streaming) */
	onCandidateProcessed?: (candidate: Candidate, fetchedPages: ExaPageContent[]) => void
): Promise<{
	candidates: Candidate[];
	fetchedPages: Map<string, ExaPageContent>;
	blockedHosts: Set<string>;
	readSources: Set<string>;
	tokenUsage?: TokenUsage;
	externalCounts: ExternalApiCounts;
}> {
	const currentYear = new Date().getFullYear().toString();
	const currentDate = new Date().toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});
	const tokenUsages: (TokenUsage | undefined)[] = [];
	const extCounts = emptyExternalCounts();
	const fetchedPages = new Map<string, ExaPageContent>();
	const blockedHosts = new Set<string>();
	const readSources = new Set<string>();
	const pageObservationState = { fetchedPages, blockedHosts, readSources };

	// Streaming thought helper
	const onThought = streaming?.onThought
		? (thought: string) => streaming.onThought!(thought, 'contact')
		: undefined;

	// ================================================================
	// Cache separation (same as old function)
	// ================================================================

	const cacheMap = new Map<string, CachedContactInfo>();
	for (const c of cachedContacts) {
		if (c.title && c.email) {
			cacheMap.set(`${c.orgKey}::${c.title.toLowerCase()}`, c);
		}
	}

	const uncached: Array<{ identity: ResolvedIdentity; reasoning: string }> = [];
	const cachedCandidates: Candidate[] = [];

	for (let i = 0; i < identities.length; i++) {
		const identity = identities[i];
		const orgKey = normalizeOrgKey(identity.organization);
		const cached = cacheMap.get(`${orgKey}::${identity.title.toLowerCase()}`);
		const roleReasoning = matchRoleReasoning(identity, roles, i);

		if (cached?.email) {
			cachedCandidates.push({
				name: cached.name || identity.name,
				title: cached.title || identity.title,
				organization: identity.organization,
				reasoning: roleReasoning,
				email: cached.email,
				email_source: cached.emailSource || undefined,
				recency_check: `Cached contact (verified in prior run)`,
				contact_notes: '',
				cacheHit: true
			});
		} else {
			uncached.push({ identity, reasoning: roleReasoning });
		}
	}

	console.debug(
		`[gemini-provider] Fan-out: ${cachedCandidates.length} cached, ${uncached.length} uncached`
	);

	// Emit cached contacts immediately
	if (onCandidateProcessed) {
		for (const cached of cachedCandidates) {
			onCandidateProcessed(cached, []);
		}
	}

	// All cached — return early
	if (uncached.length === 0) {
		console.debug('[gemini-provider] Fan-out: all identities cached, returning early');
		return {
			candidates: cachedCandidates,
			fetchedPages,
			blockedHosts,
			readSources,
			tokenUsage: undefined,
			externalCounts: extCounts
		};
	}

	// ================================================================
	// Stage 1: Parallel Contact Searches (~3s)
	// ================================================================

	if (signal?.aborted) {
		return {
			candidates: cachedCandidates,
			fetchedPages,
			blockedHosts,
			readSources,
			tokenUsage: sumTokenUsage(...tokenUsages),
			externalCounts: extCounts
		};
	}

	onThought?.(`Searching for contact information across ${uncached.length} positions...`);
	console.debug(`[gemini-provider] Stage 1: ${uncached.length} parallel contact searches`);

	// Template fallback query builder — used when planning fails or a plan is malformed
	const buildFallbackQuery = (identity: ResolvedIdentity): string => {
		const isUnknown = identity.name === 'UNKNOWN';
		if (isUnknown) {
			return `"${identity.title}" "${identity.organization}" contact email ${currentYear}`;
		}
		return `"${identity.name}" "${identity.organization}" contact email`;
	};

	// ================================================================
	// Phase 2b: Query Planning (1 Gemini call)
	// ================================================================
	// Ask the model to compose per-identity search queries + optional
	// domain filters based on how each organization type surfaces
	// contact information. Falls back to the rigid template on failure.

	const planningSystem = `You plan web searches that will surface a decision-maker's official contact email.

For each identity, produce:
- search_query: a natural-language query tuned to how THIS organization type publishes contact info. Can include the person's name + context. Freed from the rigid "contact email" phrasing when a different phrasing fits better (e.g. "contact the senator", "office staff", "media inquiries").
- include_domains: an OPTIONAL list of domains to scope the search to. Return an empty array when unsure — the domain filter is optional, not mandatory.
- reasoning: one sentence on why this strategy fits.

How different organization types surface contact info:
- US senators: personal {firstname}{lastname}.senate.gov subdomains have /contact pages. Use include_domains like ["{lastname}.senate.gov", "senate.gov"].
- US House reps: {lastname}.house.gov subdomains. Use include_domains like ["{lastname}.house.gov", "house.gov"].
- US federal agencies (EPA, DOJ, HHS, etc.): leadership pages on the main .gov site. Use include_domains like ["epa.gov"] or the agency's domain.
- US state governors / state legislators: official state government sites (e.g. "governor.state.xx.us", "state.xx.us", "{state}legislature.gov").
- Canadian MPs / federal Ministers: parl.gc.ca has member contact pages. Use include_domains like ["ourcommons.ca", "parl.gc.ca"].
- Canadian provincial officials (MLAs, MPPs, MNAs): provincial legislature sites.
- UK MPs: parliament.uk member pages. Use include_domains like ["parliament.uk"].
- Corporate execs: company investor relations, SEC filings (sec.gov), LinkedIn. Use include_domains like ["{company}.com", "sec.gov"] when confident.
- Nonprofits: the org's own /about/leadership or /team page. Use the org's domain when you can infer it confidently.
- University officials: the institution's .edu domain.
- Journalists / editors: the publication's own domain.

Rules:
- Return EXACTLY one plan per identity, in order, with identity_index matching the input index (0-based).
- When you are NOT confident about the specific domain, return an empty include_domains array. A bad domain filter is worse than no filter.
- Keep search_query concise (under 120 chars).`;

	const planningUser =
		`Plan search queries for these ${uncached.length} identities:\n\n` +
		uncached
			.map((entry, i) => {
				const { identity } = entry;
				const nameStr = identity.name === 'UNKNOWN' ? '(name unknown)' : identity.name;
				return `[${i}] ${nameStr} — ${identity.title} @ ${identity.organization}`;
			})
			.join('\n');

	const planByIndex = new Map<number, QueryPlan>();
	try {
		const planResponse = await generate(planningUser, {
			stage: 'decision-query-planning',
			systemInstruction: planningSystem,
			temperature: 0.3,
			thinkingLevel: 'low',
			responseSchema: QUERY_PLAN_SCHEMA,
			signal
		});
		tokenUsages.push(extractTokenUsage(planResponse));

		const planText = planResponse.text || '{}';
		const parsedPlan = JSON.parse(planText) as QueryPlanResponse;

		if (Array.isArray(parsedPlan.plans)) {
			for (const plan of parsedPlan.plans) {
				// Validate each plan shape — malformed entries are dropped, not fatal
				if (
					plan &&
					Number.isInteger(plan.identity_index) &&
					plan.identity_index >= 0 &&
					plan.identity_index < uncached.length &&
					typeof plan.search_query === 'string' &&
					plan.search_query.trim().length > 0 &&
					Array.isArray(plan.include_domains)
				) {
					planByIndex.set(plan.identity_index, plan);
				}
			}
		}

		console.debug(
			`[gemini-provider] Phase 2b: planned ${planByIndex.size}/${uncached.length} queries`
		);
	} catch (err) {
		console.warn(
			'[gemini-provider] Phase 2b query planning failed, falling back to template queries:',
			sanitizeProviderErrorMessage(err)
		);
	}

	// Build per-identity search queries — use plan when available, template otherwise
	const searchPlans = uncached.map((entry, i) => {
		const plan = planByIndex.get(i);
		if (plan) {
			const includeDomains = plan.include_domains
				.filter((d) => typeof d === 'string' && d.trim().length > 0)
				.slice(0, 5)
				.map((domain) => domain.slice(0, 253));
			return {
				query: plan.search_query.slice(0, 120),
				includeDomains: includeDomains.length > 0 ? includeDomains : undefined
			};
		}
		return {
			query: buildFallbackQuery(entry.identity),
			includeDomains: undefined as string[] | undefined
		};
	});
	const searchQueries = searchPlans.map((p) => p.query);

	const searchResults = await Promise.allSettled(
		searchPlans.map((p) =>
			searchWeb(
				p.query,
				p.includeDomains
					? { maxResults: 10, includeDomains: p.includeDomains, signal }
					: { maxResults: 10, signal }
			)
		)
	);

	// Pair search results with identity info, classify URLs
	const identitySearchResults: Array<{
		identity: ResolvedIdentity;
		reasoning: string;
		hits: Array<{
			url: string;
			title: string;
			publishedDate?: string;
			score?: number;
			url_hint: string;
		}>;
	}> = uncached.map((entry, i) => {
		const result = searchResults[i];
		const rawHits = result.status === 'fulfilled' ? result.value : [];
		if (result.status === 'rejected') {
			console.warn(
				`[gemini-provider] Stage 1 search failed for identityIndex=${i}:`,
				sanitizeProviderErrorMessage(result.reason)
			);
		}
		const hits = rawHits.slice(0, 10).map((h) => ({
			url: h.url.slice(0, 512),
			title: h.title.slice(0, 240),
			publishedDate: h.publishedDate,
			score: h.score,
			url_hint: classifyUrl(h.url)
		}));
		return {
			identity: entry.identity,
			reasoning: entry.reasoning,
			hits
		};
	});

	extCounts.exaSearches += searchQueries.length;
	const totalHits = identitySearchResults.reduce((sum, isr) => sum + isr.hits.length, 0);
	console.debug(
		`[gemini-provider] Stage 1 complete: ${totalHits} total hits across ${uncached.length} searches`
	);
	onThought?.(
		`Found ${totalHits} potential sources. Selecting the most promising pages to read...`
	);

	// ================================================================
	// Stage 2: Page Selection (1 Gemini call, ~3-5s)
	// ================================================================

	if (signal?.aborted) {
		return {
			candidates: cachedCandidates,
			fetchedPages,
			blockedHosts,
			readSources,
			tokenUsage: sumTokenUsage(...tokenUsages),
			externalCounts: extCounts
		};
	}

	const MAX_PAGES_TOTAL = Math.min(
		uncached.length * 2,
		DECISION_MAKER_PROVIDER_LIMITS.maxPagesTotal
	);

	const pageSelectionSystem = PAGE_SELECTION_PROMPT.replace(/{CURRENT_DATE}/g, currentDate).replace(
		/{MAX_PAGES_TOTAL}/g,
		String(MAX_PAGES_TOTAL)
	);
	const pageSelectionUser = buildPageSelectionPrompt(identitySearchResults);

	console.debug(
		`[gemini-provider] Stage 2: Page selection call (budget: ${MAX_PAGES_TOTAL} pages)`
	);

	const selectionResult = await generateWithThoughts<PageSelectionResponse>(
		pageSelectionUser,
		{
			stage: 'decision-page-selection',
			systemInstruction: pageSelectionSystem,
			temperature: 0.1,
			thinkingLevel: 'low',
			signal
		},
		onThought
	);
	tokenUsages.push(selectionResult.tokenUsage);

	const selectionExtraction = extractJsonFromGroundingResponse<PageSelectionResponse>(
		selectionResult.rawText || '{}',
		PageSelectionResponseSchema
	);

	// Build URL → identity indices map (same page attributed to multiple identities, fetched once)
	const urlToIdentities = new Map<string, Set<number>>();

	if (
		isSuccessfulExtraction(selectionExtraction) &&
		selectionExtraction.data?.page_selections?.length > 0
	) {
		// Parse successful — Gemini may rank exact Exa hits but cannot mint a new
		// destination or expand the reviewed per-identity/global fetch envelope.
		const allowlisted = allowlistedPageSelections(
			selectionExtraction.data.page_selections,
			identitySearchResults,
			MAX_PAGES_TOTAL
		);
		for (const [url, identityIndexes] of allowlisted) {
			urlToIdentities.set(url, identityIndexes);
		}
		console.debug(`[gemini-provider] Stage 2: Gemini selected ${urlToIdentities.size} unique URLs`);
	} else {
		// Fallback: select top 2 contact/about/press pages per identity
		console.warn('[gemini-provider] Stage 2: Page selection parse failed, using fallback');
		for (let i = 0; i < identitySearchResults.length; i++) {
			const priorityHints = new Set(['contact_page', 'about_page', 'press_page']);
			const priorityHits = identitySearchResults[i].hits
				.filter((h) => priorityHints.has(h.url_hint))
				.slice(0, 2);

			// If not enough priority hits, fill with any hits
			const fallbackHits =
				priorityHits.length < 2
					? identitySearchResults[i].hits
							.filter((h) => !priorityHints.has(h.url_hint))
							.slice(0, 2 - priorityHits.length)
					: [];

			for (const h of [...priorityHits, ...fallbackHits]) {
				if (!urlToIdentities.has(h.url)) {
					urlToIdentities.set(h.url, new Set());
				}
				urlToIdentities.get(h.url)!.add(i);
			}
		}
		console.debug(`[gemini-provider] Stage 2 fallback: ${urlToIdentities.size} unique URLs`);
	}

	// Slice to MAX_PAGES_TOTAL unique URLs
	const selectedUrls = Array.from(urlToIdentities.keys()).slice(0, MAX_PAGES_TOTAL);
	const selectedUrlToIdentities = new Map<string, Set<number>>();
	for (const url of selectedUrls) {
		selectedUrlToIdentities.set(url, urlToIdentities.get(url)!);
	}

	console.debug(
		`[gemini-provider] Stage 2 final: ${selectedUrls.length} URLs to fetch (budget: ${MAX_PAGES_TOTAL})`
	);

	// ================================================================
	// Stage 3: Parallel Page Reads (~5-8s)
	// ================================================================

	if (signal?.aborted) {
		return {
			candidates: cachedCandidates,
			fetchedPages,
			blockedHosts,
			readSources,
			tokenUsage: sumTokenUsage(...tokenUsages),
			externalCounts: extCounts
		};
	}

	onThought?.(`Reading ${selectedUrls.length} pages for contact details...`);
	console.debug(`[gemini-provider] Stage 3: ${selectedUrls.length} parallel page reads`);

	// Full page content for grounding; prunePageContent() trims for Gemini.
	extCounts.firecrawlReads += selectedUrls.length;
	const pageReadResults = await Promise.allSettled(
		selectedUrls.map((url) => readPageOutcome(url, { signal }))
	);

	// Build identity name list for contact-priority pruning
	const identityNamesForPruning = uncached
		.map((u) => u.identity.name)
		.filter((n) => n !== 'UNKNOWN');

	const pagesForSynthesis: Array<{
		url: string;
		title: string;
		text: string;
		recordBlocks: ExaPageContent['recordBlocks'];
		contactHints: { emails: string[]; phones: string[]; socialUrls: string[] };
		attributedTo: number[];
	}> = [];

	for (let i = 0; i < selectedUrls.length; i++) {
		const url = selectedUrls[i];
		const result = pageReadResults[i];

		if (result.status === 'rejected') {
			recordContactPageOutcome(
				url,
				pageRetrievalBlocked(url, 'transport', 'page_read_rejected'),
				pageObservationState
			);
			console.warn(`[gemini-provider] Stage 3: Page read failed for ${providerUrlLogLabel(url)}`);
			continue;
		}

		const outcome = result.value;
		const page = recordContactPageOutcome(url, outcome, pageObservationState);
		if (outcome.outcome === 'blocked') {
			console.debug(
				`[gemini-provider] Stage 3: Retrieval blocked for ${providerUrlLogLabel(url)}${'signal' in outcome ? ` (vendor=${outcome.signal.vendor})` : ''}`
			);
			continue;
		}
		if (outcome.outcome === 'absent') {
			console.debug(`[gemini-provider] Stage 3: No content for ${providerUrlLogLabel(url)}`);
			continue;
		}
		if (!page) continue;

		// Extract contact hints from full text (before pruning)
		const contactHints = extractContactHints(page.text);

		// Prune for synthesis prompt — Gemini gets cleaner signal
		const prunedText = prunePageContent(page.text, identityNamesForPruning);

		// Track identity attribution from Stage 2
		const attributedTo = Array.from(selectedUrlToIdentities.get(url) || []);

		pagesForSynthesis.push({
			url: page.url,
			title: page.title,
			text: prunedText,
			recordBlocks: page.recordBlocks,
			contactHints,
			attributedTo
		});
	}

	console.debug(
		`[gemini-provider] Stage 3 complete: ${pagesForSynthesis.length} pages readable, ${fetchedPages.size} stored`
	);
	onThought?.(`Retrieved ${pagesForSynthesis.length} pages. Analyzing contacts...`);

	// Stage 3b: for identities still missing a usable email, follow at most one
	// same-host link that was present in this run's retrieved link graph.
	if (!signal?.aborted && pagesForSynthesis.length > 0) {
		const linksByUrl = new Map<string, readonly string[]>();
		for (const page of fetchedPages.values()) {
			// Preserve R1's three link-graph facts: an absent field means no graph was
			// produced, while a present empty array means it was produced with no links.
			if (page.links !== undefined) linksByUrl.set(page.url, page.links);
		}

		const seatHopTargets = selectSeatHopTargets({
			pages: pagesForSynthesis,
			linksByUrl,
			alreadyFetchedUrls: new Set(fetchedPages.keys()),
			identityCount: uncached.length,
			maxTargets: DECISION_MAKER_PROVIDER_LIMITS.maxSeatHopPages
		});

		if (seatHopTargets.length > 0) {
			extCounts.firecrawlReads += seatHopTargets.length;
			const seatHopReadResults = await Promise.allSettled(
				seatHopTargets.map((target) => readPageOutcome(target.url, { signal }))
			);

			for (let i = 0; i < seatHopTargets.length; i++) {
				const target = seatHopTargets[i];
				const result = seatHopReadResults[i];
				if (result.status === 'rejected') {
					recordContactPageOutcome(
						target.url,
						pageRetrievalBlocked(target.url, 'transport', 'page_read_rejected'),
						pageObservationState
					);
					console.warn(
						`[gemini-provider] Stage 3b: Page read failed for ${providerUrlLogLabel(target.url)}`
					);
					continue;
				}

				const outcome = result.value;
				const page = recordContactPageOutcome(target.url, outcome, pageObservationState);
				if (outcome.outcome === 'blocked') {
					console.debug(
						`[gemini-provider] Stage 3b: Retrieval blocked for ${providerUrlLogLabel(target.url)}${'signal' in outcome ? ` (vendor=${outcome.signal.vendor})` : ''}`
					);
					continue;
				}
				if (outcome.outcome === 'absent') {
					console.debug(
						`[gemini-provider] Stage 3b: No content for ${providerUrlLogLabel(target.url)}`
					);
					continue;
				}
				if (!page) continue;
				pagesForSynthesis.push({
					url: page.url,
					title: page.title,
					text: prunePageContent(page.text, identityNamesForPruning),
					recordBlocks: page.recordBlocks,
					contactHints: extractContactHints(page.text),
					attributedTo: target.identityIndexes
				});
			}
		}
	}

	// If zero pages readable: return all uncached identities as no-email candidates
	if (pagesForSynthesis.length === 0) {
		console.warn('[gemini-provider] Stage 3: Zero pages readable — returning no-email candidates');
		const noEmailCandidates: Candidate[] = uncached.map(({ identity, reasoning }, index) => {
			const sourceUrl = selectedUrls.find((url) => selectedUrlToIdentities.get(url)?.has(index));
			return {
				name: identity.name,
				title: identity.title,
				organization: identity.organization,
				reasoning,
				email: '',
				...(sourceUrl ? { source_url: sourceUrl } : {}),
				recency_check: '',
				contact_notes: 'No pages could be read — try again later.'
			};
		});

		if (onCandidateProcessed) {
			for (const candidate of noEmailCandidates) {
				onCandidateProcessed(candidate, []);
			}
		}

		return {
			candidates: [...cachedCandidates, ...noEmailCandidates],
			fetchedPages,
			blockedHosts,
			readSources,
			tokenUsage: sumTokenUsage(...tokenUsages),
			externalCounts: extCounts
		};
	}

	// ================================================================
	// Stage 4: Chunked Synthesis (N Gemini calls, ~5-8s each)
	// ================================================================

	if (signal?.aborted) {
		return {
			candidates: cachedCandidates,
			fetchedPages,
			blockedHosts,
			readSources,
			tokenUsage: sumTokenUsage(...tokenUsages),
			externalCounts: extCounts
		};
	}

	const SYNTHESIS_CHUNK_SIZE = DECISION_MAKER_PROVIDER_LIMITS.synthesisChunkSize;
	const domainContext = generateDomainContext(
		detectOrgTypes(uncached.map((u) => u.identity.organization))
	);
	const synthesisSystem = CONTACT_SYNTHESIS_PROMPT.replace(/{CURRENT_DATE}/g, currentDate).replace(
		/{DOMAIN_CONTEXT}/g,
		domainContext || ''
	);

	// Partition uncached identities into chunks
	const chunks: Array<typeof uncached> = [];
	for (let i = 0; i < uncached.length; i += SYNTHESIS_CHUNK_SIZE) {
		chunks.push(uncached.slice(i, i + SYNTHESIS_CHUNK_SIZE));
	}

	console.debug(
		`[gemini-provider] Stage 4: ${chunks.length} parallel synthesis chunk(s) for ${uncached.length} identities`
	);

	const allPages = Array.from(fetchedPages.values());

	// Build per-chunk work items (prompt + page subset + identity mapping)
	const chunkWork = chunks.map((chunk, chunkIdx) => {
		const globalStartIdx = chunkIdx * SYNTHESIS_CHUNK_SIZE;
		const chunkGlobalIndices = chunk.map((_, i) => globalStartIdx + i);

		const attributedPages = pagesForSynthesis.filter(
			(p) =>
				p.attributedTo.length === 0 ||
				p.attributedTo.some((idx) => chunkGlobalIndices.includes(idx))
		);
		const chunkPages = [
			...attributedPages.filter((p) => p.contactHints.emails.some(isUsableContactEmail)),
			...attributedPages.filter((p) => !p.contactHints.emails.some(isUsableContactEmail))
		]
			.slice(0, DECISION_MAKER_PROVIDER_LIMITS.maxPagesPerSynthesisChunk)
			.map((p) => {
				const recordBlocks = boundedSynthesisRecordBlocks(p.recordBlocks);
				const recordSectionBytes = Math.min(
					DECISION_MAKER_PROVIDER_LIMITS.maxPageBytesPerSynthesisChunk,
					new TextEncoder().encode(renderRecordBlockSection(recordBlocks)).byteLength
				);
				return {
					...p,
					url: truncateUtf8(p.url, 512),
					title: truncateUtf8(p.title, 240),
					text: truncateUtf8(
						p.text,
						DECISION_MAKER_PROVIDER_LIMITS.maxPageBytesPerSynthesisChunk - recordSectionBytes
					),
					recordBlocks,
					contactHints: {
						emails: boundContactHintEmails(p.contactHints.emails),
						phones: p.contactHints.phones
							.slice(0, DECISION_MAKER_PROVIDER_LIMITS.maxContactHintPhonesPerPage)
							.map((value) => truncateUtf8(value, DECISION_MAKER_PROVIDER_LIMITS.maxPhoneBytes)),
						socialUrls: p.contactHints.socialUrls
							.slice(0, DECISION_MAKER_PROVIDER_LIMITS.maxContactHintSocialUrlsPerPage)
							.map((value) => truncateUtf8(value, DECISION_MAKER_PROVIDER_LIMITS.maxSocialUrlBytes))
					},
					attributedTo: p.attributedTo
						.filter((idx) => chunkGlobalIndices.includes(idx))
						.map((idx) => idx - globalStartIdx)
				};
			});

		const synthesisUser = buildContactSynthesisPrompt(
			chunk.map((u) => ({
				identity: {
					...u.identity,
					name: truncateUtf8(u.identity.name, 256),
					title: truncateUtf8(u.identity.title, 512),
					organization: truncateUtf8(u.identity.organization, 512),
					search_evidence: truncateUtf8(u.identity.search_evidence, 1_024)
				},
				reasoning: truncateUtf8(u.reasoning, 1_024)
			})),
			chunkPages,
			issueContext
				? {
						...issueContext,
						subjectLine: truncateUtf8(issueContext.subjectLine, 800),
						coreMessage: truncateUtf8(
							issueContext.coreMessage,
							DECISION_MAKER_PROVIDER_LIMITS.maxIssueCoreMessageBytes
						),
						topics: issueContext.topics
							.slice(0, DECISION_MAKER_PROVIDER_LIMITS.maxIssueTopics)
							.map((topic) => truncateUtf8(topic, 256))
					}
				: undefined
		);

		return { chunk, chunkIdx, globalStartIdx, chunkPages, synthesisUser };
	});

	// Fire all chunks in parallel — each emits candidates immediately on completion
	const synthesizedCandidates: Candidate[] = [];
	let chunksComplete = 0;

	onThought?.(`Verifying contact details across ${pagesForSynthesis.length} sources...`);

	await Promise.allSettled(
		chunkWork.map(async ({ chunk, chunkIdx, globalStartIdx, synthesisUser }) => {
			if (signal?.aborted) return;

			console.debug(
				`[gemini-provider] Stage 4 chunk ${chunkIdx + 1}/${chunks.length}: ${chunk.length} identities`
			);

			let candidates: Candidate[];

			try {
				const response = await generate(synthesisUser, {
					stage: 'decision-contact-synthesis',
					systemInstruction: synthesisSystem,
					temperature: 0.2,
					thinkingLevel: 'low',
					responseSchema: PERSON_LOOKUP_RESPONSE_SCHEMA,
					signal
				});
				tokenUsages.push(extractTokenUsage(response));

				const responseText = response.text || '{}';
				const parsed = JSON.parse(responseText) as PersonLookupResponse;

				if (parsed.decision_makers?.length > 0) {
					console.debug(
						`[gemini-provider] Stage 4 chunk ${chunkIdx + 1}: synthesized ${parsed.decision_makers.length} candidates`
					);
					candidates = parsed.decision_makers
						.slice(0, DECISION_MAKER_PROVIDER_LIMITS.maxCandidatesPerSynthesisChunk)
						.flatMap((candidate) => {
							const validated = CandidateSchema.safeParse(candidate);
							return validated.success ? [validated.data] : [];
						});
				} else {
					console.debug(
						`[gemini-provider] Stage 4 chunk ${chunkIdx + 1}: model returned 0 candidates`
					);
					candidates = [];
				}
			} catch (err) {
				console.warn(
					`[gemini-provider] Stage 4 chunk ${chunkIdx + 1}: generate() failed:`,
					sanitizeProviderErrorMessage(err)
				);
				candidates = chunk.map(({ identity, reasoning }, localIdx) => {
					const globalIdx = globalStartIdx + localIdx;
					return fallbackFromPageHints(identity, globalIdx, reasoning, pagesForSynthesis);
				});
				const hintRecovered = candidates.filter((c) => c.email).length;
				console.debug(
					`[gemini-provider] Stage 4 chunk ${chunkIdx + 1} fallback: ${hintRecovered}/${candidates.length} recovered from page hints`
				);
			}

			// Backfill: if synthesis still has a sentinel name, try to recover from input
			for (const candidate of candidates) {
				if (isSentinelName(candidate.name)) {
					const matchingInput = chunk.find(
						(u) =>
							u.identity.title.toLowerCase() === candidate.title.toLowerCase() &&
							u.identity.organization.toLowerCase() === candidate.organization.toLowerCase()
					);
					if (matchingInput && !isSentinelName(matchingInput.identity.name)) {
						console.debug('[gemini-provider] Applied one candidate identity-name backfill');
						candidate.name = matchingInput.identity.name;
					}
				}
			}

			// Emit immediately — don't wait for other chunks
			synthesizedCandidates.push(...candidates);
			if (onCandidateProcessed) {
				for (const candidate of candidates) {
					onCandidateProcessed(candidate, allPages);
				}
			}

			// Progress update after each chunk completes
			chunksComplete++;
			const withEmail = candidates.filter((c) => c.email?.includes('@')).length;
			const names = candidates
				.filter((c) => c.email?.includes('@'))
				.map((c) => c.name)
				.join(', ');
			if (withEmail > 0) {
				onThought?.(`Found contact details for ${names}.`);
			}
			if (chunksComplete < chunks.length) {
				onThought?.(
					`Resolving remaining contacts (${chunks.length - chunksComplete} of ${chunks.length} groups left)...`
				);
			}
		})
	);

	// ================================================================
	// Return: merge cached + synthesized
	// ================================================================

	const allCandidates = [...cachedCandidates, ...synthesizedCandidates];
	console.debug(
		`[gemini-provider] Fan-out complete: ${allCandidates.length} total candidates (${cachedCandidates.length} cached + ${synthesizedCandidates.length} synthesized), ${fetchedPages.size} pages`
	);

	return {
		candidates: allCandidates,
		fetchedPages,
		blockedHosts,
		readSources,
		tokenUsage: sumTokenUsage(...tokenUsages),
		externalCounts: extCounts
	};
}

// ============================================================================
// Gemini Provider Implementation
// ============================================================================

// NOTE: huntContactsParallel_legacy and huntSingleContact were deleted.
// The fan-out-synthesize pipeline (4-stage) replaced N parallel ReAct loops.
// If rollback is needed, retrieve from git history.

// ============================================================================
// Gemini Provider Implementation
// ============================================================================

export class GeminiDecisionMakerProvider implements DecisionMakerProvider {
	readonly name = 'gemini-search';

	readonly supportedTargetTypes: readonly string[] = [];

	canResolve(context: ResolveContext): boolean {
		// Gemini + Exa Search can handle any target type
		return !!context.subjectLine;
	}

	async resolve(context: ResolveContext): Promise<DecisionMakerResult> {
		const startTime = Date.now();
		const { subjectLine, coreMessage, topics, voiceSample, streaming, audienceGuidance } = context;
		const tokenUsages: (TokenUsage | undefined)[] = [];
		const pipelineExtCounts = emptyExternalCounts();

		console.debug('[gemini-provider] Starting parallel resolution...');

		try {
			// ================================================================
			// Phase 1: Role Discovery — Structural reasoning, no names
			// ================================================================

			streaming?.onPhase?.('discover', 'Mapping institutional power structure...');

			const rolePrompt = buildRoleDiscoveryPrompt(
				subjectLine,
				coreMessage,
				topics,
				voiceSample,
				audienceGuidance
			);

			console.debug('[gemini-provider] Phase 1: Discovering roles with thoughts...');

			const roleResult = await generateWithThoughts<RoleDiscoveryResponse>(
				rolePrompt,
				{
					stage: 'decision-role-discovery',
					systemInstruction: ROLE_DISCOVERY_PROMPT,
					// 0.7: Role discovery is creative-analytical — finding non-obvious power brokers
					// requires exploring the model's full understanding of institutional structure.
					// Factual grounding comes from Phase 2 search, not token suppression here.
					temperature: 0.7,
					thinkingLevel: 'medium',
					signal: context.signal
				},
				streaming?.onThought ? (thought) => streaming.onThought!(thought, 'discover') : undefined
			);
			tokenUsages.push(roleResult.tokenUsage);

			const extraction = extractJsonFromGroundingResponse<RoleDiscoveryResponse>(
				roleResult.rawText || '{}'
			);

			if (!isSuccessfulExtraction(extraction)) {
				console.error('[gemini-provider] Phase 1 JSON extraction failed:', {
					error: sanitizeProviderErrorMessage(extraction.error),
					rawTextLength: roleResult.rawText?.length ?? 0
				});
				throw new Error('Finding decision-makers hit a snag. Please try again.');
			}

			const discoveredRoles: DiscoveredRole[] = extraction.data?.roles || [];

			// COGS-fanout guard: cap the role count before the Exa/Firecrawl/Gemini
			// fanout so per-message COGS can't exceed the budgeted ~$0.22 ceiling.
			// Phase 1 is an unbounded enumeration; the entire downstream cost scales
			// with this count, so bounding it here bounds the whole resolution.
			const roles = capFanout(discoveredRoles, MAX_DECISION_MAKER_FANOUT);
			if (roles.length < discoveredRoles.length) {
				console.debug(
					`[gemini-provider] COGS-fanout guard: capped ${discoveredRoles.length} roles → ${roles.length} (max ${MAX_DECISION_MAKER_FANOUT})`
				);
			}

			console.debug('[gemini-provider] Phase 1 complete:', {
				rolesFound: roles.length,
				rolesDiscovered: discoveredRoles.length
			});

			if (roles.length === 0) {
				streaming?.onPhase?.('complete', 'No relevant positions identified');
				return {
					decisionMakers: [],
					provider: this.name,
					cacheHit: false,
					latencyMs: Date.now() - startTime,
					researchSummary:
						'No positions with direct power over this issue were identified. Try refining the subject line to be more specific about the decision being sought.',
					tokenUsage: sumTokenUsage(...tokenUsages)
				};
			}

			// Bridging thought: summarize discovered roles
			if (streaming?.onThought) {
				const roleNames = roles.slice(0, 3).map((r) => r.position);
				const suffix = roles.length > 3 ? ` and ${roles.length - 3} more` : '';
				streaming.onThought(
					`Found ${roles.length} key positions: ${roleNames.join(', ')}${suffix}. Now searching for who currently holds each role...`,
					'discover'
				);
			}

			// ================================================================
			// Phase 2a: Parallel Identity Resolution
			// Direct Exa searches (1 per role) + 1 extraction call
			// ================================================================

			streaming?.onPhase?.(
				'identity',
				`Identifying current holders of ${roles.length} positions...`
			);

			const identityResult = await resolveIdentitiesFromSearch(roles, streaming, context.signal);
			tokenUsages.push(identityResult.tokenUsage);
			pipelineExtCounts.exaSearches += identityResult.exaSearchCount;
			const identities = identityResult.identities;

			console.debug(`[gemini-provider] Phase 2a complete: ${identities.length} identities`);

			// ================================================================
			// Cache Lookup — Pre-populate known emails
			// ================================================================

			const orgTitlePairs = identities.map((id) => ({
				organization: id.organization,
				title: id.title
			}));
			const cachedContactsRaw = await getCachedContacts(orgTitlePairs);
			const cachedContacts = Array.isArray(cachedContactsRaw) ? cachedContactsRaw : [];

			if (cachedContacts.length > 0) {
				const withEmail = cachedContacts.filter((c) => c.email);
				console.debug(`[gemini-provider] Cache hit: ${withEmail.length} contacts pre-populated`);
			}

			// Emit identity placeholders to UI — cards appear before contact hunting starts
			if (streaming?.onIdentitiesFound) {
				const placeholders = identities.map((id) => {
					const orgKey = normalizeOrgKey(id.organization);
					const cached = cachedContacts.find(
						(c) =>
							c.email && c.orgKey === orgKey && c.title?.toLowerCase() === id.title.toLowerCase()
					);
					return {
						name: id.name === 'UNKNOWN' ? '' : id.name,
						title: id.title,
						organization: id.organization,
						status: cached?.email ? ('cached' as const) : ('pending' as const)
					};
				});
				streaming.onIdentitiesFound(placeholders);
			}

			// ================================================================
			// Phase 2b: Per-Identity Parallel Contact Hunting
			// N concurrent mini-agents (1 search + 2 reads each)
			// ================================================================

			streaming?.onPhase?.('contact', `Searching for contact information...`);

			const emittedNames = new Set<string>();

			const contactResult = await huntContactsFanOutSynthesize(
				identities,
				cachedContacts,
				roles,
				{
					subjectLine: context.subjectLine,
					coreMessage: context.coreMessage,
					topics: context.topics
				},
				streaming,
				context.signal,
				// Per-identity streaming callback — emit as each mini-agent completes
				(candidate, pages) => {
					if (isSentinelName(candidate.name || '')) return;

					// Skip duplicate person (same person resolved for multiple positions)
					const nameLower = candidate.name.toLowerCase().replace(/\s+/g, ' ').trim();
					if (emittedNames.has(nameLower)) return;
					emittedNames.add(nameLower);

					// Cache hits have no pages — email was verified in a prior run.
					// Skip processOneCandidate which would strip the email when it
					// finds no page content to re-verify against.
					if (pages.length === 0 && candidate.email?.includes('@')) {
						streaming?.onCandidateResolved?.({
							name: candidate.name,
							title: candidate.title,
							organization: candidate.organization,
							email: candidate.email,
							emailSource: candidate.email_source,
							reasoning: candidate.reasoning,
							status: 'resolved',
							discovered: candidate.discovered
						});
						return;
					}

					const processed = this.processOneCandidate(candidate, pages);
					if (!processed) return;

					streaming?.onCandidateResolved?.({
						name: processed.name,
						title: processed.title,
						organization: processed.organization,
						email: processed.email,
						emailSource: processed.emailSource,
						reasoning: processed.reasoning,
						status: processed.email ? 'resolved' : 'no-email',
						discovered: candidate.discovered
					});
				}
			);
			tokenUsages.push(contactResult.tokenUsage);
			const merged = sumExternalCounts(pipelineExtCounts, contactResult.externalCounts);
			Object.assign(pipelineExtCounts, merged);

			const data: PersonLookupResponse = {
				decision_makers: contactResult.candidates,
				research_summary: `Searched for ${identities.length} decision-makers across ${contactResult.fetchedPages.size} pages.`
			};
			const pageContents = Array.from(contactResult.fetchedPages.values());
			console.debug('[gemini-provider] Contact hunting results:', {
				candidatesFound: data.decision_makers?.length || 0,
				pagesRead: pageContents.length
			});

			// Process decision-makers with content-based email verification
			const processed = this.processDecisionMakers(data.decision_makers || [], pageContents);

			const latencyMs = Date.now() - startTime;

			if (processed.length === 0) {
				console.debug('[gemini-provider] No decision-makers found after processing');
				streaming?.onPhase?.('complete', 'No verified decision-makers found');
				return {
					decisionMakers: [],
					provider: this.name,
					cacheHit: false,
					latencyMs,
					researchSummary:
						data.research_summary ||
						'No verifiable decision-makers found. The positions were identified but current holders could not be verified with recent sources.',
					metadata: {
						blockedHosts: [...contactResult.blockedHosts],
						readSources: [...contactResult.readSources],
						externalCounts: pipelineExtCounts
					},
					tokenUsage: sumTokenUsage(...tokenUsages)
				};
			}

			console.debug(`[gemini-provider] Parallel resolution complete in ${latencyMs}ms:`, {
				rolesDiscovered: roles.length,
				identitiesResolved: identities.filter((id) => id.name !== 'UNKNOWN').length,
				cacheHits: cachedContacts.filter((c) => c.email).length,
				candidatesFound: data.decision_makers?.length || 0,
				verified: processed.length,
				withEmail: processed.filter((dm) => dm.email).length
			});

			// Email verification: check if email appears in page content (text + highlights).
			// Highlights capture emails from mailto: links and contact sections that
			// plain text extraction misses. Unverified emails are stripped.
			const withEmail = processed.filter((dm) => dm.email);
			const withGroundedEmail = processed.filter((dm) => dm.emailGrounded === true);
			const withUngroundedEmail = processed.filter((dm) => dm.emailClaimStripped === true);

			console.debug(`[gemini-provider] Email grounding summary:`, {
				total: processed.length,
				withEmail: withEmail.length,
				groundedEmails: withGroundedEmail.length,
				ungroundedEmails: withUngroundedEmail.length
			});

			// Log shared emails for visibility but DO NOT strip them.
			// Org-level emails (planning@, press@, info@) are often the ONLY contact
			// path for board/committee members. Stripping them loses the contact entirely.
			const emailCounts = new Map<string, number>();
			for (const dm of processed) {
				if (!dm.email) continue;
				const lower = dm.email.toLowerCase();
				emailCounts.set(lower, (emailCounts.get(lower) || 0) + 1);
			}
			const sharedEmailCounts = Array.from(emailCounts.values()).filter((count) => count > 1);
			if (sharedEmailCounts.length > 0) {
				console.debug('[gemini-provider] Shared org-level contact paths retained:', {
					sharedEmailGroups: sharedEmailCounts.length,
					candidateAssignments: sharedEmailCounts.reduce((sum, count) => sum + count, 0)
				});
			}

			// Deduplicate candidates by name: when the same person appears for
			// multiple positions (e.g., "President" and "Chair"), keep the entry
			// with the best email coverage.
			const seenNames = new Map<string, number>();
			const deduped: typeof processed = [];
			let duplicateMerges = 0;

			for (const dm of processed) {
				const normalized = dm.name.toLowerCase().replace(/\s+/g, ' ').trim();
				const existingIdx = seenNames.get(normalized);

				if (existingIdx !== undefined) {
					const existing = deduped[existingIdx];
					if (!existing.email && dm.email) {
						deduped[existingIdx] = dm;
					} else if (existing.email && dm.email && dm.emailGrounded && !existing.emailGrounded) {
						deduped[existingIdx] = dm;
					}
					duplicateMerges++;
				} else {
					seenNames.set(normalized, deduped.length);
					deduped.push(dm);
				}
			}
			if (duplicateMerges > 0) {
				console.debug(`[gemini-provider] Dedup: merged ${duplicateMerges} duplicate candidates`);
			}

			const withVerifiedEmail = deduped.filter((dm) => dm.email);
			const withoutEmail = deduped.filter((dm) => !dm.email);
			console.debug(
				`[gemini-provider] Returning ${deduped.length} candidates: ${withVerifiedEmail.length} with verified email, ${withoutEmail.length} without email`
			);

			const contactsToCache = deduped.flatMap((dm) =>
				typeof dm.email === 'string' && dm.email.includes('@')
					? [
							{
								organization: dm.organization,
								title: dm.title,
								name: dm.name,
								email: dm.email,
								emailSource: dm.emailSource
							}
						]
					: []
			);

			// Cache write — fire-and-forget, never blocks the response
			upsertResolvedContacts(contactsToCache).catch((err) =>
				console.warn('[gemini-provider] Cache write failed:', sanitizeProviderErrorMessage(err))
			);

			streaming?.onPhase?.(
				'complete',
				deduped.length > 0
					? withVerifiedEmail.length > 0
						? `Found ${deduped.length} decision-makers (${withVerifiedEmail.length} with verified email)`
						: `Found ${deduped.length} decision-makers — no contactable public email route was confirmed`
					: `No decision-makers found`
			);

			return {
				decisionMakers: deduped,
				provider: this.name,
				cacheHit: false,
				latencyMs,
				researchSummary: data.research_summary || 'Parallel resolution completed.',
				metadata: {
					rolesDiscovered: roles.length,
					identitiesResolved: identities.filter((id) => id.name !== 'UNKNOWN').length,
					cacheHits: cachedContacts.filter((c) => c.email).length,
					candidatesFound: data.decision_makers?.length || 0,
					verified: deduped.length,
					withVerifiedEmail: withVerifiedEmail.length,
					emailsFilteredOut: withUngroundedEmail.length,
					blockedHosts: [...contactResult.blockedHosts],
					readSources: [...contactResult.readSources],
					externalCounts: pipelineExtCounts
				},
				tokenUsage: sumTokenUsage(...tokenUsages)
			};
		} catch (error) {
			// Never propagate raw provider errors to either the user or durable logs.
			console.error('[gemini-provider] Resolution error:', sanitizeProviderErrorMessage(error));

			const latencyMs = Date.now() - startTime;
			streaming?.onPhase?.('complete', 'Research encountered an issue — returning partial results');

			return {
				decisionMakers: [],
				provider: this.name,
				cacheHit: false,
				latencyMs,
				researchSummary:
					'Research encountered an issue. Please try again or refine your subject line.',
				tokenUsage: sumTokenUsage(...tokenUsages)
			};
		}
	}

	// ========================================================================
	// Processing Helpers
	// ========================================================================

	/**
	 * Process candidates into ProcessedDecisionMaker format.
	 * Filters unnamed candidates, then runs per-candidate email verification.
	 */
	private processDecisionMakers(
		candidates: Candidate[],
		pageContents: ExaPageContent[]
	): ProcessedDecisionMaker[] {
		return candidates
			.filter((c) => {
				if (isSentinelName(c.name || '')) {
					console.debug('[gemini-provider] Dropping one unnamed candidate');
					return false;
				}
				return true;
			})
			.map((c) => this.processOneCandidate(c, pageContents))
			.filter((dm): dm is ProcessedDecisionMaker => dm !== null);
	}

	/**
	 * Process a single candidate with content-based email verification.
	 * The email must appear in a page the agent actually read.
	 * Used both in batch (processDecisionMakers) and per-identity streaming.
	 */
	private processOneCandidate(
		candidate: Candidate,
		pageContents: ExaPageContent[]
	): ProcessedDecisionMaker | null {
		const hasEmail =
			candidate.email &&
			candidate.email !== 'NO_EMAIL_FOUND' &&
			candidate.email.toUpperCase() !== 'NO_EMAIL_FOUND' &&
			candidate.email.includes('@');

		let emailGrounded = false;
		let emailSource: string | undefined;
		let emailSourceTitle: string | undefined;
		let groundedPageText: string | undefined;
		let publiclyAttestableEmailGrounding = false;

		// Cache hits were verified in a prior run — trust the stored email
		// without re-grounding against this run's (different) page set.
		if (hasEmail && candidate.cacheHit) {
			emailGrounded = true;
			emailSource = candidate.email_source;
		}

		if (hasEmail && !emailGrounded) {
			const emailLower = candidate.email.toLowerCase();

			if (candidate.email_source) {
				const sourcePage = pageContents.find((p) => p.url === candidate.email_source);
				if (sourcePage?.text.toLowerCase().includes(emailLower)) {
					emailGrounded = true;
					publiclyAttestableEmailGrounding = true;
					emailSource = sourcePage.url;
					emailSourceTitle = sourcePage.title;
					groundedPageText = sourcePage.text;
				}
			}

			if (!emailGrounded) {
				for (const page of pageContents) {
					if (page.text.toLowerCase().includes(emailLower)) {
						emailGrounded = true;
						publiclyAttestableEmailGrounding = true;
						emailSource = page.url;
						emailSourceTitle = page.title;
						groundedPageText = page.text;
						break;
					}
				}
			}

			console.debug(`[gemini-provider] Candidate email grounding check: grounded=${emailGrounded}`);
		}

		let verifiedPersonSource = '';
		if (emailSource) {
			verifiedPersonSource = emailSource;
		} else if (candidate.email_source) {
			verifiedPersonSource = candidate.email_source;
		} else if (candidate.source_url) {
			verifiedPersonSource = candidate.source_url;
		}

		const personSourceNote = verifiedPersonSource
			? `Person verified via: ${verifiedPersonSource}`
			: 'Person source: from search results';

		const emailStatusNote = !hasEmail
			? 'Email: Not found in retrieved pages'
			: emailGrounded
				? `Email VERIFIED in page content: ${emailSource}`
				: `Email NOT VERIFIED (not found in any retrieved page)`;

		const provenance = [
			candidate.reasoning,
			'',
			personSourceNote,
			emailStatusNote,
			...(candidate.recency_check ? ['', candidate.recency_check] : [])
		].join('\n');

		const confidence = Math.min(
			1.0,
			0.4 +
				(emailGrounded ? 0.3 : 0) +
				(candidate.recency_check ? 0.15 : 0) +
				(candidate.cacheHit ? 0.1 : 0) +
				(verifiedPersonSource ? 0.05 : 0)
		);

		const emailReaches = hasEmail
			? resolveEmailReachesClaim({
					raw: candidate.reaches,
					rawLabel: candidate.reaches_label,
					groundedPageText
				})
			: undefined;
		const delivery = deriveDeliveryTier({
			email: hasEmail ? candidate.email : undefined,
			candidateName: candidate.name,
			title: candidate.title,
			groundedThisRun: publiclyAttestableEmailGrounding,
			groundingSourceUrl: emailSource
		});

		const processed: ProcessedDecisionMaker = {
			name: candidate.name,
			title: candidate.title,
			organization: candidate.organization,
			email: hasEmail ? candidate.email : undefined,
			reasoning: candidate.reasoning,
			source: verifiedPersonSource || '',
			provenance,
			isAiResolved: true,
			recencyCheck: candidate.recency_check,
			emailGrounded: hasEmail ? emailGrounded : undefined,
			emailSource: emailGrounded ? emailSource : undefined,
			emailSourceTitle: emailGrounded ? emailSourceTitle : undefined,
			deliveryTier: delivery.deliveryTier,
			...(delivery.seatRoute ? { seatRoute: delivery.seatRoute } : {}),
			emailReachesClaim: hasEmail ? emailReaches?.claim : undefined,
			...(emailReaches?.label ? { emailReachesLabel: emailReaches.label } : {}),
			...(publiclyAttestableEmailGrounding && emailSource
				? {
						publicEmailGrounding: {
							version: 1 as const,
							method: 'page-read' as const,
							source: emailSource
						}
					}
				: {}),
			contactNotes: candidate.contact_notes || undefined,
			discovered: candidate.discovered || false,
			confidence
		};

		if (processed.email && processed.emailGrounded !== true) {
			console.debug('[gemini-provider] Stripping one ungrounded candidate email');
			return {
				...processed,
				email: undefined,
				emailGrounded: false,
				emailClaimStripped: true
			};
		}

		return processed;
	}
}
