import * as Sentry from '@sentry/sveltekit';
import { initConvex } from 'convex-sveltekit';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { env as publicEnv } from '$env/dynamic/public';
import type { HandleClientError } from '@sveltejs/kit';

// Sentry DSN comes from CF Pages runtime secret `PUBLIC_SENTRY_DSN` via
// SvelteKit's `$env/dynamic/public`. The previous read of
// `import.meta.env.VITE_SENTRY_DSN` was Vite's build-time injection — CF
// Pages secrets aren't available at the build step (they're runtime), so
// client-side Sentry was dark in production. Dynamic public env reads at
// request time from the worker's platform env and forwards to the browser
// during SSR.
const dsn = publicEnv.PUBLIC_SENTRY_DSN;
const environment = publicEnv.PUBLIC_SENTRY_ENVIRONMENT || 'development';

if (dsn) {
	Sentry.init({
		dsn,
		environment,
		tracesSampleRate: 0,
		// PII masking — replace entire user object with redacted stub
		beforeSend(event) {
			if (event.user) {
				event.user = { id: '[redacted]' };
			}
			return event;
		}
	});
}

// Initialize Convex client early so transport.decode can subscribe
// before any component mounts.
if (PUBLIC_CONVEX_URL) {
	initConvex(PUBLIC_CONVEX_URL);
}

export const handleError = Sentry.handleErrorWithSentry(
	(input: Parameters<HandleClientError>[0]) => {
		// Same as the server-side handler: attach the Sentry event ID to the
		// error object so /+error.svelte can render the copy-able reference.
		console.error('[handleError:client]', input.error);
		const eventId = Sentry.lastEventId();
		return {
			message: 'Internal Error',
			eventId
		};
	}
);
