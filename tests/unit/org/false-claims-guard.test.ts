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
