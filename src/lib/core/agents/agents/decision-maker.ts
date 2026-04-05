/**
 * Decision-Maker Resolution Agent — ThoughtStream Integration
 *
 * Streams actual model reasoning to the UI instead of fake/hardcoded thoughts.
 *
 * Features:
 * - ThoughtEmitter for structured reasoning visualization
 * - Progressive disclosure with citations
 * - Document, search_web, and read_page tool integration
 *
 * @example
 * ```typescript
 * const segments: ThoughtSegment[] = [];
 * const result = await resolveDecisionMakers(
 *   {
 *     targetType: 'corporate',
 *     targetEntity: 'Apple Inc.',
 *     subjectLine: 'Sustainability leadership',
 *     coreMessage: 'Requesting climate action...',
 *     topics: ['climate', 'sustainability']
 *   },
 *   (segment) => {
 *     segments.push(segment);
 *     console.log('New thought:', segment.content);
 *   }
 * );
 * ```
 */

import { ThoughtEmitter } from '$lib/core/thoughts/emitter';
import { decisionMakerRouter } from '../providers';
import { sumTokenUsage } from '../types';
import { verifyEmailBatch, type EmailVerdict } from '$lib/server/email-verification';
import { updateContactVerification } from '../utils/contact-cache';
import { generateAccountabilityOpeners } from './decision-maker-accountability';
import {
	documentToolDefinition,
	executeDocumentTool,
	getDocumentTypeColor,
	getDocumentTypeIcon,
	type DocumentAnalysisResult
} from '$lib/core/tools/document';
import { searchWeb, readPage, type ExaPageContent } from '../exa-search';
import type { DocumentType } from '$lib/server/reducto/types';
import type { ResolveContext, DecisionMakerResult } from '../providers/types';
import type { ThoughtSegment, Citation } from '$lib/core/thoughts/types';
import { cleanThoughtForDisplay } from '../utils/thought-filter';
import type { ProcessedDecisionMaker } from '$lib/types/template';

/** Decision-maker has a verified, contactable email address. */
function hasVerifiedEmail(
	dm: ProcessedDecisionMaker
): dm is ProcessedDecisionMaker & { email: string } {
	return typeof dm.email === 'string' && dm.email.includes('@');
}

/**
 * Progressive reveal events emitted alongside ThoughtSegments.
 * These bypass the ThoughtEmitter and go directly to the SSE stream
 * as typed metadata payloads for the UI to render incrementally.
 */
interface IdentityFoundEvent {
	type: 'identity-found';
	content: string;
	timestamp: number;
	metadata: { identities: unknown };
}

interface CandidateResolvedEvent {
	type: 'candidate-resolved';
	content: string;
	timestamp: number;
	metadata: { candidate: unknown };
}

interface VerificationEvent {
	type: 'verification';
	content: string;
	timestamp: number;
	metadata: { status: 'starting' | 'complete'; count?: number; verified?: number; dropped?: number; message: string };
}

/** Union of ThoughtSegment and progressive reveal events */
export type SegmentOrRevealEvent = ThoughtSegment | IdentityFoundEvent | CandidateResolvedEvent | VerificationEvent;

// ============================================================================
// Agentic Tool Context — shared state for tool handlers during a session
// ============================================================================

/**
 * Shared context passed to tool handlers during an agentic research session.
 * Tracks budget usage and accumulates fetched page contents for email verification.
 */
export interface AgenticToolContext {
	/** Accumulated page contents for post-session email verification */
	fetchedPages: Map<string, ExaPageContent>;
	/** Number of search_web calls made */
	searchCount: number;
	/** Number of read_page calls made */
	pageReadCount: number;
	/** Maximum allowed searches */
	maxSearches: number;
	/** Maximum allowed page reads */
	maxPageReads: number;
}

// ============================================================================
// URL Classification & Contact Extraction Helpers
// ============================================================================

/**
 * Classify a URL by its path pattern. Returns a descriptive label
 * the agent can use however it sees fit — not a priority signal.
 */
export function classifyUrl(url: string): string {
	try {
		const path = new URL(url).pathname.toLowerCase();
		if (/\/(contact|staff|directory|people|team|leadership)/.test(path)) return 'contact_page';
		if (/\/(press|media|news|newsroom|releases)/.test(path)) return 'press_page';
		if (/\/(about|board|executive|governance)/.test(path)) return 'about_page';
		if (path === '/' || path === '') return 'homepage';
		return 'other';
	} catch {
		return 'other';
	}
}

/**
 * Suggest common contact-related URLs based on a domain.
 * Offered as possibilities the agent can use or ignore.
 */
export function suggestContactUrls(url: string): string[] {
	try {
		const origin = new URL(url).origin;
		return [
			`${origin}/contact`,
			`${origin}/about/staff`,
			`${origin}/about/leadership`,
			`${origin}/press`
		];
	} catch {
		return [];
	}
}

/**
 * Extract contact-related hints from page text via regex.
 * Returns pre-parsed signals so the agent doesn't have to scan full markdown.
 */
export function extractContactHints(text: string): {
	emails: string[];
	phones: string[];
	socialUrls: string[];
} {
	const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
	const phoneRe = /(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
	const socialRe = /https?:\/\/(?:www\.)?(?:twitter|x|linkedin|facebook)\.com\/[^\s)"\]]+/gi;
	return {
		emails: [...new Set(text.match(emailRe) || [])],
		phones: [...new Set(text.match(phoneRe) || [])],
		socialUrls: [...new Set(text.match(socialRe) || [])].slice(0, 5)
	};
}

// ============================================================================
// Tool Definitions — Gemini function declarations
// ============================================================================

/**
 * Gemini function declaration for the document analysis tool
 */
export const geminiDocumentToolDeclaration = {
	name: documentToolDefinition.name,
	description: documentToolDefinition.description,
	parameters: documentToolDefinition.parameters
};

/**
 * Gemini function declaration for web search via Exa
 */
export const searchWebToolDeclaration = {
	name: 'search_web',
	description: `Search the web for information about people, organizations, and contact details.
Returns up to 25 search result metadata (title, URL, published date) per query.
No page content is returned — use read_page to get content from promising URLs.

Best practices:
- Use specific queries like "City of Portland Mayor office staff contact email 2026"
- Include the organization name, role keywords, and "contact" or "email" in queries
- Try official site queries: "site:portland.gov mayor office staff directory"
- If first search doesn't find emails, try different query angles (staff directory, leadership page, contact page)`,
	parameters: {
		type: 'object' as const,
		properties: {
			query: {
				type: 'string' as const,
				description: 'Search query. Be specific: include org name, role, and "contact" or "email" for best results.'
			}
		},
		required: ['query']
	}
};

/**
 * Gemini function declaration for reading a web page via Exa
 */
export const readPageToolDeclaration = {
	name: 'read_page',
	description: `Fetch and read the full text content of a web page.
Returns the page's text content in markdown format plus pre-extracted contact_hints (emails, phones, social URLs found on the page).

IMPORTANT: Email addresses you report MUST appear verbatim in the text returned by this tool. Only trust emails from pages with institutional provenance — published by the person's organization or in authoritative reporting. Third-party sites that aggregate contact information cannot establish that an email is current or routes to the right person.`,
	parameters: {
		type: 'object' as const,
		properties: {
			url: {
				type: 'string' as const,
				description: 'The URL to fetch content from'
			},
			reason: {
				type: 'string' as const,
				description: 'Brief reason for reading this page'
			},
			maxCharacters: {
				type: 'number' as const,
				description: 'Maximum characters to return (default 12000, max 15000). Request more for pages likely rich in contact info.'
			}
		},
		required: ['url']
	}
};

// ============================================================================
// Tool Argument Types
// ============================================================================

interface DocumentToolArgs {
	url: string;
	query: string;
	documentType?: DocumentType;
}

interface SearchWebToolArgs {
	query: string;
}

interface ReadPageToolArgs {
	url: string;
	reason?: string;
	maxCharacters?: number;
}

/** Narrow Gemini function call args to expected tool type.
 *  SDK types args as Record<string, unknown> — we validate by function name. */
function narrowToolArgs<T>(args: Record<string, unknown> | undefined): T {
	return args as unknown as T;
}

/**
 * Function call request from Gemini
 */
interface GeminiFunctionCall {
	name: string;
	args: Record<string, unknown>;
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Handle search_web tool invocation.
 * Searches via Exa with budget enforcement.
 */
async function handleSearchWebToolCall(
	args: SearchWebToolArgs,
	context: AgenticToolContext,
	emitter: ThoughtEmitter
): Promise<unknown> {
	const { query } = args;

	// Budget check
	if (context.searchCount >= context.maxSearches) {
		console.debug(`[decision-maker] search_web budget exhausted (${context.maxSearches} used)`);
		return {
			success: false,
			query,
			results: [],
			resultCount: 0,
			error: `Search budget exhausted (${context.maxSearches} searches used). Proceed with the information you have.`
		};
	}

	context.searchCount++;
	const action = emitter.startAction('search', `Searching: "${query}"`);

	try {
		const hits = await searchWeb(query);

		action.addFinding(`Found ${hits.length} results`);
		action.complete(`Search complete: ${hits.length} results`);

		// Collect unique domains for contact URL suggestions
		const seenDomains = new Set<string>();
		const suggestedUrls: string[] = [];
		for (const h of hits) {
			try {
				const domain = new URL(h.url).origin;
				if (!seenDomains.has(domain) && seenDomains.size < 3) {
					seenDomains.add(domain);
					suggestedUrls.push(...suggestContactUrls(h.url));
				}
			} catch { /* skip malformed URLs */ }
		}

		return {
			success: true,
			query,
			results: hits.map(h => ({
				url: h.url,
				title: h.title,
				publishedDate: h.publishedDate,
				score: h.score,
				url_hint: classifyUrl(h.url)
			})),
			resultCount: hits.length,
			suggested_contact_urls: suggestedUrls
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Search failed';
		action.error(errorMessage);
		return {
			success: false,
			query,
			results: [],
			resultCount: 0,
			error: errorMessage
		};
	}
}

/**
 * Handle read_page tool invocation.
 * Fetches page content via Exa with budget enforcement.
 * Stores content in context.fetchedPages for email verification.
 */
async function handleReadPageToolCall(
	args: ReadPageToolArgs,
	context: AgenticToolContext,
	emitter: ThoughtEmitter
): Promise<unknown> {
	const { url, reason, maxCharacters: requestedMax } = args;

	// Budget check
	if (context.pageReadCount >= context.maxPageReads) {
		console.debug(`[decision-maker] read_page budget exhausted (${context.maxPageReads} used)`);
		return {
			success: false,
			url,
			title: '',
			text: '',
			error: `Page read budget exhausted (${context.maxPageReads} reads used). Proceed with the information you have.`
		};
	}

	context.pageReadCount++;
	const action = emitter.startAction('analyze', reason || `Reading: ${url}`);

	// Legacy path: clamp maxCharacters (readPage now returns full text regardless)
	const maxChars = requestedMax
		? Math.min(Math.max(requestedMax, 1000), 15000)
		: undefined;

	try {
		const page = await readPage(url, maxChars ? { maxCharacters: maxChars } : undefined);

		if (!page) {
			action.error('No content retrieved');
			return {
				success: false,
				url,
				title: '',
				text: '',
				error: 'Could not retrieve page content. The page may be behind authentication or temporarily unavailable.'
			};
		}

		// Store for post-session email verification
		context.fetchedPages.set(url, page);

		// Pre-extract contact hints from the full page text
		const contactHints = extractContactHints(page.text);

		action.addFinding(`Retrieved ${page.text.length} characters`);
		if (contactHints.emails.length > 0) {
			action.addFinding(`Found ${contactHints.emails.length} email(s) on page`);
		}
		action.complete(`Read: "${page.title.slice(0, 60)}"`);

		return {
			success: true,
			url: page.url,
			title: page.title,
			text: page.text,
			publishedDate: page.publishedDate,
			url_hint: classifyUrl(url),
			contact_hints: contactHints
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Page read failed';
		action.error(errorMessage);
		return {
			success: false,
			url,
			title: '',
			text: '',
			error: errorMessage
		};
	}
}

/**
 * Handle document tool invocation from Gemini function calling.
 */
export async function handleDocumentToolCall(
	args: DocumentToolArgs,
	emitter: ThoughtEmitter
): Promise<DocumentAnalysisResult> {
	const { url, query, documentType } = args;

	const action = emitter.startAction('analyze', `Analyzing document: ${url}`);

	try {
		const result = await executeDocumentTool(url, query, documentType, emitter);

		if (!result.success) {
			action.error(result.error || 'Document analysis failed');
			return result;
		}

		if (result.document) {
			action.addFinding(`Parsed ${result.document.sections.length} sections`);
			action.addFinding(`Extracted ${result.document.entities.length} entities`);
		}

		if (result.citations && result.citations.length > 0) {
			const docType = result.document?.type || documentType || 'official';
			emitDocumentCitations(emitter, result.citations, docType);
		}

		if (result.summary) {
			emitter.insight(result.summary, {
				icon: getDocumentTypeIcon(result.document?.type || documentType || 'official'),
				pin: true
			});
		}

		action.complete(
			`Document analysis complete: ${result.document?.title || 'Untitled'}`
		);

		return result;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		action.error(errorMessage);
		return {
			success: false,
			error: errorMessage
		};
	}
}

/**
 * Emit L1 citations from document analysis with document type styling.
 */
function emitDocumentCitations(
	emitter: ThoughtEmitter,
	citations: Citation[],
	documentType: DocumentType
): void {
	const color = getDocumentTypeColor(documentType);
	const icon = getDocumentTypeIcon(documentType);

	for (const citation of citations) {
		const enrichedCitation = emitter.cite(citation.label, {
			url: citation.url,
			excerpt: citation.excerpt,
			documentId: citation.documentId
		});

		emitter.think(`${icon} ${citation.label}`, {
			citations: [enrichedCitation],
			emphasis: 'normal'
		});
	}

	console.debug(`[decision-maker] Emitted ${citations.length} document citations with color: ${color}`);
}

// ============================================================================
// Function Call Dispatcher
// ============================================================================

/**
 * Process a function call from Gemini and return the result.
 *
 * Dispatches to the appropriate tool handler based on function name.
 * Supports: analyze_document, search_web, read_page.
 *
 * @param functionCall - Function call from Gemini response
 * @param emitter - ThoughtEmitter for streaming updates
 * @param context - Optional agentic tool context for budget tracking
 * @returns Result to send back to Gemini
 */
export async function processGeminiFunctionCall(
	functionCall: GeminiFunctionCall,
	emitter: ThoughtEmitter,
	context?: AgenticToolContext
): Promise<unknown> {
	console.debug(`[decision-maker] Processing function call: ${functionCall.name}`);

	switch (functionCall.name) {
		case 'analyze_document': {
			const args = narrowToolArgs<DocumentToolArgs>(functionCall.args);
			return await handleDocumentToolCall(args, emitter);
		}

		case 'search_web': {
			if (!context) {
				return { success: false, error: 'search_web requires an agentic tool context' };
			}
			const args = narrowToolArgs<SearchWebToolArgs>(functionCall.args);
			return await handleSearchWebToolCall(args, context, emitter);
		}

		case 'read_page': {
			if (!context) {
				return { success: false, error: 'read_page requires an agentic tool context' };
			}
			const args = narrowToolArgs<ReadPageToolArgs>(functionCall.args);
			return await handleReadPageToolCall(args, context, emitter);
		}

		default:
			console.warn(`[decision-maker] Unknown function call: ${functionCall.name}`);
			return { error: `Unknown function: ${functionCall.name}` };
	}
}

// ============================================================================
// Main Resolution Function
// ============================================================================

/**
 * Resolve decision-makers using ThoughtStream integration.
 *
 * This function wraps the provider architecture with structured thought emission
 * and contextual memory retrieval. It maintains the same resolution logic but
 * emits rich ThoughtSegments instead of raw text.
 *
 * @param context - Resolution context with target info and message content
 * @param onSegment - Callback invoked for each emitted thought segment
 * @returns Decision-maker resolution result
 */
export async function resolveDecisionMakers(
	context: ResolveContext,
	onSegment: (segment: SegmentOrRevealEvent) => void
): Promise<DecisionMakerResult> {
	const emitter = new ThoughtEmitter(onSegment);

	try {
		// ========================================================================
		// Phase 1: Research — Delegate to provider
		// ========================================================================

		emitter.startPhase('research');

		// Bridge streaming callbacks to ThoughtEmitter - only forward real model thoughts
		// Progressive reveal events (identity-found, candidate-resolved) bypass the
		// ThoughtEmitter and go directly through onSegment as typed metadata payloads.
		const enhancedContext: ResolveContext = {
			...context,
			streaming: {
				onThought: (thought, phase) => {
					const cleaned = cleanThoughtForDisplay(thought);
					if (cleaned) {
						emitter.think(cleaned);
					}
				},
				onIdentitiesFound: (identities) => {
					onSegment({
						type: 'identity-found',
						content: '',
						timestamp: Date.now(),
						metadata: { identities }
					});
				},
				onCandidateResolved: (candidate) => {
					onSegment({
						type: 'candidate-resolved',
						content: '',
						timestamp: Date.now(),
						metadata: { candidate }
					});
				}
			}
		};

		const result = await decisionMakerRouter.resolve(enhancedContext);

		// ========================================================================
		// Filter — Only contactable decision-makers proceed
		// ========================================================================

		const totalResolved = result.decisionMakers.length;
		result.decisionMakers = result.decisionMakers.filter(hasVerifiedEmail);
		let droppedCount = totalResolved - result.decisionMakers.length;

		if (droppedCount > 0) {
			console.debug(
				`[decision-maker] Filtered ${droppedCount} decision-maker(s) without verified email`
			);
		}

		// ========================================================================
		// Phase 3.5: Email Deliverability Verification
		// ========================================================================

		if (result.decisionMakers.length > 0) {
			const emailsToVerify = result.decisionMakers
				.filter((dm): dm is typeof dm & { email: string } => typeof dm.email === 'string')
				.map((dm) => dm.email);

			if (emailsToVerify.length > 0) {
				onSegment({
					type: 'verification',
					content: '',
					timestamp: Date.now(),
					metadata: { status: 'starting', count: emailsToVerify.length, message: `Verifying ${emailsToVerify.length} email address${emailsToVerify.length > 1 ? 'es' : ''}...` }
				});

				try {
					const verificationResults = await verifyEmailBatch(emailsToVerify);

					// Collect cache writeback entries for ALL verified emails (before filtering)
					const cacheUpdates: Array<{ organization: string; title: string; verificationStatus: string }> = [];
					for (const dm of result.decisionMakers) {
						if (!dm.email) continue;
						const vr = verificationResults.get(dm.email);
						if (vr && dm.organization && dm.title) {
							cacheUpdates.push({
								organization: dm.organization,
								title: dm.title,
								verificationStatus: vr.verdict
							});
						}
					}

					let droppedByVerification = 0;
					result.decisionMakers = result.decisionMakers.filter((dm) => {
						if (!dm.email) return true; // no email to verify, keep
						const vr = verificationResults.get(dm.email);
						if (vr && vr.verdict === 'undeliverable') {
							droppedByVerification++;
							return false;
						}
						// Annotate survivors
						if (vr) {
							dm.emailVerified = vr.verdict as Exclude<EmailVerdict, 'undeliverable'>;
						}
						return true;
					});

					onSegment({
						type: 'verification',
						content: '',
						timestamp: Date.now(),
						metadata: {
							status: 'complete',
							verified: emailsToVerify.length - droppedByVerification,
							dropped: droppedByVerification,
							message: droppedByVerification > 0
								? `Verified ${emailsToVerify.length - droppedByVerification} addresses, removed ${droppedByVerification} undeliverable`
								: `All ${emailsToVerify.length} addresses verified`
						}
					});

					if (droppedByVerification > 0) {
						droppedCount += droppedByVerification;
						console.debug(`[decision-maker] Phase 3.5: Dropped ${droppedByVerification} undeliverable email(s)`);
					}

					// Write verification status back to contact cache (awaited for ALS scope)
					if (cacheUpdates.length > 0) {
						await updateContactVerification(cacheUpdates).catch((err) =>
							console.warn('[decision-maker] Phase 3.5 cache writeback failed:', err)
						);
					}
				} catch (err) {
					console.warn('[decision-maker] Phase 3.5 failed (non-fatal):', err);
				}
			}
		}

		// ========================================================================
		// Recommendation — Present findings
		// ========================================================================

		emitter.startPhase('recommendation');

		if (result.decisionMakers.length === 0) {
			if (droppedCount > 0) {
				emitter.think(
					`Identified ${droppedCount} decision-maker${droppedCount > 1 ? 's' : ''}, ` +
						'but none had publicly available email addresses. ' +
						'You can add contacts manually on the next screen.',
					{ emphasis: 'highlight' }
				);
			} else {
				emitter.think(
					'No decision-makers could be identified. ' +
						'Try refining your search or providing more specific organizational details.',
					{ emphasis: 'highlight' }
				);
			}
		} else {
			const countLabel = `${result.decisionMakers.length} decision-maker${result.decisionMakers.length > 1 ? 's' : ''}`;
			if (droppedCount > 0) {
				emitter.insight(
					`Found ${countLabel} with verified contact info. ${droppedCount} more identified but excluded (no public email).`,
					{ icon: '✅' }
				);
			} else {
				emitter.insight(
					`Found ${countLabel} with verified contact info.`,
					{ icon: '✅' }
				);
			}

			for (const dm of result.decisionMakers) {
				const citations = [];

				if (dm.source) {
					citations.push(
						emitter.cite(`Source for ${dm.name}`, {
							url: dm.source,
							excerpt: dm.reasoning || 'Verification source'
						})
					);
				}

				const dmLabel = `${dm.name} — ${dm.title}${dm.organization ? ` at ${dm.organization}` : ''}`;

				emitter.recommend(dmLabel, {
					citations: citations.length > 0 ? citations : undefined,
					pin: true,
					icon: '👤'
				});

				if (dm.reasoning) {
					emitter.think(`Why ${dm.name}: ${dm.reasoning}`, { emphasis: 'muted' });
				}
			}
		}

		emitter.completePhase();

		// ========================================================================
		// Phase 4: Accountability & Classification (non-fatal)
		// ========================================================================

		if (result.decisionMakers.length > 0) {
			emitter.startPhase('accountability');
			emitter.think('Generating accountability context...');

			try {
				const accountabilityResult = await generateAccountabilityOpeners(
					{
						subjectLine: context.subjectLine || '',
						coreMessage: context.coreMessage || '',
						topics: context.topics || [],
						decisionMakers: result.decisionMakers.map((dm) => ({
							name: dm.name,
							title: dm.title,
							organization: dm.organization || '',
							reasoning: dm.reasoning || ''
						}))
					},
					emitter
				);

				// Merge accountability data back into decision makers
				for (const dm of result.decisionMakers) {
					const opener = accountabilityResult.openers.get(dm.name);
					if (opener) {
						dm.accountabilityOpener = opener.accountabilityOpener;
						dm.roleCategory = opener.roleCategory;
						dm.relevanceRank = opener.relevanceRank;
						dm.publicActions = opener.publicActions;
					}
				}

				// Store personalPrompt on first DM (extracted by UI for compose pane placeholder)
				if (result.decisionMakers[0] && accountabilityResult.personalPrompt) {
					result.decisionMakers[0].personalPrompt = accountabilityResult.personalPrompt;
				}

				// Sum Phase 4 token usage into pipeline total
				if (accountabilityResult.tokenUsage) {
					result.tokenUsage = sumTokenUsage(result.tokenUsage, accountabilityResult.tokenUsage);
				}

				emitter.insight(
					`Generated accountability openers for ${accountabilityResult.openers.size} decision-makers.`,
					{ icon: '🎯' }
				);
			} catch (error) {
				console.error('[decision-maker] Phase 4 failed (non-fatal):', error);
				emitter.think(
					'Accountability generation unavailable — proceeding without openers.',
					{ emphasis: 'muted' }
				);
			}

			emitter.completePhase();
		}

		// Stash drop count for pipeline_stats observability
		if (droppedCount > 0) {
			result.metadata = { ...result.metadata, droppedEmailless: droppedCount };
		}

		return result;
	} catch (error) {
		console.error('[decision-maker] Resolution failed:', error);

		const errorMessage =
			error instanceof Error ? error.message : 'An unexpected error occurred';
		emitter.think(`Error: ${errorMessage}`, { emphasis: 'highlight' });

		throw error;
	}
}

// ============================================================================
// Tool Registration Helpers
// ============================================================================

/**
 * Get tool declarations for Gemini function calling.
 *
 * @param mode - 'research' for agentic search tools, 'document' for document analysis
 * @returns Array of Gemini-compatible function declarations
 */
export function getAgentToolDeclarations(mode: 'research' | 'search-only' | 'document' = 'document') {
	if (mode === 'search-only') {
		return [searchWebToolDeclaration];
	}
	if (mode === 'research') {
		return [searchWebToolDeclaration, readPageToolDeclaration];
	}
	return [geminiDocumentToolDeclaration];
}
