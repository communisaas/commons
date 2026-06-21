/**
 * P3 (create-flow terminal: foreground the SEND, demote publish to opt-in
 * amplification) + P4 (proof footer honesty: sender-framed + the SSOT tier label
 * so a self-reported sender is never overclaimed as "Verified resident").
 * Source-pin coverage.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('P3 — create-flow terminal foregrounds the send', () => {
	const mgr = src('src/lib/components/template/creator/MessageGenerationResolver.svelte');

	it('the terminal CTA leads with the send, not "Publish action page"', () => {
		expect(mgr).toContain('Continue to send');
		expect(mgr).not.toContain('Publish action page');
	});

	it('the CTA label does not overclaim that a send already happened on click', () => {
		// the click navigates/publishes; the actual mailto is 1-2 steps later, so the
		// label must not assert "Send this now" (a forward overclaim).
		expect(mgr).not.toContain('Send this now');
		expect(mgr).toContain('Saving'); // in-flight label (was "Publishing…", which overstated the org job)
	});

	it('publish is reframed as opt-in amplification, send-first', () => {
		expect(mgr).toContain('so you can send now');
		expect(mgr).toContain('so others can send it too');
	});
});

describe('P4 — proof footer is sender-framed + uses the SSOT tier label', () => {
	const slug = src('src/routes/s/[slug]/+page.svelte');
	const server = src('src/routes/s/[slug]/+page.server.ts');
	const compose = src('src/lib/components/action/ComposePane.svelte');

	it('buildProofFooter routes through the SSOT (formatTierEmailFooter), no hardcoded residency', () => {
		expect(slug).toMatch(/formatTierEmailFooter\(\{/);
		expect(slug).toContain("from '$lib/core/identity/tier-display'");
		// the pre-existing residency overclaim + the redundant Gov-ID append are gone
		expect(slug).not.toMatch(/push\(`Verified resident/);
		expect(slug).not.toMatch(/\+= ' · Gov ID'/);
	});

	it('the verify URL is offered as the SENDER\'s proof, not an instruction to the recipient', () => {
		expect(slug).toContain("Confirm I'm a real constituent");
		// the URL carries https:// so it auto-links in mail clients (Gmail/Apple Mail/Outlook)
		expect(slug).toContain('https://commons.email/v/');
		expect(slug).not.toMatch(/push\(`commons\.email\/v\//); // no bare unframed URL
	});

	it('verification_method is threaded to data.user so the label can be method-specific', () => {
		expect(server).toContain('verification_method: locals.user.verification_method');
	});

	it('ComposePane carries no residency overclaim and no false "cryptographic proof"', () => {
		// pin the RENDERED template literal (the ternary value), not the explanatory comment
		expect(compose).toMatch(/\?\s*`Verified constituent ·/);
		expect(compose).not.toMatch(/\?\s*`Verified resident/);
		expect(compose).not.toContain('Cryptographic proof'); // the false residency-proof claim
	});
});
