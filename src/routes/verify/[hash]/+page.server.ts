// CONVEX: Keep SvelteKit — security-critical verification flow (delivery + credential lookup, public endpoint)
import type { PageServerLoad } from './$types';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';

/**
 * Privacy-preserving verification endpoint.
 *
 * Handles two URL patterns:
 * 1. /verify/{deliveryId} — per-delivery report verification (new)
 * 2. /verify/{credentialHash} — individual credential verification (legacy)
 *
 * For delivery verification: shows campaign title, frozen packet stats, and
 * the district-level breakdown without revealing any constituent PII.
 *
 * For credential verification: displays "This message was sent by a verified
 * constituent of [district]" without revealing user identity.
 */
export const load: PageServerLoad = async ({ params }) => {
	const { hash } = params;

	if (!hash || hash.length < 8) {
		return { credential: null, delivery: null, error: 'Invalid verification link' };
	}

	try {
		// Try CampaignDelivery lookup first (per-delivery verify URLs)
		const delivery = await db.campaignDelivery.findUnique({
			where: { id: hash },
			select: {
				id: true,
				targetDistrict: true,
				packetSnapshot: true,
				sentAt: true,
				campaign: {
					select: { title: true }
				}
			}
		});

		if (delivery) {
			const snap = delivery.packetSnapshot as Record<string, unknown> | null;
			return {
				credential: null,
				delivery: {
					campaignTitle: delivery.campaign.title,
					district: delivery.targetDistrict,
					verified: typeof snap?.verified === 'number' ? snap.verified : null,
					districtCount: typeof snap?.districtCount === 'number' ? snap.districtCount : null,
					sentAt: delivery.sentAt?.toISOString() ?? null
				},
				error: null
			};
		}

		// Try Campaign lookup (backward compat for campaign-level verify URLs)
		const campaign = await db.campaign.findUnique({
			where: { id: hash },
			select: { id: true, title: true }
		});

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
		const credential = await db.districtCredential.findFirst({
			where: { credential_hash: hash },
			select: {
				congressional_district: true,
				verification_method: true,
				issued_at: true,
				expires_at: true,
				revoked_at: true
			}
		});

		if (!credential) {
			return { credential: null, delivery: null, error: 'Credential not found' };
		}

		if (credential.revoked_at) {
			return { credential: null, delivery: null, error: 'This credential has been revoked' };
		}

		const isExpired = new Date() > credential.expires_at;

		return {
			credential: {
				district: credential.congressional_district,
				method: credential.verification_method,
				issuedAt: credential.issued_at.toISOString(),
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
