/**
 * POST /api/do-not-contact/links — send-time suppression links, minted on request.
 *
 * A suppression URL is a permanent, global takedown credential for one mailbox.
 * It is minted at the moment a message is assembled, for the addresses that
 * message actually carries — never eagerly on a page load, and never shipped in
 * an anonymous page payload for a whole roster of people.
 *
 * POST ONLY. There is no GET here and there must never be one: mail-security
 * appliances and inbox previewers prefetch links, and a GET mint would put a
 * durable credential into browser history, referer chains and scanner logs.
 *
 * The roster is derived SERVER-side from the same published artifact the public
 * template page renders. A caller may NARROW that roster by naming addresses; it
 * can never widen it. Naming an address the template does not publish yields no
 * entry, so this endpoint cannot be used to mint a takedown link for an arbitrary
 * mailbox.
 *
 * Every ordinary outcome answers 200 with `{ links }`. A hit, a miss, an
 * unknown slug and a congressional-relay template are indistinguishable from
 * the outside — anything else is an address-enumeration oracle. A request whose
 * requested/published roster exceeds the reviewed ceiling is rejected in full;
 * it is never trimmed into a response that falsely looks complete.
 */

import { error, json } from '@sveltejs/kit';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '$lib/server/bounded-json-request';
import { isValidPublicTemplateSlug } from '$lib/server/public-template-detail-path';
import { getCachedPublicTemplatePageArtifact } from '$lib/server/public-template-queries';
import { parseRecipientConfig } from '$lib/types/template';
import { computeGlobalEmailHash } from '$lib/core/crypto/org-scoped-hash';
import { buildRecipientSuppressionUrl } from '$lib/server/email/recipient-suppression';
import { isCongressionalDelivery } from '$convex/lib/templateDeliveryMethod';
import type { RequestHandler } from './$types';

const REQUEST_MAX_BYTES = 16 * 1024;
/** Addresses minted per request. Above this, the whole request fails. */
const DO_NOT_CONTACT_LINK_MAX = 20;
const EMAIL_MAX_CHARS = 256;
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

/** One shape for every outcome. Callers learn nothing from a miss. */
function response(links: Record<string, string>): Response {
	return json({ links }, { status: 200, headers: NO_STORE_HEADERS });
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

export const POST: RequestHandler = async ({ request, url, platform, getClientAddress }) => {
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

	const config = parseRecipientConfig(artifact.detail.recipient_config);
	const roster = new Set<string>();
	for (const email of config.emails ?? []) {
		const normalized = normalizeAddress(email);
		if (normalized) roster.add(normalized);
	}
	for (const decisionMaker of config.decisionMakers ?? []) {
		const normalized = normalizeAddress(decisionMaker?.email);
		if (normalized) roster.add(normalized);
	}

	// A named address is an intersection with the published roster, never a
	// replacement for it. No `emails` at all means the composer resolved its
	// recipients internally, so the whole roster is the answer.
	let requested: string[];
	if (Array.isArray(body.emails)) {
		const named = new Set<string>();
		for (const email of body.emails) {
			const normalized = normalizeAddress(email);
			if (normalized && roster.has(normalized)) named.add(normalized);
		}
		requested = [...named];
	} else {
		requested = [...roster];
	}
	if (requested.length > DO_NOT_CONTACT_LINK_MAX) {
		throw error(
			413,
			`Recipient roster exceeds the ${DO_NOT_CONTACT_LINK_MAX}-address suppression-link limit`
		);
	}

	const links: Record<string, string> = {};
	for (const address of requested) {
		try {
			links[address] = buildRecipientSuppressionUrl(await computeGlobalEmailHash(address));
		} catch (cause) {
			// Preserve the no-oracle 200 shape, but leave the entry absent. The shared
			// send-time reader requires a complete map and blocks the direct send; it
			// never erases this missing credential into an optional footer.
			if (!mintWarned) {
				mintWarned = true;
				console.warn(
					'[do-not-contact] link unavailable; direct messages requiring it will be blocked',
					cause
				);
			}
		}
	}

	return response(links);
};
