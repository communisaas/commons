/**
 * Atlas-version migration check (G6).
 *
 * Tree 2 root rotates quarterly when shadow-atlas republishes. Existing
 * credentials bind to the prior root via cellMapRoot + cellMapPath. After
 * a rotation, the old proof verifies against the OLD root only — but the
 * server-side verifier may have moved on to the new root.
 *
 * This helper compares the credential's persisted atlas version (G6) to
 * the manifest's currentVersion. When they differ, the user should be
 * prompted to re-verify (via IdentityRecoveryFlow) so their credential
 * binds to the new root.
 *
 * Why string-version comparison: the manifest publishes a human-readable
 * currentVersion (e.g., "v20260503"). Comparing strings is exact, deterministic,
 * and doesn't require fetching chunks. The cellMapRoot pin remains the
 * cryptographic anchor at submission time; this check is the UX delta.
 *
 * Failure modes:
 *   - manifest fetch fails → return 'unknown' (don't block on transient outage)
 *   - credential has no atlasVersion (pre-G6) → return 'pre-g6' (legacy credentials)
 *   - versions match → 'current' (no action needed)
 *   - versions differ → 'stale' (prompt re-verify)
 */

import type { SessionCredential } from './session-credentials';
import { getCurrentAtlasVersion } from '$lib/core/shadow-atlas/district-bundle';

export type AtlasMigrationStatus = 'current' | 'stale' | 'pre-g6' | 'unknown';

export interface AtlasMigrationCheck {
	status: AtlasMigrationStatus;
	credentialVersion: string | null;
	currentVersion: string | null;
}

// straddleDelta was previously declared here but never populated. Per G6r,
// declared-not-implemented is worse than absent: callers either trust the
// type (it's optional, "always undefined" is valid) or check for it (and
// always go down the not-set branch). When the delta-tracking lands as a
// follow-up, add it back to the type AND populate it in checkAtlasMigration.

/**
 * Check whether a credential's atlas version is stale relative to the
 * currently published manifest. UI callers should treat 'stale' as a
 * prompt-to-re-verify condition; 'pre-g6' similarly should re-verify
 * because pre-G6 credentials don't have h3Cell either (G7 dependency)
 * and would fail at delivery anyway.
 *
 * Best-effort by design: if the manifest is unreachable, returns 'unknown'
 * rather than blocking — atlas outage shouldn't lock users out of the app.
 */
export async function checkAtlasMigration(
	credential: SessionCredential,
	signal?: AbortSignal,
): Promise<AtlasMigrationCheck> {
	const credentialVersion = credential.atlasVersion ?? null;

	if (!credentialVersion) {
		// Pre-G6 credentials: no atlasVersion field. They likely also lack
		// h3Cell (pre-G7), so they'll fail at delivery anyway. Prompt to
		// re-verify.
		return {
			status: 'pre-g6',
			credentialVersion: null,
			currentVersion: null,
		};
	}

	let currentVersion: string | null;
	try {
		currentVersion = await getCurrentAtlasVersion(signal);
	} catch {
		currentVersion = null;
	}

	if (!currentVersion) {
		return {
			status: 'unknown',
			credentialVersion,
			currentVersion: null,
		};
	}

	if (credentialVersion === currentVersion) {
		return {
			status: 'current',
			credentialVersion,
			currentVersion,
		};
	}

	return {
		status: 'stale',
		credentialVersion,
		currentVersion,
	};
}
