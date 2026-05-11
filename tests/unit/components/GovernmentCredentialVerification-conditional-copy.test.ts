/**
 * GovernmentCredentialVerification conditional copy.
 *
 * Behavioral verification that the dead-end states render different
 * copy based on `(minimumTier, userTrustTier)` — "address-tier still
 * works for you" must only render when the user actually holds tier
 * ≥ 2 already, otherwise the reassurance is false. Source-text
 * pinned at `mdl-launch-gates.test.ts:80-95`; this file lands the
 * behavioral assertion that the render output matches the pin.
 *
 * Runs under `vitest.components.config.ts` (Svelte 5 + DOM env).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';

// Web Animations API polyfill provided by `tests/config/setup.ts`.

// Force the component into the `unsupported` state by making the
// browser-capability gate return false.
vi.mock('$lib/core/identity/digital-credentials-api', () => ({
	shouldUseDigitalCredentialsFlow: vi.fn(() => false),
	getSupportedProtocols: vi.fn(() => ({ mdoc: false, openid4vp: false })),
	requestCredential: vi.fn(async () => ({ ok: false, error: 'unsupported' })),
}));

import GovernmentCredentialVerification from '$lib/components/auth/GovernmentCredentialVerification.svelte';

describe('GovernmentCredentialVerification conditional dead-end copy', () => {
	afterEach(() => {
		cleanup();
	});

	it('shows "this action does not need a digital ID" when min=2 and user=2', () => {
		const { getByText } = render(GovernmentCredentialVerification, {
			props: {
				userId: 'test-user',
				minimumTier: 2,
				userTrustTier: 2,
			},
		});

		// addressTierIsEnough = (2 <= 2 && 2 >= 2) = true
		expect(getByText(/this action does not need a digital ID/i)).toBeTruthy();
	});

	it('shows "This action requires a digital ID" when min=4 (CWC, regardless of user tier)', () => {
		const { getByText } = render(GovernmentCredentialVerification, {
			props: {
				userId: 'test-user',
				minimumTier: 4,
				userTrustTier: 2,
			},
		});

		// addressTierIsEnough = (4 <= 2 && ...) = false
		expect(getByText(/This action requires a digital ID/i)).toBeTruthy();
	});

	it('shows "This action requires a digital ID" when user=0 even if min=2 (honest copy)', () => {
		const { getByText } = render(GovernmentCredentialVerification, {
			props: {
				userId: 'test-user',
				minimumTier: 2,
				userTrustTier: 0,
			},
		});

		// addressTierIsEnough = (2 <= 2 && 0 >= 2) = false — user doesn't
		// have address-tier yet, so "still works for you" would be false
		// reassurance. The copy must surface that the action still needs
		// upgrade.
		expect(getByText(/This action requires a digital ID/i)).toBeTruthy();
	});

	it('falls back to strictest reading when junk tier values (clampTier defense)', () => {
		const { getByText } = render(GovernmentCredentialVerification, {
			props: {
				userId: 'test-user',
				minimumTier: Number.NaN as unknown as number, // clamps to 5
				userTrustTier: 'malicious' as unknown as number, // clamps to 0
			},
		});

		// Both clamped: min=5, user=0 → addressTierIsEnough = false →
		// "requires a digital ID" copy. Junk values can't unlock the
		// permissive branch.
		expect(getByText(/This action requires a digital ID/i)).toBeTruthy();
	});
});
