import { describe, expect, it } from 'vitest';

import {
	isBoundedFieldElement,
	isBoundedHexBytes,
	isBytes32,
	isRecord,
	isSafeUint,
	isThreeTreePublicInputs
} from '$lib/server/debate-input-validation';

describe('debate input validation', () => {
	it('accepts only plain JSON objects at route boundaries', () => {
		expect(isRecord({ ok: true })).toBe(true);
		expect(isRecord([])).toBe(false);
		expect(isRecord(null)).toBe(false);
		expect(isRecord('object')).toBe(false);
	});

	it('bounds unsigned integer and bytes32 fields exactly', () => {
		expect(isSafeUint(0)).toBe(true);
		expect(isSafeUint(Number.MAX_SAFE_INTEGER)).toBe(true);
		expect(isSafeUint(-1)).toBe(false);
		expect(isSafeUint(1.5)).toBe(false);
		expect(isBytes32(`0x${'ab'.repeat(32)}`)).toBe(true);
		expect(isBytes32(`0x${'ab'.repeat(31)}`)).toBe(false);
		expect(isBytes32('ab'.repeat(32))).toBe(false);
	});

	it('rejects empty, odd, non-hex, or over-budget proof strings', () => {
		expect(isBoundedHexBytes('0x1234')).toBe(true);
		expect(isBoundedHexBytes('1234')).toBe(true);
		expect(isBoundedHexBytes('0x')).toBe(false);
		expect(isBoundedHexBytes('0x123')).toBe(false);
		expect(isBoundedHexBytes('0xzz')).toBe(false);
		expect(isBoundedHexBytes(`0x${'aa'.repeat(10)}`, 8)).toBe(false);
	});

	it('requires exactly 31 individually bounded three-tree public inputs', () => {
		const valid = Array.from({ length: 31 }, (_, index) => String(index));
		expect(isThreeTreePublicInputs(valid)).toBe(true);
		expect(isThreeTreePublicInputs(valid.slice(1))).toBe(false);
		expect(isThreeTreePublicInputs([...valid.slice(0, 30), 'x'.repeat(81)])).toBe(false);
		expect(isBoundedFieldElement(`0x${'ff'.repeat(32)}`)).toBe(true);
		expect(isBoundedFieldElement('-1')).toBe(false);
	});
});
