/**
 * Sentry monitoring helper — thin wrapper for error capture with app context.
 *
 * Safe to call even when Sentry is not initialized (e.g., dev without DSN).
 * Never throws — errors in Sentry itself are swallowed and logged to console.
 */
import * as Sentry from '@sentry/sveltekit';

type SentryLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

export function captureWithContext(
	error: unknown,
	context?: { userId?: string; orgId?: string; action?: string; level?: SentryLevel }
) {
	try {
		const { level, ...appContext } = context ?? {};
		Sentry.captureException(error, {
			level,
			contexts: Object.keys(appContext).length > 0 ? { app: appContext } : undefined
		});
	} catch {
		// Sentry not available or not initialized — console fallback.
		// Preserve level and context so an operator inspecting logs can still
		// distinguish P0 (level=fatal) from noise, and see which subsystem
		// raised the event (action field).
		const tag = context?.level ? `[${context.level.toUpperCase()}]` : '[ERROR]';
		const action = context?.action ? ` ${context.action}` : '';
		console.error(`[monitoring]${tag}${action}`, error, context);
	}
}
