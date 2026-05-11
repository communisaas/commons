import { describe, it, expect } from 'vitest';
import {
	computeOrgScopedEmailHash,
	computeOrgScopedPhoneHash,
	computeGlobalEmailHash,
	computeGlobalPhoneHash,
	normalizeEmail,
	normalizePhone
} from '$lib/core/crypto/org-scoped-hash';

// `computeGlobalEmailHash` is exported from the `org-scoped-hash` module.
// The Convex-side mirror at `convex/_orgHash.ts:computeGlobalEmailHash`
// MUST stay byte-identical (same `normalizeEmail`, same `"email:"` domain
// prefix, same SHA-256 — see the comment block on each helper). The
// inline test-only mirror previously here drifted from the production
// impl and silently hid a hash-family mismatch between client and server.

describe('email hash invariants', () => {
	const orgIdA = 'org_alpha_01';
	const orgIdB = 'org_beta_99';
	const email = '  Recipient@Example.COM  ';

	it('org-scoped hash is independent of email casing and whitespace', async () => {
		const a = await computeOrgScopedEmailHash(orgIdA, email);
		const b = await computeOrgScopedEmailHash(orgIdA, 'recipient@example.com');
		expect(a).toBe(b);
	});

	it('org-scoped hash differs by orgId for the same email (no cross-org correlation)', async () => {
		const inOrgA = await computeOrgScopedEmailHash(orgIdA, email);
		const inOrgB = await computeOrgScopedEmailHash(orgIdB, email);
		expect(inOrgA).not.toBe(inOrgB);
	});

	it('global hash and org-scoped hash diverge for the same email by design', async () => {
		const orgScoped = await computeOrgScopedEmailHash(orgIdA, email);
		const global = await computeGlobalEmailHash(email);
		expect(orgScoped).not.toBe(global);
	});

	it('global hash is the same across orgs (cross-org bounce/complaint correlation)', async () => {
		const a = await computeGlobalEmailHash(email);
		const b = await computeGlobalEmailHash('recipient@example.com');
		expect(a).toBe(b);
	});

	it('emailEvents writes globalHash; emailDeliveryReceipts writes org-scoped — pinned by hash output divergence', async () => {
		// emailEvents.recipientEmailHash uses computeGlobalEmailHash (convex/webhooks.ts).
		// emailDeliveryReceipts.recipientEmailHash uses supporter.emailHash, which is
		// computed via computeOrgScopedEmailHash (convex/_orgHash.ts).
		// This test pins the architectural asymmetry: the two tables intentionally
		// store different hash values for the same recipient. Cross-table joins
		// MUST go through the supporter row (which carries both globalEmailHash
		// and emailHash on the same record).
		const eventsHash = await computeGlobalEmailHash(email);
		const receiptsHash = await computeOrgScopedEmailHash(orgIdA, email);
		expect(eventsHash).not.toBe(receiptsHash);
	});

	it('org-scoped hash domain-separates email vs phone (cannot cross-walk schemes)', async () => {
		const emailHash = await computeOrgScopedEmailHash(orgIdA, '+15551234567');
		const phoneHash = await computeOrgScopedPhoneHash(orgIdA, '+15551234567');
		expect(emailHash).not.toBe(phoneHash);
	});

	it('normalizeEmail collapses whitespace and case', () => {
		expect(normalizeEmail('  A@B.com  ')).toBe('a@b.com');
	});

	it('normalizePhone enforces E.164-ish leading +', () => {
		expect(normalizePhone('+1 (555) 123-4567')).toBe('+15551234567');
		expect(() => normalizePhone('5551234567')).toThrow();
		expect(() => normalizePhone('+12')).toThrow();
	});

	// Phone-hash invariants. The historical regression: TCPA STOP/START
	// hash family mismatch (supporter rows had org-scoped `phoneHash`,
	// webhook computed a different global hash with diverging
	// normalization). These pins are the floor below which the cure
	// regresses.
	it('global phone hash is the same across orgs (cross-org TCPA STOP/START correlation)', async () => {
		const phone = '+15551234567';
		const a = await computeGlobalPhoneHash(phone);
		const b = await computeGlobalPhoneHash('+1 (555) 123-4567');
		expect(a).toBe(b);
	});

	it('global phone hash differs from org-scoped phone hash (by design)', async () => {
		const phone = '+15551234567';
		const global = await computeGlobalPhoneHash(phone);
		const orgScoped = await computeOrgScopedPhoneHash(orgIdA, phone);
		expect(global).not.toBe(orgScoped);
	});

	it('global phone hash is domain-separated from global email hash for the same input', async () => {
		// Both consume the same normalized string '+15551234567', but the
		// domain prefixes 'email:' vs 'phone:' separate them. Without that
		// separation, an attacker who controls one channel could forge the
		// other's lookup hash.
		const input = '+15551234567';
		const emailHash = await computeGlobalEmailHash(input);
		const phoneHash = await computeGlobalPhoneHash(input);
		expect(emailHash).not.toBe(phoneHash);
	});

	it('global phone hash throws on non-E.164 input (no silent normalization drift)', async () => {
		await expect(computeGlobalPhoneHash('5551234567')).rejects.toThrow();
		await expect(computeGlobalPhoneHash('+12')).rejects.toThrow();
	});
});
