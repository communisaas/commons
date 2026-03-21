/**
 * Normalized bill ingestion types shared between Congress.gov and Open States.
 *
 * Both data sources normalize to BillIngestion before upsert into the Bill table.
 * This decouples source-specific API shapes from our internal model.
 */

/** Sponsor extracted from a bill */
export interface BillSponsor {
	name: string;
	externalId: string; // bioguide_id (federal) or openstates people_id (state)
	party: string | null;
}

/** Normalized bill data ready for upsert */
export interface BillIngestion {
	/** Canonical external ID: "{chamber}-{number}-{congress}" (federal) or "{state}-{chamber}-{number}-{session}" (state) */
	externalId: string;
	/** e.g. "us-federal", "us-state-ca", "uk-parliament" */
	jurisdiction: string;
	/** "federal" | "state" | "local" */
	jurisdictionLevel: 'federal' | 'state' | 'local';
	/** "house" | "senate" | null */
	chamber: string | null;
	title: string;
	summary: string | null;
	/** "introduced" | "committee" | "floor" | "passed" | "failed" | "signed" | "vetoed" */
	status: string;
	statusDate: Date;
	sponsors: BillSponsor[];
	committees: string[];
	sourceUrl: string;
	fullTextUrl: string | null;
	topics: string[];
	entities: string[];
}

/** Result of an ingestion run */
export interface IngestionResult {
	/** Number of bills upserted */
	upserted: number;
	/** Number of bills that had status changes */
	statusChanged: number;
	/** Cursor for next invocation (null = all pages consumed) */
	nextCursor: string | null;
	/** Errors encountered (non-fatal) */
	errors: string[];
}

/** Cursor state persisted between cron invocations */
export interface IngestionCursor {
	/** API offset or page token */
	offset: number;
	/** Timestamp of last successful sync (ISO 8601) */
	lastSyncedAt: string;
	/** Consecutive API error count (triggers fallback at 3) */
	consecutiveErrors: number;
}
