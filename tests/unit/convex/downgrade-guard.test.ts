/**
 * Wave 7 / FU-1.2 — pure-helper tests for `applyDowngradeGuard`.
 *
 * Replaces the mock-mirror tax in `regrounding-attack-sims.test.ts` with
 * direct assertions against the extracted helper. The MockConvex mirror
 * still exists in attack-sims (it tests the broader throttle + sybil flow),
 * but is no longer responsible for the guard's semantics — those are tested
 * here against the production helper.
 */

import { describe, it, expect } from 'vitest';
import { applyDowngradeGuard } from '../../../convex/_downgradeGuard';

describe('applyDowngradeGuard', () => {
	it('first-time user (no existing rows) accepts any input including undefined', () => {
		expect(applyDowngradeGuard([], undefined)).toBeNull();
		expect(applyDowngradeGuard([], '0xabc')).toBeNull();
	});

	it('legacy user (existing rows but none with commitment) accepts undefined', () => {
		const existing = [{ districtCommitment: undefined }, {}];
		expect(applyDowngradeGuard(existing, undefined)).toBeNull();
	});

	it('legacy user can also accept a commitment (upgrade path)', () => {
		const existing = [{ districtCommitment: undefined }];
		expect(applyDowngradeGuard(existing, '0xabc' + '0'.repeat(61))).toBeNull();
	});

	it('user with prior commitment + missing incoming → DOWNGRADE rejected', () => {
		const existing = [{ districtCommitment: '0xprior' + '0'.repeat(58) }];
		expect(applyDowngradeGuard(existing, undefined)).toBe(
			'ADDRESS_VERIFICATION_COMMITMENT_DOWNGRADE'
		);
	});

	it('user with prior commitment + new commitment → accepted', () => {
		const existing = [{ districtCommitment: '0xprior' + '0'.repeat(58) }];
		expect(applyDowngradeGuard(existing, '0xnew' + '0'.repeat(60))).toBeNull();
	});

	it('user with mixed history (one v1, one v2) + missing incoming → DOWNGRADE rejected', () => {
		const existing = [
			{ districtCommitment: undefined },
			{ districtCommitment: '0xv2' + '0'.repeat(62) }
		];
		expect(applyDowngradeGuard(existing, undefined)).toBe(
			'ADDRESS_VERIFICATION_COMMITMENT_DOWNGRADE'
		);
	});

	it('empty-string incoming commitment is treated as missing (not a valid downgrade bypass)', () => {
		const existing = [{ districtCommitment: '0xprior' + '0'.repeat(58) }];
		expect(applyDowngradeGuard(existing, '')).toBe(
			'ADDRESS_VERIFICATION_COMMITMENT_DOWNGRADE'
		);
	});

	it('accepts when only revoked rows had commitment (history is forever — once v2, always v2)', () => {
		// Revocation does not erase the row's `districtCommitment` field;
		// the guard sees the full history. Forces a v2 user who had their
		// credential revoked to keep providing v2 commitments on re-verify.
		const existing = [
			// Single revoked v2 row.
			{ districtCommitment: '0xrevokedv2' + '0'.repeat(54) }
		];
		expect(applyDowngradeGuard(existing, undefined)).toBe(
			'ADDRESS_VERIFICATION_COMMITMENT_DOWNGRADE'
		);
		// Replacement v2 commitment is accepted.
		expect(applyDowngradeGuard(existing, '0xnewv2' + '0'.repeat(58))).toBeNull();
	});
});
