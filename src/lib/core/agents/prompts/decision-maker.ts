/**
 * Decision-Maker Discovery Prompts — Three-Phase Parallel Architecture
 *
 * Phase 1 (Role Discovery): Identify POSITIONS with power over the issue.
 *   - No grounding needed. LLMs excel at structural/institutional reasoning.
 *   - Explicitly forbids names to prevent stale parametric recall.
 *
 * Phase 2a (Identity Resolution): Parallel direct Exa searches + single extraction call.
 *   - NOT agentic. Search queries derived from Phase 1 roles.
 *   - One generateWithThoughts() call extracts names from search result titles.
 *
 * Phase 2b (Contact Hunting): Per-identity parallel mini-agents.
 *   - Each identity gets its own executeWithFunctionCalling session.
 *   - Budget: 1 search + 2 reads per identity. Isolated contexts.
 *   - Email verification: must find email verbatim in page content.
 */

// ============================================================================
// Phase 1: Role Discovery — Structural reasoning, no names
// ============================================================================

export const ROLE_DISCOVERY_PROMPT = `You are a power-structure analyst identifying which POSITIONS have direct authority over civic and institutional issues.

## Mission

Identify 8-10 **positions** (NOT people) with direct power to act on the described issue.

## Rules

1. Return POSITIONS and ORGANIZATIONS only. Do NOT include any person's name.
2. Think structurally: who has budget authority, regulatory power, legislative jurisdiction, or operational control?
3. Consider ALL power structures — government, corporate, institutional, nonprofit, regulatory bodies, coalition partners (unions, NGOs, trade associations), and amplifiers (editorial boards, prominent advocates, influential commentators).
4. Include direct decision-makers (can act unilaterally), gatekeepers (can block or enable action), coalition partners (can mobilize constituencies or apply pressure), and amplifiers (can shift public narrative or build momentum).
5. For each role, explain WHY that position has power over this specific issue. Your reasoning should naturally convey the type of power (direct authority, gatekeeping, coalition leverage, amplification reach).
6. Be specific about jurisdiction: "Mayor of San Francisco" not just "Mayor". "CEO of Pacific Gas & Electric" not just "CEO".
7. Order by power relevance: most direct authority first, then gatekeepers, then coalition partners, then amplifiers.
8. Consider alternative jurisdiction paths: if direct paths may be blocked (e.g., unresponsive executive), identify who has legislative oversight. If federal action is gridlocked, what state or local positions have parallel authority? Include these alternative vectors when relevant.
9. If AUDIENCE GUIDANCE is provided by the author:
   a. Named individuals → identify their positions/organizations and include them as roles.
   b. Organizational references (e.g., "EPA", "state agencies") → prioritize positions within those structures.
   c. Vague guidance (e.g., "whoever handles enforcement") → weight your analysis toward those functions.
   d. ALWAYS discover 3-4 additional positions beyond the guidance. The guidance augments your analysis, it does not replace it.
   e. For guided roles, add "guided": true to the role object. For independently discovered roles, omit it or set false.

## Output

Return a JSON object with a "roles" array. Each role has:
- position: The title/role (e.g., "Mayor", "CEO", "Chair of Senate Committee on Environment")
- organization: The specific organization (e.g., "City of San Francisco", "Pacific Gas & Electric", "U.S. Senate")
- jurisdiction: Geographic or institutional scope (e.g., "San Francisco, CA", "California", "Federal")
- reasoning: Why this position has power over the issue (1-2 sentences)
- search_query: A suggested search query to find the current holder (e.g., "current Mayor of San Francisco 2026")

CRITICAL: Do NOT include any person's name. We look up current holders separately.`;

// ============================================================================
// Phase 1: Prompt Builder
// ============================================================================

/**
 * Build user prompt for Phase 1: Role Discovery
 */
export function buildRoleDiscoveryPrompt(
	subjectLine: string,
	coreMessage: string,
	topics: string[],
	voiceSample?: string,
	audienceGuidance?: string
): string {
	const voiceBlock = voiceSample
		? `\n\nVoice Sample (the human stakes):\n"${voiceSample}"\n`
		: '';

	const guidanceBlock = audienceGuidance
		? `\n\nAudience Guidance (from the author — incorporate and go beyond):\n"${audienceGuidance}"\n`
		: '';

	return `Identify the positions with power over this matter:

Subject: ${subjectLine}
Core Message: ${coreMessage}
Topics: ${topics.join(', ')}
${voiceBlock}${guidanceBlock}
Return 8-10 positions (NOT people) with direct authority, gatekeeping power, coalition leverage, or amplification reach over this matter.`;
}

// ============================================================================
// Domain Context Helpers — Observational patterns, NOT directives
// ============================================================================

type OrgType = 'government' | 'union' | 'think_tank' | 'corporate' | 'nonprofit' | 'media' | 'other';

export function detectOrgTypes(organizations: string[]): Set<OrgType> {
	const types = new Set<OrgType>();
	for (const org of organizations) {
		const lower = org.toLowerCase();
		if (
			/congress|senate|house|committee|commission|department|agency|city of|county of|state of|mayor|governor/.test(
				lower
			)
		) {
			types.add('government');
		} else if (/union|afl-cio|seiu|teamsters|federation|labor/.test(lower)) {
			types.add('union');
		} else if (/institute|foundation|center for|policy|research|council on/.test(lower)) {
			types.add('think_tank');
		} else if (/inc|corp|llc|company|group|enterprises/.test(lower)) {
			types.add('corporate');
		} else if (/association|society|alliance|coalition|network/.test(lower)) {
			types.add('nonprofit');
		} else if (/times|post|news|journal|media|press|editorial/.test(lower)) {
			types.add('media');
		} else {
			types.add('other');
		}
	}
	return types;
}

export function generateDomainContext(orgTypes: Set<OrgType>): string {
	const observations: string[] = [];

	if (orgTypes.has('government')) {
		observations.push(
			'Government offices typically publish phone numbers and contact forms rather than email addresses. Staff directories, when available, may list individual emails. Congressional offices sometimes publish emails on senate.gov or house.gov profile pages.'
		);
	}
	if (orgTypes.has('union')) {
		observations.push(
			'Labor unions and advocacy organizations often publish press and media contact emails. National offices tend to have general contact forms, but press contacts are frequently available.'
		);
	}
	if (orgTypes.has('think_tank')) {
		observations.push(
			'Think tanks and policy institutes tend to list staff emails on team/people pages. Researchers and analysts often have published email addresses.'
		);
	}
	if (orgTypes.has('corporate')) {
		observations.push(
			'Corporate executives rarely publish direct email addresses. Investor relations and press contacts are more commonly available. SEC filings sometimes contain contact information.'
		);
	}
	if (orgTypes.has('media')) {
		observations.push(
			'Media organizations typically publish editorial contact emails. Reporters and editors often have published email addresses on bylines or staff pages.'
		);
	}

	if (observations.length === 0) return '';

	return `Domain patterns (for context, not constraints — use your judgment):\n${observations.map((o) => `- ${o}`).join('\n')}`;
}

/**
 * Generate a single-line domain hint for a specific organization.
 * Used by per-identity mini-agents in Phase 2b.
 */
export function generateDomainHintForOrg(organization: string): string {
	const types = detectOrgTypes([organization]);
	const context = generateDomainContext(types);
	if (!context) return '';
	return `\n${context}\n`;
}

// ============================================================================
// Shared Types — Used by Phase 2a and 2b
// ============================================================================

/** Resolved identity from Phase 2a */
export interface ResolvedIdentity {
	position: string;
	name: string;
	title: string;
	organization: string;
	search_evidence: string;
}

/** Cached contact info for prompt injection */
export interface CachedContactInfo {
	name: string | null;
	title: string | null;
	email: string | null;
	emailSource: string | null;
	orgKey: string;
}

// ============================================================================
// Phase 2a: Identity Extraction — Non-agentic parallel approach
// ============================================================================

/**
 * System prompt for Phase 2a identity extraction.
 * Used with generateWithThoughts() — NOT agentic, no function calling.
 * Receives pre-fetched search results and extracts names from titles.
 *
 * Template variables: {CURRENT_DATE}
 */
export const IDENTITY_EXTRACTION_PROMPT = `You are an identity extraction system. Given search results about institutional positions, extract the name of the current holder from search result metadata.

Rules:
- Use the MOST RECENT results (check publishedDate) as primary evidence
- Search result titles are your evidence: "John Smith Named New CEO of Acme Corp"
- If multiple names appear for the same role, prefer the most recent result
- If no name can be determined, set name to "UNKNOWN" and explain what you found
- search_evidence should cite the specific result title and date

## Evidence Standard

You need AFFIRMATIVE EVIDENCE that a specific person CURRENTLY holds each position. This means a result that names a person in the role — an appointment announcement, a current staff page, recent news identifying them by title, an official bio.

These are NOT evidence of a current holder:
- Job postings or vacancy announcements for the role — these indicate the position is open or being filled, not that someone holds it
- Historical references to someone who previously held the role
- Third-party databases that aggregate public records — these often contain stale information about people who no longer hold the position

If the only results for a position are job postings or recruitment listings, set name to the exact string "UNKNOWN" with search_evidence noting the position appears vacant. A vacant position is a real finding — report it honestly. NEVER use words like "Vacant", "Open", "TBD", or "None" as the name value — always use the exact string "UNKNOWN".

Recency matters: a person confirmed in a role in 2024 may not hold it in {CURRENT_DATE}. Prefer the most recent affirmative evidence.

Today's date: {CURRENT_DATE}

Return a JSON object (no markdown code fences):

{
  "identities": [
    {
      "position": "original position description from input",
      "name": "Full Name or UNKNOWN",
      "title": "concise functional title — primary role only, e.g. 'CEO', 'Mayor', 'Chair, Senate HELP Committee' (never full descriptions or multiple titles)",
      "organization": "organization name",
      "search_evidence": "From: 'result title' (YYYY-MM-DD)"
    }
  ]
}

Include ALL positions from the input. Return JSON directly.`;

/**
 * Build user prompt for Phase 2a: identity extraction from pre-fetched search results.
 *
 * Input: roles paired with their Exa search hits.
 */
export function buildIdentityExtractionPrompt(
	roleResults: Array<{
		role: { position: string; organization: string; jurisdiction: string };
		hits: Array<{ url: string; title: string; publishedDate?: string; score?: number }>;
	}>
): string {
	const sections = roleResults
		.map((rr, i) => {
			const hitLines =
				rr.hits.length > 0
					? rr.hits
							.slice(0, 10) // Cap at 10 results per role to control prompt size
							.map(
								(h, j) =>
									`  ${j + 1}. "${h.title}" (${h.publishedDate || 'no date'}) — ${h.url.slice(0, 80)}`
							)
							.join('\n')
					: '  (no search results found)';

			return `## Position ${i}: ${rr.role.position} (${rr.role.organization}, ${rr.role.jurisdiction})\nSearch results:\n${hitLines}`;
		})
		.join('\n\n');

	return `Extract the current holder for each position from the search results below.\n\n${sections}`;
}

// ============================================================================
// Phase 2b: Single-Contact Hunting — Per-identity mini-agents
// ============================================================================

/**
 * System prompt for per-identity contact hunting mini-agents.
 * Each mini-agent has a tiny budget (1 search + 2 reads) focused on ONE person.
 *
 * Design: maximum agency, minimum prescription.
 * Template variables: {MAX_SEARCHES}, {MAX_PAGE_READS}, {DOMAIN_HINT}, {CURRENT_DATE}
 */
export const SINGLE_CONTACT_PROMPT = `You are searching for the email address of ONE specific person. You have two tools: search_web and read_page.

Budget: {MAX_SEARCHES} search(es), {MAX_PAGE_READS} page read(s).

Rules:
1. Emails you report MUST appear verbatim in a page you read via read_page.
2. Do NOT construct, guess, or infer email addresses.
3. General office emails ARE acceptable (mayor@city.gov, press@org.com) — these are valid published contact paths.
4. Tool responses include contact_hints (pre-extracted emails/phones) and url_hint (page type). Use these however you see fit.
5. If no email found, capture alternatives (phone, form URL, social profile) in contact_notes.
6. An email is only a valid contact path when found on a page with INSTITUTIONAL PROVENANCE — published by the person's organization or in authoritative reporting. The page must connect the email to the person or their office. Third-party sites that aggregate or infer contact information do not establish this connection — the email may be outdated, pattern-generated, or belong to someone who no longer holds the role.
7. If evidence suggests the position is vacant (job postings, recruitment listings, no current holder named), report this in contact_notes rather than returning a recruiter's email.
8. If no email with institutional provenance can be found, return NO_EMAIL_FOUND. A missing email is more useful than one that reaches the wrong person or bounces.
{DOMAIN_HINT}
Today's date: {CURRENT_DATE}

Return a JSON object (no markdown code fences):

{
  "decision_makers": [{
    "name": "Full Name",
    "title": "Concise role (e.g. 'CEO', 'Senator', 'VP of Operations')",
    "organization": "Organization Name",
    "email": "found@email.com or NO_EMAIL_FOUND",
    "email_source": "URL where email appeared in read_page text, or empty string",
    "recency_check": "Identity confirmed via [search evidence]",
    "contact_notes": "Alternative contacts found, or empty string"
  }],
  "research_summary": "What you found"
}

Return JSON directly — no markdown code blocks.`;

/**
 * Build focused user prompt for a single-identity contact hunting mini-agent.
 *
 * When identity is UNKNOWN, the mission expands: identify the person first,
 * then find their email. The agent gets a bigger budget for this (2 searches).
 */
export function buildSingleContactPrompt(
	identity: ResolvedIdentity,
	reasoning: string
): string {
	if (identity.name === 'UNKNOWN') {
		return `Identify who currently holds this position AND find their email address:

**${identity.title}** at ${identity.organization}
Why this position matters: ${reasoning}

Step 1: Search to find the CURRENT person in this role. Use the most recent results.
Step 2: Once you have a name, search for their email.

You MUST return the person's actual name in the "name" field — never return "Unknown" or "UNKNOWN".
If you cannot determine who holds this position, set name to the most specific title you can find.`;
	}

	return `Find the email address for:

**${identity.name}** — ${identity.title} at ${identity.organization}
Identity confirmed via: ${identity.search_evidence}
Why they matter: ${reasoning}`;
}

// ============================================================================
// Phase 2b-batch: Page Selection — Single call to rank and select URLs
// ============================================================================

/**
 * System prompt for batch page selection.
 * Receives all identities with their search results and selects which pages
 * to fetch, respecting a total page budget across all identities.
 *
 * Template variables: {CURRENT_DATE}, {MAX_PAGES_TOTAL}
 */
export const PAGE_SELECTION_PROMPT = `You are a page selection system. Given search results for multiple people, select which web pages to read in order to find their contact information.

## Mission

Select up to {MAX_PAGES_TOTAL} pages total across ALL identities. Allocate budget wisely — prioritize pages most likely to contain email addresses or direct contact information.

## Rules

1. Do NOT invent URLs — only select from the search results provided.
2. If a single page likely contains contacts for multiple people (e.g., a staff directory or leadership page), attribute it to ALL relevant identities. It will only be fetched once.
3. Use url_hint labels (contact_page, press_page, about_page, homepage, other) as signals but not absolute rules — a homepage may contain contact info, and a "contact page" may just have a form.
4. Prefer pages from the organization's own domain over third-party sources.
5. Prefer recent results over older ones when available.
6. If no promising pages exist for an identity, include it in the output with an empty selected_pages array.
7. Stay within the {MAX_PAGES_TOTAL} page budget. Count each unique URL only once toward the budget, even if attributed to multiple identities.
8. Prioritize pages with INSTITUTIONAL PROVENANCE — pages published by the person's organization (staff directories, about/leadership pages, contact pages, press releases) or authoritative reporting (news, government records). These are the only pages that can establish a valid contact path: they connect an email to a person because the institution itself published both.
9. Third-party sites that aggregate or infer contact information are low-value even if they appear to contain emails — they cannot establish that an email is current or routes to this person in their role. Job postings are similarly low-value: they contain recruiter contacts, not the decision-maker's. If the only results for an identity are job postings or aggregator sites, return an empty selected_pages array — the position may be vacant or the contact may not be publicly available.

Today's date: {CURRENT_DATE}

## Output

Return a JSON object:

{
  "page_selections": [
    {
      "identity_index": 0,
      "person_name": "Full Name",
      "organization": "Org Name",
      "selected_pages": [
        { "url": "https://...", "reason": "Brief reason for selecting this page", "url_hint": "contact_page" }
      ]
    }
  ]
}

Include ALL identities from the input, even those with no selected pages.

Return JSON directly — no markdown code blocks.`;

/**
 * Build user prompt for batch page selection.
 * Formats each identity with its search hits for the page selection model.
 */
export function buildPageSelectionPrompt(
	identitySearchResults: Array<{
		identity: ResolvedIdentity;
		reasoning: string;
		hits: Array<{ url: string; title: string; publishedDate?: string; score?: number; url_hint: string }>;
	}>
): string {
	const sections = identitySearchResults
		.map((isr, i) => {
			const hitLines =
				isr.hits.length > 0
					? isr.hits
							.slice(0, 15)
							.map(
								(h, j) =>
									`  ${j + 1}. "${h.title}" (${h.publishedDate || 'no date'}) [${h.url_hint}] — ${h.url}`
							)
							.join('\n')
					: '  (no search results found)';

			return `## Identity ${i}: ${isr.identity.name} — ${isr.identity.title} at ${isr.identity.organization}
Why they matter: ${isr.reasoning}
Search evidence: ${isr.identity.search_evidence}
Search results:\n${hitLines}`;
		})
		.join('\n\n');

	return `Select which pages to read to find contact information for each person.\n\n${sections}`;
}

// ============================================================================
// Phase 2b-batch: Contact Synthesis — Single call to extract contacts from pages
// ============================================================================

/**
 * System prompt for batch contact synthesis.
 * Receives all identities and all fetched page content, then extracts
 * contact information for each person from the page text.
 *
 * Template variables: {CURRENT_DATE}, {DOMAIN_CONTEXT}
 */
export const CONTACT_SYNTHESIS_PROMPT = `You are a contact extraction system. Given page content fetched from the web, find the best available contact path for specific people AND discover additional relevant decision-makers found in the pages.

## Mission

1. For each person in the "search hints" section, find the BEST AVAILABLE contact path from the provided page content. This means: personal email first, then department/board/office email, then general org email. Cross-reference across all pages — an email for person A may appear on a page originally selected for person B. **If a search hint has name "UNKNOWN", identify the current holder from page content and return their real full name in the output.** The name field must always contain the actual person's name, never "UNKNOWN", "Vacant", or any placeholder.
2. ALSO extract other relevant decision-makers you discover in the page content who have direct authority, gatekeeping power, coalition leverage, or amplification reach over the issue described in the Issue Context section. When a page lists a board, committee, council, or staff directory, extract ALL members whose roles give them power over the issue — these are high-value discoveries.

## Rules

1. Emails you report MUST appear VERBATIM in the provided page content or in the "Pre-extracted hints" section. Do NOT construct, guess, or infer email addresses.
2. **CRITICAL — Maximize email coverage using the full contact hierarchy.** When no personal email exists, assign the most relevant organizational email available: department, division, board, committee, or general contact address. Any published email for a person's organization IS a valid contact path to reach them. The "Pre-extracted hints" section lists emails already regex-extracted from each page — treat these as verified present in the page text and USE THEM. Never return NO_EMAIL_FOUND when any email from the person's organization appears in the page content or hints.
3. For each person, cite the specific page URL where the email was found in email_source.
4. Set email to "NO_EMAIL_FOUND" ONLY as an absolute last resort — when no email at all (personal, departmental, press, info, general) appears anywhere in the page content or hints for their organization. Capture alternatives (phone numbers, contact form URLs, social profiles) in contact_notes.
5. The reasoning field must be PERSON-SPECIFIC: explain why THIS individual has power over THIS issue — their authority, jurisdiction, decisions, or institutional leverage. Speak to their relationship with the issue, not to the sources you read. NEVER reference pages, page numbers, documents, or source artifacts in reasoning. 2-3 sentences.
6. Cross-reference across ALL pages: an email relevant to person A may appear on a page attributed to person B. Scan every page for organizational emails that match any person's organization.
7. Verify identity recency: note evidence from the page content that the person currently holds the stated position in recency_check.
8. Prefer the most specific email available: personal > department/division > org-wide > press/info. But ANY level is better than NO_EMAIL_FOUND.
9. For discovered contacts (not in the search hints): set discovered to true and provide issue-specific reasoning explaining why this person is relevant. When you find a directory, board, committee, or leadership page, extract members whose roles give them authority or influence over the issue.

## Evidence Chain

A valid contact path requires three links. If any link is broken, the email is not usable:

1. **Current occupancy**: The page content contains evidence this person CURRENTLY holds this role. Not formerly held, not nominated for, not being recruited for — currently holds. If a page describes the position as vacant or shows a job posting for the role, that person-position link is broken.

2. **Institutional provenance**: The email appears on a page published by the organization itself (staff directory, official website, press release) or in authoritative reporting about the organization (news coverage, government filings). An email that appears only on a third-party site that aggregates or infers contact information has no institutional backing — it may be outdated, pattern-generated, or belong to someone who no longer holds the role.

3. **Person-email co-occurrence**: The email and the person's identity (name or specific role title) are connected on the same page in a way that establishes the email as a contact path for that person or their office. An email that merely exists on the same website — but on an unrelated page — is not a valid connection.

When a link is broken, return NO_EMAIL_FOUND for that person. A missing email is more useful than one that reaches the wrong person, bounces, or routes to a recruiter instead of a decision-maker.
{DOMAIN_CONTEXT}
Today's date: {CURRENT_DATE}

## Output

Return a JSON object matching this schema:

{
  "decision_makers": [
    {
      "name": "Full Name",
      "title": "Concise role",
      "organization": "Organization Name",
      "email": "found@email.com or NO_EMAIL_FOUND",
      "email_source": "URL where email appeared verbatim, or empty string if NO_EMAIL_FOUND",
      "source_url": "URL of the page where this person was mentioned or found",
      "reasoning": "Person-specific justification (2-3 sentences)",
      "recency_check": "Evidence this person currently holds position",
      "contact_notes": "Alternative contacts if no email, or empty string",
      "discovered": false
    }
  ],
  "research_summary": "Brief summary of what was found across all pages"
}

Include ALL people from the search hints, even those for whom no email was found (set discovered to false for these).
For newly discovered contacts from the pages, set discovered to true.

Return JSON directly — no markdown code blocks.`;

/**
 * Build user prompt for batch contact synthesis.
 * Combines identity list with fetched page content and pre-extracted hints.
 */
export function buildContactSynthesisPrompt(
	identities: Array<{
		identity: ResolvedIdentity;
		reasoning: string;
	}>,
	pages: Array<{
		url: string;
		title: string;
		text: string;
		contactHints: { emails: string[]; phones: string[]; socialUrls: string[] };
		attributedTo: number[];
	}>,
	issueContext?: {
		subjectLine: string;
		coreMessage: string;
		topics: string[];
	}
): string {
	// Section 0: Issue context (enables relevance judgment for discovered contacts)
	const issueSection = issueContext
		? `## Issue Context

Subject: ${issueContext.subjectLine}
Core Message: ${issueContext.coreMessage}
Topics: ${issueContext.topics.join(', ')}

`
		: '';

	// Section 1: People to find contacts for
	const peopleSection = identities
		.map((entry, i) => {
			return `${i}. **${entry.identity.name}** — ${entry.identity.title} at ${entry.identity.organization}
   Why they matter: ${entry.reasoning}
   Search evidence: ${entry.identity.search_evidence}`;
		})
		.join('\n\n');

	// Section 2: Page content
	const pagesSection = pages
		.map((page, i) => {
			const attribution = page.attributedTo.map((idx) => {
				const entry = identities[idx];
				return entry ? entry.identity.name : `Identity ${idx}`;
			}).join(', ');

			const hintsLines: string[] = [];
			if (page.contactHints.emails.length > 0) {
				hintsLines.push(`  Emails found: ${page.contactHints.emails.join(', ')}`);
			}
			if (page.contactHints.phones.length > 0) {
				hintsLines.push(`  Phones found: ${page.contactHints.phones.join(', ')}`);
			}
			if (page.contactHints.socialUrls.length > 0) {
				hintsLines.push(`  Social URLs: ${page.contactHints.socialUrls.join(', ')}`);
			}
			const hintsBlock = hintsLines.length > 0
				? `Pre-extracted hints:\n${hintsLines.join('\n')}\n`
				: 'Pre-extracted hints: (none)\n';

			return `### Page ${i + 1}: ${page.title}
URL: ${page.url}
Selected for: ${attribution}
${hintsBlock}
Content:
${page.text}`;
		})
		.join('\n\n---\n\n');

	return `Find contact information for each person using the page content below. Also identify any OTHER relevant decision-makers found in the pages who have direct authority, gatekeeping power, or influence over this issue.

${issueSection}## People to find contacts for (search hints)

${peopleSection}

## Page Content

${pagesSection}`;
}
