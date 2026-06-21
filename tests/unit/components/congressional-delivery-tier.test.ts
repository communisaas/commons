/**
 * API/CWC (congressional) delivery floor = Tier 2 (verified constituent via the
 * address-first flow). The client gate must mirror the server's
 * REQUIRED_CONGRESSIONAL_PROOF_TIER; gov-ID (tier 4) raises the assurance BADGE on
 * the proof, it is NOT the bar. Email/mailto delivery stays open (no gate) — the
 * channel sets the requirement, not the recipient.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('API/CWC delivery is gated at Tier 2, client aligned to the server', () => {
	it('the client gate (TemplateModal) requires Tier 2 — no over-gating back to gov-ID (tier 4)', () => {
		const tm = src('src/lib/components/template/TemplateModal.svelte');
		// minimumTier is unique to the VerificationGate prop in this file
		expect(tm).toContain('minimumTier={2}');
		expect(tm).not.toMatch(/minimumTier=\{[^}]*4/); // never drift back to the tier-4 gov-ID gate
	});

	it('both submission endpoints enforce the same Tier-2 floor (the server bar the client mirrors)', () => {
		expect(src('convex/submissions.ts')).toContain('REQUIRED_CONGRESSIONAL_PROOF_TIER = 2');
		expect(src('src/routes/api/submissions/create/+server.ts')).toContain(
			'REQUIRED_CONGRESSIONAL_PROOF_TIER = 2'
		);
	});
});
