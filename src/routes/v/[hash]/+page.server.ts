/**
 * Verification Page Server Load
 *
 * Resolves a verification hash to verification data.
 * Two resolution paths:
 * 1. Campaign ID hash → campaign delivery verification (packet summary)
 * 2. User verification hash → individual sender verification (future)
 */
import { error } from '@sveltejs/kit';
import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const { hash } = params;

	if (!hash || hash.length < 6) {
		throw error(404, 'Invalid verification link');
	}

	// Try resolving as a campaign ID (report verification links use campaign._id as hash)
	try {
		// getStats returns K-floored counts (null below 5 for *Actions, null below
		// 3 for uniqueDistricts; exact above). Sub-K cohort sizes would name
		// specific submitters; above K the count is the public-civic-action signal.
		const stats = await serverQuery(api.campaigns.getStats, {
			_secret: getInternalSecret(),
			campaignId: hash as Id<'campaigns'>
		});

		if (stats) {
			// Aggregate-only packet summary (computed inside Convex; no per-action
			// or per-cell data crosses the boundary to the public surface).
			let summary;
			try {
				summary = await serverQuery(api.campaigns.getCampaignPacketSummary, {
					_secret: getInternalSecret(),
					campaignId: hash as Id<'campaigns'>
				});
			} catch {
				summary = null;
			}

			return {
				hash,
				mode: 'campaign' as const,
				// Campaign mode is a COHORT report, not a per-sender identity. It has
				// no single trust tier / verification method / composition — asserting
				// one (the old synthetic trustTier:2 / identity:'mixed') was a false
				// claim. The page renders cohort language + the recomputable attestation
				// instead; these are null so a tier claim can never be reintroduced.
				trustTier: null as (0 | 1 | 2 | 3 | 4 | 5) | null,
				identity: {
					verified: false,
					method: null as 'email' | 'gov-id' | 'mixed' | null
				},
				location: {
					verified: false,
					state: null as string | null,
					districts: [] as { slot: number; label: string; value: string }[]
				},
				govCredential: false,
				composition: null as 'individual' | 'template' | 'mixed' | null,
				verifiedAt: Date.now(),
				// LATENT (2026-07-03): participantCount is currently unrendered (the
				// page reads cohort size from campaignContext.verified); kept as data
				// for a future message-level surface.
				participantCount: stats.verifiedActions,
				campaignContext: {
					verified: stats.verifiedActions,
					total: stats.totalActions,
					districtCount: stats.uniqueDistricts,
					dateRange: summary?.dateRange ?? null,
					// T8-2 — qualitative phrases + K-floored top districts + attestation
					identityPhrase: summary?.identityPhrase ?? null,
					authorshipPhrase: summary?.authorshipPhrase ?? null,
					integrityPhrase: summary?.integrityPhrase ?? null,
					topDistricts: summary?.topDistricts ?? [],
					attestationHash: summary?.attestationHash ?? null
				}
			};
		}
	} catch {
		// Not a valid campaign ID — fall through to user verification
	}

	// Try resolving as a district credential hash
	try {
		const credential = await serverQuery(api.users.resolveCredentialHash, {
			_secret: getInternalSecret(),
			credentialHash: hash,
			asOf: Date.now()
		});

		if (credential) {
			const methodMap: Record<string, 'email' | 'gov-id' | 'mixed'> = {
				civic_api: 'email',
				postal: 'email',
				mdl: 'gov-id',
				shadow_atlas: 'gov-id'
			};

			const districts: { slot: number; label: string; value: string }[] = [];
			if (credential.congressionalDistrict) {
				districts.push({
					slot: 0,
					label: 'Congressional district',
					value: credential.congressionalDistrict
				});
			}
			if (credential.stateSenateDistrict) {
				districts.push({
					slot: 2,
					label: 'State senate district',
					value: credential.stateSenateDistrict
				});
			}
			if (credential.stateAssemblyDistrict) {
				districts.push({
					slot: 3,
					label: 'State assembly district',
					value: credential.stateAssemblyDistrict
				});
			}

			return {
				hash,
				mode: 'individual' as const,
				trustTier: credential.trustTier as 0 | 1 | 2 | 3 | 4 | 5,
				identity: {
					verified: true,
					method: methodMap[credential.verificationMethod] ?? 'email'
				},
				location: {
					verified: districts.length > 0,
					state: credential.congressionalDistrict?.split('-')[0] ?? null,
					districts,
					// B3 — freshness provenance. Two INDEPENDENT clocks rendered
					// separately on the certificate; each is `null` when the
					// credential carries no real value (legacy row or honestly-
					// unknown at issuance). tigerVintage labels the boundary clock;
					// resolutionConfidence annotates the mapping. Never copy one
					// clock's value into the other.
					boundaryAsOf: credential.boundaryAsOf ?? null,
					officialsAsOf: credential.officialsAsOf ?? null,
					tigerVintage: credential.tigerVintage ?? null,
					resolutionConfidence: credential.resolutionConfidence ?? null
				},
				govCredential: credential.trustTier >= 3,
				composition: 'individual' as 'individual' | 'template' | 'mixed',
				verifiedAt: credential.issuedAt,
				participantCount: null as number | null,
				campaignContext: null
			};
		}
	} catch {
		// Hash doesn't match a credential — fall through
	}

	// Unresolved hash — show minimal verification page
	throw error(404, 'Verification record not found');
};
