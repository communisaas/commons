/**
 * Guard against re-introducing provably-false in-product claims.
 *
 * The org tooling must not assert capabilities the code does not have. Two
 * specific strings are forbidden because they were false at audit time:
 *  - "Quota enforced by billing limits." on the verified-action plan row
 *    (metered + displayed, never enforced at a cap).
 *  - "carries a zero-knowledge proof" in the org VerificationPacket
 *    (the packet carries a single SHA-256 attestation, not per-row ZK).
 *
 * These scan the real source so a future copy edit that resurrects the claim
 * turns this test RED.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...walk(full));
		else if (/\.(svelte|ts|js)$/.test(entry)) out.push(full);
	}
	return out;
}

const FILES = walk(SRC);

function hits(needle: string | RegExp): string[] {
	return FILES.filter((f) => {
		const text = readFileSync(f, 'utf8');
		return typeof needle === 'string' ? text.includes(needle) : needle.test(text);
	});
}

describe('false-claims guard', () => {
	it('no surface claims the verified-action quota is enforced', () => {
		expect(hits('Quota enforced by billing limits')).toEqual([]);
	});

	it('the VerificationPacket does not claim per-row zero-knowledge proofs', () => {
		expect(hits('carries a zero-knowledge proof')).toEqual([]);
	});

	it('the verified-action plan row is honestly metered, not enforced', () => {
		const settings = readFileSync(
			join(SRC, 'routes/org/[slug]/settings/+page.server.ts'),
			'utf8'
		);
		// The verified-actions row must be the metered/partial copy, not "enforced".
		expect(settings).toContain('not a hard cap today');
		const verifiedRowBlock = settings.slice(
			settings.indexOf('verified actions/mo'),
			settings.indexOf('verified actions/mo') + 200
		);
		expect(verifiedRowBlock).toContain("state: 'partial'");
		expect(verifiedRowBlock).not.toMatch(/enforced|hard cap(?! today)/i);
	});

	it('the VerificationPacket footnote names the SHA-256 attestation', () => {
		const packet = readFileSync(
			join(SRC, 'lib/components/org/VerificationPacket.svelte'),
			'utf8'
		);
		expect(packet).toMatch(/SHA-256 attestation/);
	});
});

describe('empirical models stay on the paid org surface', () => {
	it('no source file hand-types an empirical model value', () => {
		// gds / ald / cai / temporalEntropy / burstVelocity are computed signals on a
		// paying org's verification packet. They are org-visible only — never recipient,
		// public, or marketing. A numeric literal means someone fabricated one to
		// decorate a page, so any hand-typed value anywhere under src/ is forbidden.
		expect(hits(/\b(gds|ald|cai|temporalEntropy|burstVelocity)\s*:\s*-?[0-9]/)).toEqual([]);
	});

	it('the anonymous /org landing page renders no packet', () => {
		// /org is reachable without a session, so it may not carry a packet at all —
		// not a computed one, and certainly not a hand-authored fake.
		const landing = readFileSync(join(SRC, 'routes/org/+page.svelte'), 'utf8');
		expect(landing).not.toContain('specimenPacket');
		expect(landing).not.toContain('ca11Boundary');
		expect(landing).not.toContain('components/org/VerificationPacket.svelte');
		expect(landing).not.toContain('participation-depth');
		expect(landing).not.toMatch(/\.specimen(__|[\s{,:])/);
	});

	it('the authenticated packet surfaces still render the real component', () => {
		// Guard against satisfying the checks above by deleting the product. Both of
		// these feed VerificationPacket a server-computed packet behind org membership;
		// that is the sanctioned surface and it must keep compiling.
		for (const rel of [
			'lib/components/org/os/ReturnSpace.svelte',
			'routes/org/[slug]/campaigns/[id]/+page.svelte'
		]) {
			expect(readFileSync(join(SRC, rel), 'utf8')).toContain(
				'$lib/components/org/VerificationPacket.svelte'
			);
		}
	});
});
