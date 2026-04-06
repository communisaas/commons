/**
 * Verification Page Server Load
 *
 * Resolves a verification hash to sender verification data.
 * Currently returns the hash for display — full user lookup
 * will be added when Convex verification endpoint is built.
 */
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const { hash } = params;

	if (!hash || hash.length < 6) {
		throw error(404, 'Invalid verification link');
	}

	// Future: query Convex for user verification state by hash prefix.
	// The data shape below matches what the real endpoint will return.
	//
	// The ZKP circuit proves membership in up to 24 district slots simultaneously
	// (see voter-protocol DISTRICT-TAXONOMY.md). Non-null slots are disclosed as
	// public inputs. The districts array below mirrors that structure — only
	// populated slots are included.
	return {
		hash,
		trustTier: 2 as 0 | 1 | 2 | 3 | 4 | 5,
		identity: {
			verified: true,
			method: 'email' as 'email' | 'gov-id'
		},
		location: {
			verified: true,
			method: 'civic_api' as 'civic_api' | 'mdl' | 'postal' | null,
			state: 'California' as string | null,
			// Full district disclosure from circuit public inputs [2-25].
			// Each entry: { slot, label (human-readable), value (district code) }
			districts: [
				{ slot: 5, label: 'City', value: 'San Francisco' },
				{ slot: 4, label: 'County', value: 'San Francisco' },
				{ slot: 0, label: 'Congressional district', value: 'CA-12' },
				{ slot: 1, label: 'Federal senate', value: 'CA' },
				{ slot: 2, label: 'State senate district', value: 'SD-11' },
				{ slot: 3, label: 'State assembly district', value: 'AD-17' },
				{ slot: 7, label: 'School district', value: 'SFUSD' }
			] as { slot: number; label: string; value: string }[]
		},
		govCredential: false,
		composition: 'individual' as 'individual' | 'template',
		verifiedAt: Date.now(),
		// Message-level context — null until Convex endpoint resolves per-message data
		topic: null as string | null,
		participantCount: null as number | null
	};
};
