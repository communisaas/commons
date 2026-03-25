/**
 * Sentry monitoring helper — thin wrapper for error capture with app context.
 *
 * Safe to call even when Sentry is not initialized (e.g., dev without DSN).
 * Never throws — errors in Sentry itself are swallowed and logged to console.
 */
import * as Sentry from '@sentry/sveltekit';

export function captureWithContext(
	error: unknown,
	context?: { userId?: string; orgId?: string; action?: string }
) {
	try {
		Sentry.captureException(error, {
			contexts: context ? { app: context } : undefined
		});
	} catch {
		// Sentry not available or not initialized — console fallback
		console.error('[monitoring]', error);
	}
}
