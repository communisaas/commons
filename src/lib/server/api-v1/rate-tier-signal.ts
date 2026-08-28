import { AsyncLocalStorage } from 'node:async_hooks';

export const API_V1_EDGE_REQUEST_HEADER = 'x-commons-api-v1-edge';
export const API_V1_RATE_TIER_HEADER = 'x-commons-internal-api-rate-tier';
export const API_V1_EDGE_PROTOCOL_VERSION = 'v1';

export type ApiV1RateTierSignal = 'inactive' | 'starter' | 'organization' | 'coalition' | 'invalid';

type SignalStore = { value?: ApiV1RateTierSignal };
const rateTierSignal = new AsyncLocalStorage<SignalStore>();

/** Run one API request in an isolate-safe signal scope. */
export function withApiV1RateTierSignal<T>(callback: () => Promise<T>): Promise<T> {
	return rateTierSignal.run({}, callback);
}

/** Called only after the exact Convex auth mutation has resolved. */
export function recordApiV1RateTierSignal(value: ApiV1RateTierSignal): void {
	const store = rateTierSignal.getStore();
	if (store) store.value = value;
}

export function getApiV1RateTierSignal(): ApiV1RateTierSignal | undefined {
	return rateTierSignal.getStore()?.value;
}
