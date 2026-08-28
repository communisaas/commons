/**
 * Unit Tests — Fact
 *
 * The load-bearing property: "we looked and found nothing" (`absent`) and "we
 * never got to look" (`blocked`) are distinct facts, and nothing in the module
 * maps them onto a common value except a `valueOr` fallback the caller supplied
 * explicitly — typed `NoInfer<NonNullable<T>>`, so it cannot widen `T` or be
 * `null`/`undefined`.
 */

import { describe, it, expect } from 'vitest';
import * as fact from '$lib/core/fact';
import { present, absent, withheld, blocked, isPresent, valueOr, type Fact } from '$lib/core/fact';

/**
 * Exhaustive discriminant walk. The `never` arm is the compile-time proof that
 * the union has exactly these four members: adding a fifth state stops this
 * file from type-checking.
 */
function label<T>(f: Fact<T>): string {
	switch (f.state) {
		case 'present':
			return 'present';
		case 'absent':
			return 'absent';
		case 'withheld':
			return 'withheld';
		case 'blocked':
			return 'blocked';
		default: {
			const _never: never = f;
			return _never;
		}
	}
}

describe('Fact constructors', () => {
	it('present carries its value', () => {
		const f = present(42);
		expect(f.state).toBe('present');
		expect(f.value).toBe(42);
		expect(Object.keys(f).sort()).toEqual(['state', 'value']);
	});

	it('absent carries nothing but its state', () => {
		const f = absent();
		expect(f.state).toBe('absent');
		expect(Object.keys(f)).toEqual(['state']);
	});

	it('withheld carries a reason', () => {
		const f = withheld('below k-anonymity floor');
		expect(f.state).toBe('withheld');
		expect(f.why).toBe('below k-anonymity floor');
		expect(Object.keys(f).sort()).toEqual(['state', 'why']);
	});

	it('blocked carries a reason', () => {
		const f = blocked('upstream timeout');
		expect(f.state).toBe('blocked');
		expect(f.why).toBe('upstream timeout');
		expect(Object.keys(f).sort()).toEqual(['state', 'why']);
	});

	it('states are mutually exclusive under an exhaustive switch', () => {
		const all: Fact<number>[] = [present(1), absent(), withheld('policy'), blocked('timeout')];
		expect(all.map(label)).toEqual(['present', 'absent', 'withheld', 'blocked']);
		expect(new Set(all.map((f) => f.state)).size).toBe(4);
	});
});

describe('isPresent', () => {
	it('is true only for present', () => {
		expect(isPresent(present('x'))).toBe(true);
		expect(isPresent(absent())).toBe(false);
		expect(isPresent(withheld('policy'))).toBe(false);
		expect(isPresent(blocked('timeout'))).toBe(false);
	});

	it('narrows to the present member', () => {
		const f: Fact<number> = present(7);
		let seen = 0;
		if (isPresent(f)) {
			// Compile-time proof: `f.value` is `number` inside the guard, with no
			// cast and no optional access. Checked by `npm run check`, which
			// type-checks `tests/**/*.ts`.
			const n: number = f.value;
			seen = n;
		}
		expect(seen).toBe(7);
	});
});

describe('valueOr', () => {
	it('returns the value when present and the fallback otherwise', () => {
		expect(valueOr(present(3), -1)).toBe(3);
		expect(valueOr(absent(), -1)).toBe(-1);
		expect(valueOr(withheld('policy'), -1)).toBe(-1);
		expect(valueOr(blocked('timeout'), -1)).toBe(-1);
	});

	it('fixes T from the Fact and requires a non-nullable fallback', () => {
		const fs: Fact<string> = blocked('timeout');
		const s: string = valueOr(fs, '');
		expect(s).toBe('');

		// The nullable escape hatch is closed by the compiler, not by convention.
		// `tsc` reports TS2578 ("unused '@ts-expect-error' directive") the moment
		// either of these starts type-checking, so this cannot rot into a comment
		// that describes a hole someone already reopened.
		// @ts-expect-error — NoInfer fixes T as string; `null` cannot widen it.
		expect(valueOr(fs, null)).toBeNull();
		// @ts-expect-error — NoInfer fixes T as string; `undefined` cannot widen it.
		expect(valueOr(fs, undefined)).toBeUndefined();
	});
});

describe('absent vs blocked are not the same fact', () => {
	const why = 'DNS-over-HTTPS returned no answer';
	const a: Fact<number> = absent();
	const b: Fact<number> = blocked(why);

	it('have different discriminants', () => {
		expect(a.state).toBe('absent');
		expect(b.state).toBe('blocked');
		expect(a.state).not.toBe(b.state);
	});

	it('are not deep-equal', () => {
		expect(a).not.toEqual(b);
		expect(a).toEqual({ state: 'absent' });
		expect(b).toEqual({ state: 'blocked', why });
	});

	it('differ under a `why` membership test', () => {
		expect('why' in a).toBe(false);
		expect('why' in b).toBe(true);
	});

	it('are both non-present without being conflated', () => {
		expect(isPresent(a)).toBe(false);
		expect(isPresent(b)).toBe(false);
		expect(label(a)).not.toBe(label(b));
		// The ONLY thing that maps them to a common value is an explicit,
		// same-typed fallback the caller chose to supply.
		expect(valueOr(a, 0)).toBe(valueOr(b, 0));
	});
});

describe('module surface', () => {
	it('exports exactly four constructors, one guard and one erasure', () => {
		expect(Object.keys(fact).sort()).toEqual([
			'absent',
			'blocked',
			'isPresent',
			'present',
			'valueOr',
			'withheld'
		]);
	});
});
