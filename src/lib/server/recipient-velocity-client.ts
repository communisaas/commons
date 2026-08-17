/**
 * Per-recipient velocity transport — the send-time seam's one call to the
 * admitting Durable Object.
 *
 * Shape copied from `paid-provider-budget-client.ts` on purpose: the binding
 * lookup, `idFromName`, `.get(id).fetch()`, the protocol header asserted on both
 * the request AND the response, the 750ms timeout, and the bounded response
 * read are the reviewed transport for this object, and a second hand-rolled one
 * would be free to drift. The object id is DEDICATED
 * (`RECIPIENT_VELOCITY_COORDINATOR_NAME`) so a send never serializes behind a
 * paid-provider admission.
 *
 * PRIVACY: no plaintext mailbox and no plaintext IP is ever serialized into the
 * request. The target key is the caller-supplied global email hash; the source
 * and template keys are domain-separated SHA-256 digests computed here. That
 * preserves the recorded property that a recipient address never enters durable
 * tracking (`src/routes/s/[slug]/+page.svelte:523-524`).
 *
 * FAILURE POSTURE: every failure — no binding, no realm, timeout, throw, wrong
 * protocol header, non-JSON, malformed body, unknown status, a verdict for a
 * target nobody asked about — returns `unmeasured`. The caller mints on
 * `unmeasured`, and `unmeasured` is never reported as "within budget".
 */

import type { RequestEvent } from '@sveltejs/kit';
import { convexWorkBudgetRealmForConvexUrl } from '$lib/server/convex-work-budget-client';
import {
	RECIPIENT_VELOCITY_COORDINATOR_NAME,
	RECIPIENT_VELOCITY_MAX_RESPONSE_BYTES,
	RECIPIENT_VELOCITY_PROTOCOL,
	RECIPIENT_VELOCITY_PROTOCOL_HEADER,
	RECIPIENT_VELOCITY_TARGET_MAX,
	RECIPIENT_VELOCITY_TIMEOUT_MS,
	isRecipientVelocityHash,
	type RecipientVelocityVerdict
} from '$lib/server/recipient-velocity-policy';

const RESERVATION_URL = 'https://convex-work-budget.internal/reserve-recipient';

type RecipientVelocityEvent = Pick<RequestEvent, 'platform'>;

/** One address the seam is about to mint for, with the hash the store keys on. */
export type RecipientVelocityTarget = Readonly<{ address: string; hash: string }>;

/** Address → verdict. Every requested address is present in the map. */
export type RecipientVelocityVerdicts = ReadonlyMap<string, RecipientVelocityVerdict>;

function unmeasured(
	targets: readonly RecipientVelocityTarget[],
	why: string
): RecipientVelocityVerdicts {
	return new Map(
		targets.map((target) => [target.address, Object.freeze({ state: 'unmeasured' as const, why })])
	);
}

function toHex(digest: ArrayBuffer): string {
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Domain-separated digest of `user:<id>` or `ip:<addr>`. The plaintext never
 * leaves this process; the store sees 64 hex characters and cannot recover
 * either an account or an address from them.
 */
export async function recipientVelocitySourceHash(sourceKey: string): Promise<string | null> {
	if (sourceKey.length < 1 || sourceKey.length > 512) return null;
	const bytes = new TextEncoder().encode(`commons:recipient-velocity-source:v1:${sourceKey}`);
	return toHex(await crypto.subtle.digest('SHA-256', bytes));
}

/** The template the mint was asked for. Scopes the refusal ECHO, never the quota. */
async function recipientVelocityScopeHash(scopeKey: string): Promise<string | null> {
	if (scopeKey.length < 1 || scopeKey.length > 512) return null;
	const bytes = new TextEncoder().encode(`commons:recipient-velocity-scope:v1:${scopeKey}`);
	return toHex(await crypto.subtle.digest('SHA-256', bytes));
}

/** Read at most `RECIPIENT_VELOCITY_MAX_RESPONSE_BYTES`, then parse. */
async function boundedResponseJson(response: Response): Promise<unknown> {
	const declared = response.headers.get('content-length');
	if (
		declared !== null &&
		(!/^(?:0|[1-9][0-9]*)$/.test(declared) ||
			Number(declared) > RECIPIENT_VELOCITY_MAX_RESPONSE_BYTES)
	) {
		await response.body?.cancel().catch(() => undefined);
		throw new Error('RECIPIENT_VELOCITY_RESPONSE_INVALID');
	}
	const text = await response.text();
	if (new TextEncoder().encode(text).byteLength > RECIPIENT_VELOCITY_MAX_RESPONSE_BYTES) {
		throw new Error('RECIPIENT_VELOCITY_RESPONSE_INVALID');
	}
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw new Error('RECIPIENT_VELOCITY_RESPONSE_INVALID');
	}
}

function positiveInteger(value: unknown): number | null {
	return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

/**
 * Reserve one mint per target for this source, for the current UTC day.
 *
 * @param targets - The addresses this send will mint for, ALREADY narrowed to
 *   natural-person mailboxes by the caller. Institutional routes and the
 *   certified relay never reach here: petitioning an office is not harassment.
 * @param sourceKey - `user:<id>` where a session exists, else `ip:<addr>`.
 * @param scopeKey - The public template slug. Scopes only the refusal echo.
 */
export async function reserveRecipientVelocity(input: {
	event: RecipientVelocityEvent;
	scopeKey: string;
	sourceKey: string;
	targets: readonly RecipientVelocityTarget[];
	timeoutMs?: number;
}): Promise<RecipientVelocityVerdicts> {
	const { targets } = input;
	if (targets.length === 0) return new Map();
	if (targets.length > RECIPIENT_VELOCITY_TARGET_MAX) {
		return unmeasured(targets, 'recipient-velocity-roster-too-large');
	}
	if (!targets.every((target) => isRecipientVelocityHash(target.hash))) {
		return unmeasured(targets, 'recipient-velocity-target-hash-invalid');
	}

	const namespace = input.event.platform?.env?.CONVEX_WORK_BUDGET;
	const realm = convexWorkBudgetRealmForConvexUrl(input.event.platform?.env?.PUBLIC_CONVEX_URL);
	const sourceHash = await recipientVelocitySourceHash(input.sourceKey);
	const scopeHash = await recipientVelocityScopeHash(input.scopeKey);
	if (!namespace) return unmeasured(targets, 'recipient-velocity-binding-absent');
	if (!realm) return unmeasured(targets, 'recipient-velocity-realm-unknown');
	if (!sourceHash || !scopeHash) return unmeasured(targets, 'recipient-velocity-key-invalid');

	let response: Response;
	try {
		const id = namespace.idFromName(RECIPIENT_VELOCITY_COORDINATOR_NAME);
		response = await namespace.get(id).fetch(
			new Request(RESERVATION_URL, {
				body: JSON.stringify({
					realm,
					scopeHash,
					sourceHash,
					targets: targets.map((target) => target.hash)
				}),
				headers: {
					'content-type': 'application/json',
					[RECIPIENT_VELOCITY_PROTOCOL_HEADER]: RECIPIENT_VELOCITY_PROTOCOL
				},
				method: 'POST',
				signal: AbortSignal.timeout(input.timeoutMs ?? RECIPIENT_VELOCITY_TIMEOUT_MS)
			})
		);
	} catch {
		return unmeasured(targets, 'recipient-velocity-unreachable');
	}

	if (
		response.status !== 200 ||
		response.headers.get(RECIPIENT_VELOCITY_PROTOCOL_HEADER) !== RECIPIENT_VELOCITY_PROTOCOL ||
		!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')
	) {
		await response.body?.cancel().catch(() => undefined);
		return unmeasured(targets, 'recipient-velocity-protocol-drift');
	}

	let body: unknown;
	try {
		body = await boundedResponseJson(response);
	} catch {
		return unmeasured(targets, 'recipient-velocity-response-invalid');
	}
	if (body === null || typeof body !== 'object' || Array.isArray(body)) {
		return unmeasured(targets, 'recipient-velocity-response-invalid');
	}
	const { retryAfterSeconds, schema, verdicts } = body as Record<string, unknown>;
	const retryAfter = positiveInteger(retryAfterSeconds);
	if (schema !== 1 || retryAfter === null || !Array.isArray(verdicts)) {
		return unmeasured(targets, 'recipient-velocity-response-invalid');
	}

	const byHash = new Map<string, RecipientVelocityVerdict>();
	for (const entry of verdicts) {
		if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
			return unmeasured(targets, 'recipient-velocity-response-invalid');
		}
		const { echo, state, target } = entry as Record<string, unknown>;
		if (!isRecipientVelocityHash(target) || typeof echo !== 'boolean') {
			return unmeasured(targets, 'recipient-velocity-response-invalid');
		}
		if (state === 'granted') {
			byHash.set(target, Object.freeze({ state: 'granted' as const }));
			continue;
		}
		if (state !== 'held') return unmeasured(targets, 'recipient-velocity-response-invalid');
		byHash.set(
			target,
			Object.freeze({ echo, retryAfterSeconds: retryAfter, state: 'held' as const })
		);
	}
	// A verdict for every target, and no verdict for a target nobody asked about.
	if (byHash.size !== targets.length || !targets.every((target) => byHash.has(target.hash))) {
		return unmeasured(targets, 'recipient-velocity-response-incomplete');
	}

	return new Map(
		targets.map((target) => [target.address, byHash.get(target.hash) as RecipientVelocityVerdict])
	);
}
