// CONVEX: Keep SvelteKit — security-critical verification flow (public endpoint)
import type { PageServerLoad } from './$types';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { formatTierDisplay } from '$lib/core/identity/tier-display';

/**
 * Privacy-preserving verification endpoint.
 *
 * Handles two URL patterns:
 * 1. /verify/{deliveryId} — per-delivery report verification (new)
 * 2. /verify/{credentialHash} — individual credential verification (legacy)
 */
export const load: PageServerLoad = async ({ params }) => {
	const { hash } = params;

	if (!hash || hash.length < 8) {
		return { credential: null, delivery: null, error: 'Invalid verification link' };
	}

	try {
		// Try CampaignDelivery lookup first (per-delivery verify URLs)
		const delivery = await serverQuery(api.verify.getDelivery, { deliveryId: hash });

		if (delivery) {
			const snap = delivery.packetSnapshot as Record<string, unknown> | null;
			return {
				credential: null,
				delivery: {
					campaignTitle: delivery.campaignTitle,
					district: delivery.targetDistrict,
					verified: typeof snap?.verified === 'number' ? snap.verified : null,
					districtCount: typeof snap?.districtCount === 'number' ? snap.districtCount : null,
					sentAt: delivery.sentAt ? new Date(delivery.sentAt).toISOString() : null
				},
				error: null
			};
		}

		// Try Campaign lookup (backward compat for campaign-level verify URLs)
		const campaign = await serverQuery(api.verify.getCampaignForVerify, { campaignId: hash });

		if (campaign) {
			return {
				credential: null,
				delivery: {
					campaignTitle: campaign.title,
					district: null,
					verified: null,
					districtCount: null,
					sentAt: null
				},
				error: null
			};
		}

		// Fall back to legacy credential hash verification
		const credential = await serverQuery(api.verify.getCredentialByHash, { credentialHash: hash });

		if (!credential) {
			return { credential: null, delivery: null, error: 'Credential not found' };
		}

		if (credential.revokedAt) {
			return { credential: null, delivery: null, error: 'This credential has been revoked' };
		}

		const isExpired = credential.expiresAt ? Date.now() > credential.expiresAt : false;

		// H6 — fetch the current atlas version for drift comparison. Best-effort:
		// if the manifest fetch fails we render "unknown drift state" (display
		// just suppresses the drift surface), NOT "no drift" — atlas freshness
		// is operator-controlled today (G6r/H0r), and we say so plainly when
		// we can't tell.
		let currentAtlasVersion: string | null = null;
		try {
			const { getCurrentAtlasVersion } = await import(
				'$lib/core/shadow-atlas/district-bundle'
			);
			// 5 s budget — verification page is cold and shouldn't hang on a
			// down atlas worker.
			currentAtlasVersion = await getCurrentAtlasVersion(AbortSignal.timeout(5_000));
		} catch (err) {
			console.warn(
				'[verify] currentAtlasVersion lookup failed:',
				err instanceof Error ? err.message : String(err),
			);
		}

		const tierDisplay = formatTierDisplay({
			method: credential.verificationMethod,
			trustTier: credential.trustTier,
			cellStraddles: credential.cellStraddles,
			atlasVersion: credential.atlasVersion,
			currentAtlasVersion,
		});

		return {
			credential: {
				district: credential.congressionalDistrict,
				method: credential.verificationMethod,
				issuedAt: credential.issuedAt ? new Date(credential.issuedAt).toISOString() : null,
				expired: isExpired,
				// H6 — derived display payload. The +page.svelte renders these
				// directly so the same helper drives staffer-facing copy.
				tierDisplay,
				// H6 — raw fields surfaced for debugging / future reuse. The
				// helper is the canonical render path; these are belt-and-
				// suspenders for surfaces that need the underlying data.
				trustTier: credential.trustTier,
				cellStraddles: credential.cellStraddles,
				cellAnchorMode: credential.cellAnchorMode,
				atlasVersion: credential.atlasVersion,
				currentAtlasVersion,
			},
			delivery: null,
			error: null
		};
	} catch (error) {
		console.error('[Verify] Lookup failed:', error instanceof Error ? error.message : String(error));
		return { credential: null, delivery: null, error: 'Verification temporarily unavailable' };
	}
};
