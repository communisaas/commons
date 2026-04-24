/**
 * Reducto Document Intelligence Types
 *
 * Type definitions for parsed documents with structure extraction.
 * Enables L3 depth layer with section navigation, entities, and query relevance.
 *
 * @module reducto/types
 */

// ============================================================================
// Document Types
// ============================================================================

/**
 * Document type for visual encoding (peripheral color recognition)
 *
 * Maps to CSS custom properties:
 * - legislative: --doc-legislative (amber)
 * - official: --doc-official (slate)
 * - media: --doc-media (blue)
 * - corporate: --doc-corporate (emerald)
 * - academic: --doc-academic (purple)
 */
export type DocumentType = 'legislative' | 'official' | 'media' | 'corporate' | 'academic';

/**
 * Document source metadata
 */
export interface DocumentSource {
	/** Source name (e.g., "Congress.gov", "SEC EDGAR") */
	name: string;

	/** Source URL */
	url: string;

	/** Publication/filing date */
	date?: string;

	/** Source type for visual encoding */
	type: DocumentType;
}

// ============================================================================
// Parsed Document Structure
// ============================================================================

/**
 * A section within a parsed document
 * Enables hierarchical navigation in L3 view
 */
export interface DocumentSection {
	/** Section identifier (e.g., "§102", "Section 3.1") */
	id: string;

	/** Section title/heading */
	title: string;

	/** Nesting level (0 = top-level) */
	level: number;

	/** Section content (text) */
	content: string;

	/** Child sections */
	children?: DocumentSection[];

	/** Page number(s) in original document */
	pageNumbers?: number[];
}

/**
 * Entity extracted from document
 * Key items for quick scanning (amounts, dates, names)
 */
export interface DocumentEntity {
	/** Entity type */
	type: 'amount' | 'date' | 'person' | 'organization' | 'location' | 'reference';

	/** Entity value as extracted */
	value: string;

	/** Normalized value (e.g., parsed date, numeric amount) */
	normalized?: string | number | Date;

	/** Context around the entity */
	context: string;

	/** Section where entity appears */
	sectionId?: string;
}

/**
 * A passage particularly relevant to the user's query
 */
export interface RelevantPassage {
	/** Passage text */
	text: string;

	/** Section containing this passage */
	sectionId: string;

	/** Relevance score (0-1) */
	score: number;

	/** Why this passage is relevant */
	reason: string;
}

/**
 * Cross-reference to another document
 */
export interface DocumentCrossRef {
	/** Reference text as it appears */
	text: string;

	/** Target document ID (if we have it parsed) */
	targetDocId?: string;

	/** External URL (if resolvable) */
	url?: string;

	/** Type of reference */
	type: 'citation' | 'amendment' | 'supersedes' | 'related';
}

/**
 * Fully parsed document with Reducto intelligence
 *
 * This is what we cache in `parsedDocumentCache` (Convex) and display in L3 view.
 */
export interface ParsedDocument {
	/** Unique document ID (Convex `_id` when cached) */
	id: string;

	/** Document title */
	title: string;

	/** Source information */
	source: DocumentSource;

	/** Document type for visual encoding */
	type: DocumentType;

	/** Hierarchical section structure */
	sections: DocumentSection[];

	/** Extracted entities */
	entities: DocumentEntity[];

	/** Cross-references to other documents */
	crossRefs: DocumentCrossRef[];

	/** Query relevance (computed when retrieved for specific query) */
	queryRelevance?: {
		/** Overall relevance score (0-1) */
		score: number;

		/** Sections most relevant to query */
		relevantSections: string[];

		/** Key passages matching query */
		passages: RelevantPassage[];

		/** Summary of why document is relevant */
		summary: string;
	};

	/** Parsing metadata */
	metadata: {
		/** When document was parsed */
		parsedAt: Date;

		/** Original document URL */
		sourceUrl: string;

		/** Total page count */
		pageCount: number;

		/** Reducto job ID for reference */
		reductoJobId?: string;
	};
}

// ============================================================================
// API Types
// ============================================================================

/**
 * Options for parsing a document
 */
export interface ParseOptions {
	/** URL of document to parse */
	url: string;

	/** Document type hint (auto-detected if not provided) */
	type?: DocumentType;

	/** Query for relevance scoring */
	query?: string;

	/** Whether to extract entities */
	extractEntities?: boolean;

	/** Whether to detect cross-references */
	detectCrossRefs?: boolean;
}

/**
 * Options for analyzing a document
 */
export interface AnalyzeOptions {
	/** Document ID (must be already parsed) */
	documentId: string;

	/** Query to analyze against */
	query: string;

	/** Maximum relevant passages to return */
	maxPassages?: number;
}

/**
 * Parse result from Reducto API
 */
export interface ParseResult {
	/** Whether parsing succeeded */
	success: boolean;

	/** Parsed document (if successful) */
	document?: ParsedDocument;

	/** Error message (if failed) */
	error?: string;

	/** Whether result was from cache */
	cached: boolean;
}

/**
 * Analysis result
 */
export interface AnalysisResult {
	/** Whether analysis succeeded */
	success: boolean;

	/** Query relevance data */
	relevance?: ParsedDocument['queryRelevance'];

	/** Error message (if failed) */
	error?: string;
}

// ============================================================================
// Cache Types
// ============================================================================

// The parsed-document cache lives in Convex as the `parsedDocumentCache` table
// (`convex/schema.ts`). It provides:
//   - A `by_expiresAt` index (cleaned up by the daily cron in `convex/crons.ts`)
//   - A `by_sourceUrlHash` unique-lookup index for deduplication
//   - A `by_documentType` index for filtering
//   - A `hitCount` field for cache statistics
