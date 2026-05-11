/**
 * F-3.4 — cross-implementation byte-equality of frozen Poseidon2 domain
 * constants.
 *
 * Commons hardcodes domain constants in `src/lib/core/crypto/poseidon.ts` with
 * comments saying "Must match voter-protocol". Comments rot. This suite
 * imports the same constants from `@voter-protocol/crypto` and asserts
 * byte-equality so a future divergence (commons drifts, or a published
 * `@voter-protocol/crypto` version changes the constants) fails CI loudly.
 *
 * The dependency is exact-pinned (`0.1.4`, no caret) so an upstream patch
 * release can't silently ship new constants. Bumping the pin is a deliberate
 * coordinated action; this test is the gate that catches the bump if it
 * carries an unexpected value change.
 *
 * REVOCATION_DOMAIN is not exported from `@voter-protocol/crypto`'s JS
 * surface (it lives in the Noir circuit). The hex literal here mirrors
 * `voter-protocol/specs/CRYPTOGRAPHY-SPEC.md` §0 and the Noir circuit
 * `global REVOCATION_DOMAIN: Field` declaration; verifying it against the
 * spec is a manual gate at namespace-freeze time.
 */

import { describe, it, expect } from 'vitest';
import {
	DOMAIN_HASH1 as VP_DOMAIN_HASH1,
	DOMAIN_HASH2 as VP_DOMAIN_HASH2,
	DOMAIN_HASH3 as VP_DOMAIN_HASH3,
	DOMAIN_HASH4 as VP_DOMAIN_HASH4,
	DOMAIN_SPONGE_24 as VP_DOMAIN_SPONGE_24
} from '@voter-protocol/crypto';
import {
	DOMAIN_HASH1,
	DOMAIN_HASH2,
	DOMAIN_HASH3,
	DOMAIN_HASH4,
	DOMAIN_SPONGE_24,
	REVOCATION_DOMAIN
} from '../../../src/lib/core/crypto/poseidon';

describe('Frozen Poseidon2 domain constants — commons vs @voter-protocol/crypto', () => {
	it('DOMAIN_HASH1 byte-equal across implementations', () => {
		expect(DOMAIN_HASH1).toBe(VP_DOMAIN_HASH1);
	});

	it('DOMAIN_HASH2 byte-equal across implementations', () => {
		expect(DOMAIN_HASH2).toBe(VP_DOMAIN_HASH2);
	});

	it('DOMAIN_HASH3 byte-equal across implementations', () => {
		expect(DOMAIN_HASH3).toBe(VP_DOMAIN_HASH3);
	});

	it('DOMAIN_HASH4 byte-equal across implementations', () => {
		expect(DOMAIN_HASH4).toBe(VP_DOMAIN_HASH4);
	});

	it('DOMAIN_SPONGE_24 byte-equal across implementations', () => {
		expect(DOMAIN_SPONGE_24).toBe(VP_DOMAIN_SPONGE_24);
	});

	it('REVOCATION_DOMAIN matches the Noir circuit constant in voter-protocol', () => {
		// The Noir circuit declares `REVOCATION_DOMAIN: Field = 0x766f7465...7631`.
		// Source: voter-protocol/packages/crypto/noir/three_tree_membership/src/main.nr
		// (UTF-8 "voter-protocol-revocation-v1"). Frozen post-launch.
		const EXPECTED =
			'0x' + (0x766f7465722d70726f746f636f6c2d7265766f636174696f6e2d7631n).toString(16).padStart(64, '0');
		expect(REVOCATION_DOMAIN).toBe(EXPECTED);
		// UTF-8 sanity: decoded bytes spell the canonical string.
		const hex = REVOCATION_DOMAIN.startsWith('0x')
			? REVOCATION_DOMAIN.slice(2)
			: REVOCATION_DOMAIN;
		const padded = hex.replace(/^0+/, '');
		const bytes = padded.match(/../g)!.map((b) => parseInt(b, 16));
		const decoded = String.fromCharCode(...bytes);
		expect(decoded).toBe('voter-protocol-revocation-v1');
	});
});
