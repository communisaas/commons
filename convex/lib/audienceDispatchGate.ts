/**
 * Launch gate for bulk audience delivery.
 *
 * Cursor-per-transaction cohort reads are bounded, but they are not immutable:
 * supporter consent, tags, and action projections may change between pages.
 * No email or SMS carrier authority may open until a durable membership job
 * freezes the candidate set and proves idempotent dispatch retries.
 */
export const AUDIENCE_DISPATCH_JOBS_READY = false;

export function requireAudienceDispatchJobsReady(): void {
	if (!AUDIENCE_DISPATCH_JOBS_READY) {
		throw new Error('AUDIENCE_DISPATCH_JOBS_NOT_READY');
	}
}
