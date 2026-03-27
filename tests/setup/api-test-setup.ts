/**
 * API Test Setup Infrastructure
 *
 * Provides MSW-based external service mocking for integration tests.
 * Post-Convex migration: no Prisma, no direct DB access.
 */

import { beforeAll, afterAll, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { externalServiceHandlers } from '../mocks/external-services';

// MSW server for external service mocking
export const server = setupServer(...externalServiceHandlers);

// Start MSW server before all tests
beforeAll(() => {
	server.listen({ onUnhandledRequest: 'error' });
});

// Reset MSW handlers between tests
beforeEach(() => {
	server.resetHandlers();
});

// Clean up MSW server after all tests
afterAll(() => {
	server.close();
});

/**
 * Mock SvelteKit RequestEvent factory for route handler testing.
 */
function createMockRequest(options: {
	url: string;
	method: string;
	body?: string;
	headers?: Record<string, string>;
}) {
	const url = new URL(options.url, 'http://localhost:5173');

	return new Request(url.toString(), {
		method: options.method,
		body: options.body,
		headers: {
			'content-type': 'application/json',
			...options.headers
		}
	});
}

export function createMockRequestEvent<
	Params extends Record<string, string> = Record<string, string>,
	RouteId extends string = string
>(options: {
	url: string;
	method: string;
	body?: string;
	headers?: Record<string, string>;
	params?: Record<string, string>;
	locals?: Record<string, any>;
}) {
	const request = createMockRequest(options);

	const mockSpan = {
		setAttribute: () => {},
		setAttributes: () => {},
		addEvent: () => {},
		setStatus: () => {},
		updateName: () => {},
		end: () => {},
		isRecording: () => false,
		recordException: () => {}
	};

	return {
		request,
		params: (options.params || {}) as Params,
		url: new URL(options.url, 'http://localhost:5173'),
		locals: {
			user: null,
			session: null,
			...options.locals
		},
		cookies: {
			get: () => undefined,
			getAll: () => [],
			set: () => {},
			delete: () => {},
			serialize: () => ''
		},
		fetch: global.fetch,
		getClientAddress: () => '127.0.0.1',
		platform: null,
		setHeaders: () => {},
		isDataRequest: false,
		isSubRequest: false,
		route: { id: options.url as RouteId },
		tracing: {
			enabled: false,
			root: mockSpan as unknown,
			current: mockSpan as unknown
		},
		isRemoteRequest: false
	};
}
