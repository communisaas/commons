import { apiError } from './response';

/** Map the shared Convex webhook policy result without leaking internals. */
export function webhookPolicyError(error: string | null, event?: string): Response | null {
	if (error === null) return null;
	switch (error) {
		case 'not_found':
			return apiError('NOT_FOUND', 'Webhook not found', 404);
		case 'subscription_limit':
			return apiError('CONFLICT', 'The organization webhook limit has been reached', 409);
		case 'creation_throttled':
			return apiError('RATE_LIMITED', 'Webhook creation is temporarily throttled', 429);
		case 'destination_policy_invalid':
			return apiError('SERVICE_UNAVAILABLE', 'Webhook destination policy is not configured', 503);
		case 'invalid_url':
			return apiError('BAD_REQUEST', 'url is malformed', 400);
		case 'invalid_url_scheme':
			return apiError('BAD_REQUEST', 'url must use HTTPS', 400);
		case 'url_too_long':
			return apiError('BAD_REQUEST', 'url is too long', 400);
		case 'destination_credentials':
			return apiError('BAD_REQUEST', 'url must not contain credentials', 400);
		case 'destination_fragment':
			return apiError('BAD_REQUEST', 'url must not contain a fragment', 400);
		case 'destination_private':
			return apiError('BAD_REQUEST', 'url must resolve to a public destination', 400);
		case 'destination_not_allowed':
			return apiError('BAD_REQUEST', 'url origin is not trusted for webhook egress', 400);
		case 'empty_events':
			return apiError('BAD_REQUEST', 'events array cannot be empty', 400);
		case 'too_many_events':
			return apiError('BAD_REQUEST', 'events array has too many entries', 400);
		case 'event_too_long':
			return apiError('BAD_REQUEST', 'event name is too long', 400);
		case 'unknown_event':
			return apiError('BAD_REQUEST', `Unknown event type: ${event ?? ''}`.trim(), 400);
		case 'description_too_long':
			return apiError('BAD_REQUEST', 'description is too long', 400);
		default:
			return apiError('SERVER_ERROR', 'Webhook operation failed', 500);
	}
}
