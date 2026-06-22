/**
 * API/CWC (congressional) delivery floor = REQUIRED_CONGRESSIONAL_PROOF_TIER (Tier 2),
 * a SINGLE source of truth (convex/_policy) shared across the three enforcement points.
 *
 * STRUCTURAL coverage — runs in CI's main lane. Asserts the floor is declared exactly
 * once and every site DERIVES from it: no local literal, no hardcoded tier-4 in either
 * client gate, and each server endpoint actually gates on the constant. This is a set of
 * structural CONTRACTS, not a single spelling check — the regression that shipped (a
 * residual `credentialMeetsMinimumTier(credential, 4)`) fails the tier-4 assertions.
 *
 * The BEHAVIORAL render assertion (constituent at the floor proceeds, below is gated)
 * lives in the components lane — congressional-delivery-gate.behavior.test.ts — because
 * Svelte 5 mount() is unavailable in CI's main jsdom+MSW lane (see vitest.config.ts).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REQUIRED_CONGRESSIONAL_PROOF_TIER } from '../../../convex/_policy';

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('API/CWC delivery floor — single source of truth (no drift across the 3 sites)', () => {
	const SITES = [
		'convex/submissions.ts',
		'src/routes/api/submissions/create/+server.ts',
		'src/lib/components/template/TemplateModal.svelte',
	];

	it('the floor is Tier 2 and declared in exactly ONE place (convex/_policy)', () => {
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
