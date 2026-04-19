import type { Source } from '$lib/types/template';

/**
 * Extract all citation numbers from message text
 * @param message - Message text containing [1][2][3] style citations
 * @returns Array of citation numbers found in the message
 */
export function extractCitations(message: string): number[] {
	const citationRegex = /\[(\d+)\]/g;
	const matches = message.matchAll(citationRegex);
	return Array.from(matches, (m) => parseInt(m[1], 10));
}

/**
 * Validate that all citations in message have corresponding sources
 * @param message - Message text with citations
 * @param sources - Available source objects
 * @returns Object with valid flag and missing citation numbers
 */
export function validateCitations(
	message: string,
	sources: Source[]
): { valid: boolean; missing: number[] } {
	const citationNumbers = extractCitations(message);
	const sourceNumbers = new Set(sources.map((s) => s.num));

	const missing = citationNumbers.filter((num) => !sourceNumbers.has(num));

	return {
		valid: missing.length === 0,
		missing
	};
}

/**
 * Convert message with [1][2][3] citations to HTML with clickable links
 * @param message - Message text with inline citations
 * @param sources - Source objects for linking
 * @returns HTML string with citation links
 */
export function linkifyCitations(message: string, sources: Source[]): string {
	const sourceMap = new Map(sources.map((s) => [s.num, s]));

	return message.replace(/\[(\d+)\]/g, (match, numStr) => {
		const num = parseInt(numStr, 10);
		const source = sourceMap.get(num);

		if (!source) {
			// Citation without source - keep as plain text
			return match;
		}

		// Return HTML link with data attribute for click handling
		return `<a href="${source.url}" target="_blank" rel="noopener noreferrer" class="citation-link" data-citation="${num}">[${num}]</a>`;
	});
}

/**
 * Format source for citation display
 * @param source - Source object
 * @returns Formatted citation string
 */
export function formatSourceCitation(source: Source): string {
	const typeLabels: Record<Source['type'], string> = {
		journalism: 'News',
		research: 'Research',
		government: 'Government',
		legal: 'Legal',
		advocacy: 'Advocacy',
		other: 'Other'
	};

	const typeLabel = typeLabels[source.type] || source.type;
	return `[${source.num}] ${source.title} (${typeLabel})`;
}

/**
 * Get source type badge color
 * @param type - Source type
 * @returns Tailwind color classes
 */
export function getSourceTypeBadge(type: Source['type']): {
	bg: string;
	text: string;
	border: string;
} {
	const badges: Record<Source['type'], { bg: string; text: string; border: string }> = {
		journalism: {
			bg: 'bg-blue-50',
			text: 'text-blue-700',
			border: 'border-blue-200'
		},
		research: {
			bg: 'bg-slate-50',
			text: 'text-slate-700',
			border: 'border-slate-200'
		},
		government: {
			bg: 'bg-slate-50',
			text: 'text-slate-700',
			border: 'border-slate-200'
		},
		legal: {
			bg: 'bg-amber-50',
			text: 'text-amber-700',
			border: 'border-amber-200'
		},
		advocacy: {
			bg: 'bg-emerald-50',
			text: 'text-emerald-700',
			border: 'border-emerald-200'
		},
		other: {
			bg: 'bg-gray-50',
			text: 'text-gray-700',
			border: 'border-gray-200'
		}
	};

	return badges[type] || badges.journalism;
}

/**
 * Clean HTML formatting from message text
 * Converts HTML tags to clean text while preserving structure:
 * - <b>, <strong> → **text** (markdown bold)
 * - <i>, <em> → *text* (markdown italic)
 * - <br>, <br/> → newline
 * - All other tags → stripped
 * @param message - Message text with HTML tags
 * @returns Clean text with markdown-style formatting
 */
export function cleanHtmlFormatting(message: string): string {
	return (
		message
			// Convert <b> and <strong> to markdown bold
			.replace(/<b>(.*?)<\/b>/gi, '**$1**')
			.replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
			// Convert <i> and <em> to markdown italic
			.replace(/<i>(.*?)<\/i>/gi, '*$1*')
			.replace(/<em>(.*?)<\/em>/gi, '*$1*')
			// Convert <br> to newlines
			.replace(/<br\s*\/?>/gi, '\n')
			// Strip all other HTML tags
			.replace(/<[^>]+>/g, '')
			// Clean up multiple consecutive newlines
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	);
}

/**
 * Split message into paragraphs for better rendering
 * Handles both \n\n and <br><br> style paragraph breaks
 * @param message - Full message text (may contain HTML)
 * @returns Array of paragraph strings
 */
export function splitIntoParagraphs(message: string): string[] {
	// First clean HTML formatting
	const cleaned = cleanHtmlFormatting(message);

	return cleaned
		.split('\n\n')
		.map((p) => p.trim())
		.filter((p) => p.length > 0);
}

/**
 * Count words in message (excluding citations)
 * @param message - Message text
 * @returns Word count
 */
export function countWords(message: string): number {
	const withoutCitations = message.replace(/\[\d+\]/g, '');
	const words = withoutCitations.trim().split(/\s+/);
	return words.filter((w) => w.length > 0).length;
}

/**
 * Estimate reading time in minutes
 * @param message - Message text
 * @returns Reading time in minutes (rounded up)
 */
export function estimateReadingTime(message: string): number {
	const wordCount = countWords(message);
	const wordsPerMinute = 200; // Average reading speed
	return Math.ceil(wordCount / wordsPerMinute);
}

/**
 * Check if message contains any citations
 * @param message - Message text
 * @returns True if message contains [1] style citations
 */
export function hasCitations(message: string): boolean {
	return /\[\d+\]/.test(message);
}

/**
 * Append a References section to the message if it has sources
 * Places references at the BOTTOM for maximum trust without interrupting message flow
 * @param message - Message text with citations
 * @param sources - Array of source objects
 * @returns Message with References section appended
 */
export function appendReferences(message: string, sources: Source[]): string {
	if (!sources || sources.length === 0 || !hasCitations(message)) {
		return message;
	}

	// Sort sources by citation number
	const sortedSources = [...sources].sort((a, b) => a.num - b.num);

	// Build references section
	const referencesSeparator = '\n\n--- REFERENCES ---\n\n';
	const referencesList = sortedSources
		.map((source) => {
			return `[${source.num}] ${source.title}\n${source.url}`;
		})
		.join('\n\n');

	return message + referencesSeparator + referencesList;
}
