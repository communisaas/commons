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
import { absent, blocked, present, withheld, type Fact } from '$lib/core/fact';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import type { PageServerLoad } from './$types';

type ContainmentSource = 'atlas-derived' | 'self-reported';

interface SourcedContainment<T> {
	value: Fact<T>;
	source: Fact<ContainmentSource>;
}

interface ContainmentRow extends SourcedContainment<string> {
	slot: number;
	label: string;
}

function containmentValue(
	value: unknown,
	isValid: (candidate: string) => boolean = (candidate) => candidate.trim().length > 0
): Fact<string> {
	if (value === null || value === undefined) return absent();
	if (typeof value !== 'string' || value.trim().length === 0) {
		return blocked('credential carried an empty value');
	}
	if (!isValid(value)) return blocked('credential carried an unresolvable value');
	return present(value);
}

function containmentSource(
	value: Fact<string>,
	credentialSource: unknown
): Fact<ContainmentSource> {
	if (value.state === 'absent') return absent();
	if (value.state === 'withheld') return withheld(value.why);
	if (value.state === 'blocked') return blocked(value.why);
	if (credentialSource === 'atlas-derived' || credentialSource === 'self-reported') {
		return present(credentialSource);
	}
	if (credentialSource === null || credentialSource === undefined) {
		return absent();
	}
	return blocked('credential carried an unsupported provenance');
}

function stateFromCongressional(
	value: Fact<string>,
	source: Fact<ContainmentSource>
): SourcedContainment<string> {
	if (value.state !== 'present') return { value, source };
	const stateCode = value.value.split('-')[0];
	if (!stateCode) {
		const why = 'credential carried an unresolvable congressional state';
		return { value: blocked(why), source: blocked(why) };
	}
	return { value: present(stateCode), source };
}

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
					state: {
						value: absent(),
						source: absent()
					} as SourcedContainment<string>,
					districts: [] as ContainmentRow[]
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

			const congressional = containmentValue(credential.congressionalDistrict);
			const stateSenate = containmentValue(credential.stateSenateDistrict);
			const stateAssembly = containmentValue(credential.stateAssemblyDistrict);
			const county = containmentValue(credential.countyFips, (candidate) =>
				/^\d{5}$/.test(candidate)
			);
			const congressionalSource = containmentSource(
				congressional,
				credential.congressionalDistrictSource
			);
			const districts: ContainmentRow[] = [
				{
					slot: 0,
					label: 'Congressional district',
					value: congressional,
					source: congressionalSource
				},
				{
					slot: 2,
					label: 'State senate district',
					value: stateSenate,
					source: containmentSource(stateSenate, credential.stateSenateDistrictSource)
				},
				{
					slot: 3,
					label: 'State assembly district',
					value: stateAssembly,
					source: containmentSource(stateAssembly, credential.stateAssemblyDistrictSource)
				},
				{
					slot: 4,
					label: 'County (FIPS)',
					value: county,
					source: containmentSource(county, credential.countyFipsSource)
				}
			];
			const state = stateFromCongressional(congressional, congressionalSource);

			return {
				hash,
				mode: 'individual' as const,
				record: {
					status: credential.status,
					retiredAt: credential.retiredAt
				},
				trustTier: credential.trustTier,
				identity: {
					verified: credential.status === 'active',
					method: methodMap[credential.verificationMethod] ?? 'email'
				},
				location: {
					verified: districts.length > 0 && credential.status === 'active',
					state,
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
				govCredential: credential.trustTier !== null && credential.trustTier >= 3,
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
