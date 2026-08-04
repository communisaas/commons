/**
 * One composer for the attestation the sender reads and the recipient receives.
 *
 * Two failures motivate these assertions and both are regressions if they return:
 *   1. a surface naming a verification class wider than the method proves
 *      (a self-reported, Census-geocoded address rendered as a "verified
 *      resident");
 *   2. the congressional relay lane reading a field that does not exist on the
 *      user object, silently collapsing every sender to the generic
 *      "Verified constituent" fallback.
 *
 * The component-lane sibling (tests/unit/components/attestation-parity.test.ts)
 * proves the rendered footer equals the mailto body. This file proves the
 * builder's semantics, locks the composer count at one, and drives every
 * recipient-visible lane through `generateMailtoUrl` — the entry point the
 * product calls — so an assertion cannot certify a zone no branch assembles.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildAttestation } from '$lib/core/identity/tier-display';
import { generateMailtoUrl } from '$lib/services/emailService';
import { toEmailServiceUser } from '$lib/types/user';
import type { EmailServiceUser } from '$lib/types/user';
import type { EmailFlowTemplate } from '$lib/types/template';

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const HASH = 'a'.repeat(64);

const decodeBody = (url: string): string => {
	const marker = '&body=';
	const at = url.indexOf(marker);
	if (at === -1) return '';
	return decodeURIComponent(url.slice(at + marker.length));
};

describe('buildAttestation — the claim a tier is allowed to make', () => {
	it('tier 0 (and null / undefined) claims nothing at all', () => {
		for (const trustTier of [0, null, undefined]) {
			const a = buildAttestation({ trustTier, method: 'civic_api', districtCode: 'CA-12' });
			expect(a.line).toBeNull();
			expect(a.verifyLine).toBeNull();
			expect(a.block).toBeNull();
		}
	});

	it('tier 1 is a sender, not a constituent — and offers no verify URL', () => {
		const a = buildAttestation({ trustTier: 1, method: 'civic_api', credentialHash: HASH });
		expect(a.line).toBe('Verified sender');
		expect(a.verifyLine).toBeNull();
		expect(a.block).toBe('Verified sender');
	});

	it('tier 2 + civic_api + district → the self-reported label with the district suffix', () => {
		const a = buildAttestation({
			trustTier: 2,
			method: 'civic_api',
			districtCode: 'CA-12',
			credentialHash: HASH
		});
		expect(a.line).toBe('Self-reported constituent (Census geocoder) · CA-12');
		expect(a.verifyLine).toBe(`Confirm I'm a real constituent: https://commons.email/v/${HASH}`);
		expect(a.block).toBe(`${a.line}\n${a.verifyLine}`);
	});

	it('a district code is an optional SUFFIX, never a gate — no district, same class', () => {
		const withDistrict = buildAttestation({
			trustTier: 2,
			method: 'civic_api',
			districtCode: 'CA-12'
		});
		for (const districtCode of [null, undefined, '']) {
			const a = buildAttestation({ trustTier: 2, method: 'civic_api', districtCode });
			expect(a.line).toBe('Self-reported constituent (Census geocoder)');
			// no silent downgrade to the tier-1 phrasing…
			expect(a.line).not.toBe('Verified sender');
			// …and the only delta against the district-bearing line is the suffix.
			expect(withDistrict.line?.startsWith(a.line as string)).toBe(true);
		}
	});

	it('a tier-2 sender with no credential hash gets the label and no verify URL', () => {
		const a = buildAttestation({ trustTier: 2, method: 'civic_api', districtCode: 'CA-12' });
		expect(a.verifyLine).toBeNull();
		expect(a.block).toBe('Self-reported constituent (Census geocoder) · CA-12');
	});

	it('tier 3 + mdl → the address-resolved label carrying the mDL protocol claim', () => {
		const a = buildAttestation({ trustTier: 3, method: 'mdl', districtCode: 'CA-12' });
		expect(a.line).toBe('Address-resolved constituent (mDL) · CA-12');
	});

	it('shadow_atlas is the same epistemic class as mDL but never borrows the mDL claim', () => {
		const a = buildAttestation({ trustTier: 3, method: 'shadow_atlas', districtCode: 'CA-12' });
		expect(a.line).toBe('Address-resolved constituent · CA-12');
		expect(a.line).not.toContain('mDL');
	});

	it('no method at any tier ≥ 2 is ever described as a resident', () => {
		const methods = ['civic_api', 'mdl', 'digital-credentials-api', 'postal', 'shadow_atlas', null];
		for (const method of methods) {
			for (const trustTier of [2, 3, 4, 5]) {
				const a = buildAttestation({ trustTier, method, districtCode: 'CA-12' });
				expect(a.line).not.toContain('Verified resident');
				expect(a.line).not.toContain('resident');
			}
		}
	});
});

describe('recipient-visible lanes embed the builder output verbatim', () => {
	const congressionalTemplate: EmailFlowTemplate = {
		id: 'attestation-relay',
		slug: 'attestation-relay',
		title: 'A subject',
		description: 'A test template',
		deliveryMethod: 'cwc',
		message_body: 'A body',
		recipient_config: { emails: [] }
	};

	const directTemplate: EmailFlowTemplate = {
		...congressionalTemplate,
		id: 'attestation-direct',
		slug: 'attestation-direct',
		deliveryMethod: 'email',
		recipient_config: { emails: ['rep@example.test'] }
	};

	// Declared fields only — `credentialHash` is one of them, so the verify line is
	// exercised rather than lost to a conversion that drops it.
	const directSender: EmailServiceUser = {
		id: 'u1',
		email: 'ada@example.test',
		name: 'Ada',
		is_verified: true,
		verification_method: 'civic_api',
		credentialHash: HASH
	};

	it('the congressional relay lane carries the method label, not the generic fallback', () => {
		const user = toEmailServiceUser({
			id: 'u1',
			email: 'ada@example.test',
			name: 'Ada',
			is_verified: true,
			verification_method: 'civic_api'
		});

		const result = generateMailtoUrl(congressionalTemplate, user, { trustTier: 2 });
		expect(result.error).toBeUndefined();

		const body = decodeBody(result.url as string);
		const expected = buildAttestation({
			trustTier: 2,
			method: 'civic_api',
			districtCode: null,
			credentialHash: user?.credentialHash ?? null
		}).block as string;

		expect(body).toContain(expected);
		// The generic fallback is the signature of reading a field the user object
		// does not declare — the whole lane collapsing to a method-blind label.
		expect(body).not.toContain('Verified constituent');
		expect(body).not.toContain('Verified resident');
	});

	it('the direct lane places exactly the builder block below the rule', () => {
		// Driven through the real send path, not by hand-feeding the zone: a
		// hand-fed zone certifies the assembler and says nothing about whether the
		// direct branch ever assembles one.
		const result = generateMailtoUrl(directTemplate, directSender, {
			trustTier: 2,
			attestation: { districtCode: 'CA-12' }
		});
		expect(result.error).toBeUndefined();

		const expected = buildAttestation({
			trustTier: 2,
			method: 'civic_api',
			districtCode: 'CA-12',
			credentialHash: HASH
		}).block as string;

		const body = decodeBody(result.url as string);
		expect(body).toContain('\n---\n');
		expect(body.split('---').pop()?.trim()).toBe(expected);
	});

	it('the direct lane claims only the district the caller passed', () => {
		// No canonical district in the caller's hand → the class stands alone. The
		// service must not reach for a second source to fill the suffix.
		const result = generateMailtoUrl(directTemplate, directSender, {
			trustTier: 2,
			attestation: {}
		});
		expect(result.error).toBeUndefined();

		const body = decodeBody(result.url as string);
		expect(body.split('---').pop()?.trim()).toBe(
			buildAttestation({
				trustTier: 2,
				method: 'civic_api',
				districtCode: null,
				credentialHash: HASH
			}).block as string
		);
		expect(body).not.toContain('CA-12');
	});

	it('a lane that did not opt in sends no footer at all', () => {
		// The mirror-image violation: a surface that shows the sender no proof
		// footer must not put a verification claim about them in a recipient's
		// inbox. Same sender, same tier, same template — no lane input, no zone.
		const result = generateMailtoUrl(directTemplate, directSender, { trustTier: 2 });
		expect(result.error).toBeUndefined();

		const body = decodeBody(result.url as string);
		expect(body).not.toContain('---');
		expect(body).not.toContain('Self-reported constituent');
		expect(body).not.toContain('commons.email/v/');
	});

	it('an opted-in lane whose sender can claim nothing emits no orphan rule', () => {
		// Tier 0 composes to a null block; the separator must not survive it.
		const result = generateMailtoUrl(directTemplate, null, {
			attestation: { districtCode: 'CA-12' }
		});
		expect(result.error).toBeUndefined();

		const body = decodeBody(result.url as string);
		expect(body).not.toContain('---');
		expect(body).not.toContain('CA-12');
	});

	it('the relay lane and the direct lane make the same claim, differing only by the district suffix', () => {
		// Known residual: the relay lane has no canonical district code in scope
		// (its only district value comes from the ephemeral delivery address, a
		// different value in a different format), so it claims none. That is a
		// suffix-only delta — the epistemic class must stay identical on both.
		//
		// Both footers are read off real sends and pinned to literal text. Compared
		// against a re-run of the composer instead, a change that moved both lanes
		// together would pass while the recipient's inbox changed under it.
		const relayBody = decodeBody(
			generateMailtoUrl(congressionalTemplate, directSender, { trustTier: 2 }).url as string
		);
		const directBody = decodeBody(
			generateMailtoUrl(directTemplate, directSender, {
				trustTier: 2,
				attestation: { districtCode: 'NY-14' }
			}).url as string
		);

		const relayFooter = (relayBody.split('---').pop() ?? '').trim().split('\n');
		const directFooter = (directBody.split('---').pop() ?? '').trim().split('\n');

		// The relay footer opens with the two routing lines the inbound relay parses.
		expect(relayFooter).toEqual([
			'[Template: attestation-relay]',
			'[From: ada@example.test]',
			'Self-reported constituent (Census geocoder)',
			`Confirm I'm a real constituent: https://commons.email/v/${HASH}`
		]);
		expect(directFooter).toEqual([
			'Self-reported constituent (Census geocoder) · NY-14',
			`Confirm I'm a real constituent: https://commons.email/v/${HASH}`
		]);

		// The delta itself, taken from the two bodies rather than restated.
		const relayClaim = relayFooter[2];
		const directClaim = directFooter[0];
		expect(directClaim.startsWith(relayClaim)).toBe(true);
		expect(directClaim).toBe(`${relayClaim} · NY-14`);
	});
});

describe('exactly one composer — source lock', () => {
	const SURFACES = [
		'src/lib/components/template-browser/parts/PreviewContent.svelte',
		'src/lib/services/emailService.ts',
		'src/routes/s/[slug]/+page.svelte'
	];

	it('no surface hardcodes a residency claim or re-derives the tier label', () => {
		for (const path of SURFACES) {
			const text = src(path);
			expect(text, path).not.toContain("'Verified resident'");
			// The label SSOT is reached only through the composer; a second call
			// site here is a second composer growing back.
			expect(text, path).not.toContain('formatTierEmailFooter(');
			// A cast over the user object is what let a phantom field compile: the
			// read must go through the declared field so a rename is a type error.
			expect(text, path).not.toContain('as { verificationMethod');
		}
	});

	it('the relay lane reads the field the user object declares, not a camelCase phantom', () => {
		// Scoped to emailService: `verificationMethod` is also the legitimate
		// parameter name of the unrelated ground-vault persistence helper, so a
		// repo-wide ban would fail on code this concern does not own.
		const emailService = src('src/lib/services/emailService.ts');
		expect(emailService).not.toContain('verificationMethod');
		expect(emailService).toContain('user?.verification_method');
	});

	it('formatTierEmailFooter has exactly one call site, inside buildAttestation', () => {
		const tierDisplay = src('src/lib/core/identity/tier-display.ts');
		const callSites = tierDisplay.match(/formatTierEmailFooter\(\{/g) ?? [];
		expect(callSites).toHaveLength(1);
		expect(tierDisplay).toContain('export function buildAttestation');
	});
});
