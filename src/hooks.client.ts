import * as Sentry from '@sentry/sveltekit';
import { initConvex } from 'convex-sveltekit';
import { PUBLIC_CONVEX_URL } from '$env/static/public';

const dsn = import.meta.env.VITE_SENTRY_DSN;

if (dsn) {
	Sentry.init({
		dsn,
		environment: import.meta.env.VITE_ENVIRONMENT || 'development',
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

export const handleError = Sentry.handleErrorWithSentry();
