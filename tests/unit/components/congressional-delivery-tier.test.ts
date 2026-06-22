/**
 * API/CWC (congressional) delivery floor = REQUIRED_CONGRESSIONAL_PROOF_TIER (Tier 2),
 * a SINGLE source of truth (convex/_policy) shared across the three enforcement points
 * so the floor can never drift. Two layers, addressing the brutalist review of the
 * first (green-by-construction) version of this file:
 *
 *  1. BEHAVIORAL — render VerificationGate AT the congressional floor and assert a
 *     constituent at the floor proceeds while one below it is gated. A dead/over-gate
 *     fails this, unlike a source-text grep.
 *  2. STRUCTURAL — assert all three sites IMPORT the one constant (no local literal,
 *     no hardcoded tier-4), and that each server endpoint actually gates on it.
 *
 * Runs under `vitest.components.config.ts` (Svelte 5 + DOM env).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The constant under test — imported by value (relative, no alias dependency) so the
// behavioral floor below tracks the real policy, not a copied literal.
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

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('API/CWC delivery floor — BEHAVIORAL gate at the congressional floor', () => {
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

describe('API/CWC delivery floor — STRUCTURAL single source of truth (no drift)', () => {
	const SITES = [
		'convex/submissions.ts',
		'src/routes/api/submissions/create/+server.ts',
		'src/lib/components/template/TemplateModal.svelte',
	];

	it('the floor is Tier 2 and is declared in exactly ONE place (convex/_policy)', () => {
		expect(REQUIRED_CONGRESSIONAL_PROOF_TIER).toBe(2);
		expect(src('convex/_policy.ts')).toMatch(
			/export const REQUIRED_CONGRESSIONAL_PROOF_TIER\s*=\s*2/
		);
	});

	it('all three enforcement points IMPORT the constant — none redefines a local literal', () => {
		for (const p of SITES) {
			const s = src(p);
			expect(s).toMatch(/import \{[^}]*REQUIRED_CONGRESSIONAL_PROOF_TIER[^}]*\} from '[^']*_policy'/);
			// the drift this refactor removes: no site re-declares its own value
			expect(s).not.toMatch(/const REQUIRED_CONGRESSIONAL_PROOF_TIER\s*=/);
		}
	});

	it('BOTH client gates reference the constant — neither hardcodes the tier-4 gov-ID requirement', () => {
		const tm = src('src/lib/components/template/TemplateModal.svelte');
		expect(tm).toContain('minimumTier={REQUIRED_CONGRESSIONAL_PROOF_TIER}');
		expect(tm).toContain(
			'credentialMeetsMinimumTier(credential, REQUIRED_CONGRESSIONAL_PROOF_TIER)'
		);
		// the exact regression the review caught: a residual tier-4 gate the first fix missed
		expect(tm).not.toMatch(/minimumTier=\{[^}]*\b4\b/);
		expect(tm).not.toMatch(/credentialMeetsMinimumTier\([^,)]+,\s*4\)/);
	});

	it('each server endpoint actually GATES on the constant (the enforcement, not just the spelling)', () => {
		expect(src('convex/submissions.ts')).toMatch(/trustTier < REQUIRED_CONGRESSIONAL_PROOF_TIER/);
		expect(src('src/routes/api/submissions/create/+server.ts')).toMatch(
			/<\s*REQUIRED_CONGRESSIONAL_PROOF_TIER/
		);
	});
});
