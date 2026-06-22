/**
 * BEHAVIORAL coverage for the API/CWC (congressional) delivery floor — renders the
 * VerificationGate AT the congressional floor (REQUIRED_CONGRESSIONAL_PROOF_TIER) and
 * asserts a constituent at the floor proceeds while one below it is gated. A dead or
 * over-gate fails this, unlike a source-text grep.
 *
 * Runs in the COMPONENTS lane (vitest.components.config.ts) — Svelte 5 mount() is
 * unavailable in CI's main jsdom+MSW lane, so this file is excluded from vitest.config.ts
 * (same as VerificationGate-auto-dismiss.test.ts). The structural single-source lock that
 * DOES run in CI lives in congressional-delivery-tier.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/svelte';

import { REQUIRED_CONGRESSIONAL_PROOF_TIER } from '../../../convex/_policy';

// Mock the gate's heavy dependencies so it mounts in jsdom (mirrors
// VerificationGate-auto-dismiss.test.ts). If the gov-ID upgrade flow mounts when it
// shouldn't, the stub's testid surfaces it.
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
vi.mock('$lib/core/identity/recovery-detector', () => ({
	credentialMeetsMinimumTier: vi.fn(() => true),
	getUsableProofCredential: vi.fn(async () => null),
	needsCredentialRecovery: vi.fn(async () => false),
}));
vi.mock('$lib/config/features', () => ({
	isAnyMdlProtocolEnabled: vi.fn(() => true),
}));
vi.mock('$lib/core/locale/jurisdiction', () => ({
	getJurisdictionLabels: vi.fn(() => ({ legislativeBody: 'Congress' })),
}));
vi.mock('$lib/stores/decryptedUser.svelte', () => ({
	decryptedUser: { email: 'test@example.com' },
}));

import VerificationGate from '$lib/components/auth/VerificationGate.svelte';

describe('API/CWC delivery floor — behavioral gate at the congressional floor', () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(() => cleanup());

	it('a constituent AT the floor proceeds — gate auto-dismisses, no gov-ID upgrade wall', async () => {
		const oncancel = vi.fn();
		const onverified = vi.fn();
		const { queryByTestId } = render(VerificationGate, {
			props: {
				userId: 'test-user',
				showModal: true,
				minimumTier: REQUIRED_CONGRESSIONAL_PROOF_TIER,
				userTrustTier: REQUIRED_CONGRESSIONAL_PROOF_TIER,
				oncancel,
				onverified,
			},
		});
		// At the floor the gate recognizes the constituent is already verified and
		// dismisses (the send proceeds) — it does NOT mount the gov-ID upgrade flow.
		await waitFor(() => expect(oncancel).toHaveBeenCalledTimes(1));
		expect(queryByTestId('identity-verification-flow-stub')).toBeNull();
		expect(onverified).not.toHaveBeenCalled();
	});

	it('a constituent BELOW the floor is gated — no auto-dismiss', async () => {
		const oncancel = vi.fn();
		const onverified = vi.fn();
		render(VerificationGate, {
			props: {
				userId: 'test-user',
				showModal: true,
				minimumTier: REQUIRED_CONGRESSIONAL_PROOF_TIER,
				userTrustTier: REQUIRED_CONGRESSIONAL_PROOF_TIER - 1,
				oncancel,
				onverified,
			},
		});
		await new Promise((r) => setTimeout(r, 50));
		expect(oncancel).not.toHaveBeenCalled();
		expect(onverified).not.toHaveBeenCalled();
	});
});
