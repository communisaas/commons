import { serverMutation, serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import {
	hashCredential,
	hashDistrict,
	issueDistrictCredential
} from '$lib/core/identity/district-credential';
import { TIER_CREDENTIAL_TTL } from '$lib/core/identity/credential-policy';

export type GroundVerificationMethod = 'civic_api' | 'postal' | 'shadow_atlas';

export interface GroundOfficialInput {
	name: string;
	chamber: 'house' | 'senate';
	party: string;
	state: string;
	district: string;
	bioguide_id: string;
	is_voting_member?: boolean;
	delegate_type?: string | null;
	phone?: string;
	office_code?: string;
	office?: string;
}

export interface GroundVerificationInput {
	district?: string;
	state_senate_district?: string;
	state_assembly_district?: string;
	verification_method: GroundVerificationMethod;
	officials?: GroundOfficialInput[];
	district_commitment?: string;
	slot_count?: number;
	coordinates?: { lat: number; lng: number };
	cell_id?: string;
	h3_cell?: string;
	cell_map_root?: string;
	cell_map_version?: string;
	atlas_root?: string;
	atlas_version?: string;
	// H1 — trust-context plumbed from the client when known.
	// cell_straddles : G2 boundary-cell mark.
	// cell_anchor_mode : G8 audit-trail mode (one of CELL_ANCHOR_MODES).
	// (atlas_version above already serves H1's atlas-rotation field.)
	cell_straddles?: boolean;
	cell_anchor_mode?: string;
}

export interface GroundCredentialResult {
	success: true;
	credential?: unknown;
	credentialHash?: string;
	commitment?: string;
	ground: {
		districtCredentialId: string;
		district: string | null;
		districtCommitment: string | null;
		slotCount: number | null;
		cellId: string | null;
		h3Cell: string | null;
		source: GroundVerificationMethod;
		issuedAt: number;
		expiresAt: number;
	};
}

export class GroundServiceError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string,
		message: string
	) {
		super(message);
		this.name = 'GroundServiceError';
	}
}

export function isGroundServiceError(error: unknown): error is GroundServiceError {
	return error instanceof GroundServiceError;
}

function extractDistrictCredentialId(result: unknown): string | null {
	if (!result || typeof result !== 'object') return null;
	const id = (result as { districtCredentialId?: unknown }).districtCredentialId;
	return typeof id === 'string' && id.length > 0 ? id : null;
}

export async function verifyGroundCommitmentAuthenticity(
	userId: string,
	input: GroundVerificationInput
): Promise<void> {
	if (!input.district_commitment) return;

	if (!input.coordinates) {
		throw new GroundServiceError(
			400,
			'COMMITMENT_AUTHENTICITY_REQUIRES_COORDINATES',
			'Address coordinates are required to verify the district commitment. Please retry the address resolution step.'
		);
	}

	try {
		const { verifyDistrictCommitment } = await import('$lib/server/identity/verify-commitment');
		await verifyDistrictCommitment({
			lat: input.coordinates.lat,
			lng: input.coordinates.lng,
			clientCommitment: input.district_commitment
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes('COMMITMENT_AUTHENTICITY_MISMATCH')) {
			console.warn('[ground] commitment authenticity mismatch', {
				userId,
				detail: msg.slice(0, 200)
			});
			throw new GroundServiceError(
				400,
				'COMMITMENT_AUTHENTICITY_MISMATCH',
				'The district commitment you submitted does not match the address. Please retry; if the problem persists, your client may have stale data.'
			);
		}
		if (
			msg.includes('COMMITMENT_VERIFY_IPFS_UNAVAILABLE') ||
			msg.includes('COMMITMENT_VERIFY_IPFS_TIMEOUT')
		) {
			const isTimeout = msg.includes('COMMITMENT_VERIFY_IPFS_TIMEOUT');
			console.error(`[ground] IPFS ${isTimeout ? 'timeout' : 'unavailable'} for authenticity check`, {
				userId,
				detail: msg.slice(0, 200)
			});
			throw new GroundServiceError(
				503,
				isTimeout ? 'COMMITMENT_VERIFY_IPFS_TIMEOUT' : 'COMMITMENT_VERIFY_IPFS_UNAVAILABLE',
				'Verification service temporarily unavailable. Please retry in a moment.'
			);
		}
		if (msg.includes('COMMITMENT_VERIFY_BAD_CELL_DATA')) {
			throw new GroundServiceError(
				422,
				'COMMITMENT_VERIFY_BAD_CELL_DATA',
				'Your address is in a region without supported district data (US territories, some rural areas). Please use district-attested verification instead.'
			);
		}

		console.error('[ground] commitment verification failed:', msg);
		throw new GroundServiceError(
			500,
			'COMMITMENT_VERIFY_FAILED',
			'Failed to verify district commitment. Please retry.'
		);
	}
}

export async function issueGroundCredential(
	userId: string,
	input: GroundVerificationInput
): Promise<GroundCredentialResult> {
	const issuedAt = Date.now();
	const expiresAt = issuedAt + TIER_CREDENTIAL_TTL[2];
	const isCommitmentOnly =
		input.verification_method === 'shadow_atlas' && Boolean(input.district_commitment);

	const userDidKey = await serverQuery(api.users.getDidKey, { userId: userId as never });
	const credential = input.district
		? await issueDistrictCredential({
				userId,
				didKey: userDidKey?.didKey ?? null,
				congressional: input.district,
				stateSenate: input.state_senate_district,
				stateAssembly: input.state_assembly_district,
				verificationMethod: input.verification_method
			})
		: null;

	const credentialHash = credential ? await hashCredential(credential) : null;
	const districtHash = input.district ? await hashDistrict(input.district) : null;

	const verified = await serverMutation(api.users.verifyAddress, {
		userId: userId as never,
		district: input.district,
		stateSenateDistrict: input.state_senate_district,
		stateAssemblyDistrict: input.state_assembly_district,
		verificationMethod: input.verification_method,
		credentialHash: credentialHash ?? undefined,
		districtHash: districtHash ?? undefined,
		districtCommitment: input.district_commitment,
		slotCount: input.slot_count,
		expiresAt,
		isCommitmentOnly,
		officials:
			!isCommitmentOnly && input.officials && input.officials.length > 0
				? input.officials.map((o) => ({
						name: o.name,
						chamber: o.chamber,
						party: o.party,
						state: o.state,
						district: o.district,
						bioguideId: o.bioguide_id,
						isVotingMember: o.is_voting_member,
						delegateType: o.delegate_type ?? undefined,
						phone: o.phone
					}))
				: undefined,
		// H1 — pass-through-when-known. Convex args validator drops undefined,
		// so legacy callers that omit these end up with undefined fields on the
		// credential row (the H0r-required "unknown" semantics).
		cellStraddles: input.cell_straddles,
		cellAnchorMode: input.cell_anchor_mode,
		atlasVersion: input.atlas_version
	});
	const districtCredentialId = extractDistrictCredentialId(verified);
	if (!districtCredentialId) {
		throw new GroundServiceError(
			503,
			'GROUND_CREDENTIAL_CONTRACT_STALE',
			'Address verification succeeded, but the credential response is stale. Please retry after the server finishes updating.'
		);
	}

	return {
		success: true,
		...(credential && credentialHash ? { credential, credentialHash } : {}),
		...(!credential && input.district_commitment ? { commitment: input.district_commitment } : {}),
		ground: {
			districtCredentialId,
			district: input.district ?? null,
			districtCommitment: input.district_commitment ?? null,
			slotCount: input.slot_count ?? null,
			cellId: input.cell_id ?? null,
			h3Cell: input.h3_cell ?? null,
			source: input.verification_method,
			issuedAt,
			expiresAt
		}
	};
}

export async function getMyGroundState(): Promise<unknown> {
	return serverQuery(api.ground.getMyGroundState, {});
}

export async function getMyGroundRestoreState(): Promise<unknown> {
	return serverQuery(api.ground.getMyGroundRestoreState, {});
}

export async function persistGroundBundle(input: {
	vault: unknown;
	cell: unknown;
	wrapper?: unknown;
}): Promise<unknown> {
	return serverMutation(api.ground.persistGroundBundle, input as never);
}
