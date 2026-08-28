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

export type CapturedSentryEvent = Readonly<{
	error: unknown;
	context?: Readonly<Record<string, unknown>>;
}>;

export const capturedSentryEvents: CapturedSentryEvent[] = [];

export const resetCapturedSentryEvents = (): void => {
	capturedSentryEvents.length = 0;
};

export function captureWithContext(
	error: unknown,
	context?: Readonly<Record<string, unknown>>
): void {
	capturedSentryEvents.push({ error, context });
}
