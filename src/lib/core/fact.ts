/**
 * Fact — one shared representation for "what did we find" AND "did we look?"
 *
 * Those two questions are orthogonal, and a nullable value answers neither
 * honestly: `null` says a slot is empty without saying whether anyone ever
 * reached the source. A `Fact<T>` keeps them apart in four states:
 *
 *  - present  — a retrieval completed, parsed, and produced a value.
 *  - absent   — a retrieval completed and parsed, and the source published
 *               nothing. A real, observed emptiness.
 *  - withheld — the value exists and was reachable, but policy forbids
 *               returning it (authorization, privacy floor, k-anonymity).
 *               A refusal to disclose, not an emptiness.
 *  - blocked  — we were stopped before we could look: timeout, upstream
 *               error, refusal, budget or ceiling. Evidence of nothing.
 *
 * Only `present` and `absent` are observations. A blocked lookup must never be
 * persisted as one, and `absent` may only be constructed where a retrieval
 * actually completed and parsed — absence is a finding, never a fallback.
 *
 * `withheld` and `blocked` both carry `why` so the reason survives to whoever
 * renders or logs the outcome; neither is ever a verdict on the subject.
 *
 * The surface is deliberately small: four constructors, one guard, and one
 * erasure. There is no helper that collapses a Fact back into a nullable
 * value — that would reinstate exactly the ambiguity this type removes.
 * `valueOr` is the single sanctioned erasure, and its fallback is typed
 * `NoInfer<NonNullable<T>>`, so `T` is fixed by the Fact rather than widened
 * from the fallback. The substitution is a visible decision at the call site,
 * and `null`/`undefined` are a compile error. The tradeoff is accepted
 * deliberately: because `NonNullable<T>`
 * strips the nullable members of `T` itself, even a caller holding a genuinely
 * nullable `Fact<string | null>` cannot default to `null` through `valueOr` —
 * it must branch on `isPresent` at the call site, where the nullability is
 * written out in the open. A nullable `T` inside a Fact is the ambiguity this
 * type exists to remove, so making that case explicit is the point.
 */

/** A four-state answer discriminated on `state`. */
export type Fact<T> =
	| { state: 'present'; value: T }
	| { state: 'absent' }
	| { state: 'withheld'; why: string }
	| { state: 'blocked'; why: string };

/** A retrieval completed and produced `value`. */
export function present<T>(value: T): { state: 'present'; value: T } {
	return { state: 'present', value };
}

/**
 * A retrieval completed and parsed, and there was nothing there. Construct this
 * ONLY on a path that actually reached and read the source.
 */
export function absent(): { state: 'absent' } {
	return { state: 'absent' };
}

/** The value was reachable but policy forbids disclosing it. */
export function withheld(why: string): { state: 'withheld'; why: string } {
	return { state: 'withheld', why };
}

/** We never got to look — timeout, error, refusal, budget or ceiling. */
export function blocked(why: string): { state: 'blocked'; why: string } {
	return { state: 'blocked', why };
}

/** Narrows to the `present` member. The other three states are switchable directly. */
export function isPresent<T>(f: Fact<T>): f is Extract<Fact<T>, { state: 'present' }> {
	return f.state === 'present';
}

/**
 * The only sanctioned erasure. `NoInfer` fixes `T` from `f`, while
 * `NonNullable<T>` rejects `null` and `undefined` under every instantiation: a
 * Fact cannot be turned back into a nullable value here, whether or not `T` is
 * itself nullable. The return type remains `T`. A caller who genuinely wants a
 * nullable default writes the branch itself — `isPresent(f) ? f.value : null`.
 */
export function valueOr<T>(f: Fact<T>, fallback: NoInfer<NonNullable<T>>): T {
	return f.state === 'present' ? f.value : fallback;
}
