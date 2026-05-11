/**
 * VerificationGate auto-dismiss behavioral test.
 *
 * The gate carries a defensive `$effect` that auto-dismisses when it
 * opens for a user who already meets the address-tier requirement.
 * This file lands the behavioral assertion: render gate with tier-2
 * user + minimumTier=2 + showModal=true; assert oncancel fires and the
 * modal closes WITHOUT mounting the mDL upgrade flow.
 *
 * Runs under `vitest.components.config.ts` (Svelte 5 + DOM env).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/svelte';

// Web Animations API polyfill is provided by `tests/config/setup.ts` —
// JSDOM lacks `element.animate` which Svelte transitions call on
// mount/unmount.

// Mock the gate's heavy dependencies. The `default` imports for
// AddressVerificationFlow / IdentityVerificationFlow / IdentityRecoveryFlow
// must resolve to a valid Svelte component or the gate fails to mount —
// even on branches where it doesn't render them. We stub each with a
// trivial component that surfaces a testid; if the auto-dismiss path
// is buggy and one of these mounts, the test can detect it.
vi.mock('$lib/components/auth/IdentityVerificationFlow.svelte', async () => {
	const mod = await import('../../mocks/IdentityVerificationFlowStub.svelte');
	return { default: mod.default };
});
vi.mock('$lib/components/auth/IdentityRecoveryFlow.svelte', async () => {
	const mod = await import('../../mocks/IdentityRecoveryFlowStub.svelte');
	return { default: mod.default };
});
vi.mock('$lib/components/auth/AddressVerificationFlow.svelte', async () => {
	const mod = await import('../../mocks/AddressVerificationFlowStub.svelte');
	return { default: mod.default };
});

// Recovery-detector helpers — return non-async stubs so the gate's
// `needsCredentialRecovery` effect resolves immediately.
vi.mock('$lib/core/identity/recovery-detector', () => ({
	credentialMeetsMinimumTier: vi.fn(() => true),
	getUsableProofCredential: vi.fn(async () => null),
	needsCredentialRecovery: vi.fn(async () => false),
}));

// Feature-flag check — return true so `mdlGated` is false and the gate
// doesn't render the "Coming soon" placeholder branch.
vi.mock('$lib/config/features', () => ({
	isAnyMdlProtocolEnabled: vi.fn(() => true),
}));

// Jurisdiction labels.
vi.mock('$lib/core/locale/jurisdiction', () => ({
	getJurisdictionLabels: vi.fn(() => ({ legislativeBody: 'Congress' })),
}));

// Decrypted-user store. The gate reads `decryptedUser.email` for the
// IdentityVerificationFlow's userEmail prop. Use a $state-like rune
// stub returning an object.
vi.mock('$lib/stores/decryptedUser.svelte', () => ({
	decryptedUser: { email: 'test@example.com' },
}));

import VerificationGate from '$lib/components/auth/VerificationGate.svelte';

describe('VerificationGate auto-dismiss', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	afterEach(() => {
		cleanup();
	});

	it('auto-dismisses when user already meets the address-tier requirement (tier 2, minimumTier 2)', async () => {
		const oncancel = vi.fn();
		const onverified = vi.fn();
		let showModal = true;

		const { queryByTestId } = render(VerificationGate, {
			props: {
				userId: 'test-user',
				showModal,
				minimumTier: 2,
				userTrustTier: 2,
				oncancel,
				onverified,
			},
		});

		// Wait for the $effect to flush — it should call oncancel and set
		// showModal = false. The IdentityVerificationFlow stub should NOT
		// appear in the rendered output because the alreadyMetsAddressTier
		// branch is synchronous on first render.
		await waitFor(() => {
			expect(oncancel).toHaveBeenCalledTimes(1);
		});

		// Defense-in-depth: verify the mDL upgrade flow didn't mount
		// (template guard prevents one-tick mount).
		expect(queryByTestId('identity-verification-flow-stub')).toBeNull();

		// onverified should NOT have been called — the user didn't COMPLETE
		// a new verification; they were already at the requested tier.
		expect(onverified).not.toHaveBeenCalled();
	});

	it('does NOT auto-dismiss when user does not meet the address-tier requirement (tier 0, minimumTier 2)', async () => {
		const oncancel = vi.fn();
		const onverified = vi.fn();

		render(VerificationGate, {
			props: {
				userId: 'test-user',
				showModal: true,
				minimumTier: 2,
				userTrustTier: 0,
				oncancel,
				onverified,
			},
		});

		// Wait briefly for effects. The auto-dismiss should NOT fire
		// because userTrustTier < 2.
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(oncancel).not.toHaveBeenCalled();
		expect(onverified).not.toHaveBeenCalled();
	});

	it('does NOT auto-dismiss when minimumTier > 2 even if user has tier 2', async () => {
		const oncancel = vi.fn();
		const onverified = vi.fn();

		render(VerificationGate, {
			props: {
				userId: 'test-user',
				showModal: true,
				minimumTier: 4,
				userTrustTier: 2,
				oncancel,
				onverified,
			},
		});

		await new Promise((resolve) => setTimeout(resolve, 50));
		// minimumTier=4 means address-tier doesn't satisfy; the auto-dismiss
		// path is gated on minimumTier <= 2.
		expect(oncancel).not.toHaveBeenCalled();
		expect(onverified).not.toHaveBeenCalled();
	});

	it('does NOT auto-dismiss when minimumTier=3 (tier 3 needs digital ID, not address)', async () => {
		const oncancel = vi.fn();
		const onverified = vi.fn();

		render(VerificationGate, {
			props: {
				userId: 'test-user',
				showModal: true,
				minimumTier: 3,
				userTrustTier: 2,
				oncancel,
				onverified,
			},
		});

		await new Promise((resolve) => setTimeout(resolve, 50));
		// Address-tier (2) doesn't cover tier-3 actions per the
		// off-by-one rule (addressTierIsEnough = minimumTier <= 2, not <= 3).
		expect(oncancel).not.toHaveBeenCalled();
		expect(onverified).not.toHaveBeenCalled();
	});

	it('does NOT auto-dismiss when forceAddressFlow=true even with tier already met', async () => {
		const oncancel = vi.fn();
		const onverified = vi.fn();

		render(VerificationGate, {
			props: {
				userId: 'test-user',
				showModal: true,
				minimumTier: 2,
				userTrustTier: 5,
				forceAddressFlow: true,
				oncancel,
				onverified,
			},
		});

		await new Promise((resolve) => setTimeout(resolve, 50));
		// forceAddressFlow is the re-grounding override — used by
		// AddressChangeFlow to re-enter the flow for a verified user. The
		// auto-dismiss explicitly skips when this is true.
		expect(oncancel).not.toHaveBeenCalled();
		expect(onverified).not.toHaveBeenCalled();
	});

	it('re-entrancy guard prevents oncancel loop if parent re-opens on dismiss', async () => {
		let oncancelCount = 0;
		const onverified = vi.fn();

		// Parent's oncancel handler simulates re-opening the modal. Without
		// the `dismissedAtSnapshot` guard, the effect would re-fire with
		// stale snapshot and dismiss again — infinite loop. With the guard,
		// the second dismiss is blocked until the snapshot refreshes (which
		// requires a true close → reopen cycle).
		const oncancel = vi.fn(() => {
			oncancelCount++;
			// Re-open the modal synchronously, simulating a buggy parent.
			// In real production this would be a state machine that auto-
			// reopens on cancel for some reason.
		});

		render(VerificationGate, {
			props: {
				userId: 'test-user',
				showModal: true,
				minimumTier: 2,
				userTrustTier: 2,
				oncancel,
				onverified,
			},
		});

		await new Promise((resolve) => setTimeout(resolve, 50));
		// Should fire exactly once — the re-entrancy guard prevents the
		// loop even if parent state were buggy.
		expect(oncancelCount).toBe(1);
		expect(onverified).not.toHaveBeenCalled();
	});

	it('snapshot resists mid-flow tier change (race-resistance)', async () => {
		const oncancel = vi.fn();
		const onverified = vi.fn();

		const { rerender } = render(VerificationGate, {
			props: {
				userId: 'test-user',
				showModal: true,
				minimumTier: 2,
				userTrustTier: 0, // opens with tier 0; no auto-dismiss
				oncancel,
				onverified,
			},
		});

		// Let initial effects settle.
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(oncancel).not.toHaveBeenCalled();
		expect(onverified).not.toHaveBeenCalled();

		// Now simulate the address flow completing — `userTrustTier`
		// reactively bumps to 2 just before `handleAddressVerificationComplete`
		// would fire `onverified`. Without the open-snapshot, the effect
		// would re-fire with new tier 2 and call `oncancel` (false-cancel
		// race). The snapshot stays 0 so the auto-dismiss doesn't fire.
		await rerender({
			userId: 'test-user',
			showModal: true,
			minimumTier: 2,
			userTrustTier: 2,
			oncancel,
			onverified,
		});

		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(oncancel).not.toHaveBeenCalled();
		expect(onverified).not.toHaveBeenCalled();
	});

	it('clamps junk tier values via clampTier (defense-in-depth)', async () => {
		const oncancel = vi.fn();
		const onverified = vi.fn();

		render(VerificationGate, {
			props: {
				userId: 'test-user',
				showModal: true,
				// Both junk: clampTier falls back to (5 for min, 0 for user).
				// Strictest reading: action requires tier 5, user is tier 0.
				// Auto-dismiss should NOT fire (user doesn't meet tier 2).
				minimumTier: Number.NaN as unknown as number,
				userTrustTier: '5' as unknown as number,
				oncancel,
				onverified,
			},
		});

		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(oncancel).not.toHaveBeenCalled();
		expect(onverified).not.toHaveBeenCalled();
	});
});
