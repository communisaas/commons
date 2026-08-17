/**
 * Per-recipient velocity policy — the constants and key derivation shared by the
 * SvelteKit seam and the admitting Durable Object.
 *
 * Pure by construction: no I/O, no `$env`, no imports that reach either. The
 * worker bundle imports this file directly (`workers/convex-work-budget.ts`),
 * exactly as it already imports `convex-work-budget-policy.ts` and
 * `paid-provider-budget-policy.ts`, so the client and the store can never
 * disagree about a path, a window, or a ceiling.
 *
 * What this governs: how many suppression links ONE source may mint for ONE
 * natural-person mailbox in one UTC day. It is a WITHHOLDING authority and
 * nothing else — it grants no capability, carries no billing or moderation
 * signal, and is read at exactly one call site
 * (`src/routes/api/do-not-contact/links/+server.ts`).
 *
 * The admission protocol is versioned on its OWN header, not the paid-provider
 * one, so the two protocols on the same Durable Object class can move
 * independently.
 */

export const RECIPIENT_VELOCITY_PROTOCOL = '1' as const;
export const RECIPIENT_VELOCITY_PROTOCOL_HEADER = 'x-recipient-velocity-protocol' as const;
export const RECIPIENT_VELOCITY_RESERVATION_PATH = '/reserve-recipient' as const;
export const RECIPIENT_VELOCITY_STATUS_PATH = '/status-recipient' as const;

/**
 * A dedicated object id. Recipient admissions must not serialize behind
 * paid-provider admissions: a send-time seam that waits on an AI budget
 * transaction is a send-time seam that times out.
 */
export const RECIPIENT_VELOCITY_COORDINATOR_NAME = 'recipient-velocity-v1' as const;

/** Mints per (source, target) per UTC day. */
export const RECIPIENT_VELOCITY_SOURCE_MAX = 3 as const;

/**
 * One repeat of the exact (source, target, scope) reservation inside this window
 * returns the previous verdict and consumes nothing. The persisted replay cap
 * below prevents a rapid caller from turning that recovery rule into free links.
 */
export const RECIPIENT_VELOCITY_IDEMPOTENCY_MS = 60_000 as const;

/**
 * At-most-one recovery response for each admitted reservation.
 *
 * A timeout retry needs one chance to recover the deterministic suppression URL,
 * but treating every request inside the idempotency window as a retry turns the
 * window into an unlimited mint. The Durable Object binds this allowance to the
 * exact `(source, target, scope)` reservation and persists how many times it was
 * replayed. The allowance is deliberately small and explicit so a hostile burst
 * has a finite upper bound.
 */
export const RECIPIENT_VELOCITY_REPLAY_MAX = 1 as const;

/** Mirrors `PAID_PROVIDER_BUDGET_TIMEOUT_MS`; this seam is on the send path. */
export const RECIPIENT_VELOCITY_TIMEOUT_MS = 750 as const;

/**
 * THE FOUNDER DECISION THIS NODE REFUSES TO MAKE IN CODE.
 *
 * A global, multi-source ceiling on one mailbox is not a smaller version of the
 * per-source bound — it is a different weapon. With no identity floor, burner
 * addresses exhaust a target's global budget and thereby silence every honest
 * constituent who writes afterwards; with an identity floor, verification
 * becomes a precondition of speech above the threshold. Both are policy, and
 * both belong to a person, not to a patch. The counter ships so the decision can
 * be made on numbers; the refusal does not.
 *
 * See `docs/architecture/rate-limiting.md` → "Per-recipient velocity".
 */
export const RECIPIENT_VELOCITY_GLOBAL_CEILING = null;

/**
 * Targets per reservation. Mirrors `DO_NOT_CONTACT_LINK_MAX` at
 * `src/routes/api/do-not-contact/links/+server.ts:39` — one send's whole roster
 * is reserved in ONE request, so a send costs one Durable Object request rather
 * than one per address.
 */
export const RECIPIENT_VELOCITY_TARGET_MAX = 20 as const;

/** `computeGlobalEmailHash` and the source/scope digests: SHA-256, lowercase hex. */
export const RECIPIENT_VELOCITY_HASH_CHARS = 64 as const;

/** `"<64 hex>"` plus the comma that separates it from the next element. */
const TARGET_ENCODED_BYTES = RECIPIENT_VELOCITY_HASH_CHARS + 3;

/**
 * The two quoted 64-char hashes the envelope carries (`scopeHash`, `sourceHash`)
 * plus a fixed allowance for the key names, the realm literal, and the JSON
 * punctuation around them.
 */
const ENVELOPE_ENCODED_BYTES = 2 * (RECIPIENT_VELOCITY_HASH_CHARS + 2) + 128;

/**
 * Body ceiling for the two recipient paths, DERIVED rather than chosen.
 *
 * The 512-byte `MAX_BODY_BYTES` the provider paths enforce is correct for their
 * single-actor bodies and stays exactly where it is. A recipient reservation
 * carries a whole send's roster — 20 hashes at 64 hex characters each is ~1.5 KB
 * — so it needs its own, still-bounded ceiling. Batching is what keeps this
 * control at one Durable Object request per send.
 */
export const RECIPIENT_VELOCITY_MAX_BODY_BYTES =
	ENVELOPE_ENCODED_BYTES + RECIPIENT_VELOCITY_TARGET_MAX * TARGET_ENCODED_BYTES;

/** Bounded read of the reservation/status response. */
export const RECIPIENT_VELOCITY_MAX_RESPONSE_BYTES = 16 * 1024;

const HASH_PATTERN = /^[a-f0-9]{64}$/;

export function isRecipientVelocityHash(value: unknown): value is string {
	return typeof value === 'string' && HASH_PATTERN.test(value);
}

/**
 * The quota key. Deliberately NOT scoped by template: a person's protection
 * from one sender cannot be bought by that sender opening a second template.
 */
export function recipientVelocitySourceTargetKey(sourceHash: string, targetHash: string): string {
	return `${sourceHash}:${targetHash}`;
}

/**
 * The ECHO key, which IS template-scoped, and only decides whether a refusal may
 * name the address back to the caller. See the disclosure note in
 * `src/routes/api/do-not-contact/links/+server.ts`.
 */
export function recipientVelocityMintKey(
	sourceHash: string,
	targetHash: string,
	scopeHash: string
): string {
	return `${sourceHash}:${targetHash}:${scopeHash}`;
}

/**
 * Three states, and `unmeasured` is never reducible to `granted`.
 *
 * The governor fails OPEN: an unreachable store mints the link. That is a
 * deliberate availability choice (the attacker it would stop already has their
 * own mail client), but the verdict must still say that nothing was measured —
 * reporting an unmeasured reservation as "within budget" is the lie that turns a
 * degraded control into a false claim of protection. Mirrors the
 * unavailable-vs-allowed split at `src/lib/server/llm-cost-protection.ts:370`.
 */
export type RecipientVelocityVerdict =
	| Readonly<{ state: 'granted' }>
	| Readonly<{
			state: 'held';
			retryAfterSeconds: number;
			/**
			 * May the refusal name this address back to the caller? True only where
			 * this source has already minted for this address on THIS template today,
			 * so the refusal discloses nothing an earlier 200 did not.
			 */
			echo: boolean;
	  }>
	| Readonly<{ state: 'unmeasured'; why: string }>;
