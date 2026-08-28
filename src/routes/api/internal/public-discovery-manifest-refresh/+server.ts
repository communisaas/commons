import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	PublicTemplatePageBackfillIncompleteError,
	refreshPublicDiscoveryManifestControl
} from '$lib/server/public-template-queries';
import {
	matchPublicDiscoveryManifestRefreshSecret,
	matchPublicDiscoveryManifestRefreshSecretValues
} from '$lib/server/public-discovery-manifest-refresh-auth';
import {
	PUBLIC_DISCOVERY_PAGE_BACKFILL_CONTINUATION_HEADER,
	PUBLIC_DISCOVERY_PAGE_BACKFILL_CONTINUATION_RETRY_SECONDS
} from '$lib/server/public-discovery-manifest-refresh-hook';
import { publicDiscoveryGraphGeneration } from '$lib/server/public-discovery-manifest-shield';

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	// Authentication precedes R2, Cache API, or Convex work. Anonymous traffic
	// can never turn this writer into a control-plane refresh amplifier.
	const presented = request.headers.get('x-public-discovery-manifest-refresh-secret');
	const platformEnv = platform?.env as Record<string, unknown> | undefined;
	// Cloudflare's platform bindings are authoritative in deployed Workers. The
	// dynamic-env wrapper remains only for local/non-platform adapters.
	const auth = platformEnv
		? matchPublicDiscoveryManifestRefreshSecretValues(
				presented,
				platformEnv.DISCOVERY_MANIFEST_REFRESH_SECRET,
				platformEnv.DISCOVERY_MANIFEST_REFRESH_SECRET_PREVIOUS
			)
		: matchPublicDiscoveryManifestRefreshSecret(presented);
	if (!auth.ok) {
		return json(
			{
				error:
					auth.reason === 'not_configured'
						? 'DISCOVERY_MANIFEST_REFRESH_SECRET not configured'
						: 'Unauthorized'
			},
			{ status: auth.reason === 'not_configured' ? 503 : 401 }
		);
	}
	if (!platform) return json({ error: 'Cloudflare platform unavailable' }, { status: 503 });
	if (!locals.reservePublicTemplateOgQueueAttempts) {
		return json(
			{ error: 'Public template OG Queue budget unavailable' },
			{ headers: { 'cache-control': 'no-store' }, status: 503 }
		);
	}

	try {
		const authority = await refreshPublicDiscoveryManifestControl({
			platform,
			allowPageArtifactBackfill: locals.publicDiscoveryPageArtifactBackfillAuthorized === true,
			reserveOgQueueAttempts: locals.reservePublicTemplateOgQueueAttempts
		});
		const generation = publicDiscoveryGraphGeneration(authority.manifest);
		return json(
			{
				generation,
				ok: true,
				list: {
					ready: authority.manifest.list.ready,
					retiredRevision: authority.withdrawalFloors.list,
					revision: authority.manifest.list.revision,
					withdrawalEpoch: authority.manifest.list.withdrawalEpoch
				},
				relations: {
					ready: authority.manifest.relations.ready,
					retiredRevision: authority.withdrawalFloors.relations,
					revision: authority.manifest.relations.revision,
					withdrawalEpoch: authority.manifest.relations.withdrawalEpoch
				}
			},
			{
				headers: {
					'cache-control': 'no-store',
					'x-public-discovery-generation': generation
				}
			}
		);
	} catch (error) {
		console.error(
			'[public-discovery-manifest-refresh] refresh failed:',
			error instanceof Error ? error.message : String(error)
		);
		if (error instanceof PublicTemplatePageBackfillIncompleteError) {
			// One admitted producer cycle intentionally publishes at most sixteen
			// immutable page artifacts. A 202 is the authenticated control protocol's
			// durable continuation signal: the Convex producer retains its token and
			// schedules the next cycle after the shared gate window. Returning 503 here
			// would discard that token and leave a large-but-valid update to cron alone.
			return json(
				{
					code: 'PUBLIC_TEMPLATE_PAGE_BACKFILL_INCOMPLETE',
					ok: false,
					retryAfterSeconds: PUBLIC_DISCOVERY_PAGE_BACKFILL_CONTINUATION_RETRY_SECONDS,
					retryable: true
				},
				{
					headers: {
						'cache-control': 'no-store',
						[PUBLIC_DISCOVERY_PAGE_BACKFILL_CONTINUATION_HEADER]: '1',
						'retry-after': String(PUBLIC_DISCOVERY_PAGE_BACKFILL_CONTINUATION_RETRY_SECONDS)
					},
					status: 202
				}
			);
		}
		return json(
			{ error: 'Public discovery manifest refresh failed' },
			{ headers: { 'cache-control': 'no-store' }, status: 503 }
		);
	}
};
