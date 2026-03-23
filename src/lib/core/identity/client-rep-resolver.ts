/**
 * Client-Side Representative Resolver
 *
 * Resolves elected representatives entirely in the browser using:
 * 1. Session credential tree state (congressionalDistrict from shadow atlas registration)
 * 2. Credential wallet fallback (district_residency VC → district code)
 * 3. Browser IPFS client (district code → officials from IPFS)
 *
 * Replaces the server-side layout.server.ts → UserDMRelation → DecisionMaker path.
 * No server calls required — all data is resolved locally.
 */

import { getTreeState } from './session-credentials';
import { getCredential, type StoredCredential } from './credential-store';
import { getOfficialsFromBrowser } from '$lib/core/shadow-atlas/browser-client';
import type { OfficialsFileIPFS } from '$lib/core/shadow-atlas/ipfs-store';

// ============================================================================
// Types
// ============================================================================

/** Representative shape matching layout.server.ts output */
export interface ClientRep {
	name: string;
	party: string;
	chamber: string;
	state: string;
	district: string;
	title?: string;
	jurisdiction?: string;
}

/** Resolution result */
export interface RepResolverResult {
	representatives: ClientRep[];
	source: 'session-credential' | 'credential-wallet' | 'none';
	districtCode: string | null;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract the congressional district code from a stored W3C VC.
 */
function extractDistrictCode(credential: StoredCredential): string | null {
	const vc = credential.credential as {
		credentialSubject?: {
			districtMembership?: {
				congressional?: string;
			};
		};
	};
	return vc?.credentialSubject?.districtMembership?.congressional ?? null;
}

/**
 * Convert IPFS officials data to the ClientRep shape.
 */
function officialsToReps(officials: OfficialsFileIPFS): ClientRep[] {
	return officials.officials.map(o => {
		const isSenate = o.chamber === 'senate';
		return {
			name: o.name,
			party: o.party,
			chamber: o.chamber,
			state: o.state,
			district: o.district ?? '',
			title: isSenate ? 'Senator' : 'Representative',
			jurisdiction: o.state,
		};
	});
}

/**
 * Given a district code, fetch officials from IPFS and return the result.
 */
async function fetchReps(
	districtCode: string,
	source: 'session-credential' | 'credential-wallet',
): Promise<RepResolverResult> {
	const officials = await getOfficialsFromBrowser(districtCode);
	if (!officials) {
		return { representatives: [], source: 'none', districtCode };
	}
	return {
		representatives: officialsToReps(officials),
		source,
		districtCode,
	};
}

// ============================================================================
// Core
// ============================================================================

/**
 * Resolve representatives for a user entirely client-side.
 *
 * Resolution order:
 * 1. Session credential TreeState (shadow atlas registration — has congressionalDistrict)
 * 2. Credential wallet VC (district_residency — has districtMembership.congressional)
 *
 * For each source, fetches officials from IPFS via browser-client.
 * Returns empty array if no credential or IPFS is unavailable.
 * This is non-fatal — callers fall back to layout data or empty state.
 *
 * @param userId - Current user ID (for credential store lookup)
 */
export async function resolveRepsFromCredential(userId: string): Promise<RepResolverResult> {
	const empty: RepResolverResult = { representatives: [], source: 'none', districtCode: null };

	try {
		// Source 1: Session credential tree state (primary for Tier 2+ users)
		const treeState = await getTreeState(userId);
		if (treeState?.congressionalDistrict) {
			const result = await fetchReps(treeState.congressionalDistrict, 'session-credential');
			if (result.representatives.length > 0) return result;
		}

		// Source 2: Credential wallet — district_residency VC
		const credential = await getCredential(userId, 'district_residency');
		if (credential) {
			if (new Date(credential.expiresAt).getTime() > Date.now()) {
				const districtCode = extractDistrictCode(credential);
				if (districtCode) {
					const result = await fetchReps(districtCode, 'credential-wallet');
					if (result.representatives.length > 0) return result;
					// Have district but no officials — return with districtCode for caller awareness
					return { representatives: [], source: 'none', districtCode };
				}
			}
		}

		return empty;
	} catch (error) {
		console.warn('[client-rep-resolver] Failed to resolve reps:', error);
		return empty;
	}
}
