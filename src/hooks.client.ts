import * as Sentry from '@sentry/sveltekit';

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

export const handleError = Sentry.handleErrorWithSentry();
