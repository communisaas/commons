import { beforeEach, vi } from 'vitest';
/// <reference path="../types/global.d.ts" />

/**
 * Global test setup that runs before each test
 *
 * Provides comprehensive environment configuration for:
 * - OAuth authentication testing
 * - Database mocking
 * - Browser environment simulation
 * - Feature flag management
 */
beforeEach(() => {
	// Reset all mocks before each test for isolation
	vi.clearAllMocks();

	// Core environment configuration
	process.env.NODE_ENV = 'test';
	// Use environment variables from .env.test file instead of hardcoded values
	process.env.DATABASE_URL =
		process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

	// OAuth environment variables - use test-specific env vars or safe defaults
	process.env.OAUTH_REDIRECT_BASE_URL =
		process.env.TEST_OAUTH_REDIRECT_BASE_URL || 'http://localhost:5173';
	// Use TEST_ prefixed variables from .env.test file
	process.env.GOOGLE_CLIENT_ID = process.env.TEST_GOOGLE_CLIENT_ID || 'test-client-id';
	process.env.GOOGLE_CLIENT_SECRET = process.env.TEST_GOOGLE_CLIENT_SECRET || 'test-secret';
	process.env.FACEBOOK_CLIENT_ID = process.env.TEST_FACEBOOK_CLIENT_ID || 'test-client-id';
	process.env.FACEBOOK_CLIENT_SECRET = process.env.TEST_FACEBOOK_CLIENT_SECRET || 'test-secret';
	process.env.DISCORD_CLIENT_ID = process.env.TEST_DISCORD_CLIENT_ID || 'test-client-id';
	process.env.DISCORD_CLIENT_SECRET = process.env.TEST_DISCORD_CLIENT_SECRET || 'test-secret';
	process.env.LINKEDIN_CLIENT_ID = process.env.TEST_LINKEDIN_CLIENT_ID || 'test-client-id';
	process.env.LINKEDIN_CLIENT_SECRET = process.env.TEST_LINKEDIN_CLIENT_SECRET || 'test-secret';
	process.env.TWITTER_CLIENT_ID = process.env.TEST_TWITTER_CLIENT_ID || 'test-client-id';
	process.env.TWITTER_CLIENT_SECRET = process.env.TEST_TWITTER_CLIENT_SECRET || 'test-secret';

	// API and service configuration
	// Keep real CONGRESS_API_KEY for smoke tests, fallback to test key for mocked tests
	process.env.CONGRESS_API_KEY = process.env.CONGRESS_API_KEY || 'test-congress-api-key';
	process.env.CWC_API_KEY = process.env.CWC_API_KEY || process.env.TEST_CWC_API_KEY || 'test-api-key';

	// Mock browser APIs that may be accessed during tests
	if (typeof window !== 'undefined') {
		// localStorage mock for analytics and browser utilities
		const localStorageMock = {
			getItem: vi.fn(() => null),
			setItem: vi.fn(),
			removeItem: vi.fn(),
			clear: vi.fn(),
			length: 0,
			key: vi.fn(() => null)
		};
		Object.defineProperty(window, 'localStorage', {
			value: localStorageMock,
			writable: true
		});

		// sessionStorage mock
		Object.defineProperty(window, 'sessionStorage', {
			value: localStorageMock,
			writable: true
		});

		// navigator mock for browser detection
		Object.defineProperty(window, 'navigator', {
			value: {
				userAgent: 'test-user-agent',
				language: 'en-US',
				languages: ['en-US'],
				onLine: true
			},
			writable: true
		});

		// location mock for URL testing
		Object.defineProperty(window, 'location', {
			value: {
				href: 'http://localhost:5173',
				origin: 'http://localhost:5173',
				protocol: 'http:',
				host: 'localhost:5173',
				hostname: 'localhost',
				port: '5173',
				pathname: '/',
				search: '',
				hash: ''
			},
			writable: true
		});

		// matchMedia mock for CSS media queries (needed for Svelte motion)
		Object.defineProperty(window, 'matchMedia', {
			value: vi.fn().mockImplementation((query: string) => ({
				matches: false,
				media: query,
				onchange: null,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
				dispatchEvent: vi.fn()
			})),
			writable: true
		});
	}

	// Global fetch mock for unit tests ONLY
	// Integration tests (tests/integration/**) use MSW for external API mocking
	// MSW must intercept fetch, so we skip the global mock for integration tests
	const testState = expect.getState() as any;
	const isIntegrationTest = testState.testPath?.includes('/tests/integration/');
	if (!isIntegrationTest) {
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: 'OK',
			headers: new Headers(),
			json: vi.fn().mockResolvedValue({}),
			text: vi.fn().mockResolvedValue(''),
			blob: vi.fn().mockResolvedValue(new Blob()),
			arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0))
		});
	}
});

import { afterEach } from 'vitest';

/**
 * Global test teardown that runs after each test
 *
 * Ensures clean state between tests by:
 * - Clearing all mocks
 * - Resetting environment variables
 * - Cleaning up browser API mocks
 */
afterEach(() => {
	// Clean up all mocks to prevent test interference
	vi.clearAllMocks();
	// Note: Removed vi.restoreAllMocks() to preserve database mocks for agent tests

	// Reset feature flag environment variables
	delete process.env.ENABLE_BETA;

	// Clean up any global fetch mock
	if (global.fetch && vi.isMockFunction(global.fetch)) {
		const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
		mockFetch.mockRestore?.();
	}

	// Reset browser API mocks if in browser environment
	if (typeof window !== 'undefined') {
		// Clear localStorage/sessionStorage state
		if (window.localStorage) {
			// Handle both real localStorage and mocked localStorage
			if (typeof window.localStorage.clear === 'function') {
				window.localStorage.clear();
			} else if (vi.isMockFunction(window.localStorage.getItem)) {
				// For mock localStorage, manually reset
				vi.mocked(window.localStorage.getItem).mockReturnValue(null);
				vi.mocked(window.localStorage.setItem).mockImplementation(() => {});
				vi.mocked(window.localStorage.removeItem).mockImplementation(() => {});
			}
		}
	}
});
