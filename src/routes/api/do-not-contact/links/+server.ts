/**
 * POST /api/do-not-contact/links — send-time suppression links, minted on request.
 *
 * A suppression URL opens the route out for one mailbox; it does not itself
 * perform any write. It is minted at the moment a message is assembled, for the
 * addresses that message actually carries — never eagerly on a page load, and
 * never shipped in an anonymous page payload for a whole roster of people.
 *
 * POST ONLY. There is no GET here and there must never be one: mail-security
 * appliances and inbox previewers prefetch links, and a GET mint would put a
 * durable credential into browser history, referer chains and scanner logs.
 *
 * The roster is both SERVER-derived and CALLER-named, and a link exists only in
 * the intersection. The published artifact NARROWS: naming an address the
 * template does not publish yields no entry, so this endpoint cannot mint for an
 * arbitrary mailbox. And a body that names no address yields no link at all — a
 * caller who does not already know an address does not learn one here, so one
 * anonymous POST can no longer harvest a whole roster's worth of links.
 *
 * Every ordinary outcome answers 200 with `{ links, held }`. A hit, a miss, an
 * unknown slug and a congressional-relay template are indistinguishable from
 * the outside — anything else is an address-enumeration oracle. A request whose
 * requested/published roster exceeds the reviewed ceiling is rejected in full;
 * it is never trimmed into a response that falsely looks complete.
 *
 * VOLUME. This is also the only server call on a non-congressional send that
 * ever sees the target address, so it is where a per-RECIPIENT bound can exist
 * at all. Every other limit in this tree is keyed per-IP or per-user. A source
 * gets `RECIPIENT_VELOCITY_SOURCE_MAX` mints per natural-person mailbox per UTC
 * day; institutional routes, government-registry namespaces and the certified
 * congressional relay are never bounded, because petitioning an office is not
 * harassment. The governor may only WITHHOLD, and it fails OPEN: an unreachable
 * store mints the link and records the verdict as unmeasured.
 *
 * It bounds the platform as an instrument. It does not — and no string here may
 * claim it does — stop anyone who assembles their own mailto or SMTP.
 */

import { error, json } from '@sveltejs/kit';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '$lib/server/bounded-json-request';
import { isValidPublicTemplateSlug } from '$lib/server/public-template-detail-path';
import { getCachedPublicTemplatePageArtifact } from '$lib/server/public-template-queries';
import { parseRecipientConfig } from '$lib/types/template';
import { computeGlobalEmailHash } from '$lib/core/crypto/org-scoped-hash';
import { buildRecipientSuppressionUrl } from '$lib/server/email/recipient-suppression';
import { classifyGovernmentalAddress } from '$lib/core/agents/governmental-class';
import { classifySeatRoute } from '$lib/core/agents/seat-route';
import {
	reserveRecipientVelocity,
	type RecipientVelocityTarget
} from '$lib/server/recipient-velocity-client';
import { isCongressionalDelivery } from '$convex/lib/templateDeliveryMethod';
import type { RequestHandler } from './$types';

const REQUEST_MAX_BYTES = 16 * 1024;
/** Addresses minted per request. Above this, the whole request fails. */
const DO_NOT_CONTACT_LINK_MAX = 20;
const EMAIL_MAX_CHARS = 256;
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

/**
 * One shape for every outcome. Callers learn nothing from a miss.
 *
 * `held` defaults to empty so EVERY early return — bad body, non-record, invalid
 * slug, missing artifact, congressional relay, roster miss — emits the same
 * fields by construction. A second ad-hoc `json(...)` on the refusal path would
 * reintroduce exactly the enumeration oracle this helper exists to prevent.
 */
function response(
	links: Record<string, string>,
	held: string[] = [],
	retryAfter?: number
): Response {
	return json(
		{ links, held, ...(retryAfter === undefined ? {} : { retryAfter }) },
		{ status: 200, headers: NO_STORE_HEADERS }
	);
}

/**
 * Is this address a natural person's mailbox, for the purposes of volume?
 *
 * Order is load-bearing: a restricted government registry is an institutional
 * route even when the artifact publishes an official's name beside it, so it is
 * never bounded here. Outside those registries, person-form and unevaluable
 * routes are bounded; office seats are not. Missing evidence never widens a
 * private-domain quota.
 */
function isVolumeBounded(address: string, candidateName: string | undefined): boolean {
	if (classifyGovernmentalAddress(address).governmental === true) return false;
	const seat = classifySeatRoute(address, { candidateName });
	if (seat?.form === 'seat') return false;
	return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The same trim+lowercase the global email hash applies. Anything that is not a
 * plausible mailbox contributes nothing rather than raising — a malformed entry
 * must not change the response shape.
 */
function normalizeAddress(value: unknown): string {
	if (typeof value !== 'string' || value.length > EMAIL_MAX_CHARS) return '';
	const normalized = value.trim().toLowerCase();
	return normalized.includes('@') ? normalized : '';
}

let mintWarned = false;

/** One warning per isolate, whatever failed the mint. */
function warnMintUnavailable(cause: unknown): void {
	if (mintWarned) return;
	mintWarned = true;
	console.warn(
		'[do-not-contact] link unavailable; direct messages requiring it will be blocked',
		cause
	);
}

export const POST: RequestHandler = async ({
	request,
	url,
	platform,
	locals,
	getClientAddress
}) => {
	const rateLimit = await getRateLimiter().check(
		`ratelimit:do-not-contact-links:ip:${getClientAddress()}`,
		{ maxRequests: 10, windowMs: 60_000 }
	);
	if (!rateLimit.allowed) throw error(429, 'Too many requests');

	let body: unknown;
	try {
		body = await readBoundedJsonRequest(request, REQUEST_MAX_BYTES, {
			maxArrayItems: DO_NOT_CONTACT_LINK_MAX,
			maxDepth: 3,
			maxNodes: 64,
			maxObjectKeys: 2,
			maxStringBytes: EMAIL_MAX_CHARS
		});
	} catch (cause) {
		if (cause instanceof BoundedJsonRequestError) {
			throw error(cause.status, cause.message);
		}
		return response({});
	}

	if (!isRecord(body)) return response({});
	const { slug } = body;
	if (!isValidPublicTemplateSlug(slug)) return response({});

	// Same published artifact the public page reads — no new provider call, no
	// new Convex function, no new recurring cost on the person layer.
	const artifact = await getCachedPublicTemplatePageArtifact({ url, platform }, slug).catch(
		() => null
	);
	if (!artifact) return response({});

	// The congressional lane routes to the certified-delivery relay and puts no
	// mailbox in front of a sender, so it owes none a route out. Mirrors the lane
	// split in `generateMailtoUrl` and the gate in `/s/[slug]/+layout.server.ts`.
	if (isCongressionalDelivery(artifact.detail.deliveryMethod)) return response({});

	// Address → the name the artifact published beside it, where it published one.
	// The name is what lets `classifySeatRoute` recognise a natural person at all;
	// a bare address set would classify every mailbox `indeterminate` and the
	// volume bound would degrade to "bounded for everything".
	const config = parseRecipientConfig(artifact.detail.recipient_config);
	const roster = new Map<string, string | undefined>();
	for (const email of config.emails ?? []) {
		const normalized = normalizeAddress(email);
		if (normalized && !roster.has(normalized)) roster.set(normalized, undefined);
	}
	for (const decisionMaker of config.decisionMakers ?? []) {
		const normalized = normalizeAddress(decisionMaker?.email);
		if (!normalized) continue;
		const name =
			typeof decisionMaker?.name === 'string' && decisionMaker.name.trim() !== ''
				? decisionMaker.name
				: undefined;
		roster.set(normalized, name ?? roster.get(normalized));
	}

	// A named address is an intersection with the published roster, never a
	// replacement for it — and never an alternative to it. A body with no
	// `emails` gets the same `200 {links:{}}` every other empty outcome gets: no
	// new status, no new body shape, no new oracle.
	if (!Array.isArray(body.emails)) return response({});
	const named = new Set<string>();
	for (const email of body.emails) {
		const normalized = normalizeAddress(email);
		if (normalized && roster.has(normalized)) named.add(normalized);
	}
	const requested = [...named];
	// Defence in depth. `readBoundedJsonRequest`'s `maxArrayItems: 20` rejects an
	// over-long `emails` array before this line is reached (a 400, atomic, above),
	// and the intersection can only shrink the list further. The ceiling stays so
	// that a future caller shape cannot quietly reintroduce an unbounded mint.
	if (requested.length > DO_NOT_CONTACT_LINK_MAX) {
		throw error(
			413,
			`Recipient roster exceeds the ${DO_NOT_CONTACT_LINK_MAX}-address suppression-link limit`
		);
	}

	// The store keys on the hash, and so does the mint, so it is computed once. A
	// hash that cannot be computed simply has no entry — the same absent-entry
	// outcome a failed mint has always had.
	const hashes = new Map<string, string>();
	for (const address of requested) {
		try {
			hashes.set(address, await computeGlobalEmailHash(address));
		} catch (cause) {
			warnMintUnavailable(cause);
		}
	}

	// Derived from the published roster AFTER the intersection, so a caller can
	// never introduce an address, name its classification, or widen its own quota
	// by naming addresses.
	const boundedTargets: RecipientVelocityTarget[] = [];
	for (const address of requested) {
		const hash = hashes.get(address);
		if (hash && isVolumeBounded(address, roster.get(address))) {
			boundedTargets.push({ address, hash });
		}
	}
	const verdicts = await reserveRecipientVelocity({
		event: { platform },
		scopeKey: slug,
		// A session identifies the sender better than a shared NAT address does, so
		// it is preferred where one exists. Both are hashed inside the client; no
		// account is required to be bounded, and none buys an exemption.
		sourceKey: locals.user?.id ? `user:${locals.user.id}` : `ip:${getClientAddress()}`,
		targets: boundedTargets
	});

	const links: Record<string, string> = {};
	const held: string[] = [];
	let retryAfter: number | undefined;
	for (const address of requested) {
		const verdict = verdicts.get(address);
		if (verdict?.state === 'held') {
			// THE DISCLOSURE, CLOSED. `held` names an address only where this source
			// has already been minted for it on THIS template today — an earlier 200
			// already told them the address is published here, so the refusal adds
			// nothing. An ungated hold emits no entry at all and falls through to the
			// existing incomplete-map path, so a caller who has spent their quota on
			// template A cannot read `held` as proof that template B publishes the
			// same mailbox. The cost is real and named in
			// `docs/architecture/rate-limiting.md`: a sender in that position sees the
			// generic incomplete-links message instead of the honest volume copy.
			if (verdict.echo) {
				held.push(address);
				retryAfter = Math.max(retryAfter ?? 0, verdict.retryAfterSeconds);
			}
			continue;
		}
		// `granted`, `unmeasured`, and every unbounded institutional route mint. An
		// unmeasured verdict is a mint that was never measured — it is never
		// recorded, reported, or reasoned about as "within budget".
		const hash = hashes.get(address);
		if (!hash) continue;
		try {
			links[address] = buildRecipientSuppressionUrl(slug, hash);
		} catch (cause) {
			// Preserve the no-oracle 200 shape, but leave the entry absent. The shared
			// send-time reader requires a complete map and blocks the direct send; it
			// never erases this missing credential into an optional footer.
			warnMintUnavailable(cause);
		}
	}

	return response(links, held, retryAfter);
};
