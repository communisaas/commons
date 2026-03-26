// CONVEX: Keep SvelteKit — security-critical verification flow (public endpoint)
import type { PageServerLoad } from './$types';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

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

		return {
			credential: {
				district: credential.congressionalDistrict,
				method: credential.verificationMethod,
				issuedAt: credential.issuedAt ? new Date(credential.issuedAt).toISOString() : null,
				expired: isExpired
			},
			delivery: null,
			error: null
		};
	} catch (error) {
		console.error('[Verify] Lookup failed:', error instanceof Error ? error.message : String(error));
		return { credential: null, delivery: null, error: 'Verification temporarily unavailable' };
	}
};
