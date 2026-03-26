/**
 * Reducto Client — Stub
 *
 * Document parsing client for the analyze_document agent tool.
 * Returns empty results until a Reducto API key is configured.
 *
 * Production note: Implement with real Reducto API calls when
 * document intelligence is prioritized.
 */

import type { ParseOptions, ParseResult, AnalyzeOptions, AnalysisResult } from './types';

// ============================================================================
// Client Interface
// ============================================================================

export interface ReductoClient {
	parse(options: ParseOptions): Promise<ParseResult>;
	analyze(options: AnalyzeOptions): Promise<AnalysisResult>;
}

// ============================================================================
// Stub Implementation
// ============================================================================

class StubReductoClient implements ReductoClient {
	async parse(options: ParseOptions): Promise<ParseResult> {
		console.debug(`[reducto] Stub: parse called for ${options.url} (no API key configured)`);
		return {
			success: false,
			error: 'Reducto API not configured. Set REDUCTO_API_KEY to enable document parsing.',
			cached: false
		};
	}

	async analyze(options: AnalyzeOptions): Promise<AnalysisResult> {
		console.debug(`[reducto] Stub: analyze called for ${options.documentId} (no API key configured)`);
		return {
			success: false,
			error: 'Reducto API not configured.'
		};
	}
}

// ============================================================================
// Singleton
// ============================================================================

let client: ReductoClient | undefined;

/**
 * Get the Reducto client singleton.
 * Returns a stub if no API key is configured.
 */
export function getReductoClient(): ReductoClient {
	if (!client) {
		client = new StubReductoClient();
	}
	return client;
}

/**
 * Parse a document from a URL (convenience wrapper).
 */
export async function parseDocument(url: string): Promise<{ text: string; pages: number }> {
	const result = await getReductoClient().parse({ url });
	if (!result.success || !result.document) {
		return { text: '', pages: 0 };
	}
	const text = result.document.sections.map((s) => s.content).join('\n\n');
	return { text, pages: result.document.metadata.pageCount };
}
