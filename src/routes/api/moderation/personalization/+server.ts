import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { moderatePersonalization } from '$lib/core/server/moderation';
import {
	AUDIENCE_ROSTER_MAX,
	deriveAudience,
	publishedRosterRoutes,
	type AudienceRoute,
	type AudienceVerdict
} from '$lib/core/server/moderation/audience';
import {
	intersectAddressed,
	normalizeAddress,
	normalizeAddressedRecipients
} from '$lib/server/addressed-recipients';
import { requireAuthenticatedAgentRequest } from '$lib/server/agent-request-authority';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '$lib/server/bounded-json-request';
import { PROMPT_GUARD_MAX_CHARACTERS } from '$lib/core/server/moderation/prompt-guard-budget';
import { isValidPublicTemplateSlug } from '$lib/server/public-template-detail-path';
import { getCachedPublicTemplatePageArtifact } from '$lib/server/public-template-queries';
import { parseRecipientConfig } from '$lib/types/template';
import { isCongressionalDelivery } from '$convex/lib/templateDeliveryMethod';
// One hash implementation shared with the send-time gate that verifies it.
import { sha256Hex } from '$lib/utils/personal-connection';
import {
	addRateLimitHeaders,
	enforceLLMRateLimit,
	rateLimitResponse
} from '$lib/server/llm-cost-protection';

/**
 * Derive the audience from the mailboxes this send ACTUALLY addresses, inside
 * the roster the artifact at this slug publishes.
 *
 * Two caller inputs, and neither grants a policy. The slug is a POINTER the
 * server dereferences into an artifact it already holds. `recipients` binds the
 * request to that artifact: every addressed address must already appear in its
 * published roster. Crucially, the caller cannot make the verdict permissive by
 * omitting a published person or indeterminate route. The full published roster
 * supplies a strict policy floor; the addressed subset is classified only when
 * that caller-independent floor is already institutional.
 *
 * Every failure to resolve — no addressed set, an unnormalizable address, an
 * absent or invalid slug, an unavailable artifact, an addressee the slug does
 * not publish — degrades to `unevaluable`, which selects the STRICT hazard set.
 * Resolution never produces a status code of its own: it is evidence for the
 * policy, not an admission check, so a caller cannot learn anything from its
 * outcome beyond the shape of a roster already public on the page they loaded.
 *
 * Persisted `seatRoute` / `governmentalClass` values inside `recipient_config`
 * are deliberately NOT read. That column is `v.any()` (`convex/schema.ts:291`)
 * and those fields are server-derived and never trusted from client input
 * (`src/lib/types/template.ts:313`), so the address is re-classified here.
 */
async function resolveAudience(
	event: Parameters<RequestHandler>[0],
	slug: unknown,
	recipients: unknown
): Promise<AudienceVerdict> {
	// The addressed set is read FIRST, before the slug is even looked at and
	// before any artifact is fetched. A request that names no mailbox has not
	// described a send anyone can measure, so no roster can be borrowed to
	// classify it — and the refusal costs no artifact read.
	const addressed = normalizeAddressedRecipients(recipients);
	if (!addressed.ok) {
		return { form: 'unevaluable', reason: 'no-addressed-recipients', routes: 0 };
	}

	if (!isValidPublicTemplateSlug(slug)) {
		return { form: 'unevaluable', reason: 'no-slug', routes: 0 };
	}

	// The same cached artifact the public page already served and the send-time
	// suppression lookup already reads — no new provider call, no new Convex
	// function, no new recurring cost.
	const artifact = await getCachedPublicTemplatePageArtifact(
		{ url: event.url, platform: event.platform },
		slug
	).catch(() => null);
	if (!artifact) return { form: 'unevaluable', reason: 'artifact-unavailable', routes: 0 };

	const publishedRoutes = publishedRosterRoutes(
		parseRecipientConfig(artifact.detail.recipient_config)
	);
	const roster = new Map<string, AudienceRoute>();
	for (const route of publishedRoutes) {
		const address = normalizeAddress(route.email);
		if (address) roster.set(address, route);
	}

	// One-directional intersection. An addressed mailbox the artifact does not
	// publish refuses the whole set rather than classifying the survivors — the
	// survivors would otherwise be choosing the policy for a send that also
	// reaches the mailbox nobody published.
	const addressedRoutes = intersectAddressed(addressed.addresses, roster);
	if (!addressedRoutes.ok) {
		return {
			form: 'unevaluable',
			reason: 'addressee-not-published',
			routes: addressed.addresses.length
		};
	}
	const certifiedRelay = isCongressionalDelivery(artifact.detail.deliveryMethod);

	// The artifact, not the caller's subset, owns the policy floor. If any
	// published route is person-form or unevaluable, dropping it from `recipients`
	// cannot turn the request institutional. This is the monotonic security rule:
	// caller-controlled removal never moves strict -> permissive.
	const publishedAudience = deriveAudience(publishedRoutes, { certifiedRelay });
	if (publishedAudience.form !== 'institutional') return publishedAudience;

	// The certified-delivery lane stands in for a roster ONLY when the artifact
	// publishes no route. This endpoint requires and intersects an addressed set
	// first, so a relay-only artifact cannot reach this call: the relay is not a
	// mailbox a caller can name. With any published route the flag is deliberately
	// ignored, so a lane fact never overrides a route somebody actually read.
	// A fully institutional artifact may report the actual addressed subset. Its
	// domain evidence still comes from the full published roster: the caller may
	// address `board@` without erasing the published `press@` that attests the
	// domain as a switchboard. The strict floor above is what makes that separation
	// safe; evidence can preserve reach, never override a strict artifact verdict.
	return deriveAudience(addressedRoutes.routes, {
		certifiedRelay,
		evidenceRoutes: publishedRoutes
	});
}

/**
 * Personalization Moderation Endpoint
 *
 * Moderates user-supplied personalization text at send time.
 * Runs Prompt Guard + Llama Guard only (no Gemini) for low latency.
 *
 * The template itself was already moderated at creation time.
 * This endpoint checks only the user's personalization delta
 * (e.g., [Personal Connection] text) for injection and safety.
 *
 * The hazard policy is selected by a SERVER-derived audience verdict, resolved
 * from the optional `slug` pointer. Absent or unresolvable, it is `unevaluable`
 * and the strict set applies.
 *
 * @see COORDINATION-INTEGRITY-SPEC.md § CI-004
 */
export const POST: RequestHandler = async (event) => {
	const authenticatedUserId = requireAuthenticatedAgentRequest(event);
	if (authenticatedUserId instanceof Response) return authenticatedUserId;

	let body: unknown;
	try {
		// `{text, slug, recipients:[20]}` walks to 24 nodes at depth 2, so 32 nodes
		// is the reviewed headroom and 20 items is the roster ceiling itself — a
		// request cannot address more mailboxes than a roster may hold. The 256-char
		// address cap is enforced in `normalizeAddress`, not by this budget, because
		// an over-long address must refuse the SEND rather than the request.
		body = await readBoundedJsonRequest(event.request, 12 * 1024, {
			maxArrayItems: AUDIENCE_ROSTER_MAX,
			maxDepth: 2,
			maxNodes: 32,
			maxObjectKeys: 4,
			maxStringBytes: PROMPT_GUARD_MAX_CHARACTERS
		});
	} catch (error) {
		if (error instanceof BoundedJsonRequestError) {
			return json({ error: error.message }, { status: error.status });
		}
		return json({ error: 'Invalid request body' }, { status: 400 });
	}

	const fields =
		body !== null && typeof body === 'object' && !Array.isArray(body)
			? (body as Record<string, unknown>)
			: undefined;
	const text = fields?.text;
	const slug = fields?.slug;
	const recipients = fields?.recipients;

	if (typeof text !== 'string') {
		return json({ error: 'text field required (string)' }, { status: 400 });
	}

	if (text.length > PROMPT_GUARD_MAX_CHARACTERS) {
		return json(
			{ error: `text must be ≤${PROMPT_GUARD_MAX_CHARACTERS} characters` },
			{ status: 400 }
		);
	}

	// Empty personalization has no provider-visible surface. Resolve it locally
	// before the shared reservation so an attacker cannot burn scarce public
	// moderation capacity with requests that deliberately cause zero Groq work.
	if (text.trim().length === 0) {
		return json({
			approved: true,
			summary: 'Empty personalization — skipped',
			latency_ms: 0
		});
	}

	const rateLimitCheck = await enforceLLMRateLimit(event, 'moderation-personalization');
	if (!rateLimitCheck.allowed) return rateLimitResponse(rateLimitCheck);

	// `slug` is a POINTER the server dereferences into an artifact it already
	// holds — never a caller assertion about who the recipient is. The roster is
	// read off the published artifact and re-classified here; a caller cannot
	// name a class, a form, a title, or an address.
	//
	// `recipients` is a caller-named binding input, and only that: every entry must
	// already appear in the published roster. The full roster is classified first
	// as a strict floor, so omitting a person can never unlock the permissive set.
	// Same one-directional intersection as
	// `src/routes/api/do-not-contact/links/+server.ts`, which is the precedent.
	const audience = await resolveAudience(event, slug, recipients);

	try {
		const result = await moderatePersonalization(text, {
			signal: event.request.signal,
			audience
		});
		const headers = new Headers();
		addRateLimitHeaders(headers, rateLimitCheck);
		return json(
			{
				approved: result.approved,
				summary: result.summary,
				latency_ms: result.latency_ms,
				// Names the bytes this verdict is about, so the client can prove the
				// response it holds is the one for the text it snapshotted. Hashed
				// over the same `text` constant that was moderated, already capped at
				// PROMPT_GUARD_MAX_CHARACTERS — no provider call, no Convex call, no
				// new cost. Present on the 400 branch too: the status is conditioned
				// on `result.approved`, and both branches leave through this object.
				contentDigest: await sha256Hex(text),
				policy: audience.form,
				...(audience.form === 'unevaluable'
					? { reason: audience.reason }
					: { basis: audience.basis })
			},
			{ headers, status: result.approved ? 200 : 400 }
		);
	} catch (error) {
		console.error('[moderation/personalization] Error:', error);
		return json(
			{ error: 'Moderation service unavailable', code: 'moderation_unavailable' },
			{ status: 503 }
		);
	}
};
