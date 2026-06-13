/**
 * /v/[hash] attestation invariant (D-10 security/trust pin).
 *
 * The verification page is the independent third-party proof — stripping its
 * Commons attestation would gut the verification value. White-label is
 * OUTBOUND-ONLY: it de-brands report emails, the embed widget, and the
 * scorecard embed, but MUST NOT touch this page.
 *
 * This pins the source so a future "de-brand everything" change can't silently
 * couple the verification page to the white-label flag or remove its Commons
 * attribution. It is a content invariant, not a render test, because the
 * attestation is load-bearing chrome that the page must always carry.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const VERIFY_PAGE = 'src/routes/v/[hash]/+page.svelte';
const source = readFileSync(VERIFY_PAGE, 'utf8');

describe('/v/[hash] keeps its Commons attestation regardless of white-label', () => {
	it('renders the Commons attribution footer', () => {
		expect(source).toContain('commons.email');
		expect(source).toContain('Commons PBC');
		// The "Commons verifies identity and location" attestation copy stays.
		expect(source).toContain('Commons verifies identity and location');
	});

	it('does NOT couple to any white-label / de-brand flag', () => {
		// The verification page must never read or branch on whiteLabel — if it
		// did, an org could strip the independent proof. Pin the absence.
		expect(/whiteLabel/i.test(source)).toBe(false);
		expect(/white-label/i.test(source)).toBe(false);
		expect(/poweredBy|powered by/i.test(source)).toBe(false);
	});

	it('mounts the independent attestation verifier', () => {
		expect(source).toContain('AttestationVerifier');
	});
});
