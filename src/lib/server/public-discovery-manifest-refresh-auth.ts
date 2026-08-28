import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

const MIN_REFRESH_SECRET_BYTES = 32;
const ABSENT_SECRET_DIGEST = createHash('sha256')
	.update('commons:public-discovery-manifest-refresh:absent-secret', 'utf8')
	.digest();

export type PublicDiscoveryManifestRefreshSecretMatch =
	| { ok: true }
	| { ok: false; reason: 'invalid' | 'not_configured' };

function isUsableSecret(value: unknown): value is string {
	return typeof value === 'string' && Buffer.byteLength(value, 'utf8') >= MIN_REFRESH_SECRET_BYTES;
}

function secretDigest(value: string): Buffer {
	return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Pure platform-env matcher for the outer request boundary. It deliberately
 * performs no process/env/auth/platform I/O, so a caller may read the two
 * values from `event.platform.env` and reject the dedicated route before the
 * general environment shim or session authentication executes.
 *
 * The active secret is mandatory. A malformed optional previous secret is
 * ignored rather than turning a healthy active credential into an outage.
 * Both candidate comparisons always use fixed-size digests and execute before
 * the result is selected; the result never identifies which generation won.
 */
export function matchPublicDiscoveryManifestRefreshSecretValues(
	presented: string | null | undefined,
	active: unknown,
	previous: unknown
): PublicDiscoveryManifestRefreshSecretMatch {
	if (!isUsableSecret(active)) {
		return { ok: false, reason: 'not_configured' };
	}

	const presentedIsString = typeof presented === 'string';
	const presentedDigest = presentedIsString ? secretDigest(presented) : ABSENT_SECRET_DIGEST;
	const activeMatch = timingSafeEqual(presentedDigest, secretDigest(active));
	const previousIsUsable = isUsableSecret(previous);
	const previousMatch = timingSafeEqual(
		presentedDigest,
		previousIsUsable ? secretDigest(previous) : ABSENT_SECRET_DIGEST
	);

	return presentedIsString && (activeMatch || (previousIsUsable && previousMatch))
		? { ok: true }
		: { ok: false, reason: 'invalid' };
}

/**
 * Authenticate only the public-discovery manifest writer endpoint. Keeping
 * this bearer separate from INTERNAL_API_SECRET limits a cron Worker leak to
 * one idempotent, bounded control-plane refresh capability.
 *
 * The variable name must never start with `PUBLIC_`: SvelteKit's publicPrefix
 * both hides such keys from `$env/dynamic/private` (this check would always
 * report not_configured) and serializes them to the browser as public env.
 */
export function matchPublicDiscoveryManifestRefreshSecret(
	presented: string | null | undefined
): PublicDiscoveryManifestRefreshSecretMatch {
	const privateEnv = env as unknown as Record<string, string | undefined>;
	return matchPublicDiscoveryManifestRefreshSecretValues(
		presented,
		privateEnv.DISCOVERY_MANIFEST_REFRESH_SECRET,
		privateEnv.DISCOVERY_MANIFEST_REFRESH_SECRET_PREVIOUS
	);
}
