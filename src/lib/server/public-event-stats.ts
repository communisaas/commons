import { getCachedPublicData } from '$lib/server/public-discovery-cache';

export const EVENT_STATS_POLL_MS = 30_000;
export const EVENT_STATS_K_ANONYMITY = 5;

export type PublicEventStats = {
	rsvpCount: number | null;
	attendeeCount: number | null;
	verifiedAttendees: number | null;
	goingCount: number | null;
	maybeCount: number | null;
	kAnonymityThreshold: 5;
};

function projectCount(value: unknown): number | null {
	if (value === null) return null;
	if (!Number.isSafeInteger(value) || (value as number) < EVENT_STATS_K_ANONYMITY) return null;
	return value as number;
}

/** Re-apply the privacy boundary when hydrating an edge-cached envelope. */
export function projectPublicEventStats(value: unknown): PublicEventStats {
	if (!value || typeof value !== 'object') throw new Error('EVENT_STATS_CACHE_INVALID');
	const candidate = value as Record<string, unknown>;
	return {
		rsvpCount: projectCount(candidate.rsvpCount),
		attendeeCount: projectCount(candidate.attendeeCount),
		verifiedAttendees: projectCount(candidate.verifiedAttendees),
		goingCount: projectCount(candidate.goingCount),
		maybeCount: projectCount(candidate.maybeCount),
		kAnonymityThreshold: EVENT_STATS_K_ANONYMITY
	};
}

/**
 * Share one Convex result across all viewers in an edge location for a complete
 * browser polling interval. The existing public-data cache uses Cloudflare's
 * free Cache API when available and a bounded/coalesced isolate map elsewhere;
 * no paid KV write or Durable Object is required.
 */
export function getCachedPublicEventStats(
	eventId: string,
	context: { url: URL; platform?: App.Platform },
	loader: () => Promise<PublicEventStats>
): Promise<PublicEventStats> {
	if (eventId.length === 0 || eventId.length > 128) {
		return Promise.reject(new Error('EVENT_ID_INVALID'));
	}
	return getCachedPublicData(
		`event-live-stats:${eventId}`,
		{
			...context,
			freshForMs: EVENT_STATS_POLL_MS,
			refreshMode: 'blocking',
			r2Policy: 'none',
			projectCachedValue: projectPublicEventStats
		},
		loader
	);
}
