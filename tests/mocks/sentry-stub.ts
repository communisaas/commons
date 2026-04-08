/**
 * Sentry monitoring stub for tests.
 *
 * Replaces $lib/server/monitoring/sentry so tests don't pull in the
 * @sentry/sveltekit → @sentry/node → @opentelemetry/api dep chain.
 * @opentelemetry/api@1.9.0 has a broken ESM build that crashes
 * Node's native ESM loader.
 *
 * See vitest.config.ts resolve.alias for the wiring.
 */

export function captureWithContext(_error: unknown, _context?: Record<string, unknown>): void {
	// noop in tests
}

export function captureMessageWithContext(
	_message: string,
	_level?: string,
	_context?: Record<string, unknown>
): void {
	// noop in tests
}
