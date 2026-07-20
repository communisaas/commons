const DAY_MS = 24 * 60 * 60 * 1000;
const RENEWAL_WINDOW_MS = 15 * DAY_MS;
const RENEWAL_LENGTH_MS = 30 * DAY_MS;

export type SessionWindow = {
	expiresAt: number;
	absoluteExpiresAt: number;
};

export type ValidSessionWindow = {
	valid: true;
	renewed: boolean;
	effectiveExpiresAt: number;
	renewTo: number | null;
};

/**
 * The request clock is explicit so Convex can cache the stable session and
 * authority rows. Both the cookie and database renewal are capped by the
 * immutable absolute lifetime.
 */
export function evaluateSessionWindow(
	session: SessionWindow,
	now: number
): ValidSessionWindow | { valid: false } {
	if (
		!Number.isFinite(now) ||
		!Number.isFinite(session.expiresAt) ||
		!Number.isFinite(session.absoluteExpiresAt)
	) {
		return { valid: false };
	}

	const hardExpiry = Math.min(session.expiresAt, session.absoluteExpiresAt);
	if (now >= hardExpiry) return { valid: false };

	const renewed = now >= session.expiresAt - RENEWAL_WINDOW_MS;
	if (!renewed) {
		return {
			valid: true,
			renewed: false,
			effectiveExpiresAt: hardExpiry,
			renewTo: null
		};
	}

	const renewTo = Math.min(now + RENEWAL_LENGTH_MS, session.absoluteExpiresAt);
	if (renewTo <= now) return { valid: false };
	return {
		valid: true,
		renewed: true,
		effectiveExpiresAt: renewTo,
		renewTo: renewTo
	};
}
