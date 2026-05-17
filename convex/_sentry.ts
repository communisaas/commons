/**
 * Direct-HTTP Sentry capture for Convex actions.
 *
 * Convex's runtime can't import `@sentry/sveltekit` (it's a SvelteKit-
 * specific package). Queries and mutations also can't make HTTP calls —
 * only actions can. So this helper is the option-(a) path from the
 * error-observability hypergraph: actions catch their own throws and
 * POST a minimal Sentry envelope directly to the ingest endpoint.
 *
 * Intentional alerts (like BOUNDARY_CELL_RATE_HIGH) still route through
 * `/api/internal/alert` → SvelteKit's `captureWithContext` → Sentry SDK,
 * which gives the full breadcrumbs/trace/release attribution. This
 * helper is for *uncaught exceptions* in Convex actions where the action
 * itself can't rely on the SvelteKit side being reachable.
 *
 * Usage pattern:
 *
 *   export const someAction = action({
 *     args: { ... },
 *     handler: async (ctx, args) => {
 *       try {
 *         // work
 *       } catch (err) {
 *         await captureToSentry(err, { action: "someAction" });
 *         throw err;
 *       }
 *     }
 *   });
 *
 * Required env on Convex prod:
 *   SENTRY_DSN          — same DSN value used on CF Pages (project ingest)
 *   SENTRY_ENVIRONMENT  — "production" / "staging" / etc.
 *
 * Never throws. If the DSN is missing or the POST fails, the function
 * logs a warning and returns — the caller's own rethrow is what
 * surfaces the original failure to the user.
 */

const SENTRY_CLIENT = "commons-convex/1.0";

export type SentryLevel = "fatal" | "error" | "warning" | "info" | "debug";

export interface CaptureContext {
	/** Convex function name — becomes Sentry tag + extra.action. */
	action?: string;
	/** Anonymized userId if known; PII is scrubbed on the SvelteKit side too. */
	userId?: string;
	/** Org id if relevant. */
	orgId?: string;
	/** Severity. Defaults to `error`. */
	level?: SentryLevel;
	/** Arbitrary key-value context. Goes to `extra` on the event. */
	extra?: Record<string, unknown>;
}

interface ParsedDsn {
	publicKey: string;
	host: string;
	projectId: string;
}

function parseDsn(dsn: string): ParsedDsn | null {
	// DSN shape: https://<KEY>@<HOST>/<PROJECT_ID>
	const match = dsn.match(/^https?:\/\/([^@]+)@([^/]+)\/(\d+)$/);
	if (!match) return null;
	return { publicKey: match[1], host: match[2], projectId: match[3] };
}

function makeEventId(): string {
	// Sentry expects 32 hex chars (no dashes).
	return crypto.randomUUID().replace(/-/g, "");
}

interface StackFrame {
	function?: string;
	filename?: string;
	lineno?: number;
	colno?: number;
	in_app?: boolean;
}

function parseStack(stack: string | undefined): StackFrame[] | undefined {
	if (!stack) return undefined;
	const frames: StackFrame[] = [];
	// First line is usually the error message itself; skip it.
	const lines = stack.split("\n").slice(1, 21);
	for (const raw of lines) {
		const line = raw.trim();
		if (!line.startsWith("at ")) continue;
		// `at functionName (file:line:col)` or `at file:line:col`
		const withFn = line.match(/^at\s+(.+?)\s+\(([^)]+):(\d+):(\d+)\)$/);
		const withoutFn = line.match(/^at\s+([^()]+):(\d+):(\d+)$/);
		if (withFn) {
			frames.push({
				function: withFn[1],
				filename: withFn[2],
				lineno: Number.parseInt(withFn[3], 10),
				colno: Number.parseInt(withFn[4], 10),
				in_app: true,
			});
		} else if (withoutFn) {
			frames.push({
				filename: withoutFn[1],
				lineno: Number.parseInt(withoutFn[2], 10),
				colno: Number.parseInt(withoutFn[3], 10),
				in_app: true,
			});
		}
	}
	return frames.length > 0 ? frames : undefined;
}

export async function captureToSentry(
	error: unknown,
	context?: CaptureContext,
): Promise<void> {
	const dsn = process.env.SENTRY_DSN;
	if (!dsn) return; // No-op when not configured (dev / staging without Sentry).

	const parsed = parseDsn(dsn);
	if (!parsed) {
		console.warn("[Sentry/convex] Invalid SENTRY_DSN format; skipping capture");
		return;
	}

	const eventId = makeEventId();
	const timestamp = new Date().toISOString();
	const environment =
		process.env.SENTRY_ENVIRONMENT || process.env.PUBLIC_SENTRY_ENVIRONMENT || "development";

	const errObj = error instanceof Error ? error : new Error(String(error));
	const message = errObj.message || "Unknown error";
	const frames = parseStack(errObj.stack);

	const event: Record<string, unknown> = {
		event_id: eventId,
		timestamp,
		platform: "javascript",
		level: context?.level ?? "error",
		environment,
		server_name: "convex",
		sdk: { name: SENTRY_CLIENT, version: "1.0" },
		message,
	};

	if (frames) {
		event.exception = {
			values: [
				{
					type: errObj.name || "Error",
					value: message,
					stacktrace: { frames },
				},
			],
		};
	}

	const extra: Record<string, unknown> = {
		...(context?.extra ?? {}),
		...(context?.userId ? { userId: context.userId } : {}),
		...(context?.orgId ? { orgId: context.orgId } : {}),
		...(context?.action ? { action: context.action } : {}),
	};
	if (Object.keys(extra).length > 0) event.extra = extra;

	if (context?.action) {
		event.tags = { action: context.action };
	}

	// Envelope = newline-separated JSON: header, item-header, item-body.
	const envelope =
		JSON.stringify({ event_id: eventId, sent_at: timestamp, dsn }) +
		"\n" +
		JSON.stringify({ type: "event", content_type: "application/json" }) +
		"\n" +
		JSON.stringify(event);

	const url = `https://${parsed.host}/api/${parsed.projectId}/envelope/`;
	const authHeader = `Sentry sentry_version=7,sentry_client=${SENTRY_CLIENT},sentry_key=${parsed.publicKey}`;

	try {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-sentry-envelope",
				"X-Sentry-Auth": authHeader,
			},
			body: envelope,
			// Cap the wait so a slow/blocked ingest endpoint can't tie up a
			// Convex action's execution beyond the original error rethrow.
			signal: AbortSignal.timeout(5_000),
		});
		if (!response.ok) {
			console.warn(
				`[Sentry/convex] Capture POST failed: ${response.status} ${response.statusText}`,
			);
		}
	} catch (err) {
		// Reporter must never throw — log and move on. The caller is about
		// to rethrow the original error, which is what actually matters.
		console.warn(
			"[Sentry/convex] Capture POST exception:",
			err instanceof Error ? err.message : String(err),
		);
	}
}
