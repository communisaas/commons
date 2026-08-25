import type { Handle } from '@sveltejs/kit';
import {
	waitForConvexWorkBudgetReservations,
	type ConvexWorkBudgetEvent,
	type ConvexWorkBudgetObservation,
	type ConvexWorkBudgetRejection
} from '$lib/server/convex-work-budget-client';

function noStoreHeaders(headers = new Headers()): Headers {
	headers.set('cache-control', 'private, no-store, max-age=0');
	headers.set('cdn-cache-control', 'no-store');
	headers.set('cloudflare-cdn-cache-control', 'no-store');
	return headers;
}

function addObservationHeaders(headers: Headers, observation: ConvexWorkBudgetObservation): void {
	headers.set('x-convex-work-budget-daily-remaining', String(observation.dailyRemainingUnits));
	headers.set('x-convex-work-budget-daily-reset-at', String(observation.dailyResetAtSeconds));
	headers.set('x-convex-work-budget-monthly-remaining', String(observation.monthlyRemainingUnits));
	headers.set('x-convex-work-budget-monthly-reset-at', String(observation.monthlyResetAtSeconds));
}

export function convexWorkBudgetRejectionResponse(
	rejection: ConvexWorkBudgetRejection,
	method = 'GET'
): Response {
	const headers = noStoreHeaders(
		new Headers({
			'content-type': 'application/json; charset=utf-8',
			'retry-after': String(rejection.retryAfterSeconds)
		})
	);
	return new Response(
		method === 'HEAD'
			? null
			: JSON.stringify({
					code: rejection.code,
					// Names WHICH precondition refused. Without it every one of the
					// seven unavailable paths is the same opaque 503.
					...(rejection.reason ? { reason: rejection.reason } : {}),
					error:
						rejection.status === 429
							? 'Convex work budget exhausted'
							: 'Convex work budget unavailable',
					retryable: true
				}),
		{ headers, status: rejection.status }
	);
}

/**
 * Converts even route-caught or fire-and-forget reservation failures into the
 * same typed fail-closed response. It must wrap auth and every route loader.
 */
export const handleConvexWorkBudgetResponses: Handle = async ({ event, resolve }) => {
	let response: Response | undefined;
	let thrown: unknown;
	try {
		response = await resolve(event);
	} catch (error) {
		thrown = error;
	}
	await waitForConvexWorkBudgetReservations(event as ConvexWorkBudgetEvent);
	const rejection = event.locals.convexWorkBudgetRejection;
	if (rejection) return convexWorkBudgetRejectionResponse(rejection, event.request.method);
	if (thrown !== undefined) throw thrown;
	if (!response) throw new Error('CONVEX_WORK_BUDGET_RESPONSE_MISSING');
	const observation = event.locals.convexWorkBudgetObservation;
	// Exact balances help explicitly authorized operators diagnose the boundary but are
	// not an anonymous oracle for tuning an exhaustion attack.
	if (
		!observation ||
		(!event.locals.convexWorkBudgetOperatorAuthorized &&
			!event.locals.publicDiscoveryManifestRefreshAuthenticated)
	) {
		return response;
	}
	const headers = new Headers(response.headers);
	addObservationHeaders(headers, observation);
	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText
	});
};
