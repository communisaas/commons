import type { ProcessedDecisionMaker, CustomRecipient } from '$lib/types/template';

/**
 * Process raw decision-maker data from agent
 */
export function processDecisionMakers(
	rawDecisionMakers: Array<{
		name: string;
		title: string;
		organization: string;
		email?: string;
		provenance?: string; // Optional in new schema, might be effectively 'reasoning'
		reasoning?: string; // New field from agent
		sourceUrl?: string; // Agent returns camelCase
		source_url?: string; // Legacy snake_case support
		emailSource?: string; // How email was verified
		emailGrounded?: boolean;
		emailSourceTitle?: string;
		isAiResolved?: boolean;
		accountabilityOpener?: string | null;
		roleCategory?: ProcessedDecisionMaker['roleCategory'];
		relevanceRank?: number;
		publicActions?: string[];
		personalPrompt?: string | null;
		publicRecipientProvenance?: ProcessedDecisionMaker['publicRecipientProvenance'];
		recencyCheck?: string; // Verification text
		metadata?: { positionSourceDate?: string }; // Structure from agent
	}>
): ProcessedDecisionMaker[] {
	return rawDecisionMakers.map((dm) => {
		// Handle both legacy (provenance) and new (reasoning) formats
		const reasoningText =
			dm.reasoning || (dm.provenance ? extractReasoning(dm.provenance) : 'No reasoning provided');
		// Support both camelCase (agent output) and snake_case (legacy)
		const sourceUrl =
			dm.sourceUrl || dm.source_url || (dm.provenance ? extractSource(dm.provenance) : undefined);

		return {
			...dm,
			reasoning: reasoningText,
			source: sourceUrl,
			isAiResolved: true,
			// Ensure provenance is always a string to satisfy typscript if needed, or just let it match the input
			provenance: dm.provenance || '',
			recencyCheck: dm.recencyCheck,
			positionSourceDate: dm.metadata?.positionSourceDate
		};
	});
}

/**
 * Extract reasoning (why this person matters) from provenance
 * Handles two formats:
 * 1. "URL (reasoning text)" - reasoning in parentheses after URL
 * 2. "Reasoning text. Source: URL" - reasoning before source marker
 */
export function extractReasoning(provenance: string | undefined): string {
	if (!provenance) return '';

	// Format 1: URL (reasoning) - extract text in parentheses
	const parenMatch = provenance.match(/\(([^)]+)\)/);
	if (parenMatch) {
		return parenMatch[1].trim();
	}

	// Format 2: Remove URL if it's at the start
	const text = provenance.replace(/^https?:\/\/[^\s]+\s*/, '').trim();

	// Split on common provenance markers
	const parts = text.split(/Source:|Email format verified|His role|Her role/i);
	const reasoning = parts[0].trim();

	// If we still have a URL at the start, just use the full text
	if (reasoning.startsWith('http')) {
		return 'Decision-maker contact verified';
	}

	// Return first sentence or first 150 chars
	const firstSentence = reasoning.match(/^[^.!?]+[.!?]/);
	if (firstSentence) {
		return firstSentence[0];
	}

	return reasoning.substring(0, 150) + (reasoning.length > 150 ? '...' : '');
}

/**
 * Extract verification URL from provenance
 */
export function extractSource(provenance: string | undefined): string | undefined {
	if (!provenance) return undefined;
	const urlMatch = provenance.match(/https?:\/\/[^\s)]+/);
	return urlMatch?.[0];
}

/**
 * Convert decision-makers to recipient emails for template
 */
export function extractRecipientEmails(
	decisionMakers: ProcessedDecisionMaker[] | undefined,
	customRecipients: CustomRecipient[] | undefined,
	includesCongress: boolean
): string[] {
	const emails: string[] = [];

	// AI-resolved decision-makers
	if (decisionMakers) {
		decisionMakers.forEach((dm) => {
			if (dm.email) emails.push(dm.email);
		});
	}

	// Custom recipients
	if (customRecipients) {
		customRecipients.forEach((cr) => {
			emails.push(cr.email);
		});
	}

	// Congressional routing — use real relay address (not a sentinel token)
	if (includesCongress) {
		emails.push('congress@commons.email');
	}

	return emails;
}

/**
 * Check if email already exists in recipient lists
 */
export function isDuplicateEmail(
	email: string,
	decisionMakers: ProcessedDecisionMaker[] | undefined,
	customRecipients: CustomRecipient[] | undefined
): boolean {
	const normalizedEmail = email.toLowerCase().trim();

	// Check decision-makers
	const inDecisionMakers =
		decisionMakers?.some((dm) => dm.email?.toLowerCase().trim() === normalizedEmail) || false;

	// Check custom recipients
	const inCustomRecipients =
		customRecipients?.some((cr) => cr.email.toLowerCase().trim() === normalizedEmail) || false;

	return inDecisionMakers || inCustomRecipients;
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	return emailRegex.test(email);
}
