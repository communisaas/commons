/**
 * The one producer chain the audience tests are allowed to measure through.
 *
 * Producer → reader → `parseRecipientConfig` → `publishedRosterRoutes`, the same
 * chain `src/routes/api/moderation/personalization/+server.ts` walks before it
 * asks `deriveAudience`. Measured on `deriveAudience` in isolation, a census will
 * happily report reach for an artifact production can never emit, so every reach
 * claim in this directory is published first and asked second.
 *
 * This module is not a suite. The include glob at `vitest.config.ts:90` matches
 * only `.test.` and `.spec.` files, so importing this one runs no `describe` —
 * the same arrangement `tests/unit/server/convex-work-budget-harness.ts` already
 * has with its three importers. It lives here so exactly one copy of the chain
 * exists; two verbatim copies are free to diverge, and once did.
 *
 * `readPublicTemplateDetailProjection` and `buildPublicTemplateDetailProjection`
 * are imported HERE and nowhere else in this directory.
 */
import {
	buildPublicTemplateDetailProjection,
	readPublicTemplateDetailProjection
} from '$convex/lib/publicTemplateDiscoverySource';
import {
	deriveAudience,
	publishedRosterRoutes,
	type AudienceRoute
} from '$lib/core/server/moderation/audience';
import { parseRecipientConfig } from '$lib/types/template';

/** `BLOCKING_HAZARDS` — the universal floor, and all an institution gets. */
export const INSTITUTIONAL_HAZARDS = ['S1', 'S4'];

/** `PERSON_BLOCKING_HAZARDS` — the floor plus what a natural person is owed. */
export const PERSON_HAZARDS = ['S1', 'S4', 'S5', 'S7', 'S10'];

/** The `templates.deliveryMethod` column holds exactly these two values. */
export type DeliveryMethod = 'cwc' | 'email';

/**
 * One published address and the name the artifact published beside it.
 *
 * Every row travels the same producer chain —
 * `buildPublicTemplateDetailProjection` → `readPublicTemplateDetailProjection` —
 * so a shape the reader refuses has no reach to measure. There is no second
 * chain in this directory.
 */
export type PublishedRow = {
	email: string;
	name: string;
	organization: string;
};

const FIXTURE_CREATED_AT = Date.UTC(2026, 0, 1);

function templateFixture(
	deliveryMethod: DeliveryMethod
): Parameters<typeof buildPublicTemplateDetailProjection>[0] {
	return {
		_id: 'templates:audience-producer-fixture',
		_creationTime: FIXTURE_CREATED_AT,
		slug: 'audience-producer-fixture',
		title: 'Audience producer fixture',
		description: 'A public projection fixture.',
		domain: 'civic',
		domainHue: 210,
		type: 'email',
		deliveryMethod,
		messageBody: 'Please consider this request.',
		sources: [],
		researchLog: [],
		preview: 'Please consider this request.',
		verifiedSends: 0,
		uniqueDistricts: 0,
		topics: []
	} as unknown as Parameters<typeof buildPublicTemplateDetailProjection>[0];
}

/**
 * Publish a roster the way production does, then fold it into routes.
 *
 * The reader's throw PROPAGATES: a row that cannot be published has zero reach,
 * and that fact is an assertion at the call site, never a caught error quietly
 * replaced with an empty roster.
 *
 * `deliveryMethod` is required. The stored column is what the endpoint reads at
 * `src/routes/api/moderation/personalization/+server.ts:103`, so no call site may
 * leave the lane unstated.
 */
export function publishRoster(
	rows: readonly PublishedRow[],
	deliveryMethod: DeliveryMethod
): AudienceRoute[] {
	const decisionMakers = rows.map((row) => ({
		email: row.email,
		name: row.name,
		title: row.name,
		organization: row.organization,
		emailGrounded: true as const,
		emailSource: 'https://example.org/contact'
	}));

	const detail = readPublicTemplateDetailProjection(
		buildPublicTemplateDetailProjection(templateFixture(deliveryMethod), {
			emails: rows.map((row) => row.email),
			decisionMakers: decisionMakers as never
		})
	);

	return publishedRosterRoutes(parseRecipientConfig(detail.recipient_config));
}

/**
 * Ask the policy on the lane the artifact actually stores.
 *
 * The endpoint derives `certifiedRelay` from the artifact's persisted
 * `deliveryMethod` through `isCongressionalDelivery`
 * (`convex/lib/templateDeliveryMethod.ts:54`) at
 * `src/routes/api/moderation/personalization/+server.ts:103,109` — it is not a
 * caller preference. The flag is load-bearing inside `deriveAudience`'s registry
 * branch, where it is the first term of the conjunction that raises
 * `registry-route-names-a-human`, and inert on a non-governmental domain, where
 * that branch is never reached. Cited by symbol, not by line: this file's
 * previous `audience.ts:352` reference pointed at a bare closing brace after the
 * module header grew.
 */
export function audienceFor(routes: AudienceRoute[], deliveryMethod: DeliveryMethod) {
	return deriveAudience(routes, { certifiedRelay: deliveryMethod === 'cwc' });
}
