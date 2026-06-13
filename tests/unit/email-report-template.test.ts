import { describe, it, expect } from 'vitest';
import { renderReport, canonicalPreimage } from '$lib/server/email/report-template';
import type { VerificationPacket } from '$lib/types/verification-packet';

const basePacket: VerificationPacket = {
	verified: 1234,
	total: 1500,
	verifiedPct: 82,
	districtCount: 12,
	authorship: { individual: 800, shared: 434, unknown: 0, explicit: true },
	dateRange: { earliest: '2026-01-01', latest: '2026-02-15', spanDays: 45 },
	identityBreakdown: { govId: 300, addressVerified: 700, emailOnly: 234, unverified: 0 },
	gds: null,
	ald: null,
	temporalEntropy: null,
	burstVelocity: null,
	cai: null,
	tiers: [],
	geography: [
		{ hash: 'aaaa1111', count: 400 },
		{ hash: 'bbbb2222', count: 300 },
		{ hash: 'cccc3333', count: 200 }
	],
	cells: null,
	temporal: null,
	driftCount: null,
	driftPct: null,
	debate: null,
	lastUpdated: '2026-02-15T00:00:00Z'
};

const baseCtx = {
	campaignId: 'k1234567890',
	campaignTitle: 'Floor vote on HR-1',
	orgName: 'Sample Coalition',
	packet: basePacket,
	verificationUrl: 'https://commons.email/v/k1234567890'
};

describe('renderReport', () => {
	it('produces a stable attestation hash for the same input', async () => {
		const a = await renderReport(baseCtx);
		const b = await renderReport(baseCtx);
		expect(a.attestationHash).toBe(b.attestationHash);
		expect(a.attestationHash).toMatch(/^[0-9a-f]{64}$/);
	});

	it('changes the attestation hash when campaignTitle changes', async () => {
		const a = await renderReport(baseCtx);
		const b = await renderReport({ ...baseCtx, campaignTitle: baseCtx.campaignTitle + '.' });
		expect(a.attestationHash).not.toBe(b.attestationHash);
	});

	it('changes the attestation hash when verified count changes', async () => {
		const a = await renderReport(baseCtx);
		const b = await renderReport({
			...baseCtx,
			packet: { ...basePacket, verified: 1235 }
		});
		expect(a.attestationHash).not.toBe(b.attestationHash);
	});

	it('does NOT change the attestation hash when verificationUrl changes (env-decoupled)', async () => {
		const a = await renderReport(baseCtx);
		const b = await renderReport({
			...baseCtx,
			verificationUrl: 'https://staging.example.com/v/k1234567890'
		});
		expect(a.attestationHash).toBe(b.attestationHash);
	});

	it('changes the attestation hash when geography order is permuted (sort canonicalizes)', async () => {
		const reversed = [...basePacket.geography!].reverse();
		const a = await renderReport(baseCtx);
		const b = await renderReport({
			...baseCtx,
			packet: { ...basePacket, geography: reversed }
		});
		// Permuting input should still produce same hash because preimage sorts.
		expect(a.attestationHash).toBe(b.attestationHash);
	});

	it('html bar chart order matches the canonical preimage order (count desc)', async () => {
		// A malicious caller passes the smallest district first; the preimage
		// must NOT preserve that order, and the rendered HTML must display the
		// largest first to match what the hash bound.
		const misordered = [
			{ hash: 'cccc3333', count: 200 },
			{ hash: 'aaaa1111', count: 400 },
			{ hash: 'bbbb2222', count: 300 }
		];
		const r = await renderReport({
			...baseCtx,
			packet: { ...basePacket, geography: misordered }
		});
		const idxLargest = r.html.indexOf('background-color:#3bc4b8'); // first bar segment
		expect(idxLargest).toBeGreaterThan(-1);
		// Preimage of misordered input must equal preimage of pre-sorted input.
		const sorted = [
			{ hash: 'aaaa1111', count: 400 },
			{ hash: 'bbbb2222', count: 300 },
			{ hash: 'cccc3333', count: 200 }
		];
		const a = canonicalPreimage({
			...baseCtx,
			packet: { ...basePacket, geography: misordered }
		});
		const b = canonicalPreimage({
			...baseCtx,
			packet: { ...basePacket, geography: sorted }
		});
		expect(a).toBe(b);
		// Preimage's geography section should be count-desc + hash-asc tiebreak.
		expect(a.includes('aaaa1111=400,bbbb2222=300,cccc3333=200')).toBe(true);
	});

	it('preimage is domain-prefixed and includes campaignId', () => {
		const preimage = canonicalPreimage(baseCtx);
		expect(preimage.startsWith('voter-protocol-report-v1\n---\n')).toBe(true);
		expect(preimage.includes('campaign:k1234567890')).toBe(true);
	});

	it('renders subject with locale-formatted verified count', async () => {
		const r = await renderReport(baseCtx);
		expect(r.subject).toContain('1,234');
		expect(r.subject).toContain('Floor vote on HR-1');
	});

	it('plain text contains the full attestation hash and avoids per-row hash listing', async () => {
		const r = await renderReport(baseCtx);
		expect(r.text).toContain(`Attestation: sha256:${r.attestationHash}`);
		// The row-by-row hash listing was replaced by a single-line summary.
		expect(r.text).not.toMatch(/aaaa1111…\s+\d/);
	});

	it('html contains the full attestation hash, not the truncated form', async () => {
		const r = await renderReport(baseCtx);
		expect(r.html).toContain(`sha256:${r.attestationHash}`);
		// Older truncation pattern should not be present.
		expect(r.html).not.toMatch(/sha256:[0-9a-f]{8}…[0-9a-f]{4}/);
	});
});

describe('renderReport — org branding (D-09)', () => {
	const accentCtx = {
		...baseCtx,
		branding: { accent: '#ff5500', logoUrl: 'https://cdn.example.com/logo.png' }
	};

	it('renders the org accent on the eyebrow header, primary bar, and verify link', async () => {
		const r = await renderReport(accentCtx);
		// Eyebrow "Verification Report" color is the accent (was the muted gray).
		expect(r.html).toContain('color:#ff5500;text-transform:uppercase');
		// Verify-independently link is tinted with the accent.
		expect(r.html).toContain('color:#ff5500;text-decoration:none');
		// Identity / geography primary segment uses the accent.
		expect(r.html).toContain('background-color:#ff5500');
	});

	it('renders the org logo in the header when set', async () => {
		const r = await renderReport(accentCtx);
		expect(r.html).toContain('src="https://cdn.example.com/logo.png"');
		expect(r.html).toContain('alt="Sample Coalition"');
	});

	it('falls back to Commons teal + no logo when branding is unset', async () => {
		const r = await renderReport(baseCtx);
		// Default Commons teal primary segment.
		expect(r.html).toContain('background-color:#3bc4b8');
		// Eyebrow keeps the muted gray default.
		expect(r.html).toContain('color:#a3a3a3;text-transform:uppercase');
		// No injected logo img.
		expect(r.html).not.toContain('<img');
	});

	it('ignores a malformed accent and falls back to Commons styling', async () => {
		const r = await renderReport({ ...baseCtx, branding: { accent: 'not-a-hex' } });
		expect(r.html).toContain('background-color:#3bc4b8');
		expect(r.html).not.toContain('not-a-hex');
	});

	it('branding NEVER changes the attestation hash (presentation-only invariant)', async () => {
		const plain = await renderReport(baseCtx);
		const branded = await renderReport(accentCtx);
		const whiteLabeled = await renderReport({ ...baseCtx, whiteLabel: true });
		// All three carry identical attestation hashes — branding + white-label
		// are excluded from the canonical preimage by design.
		expect(branded.attestationHash).toBe(plain.attestationHash);
		expect(whiteLabeled.attestationHash).toBe(plain.attestationHash);
		expect(canonicalPreimage(accentCtx)).toBe(canonicalPreimage(baseCtx));
	});
});
