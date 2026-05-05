import { latLngToCell } from 'h3-js';
import {
	encodeGroundVaultAAD,
	encryptGroundVaultPayload,
	generateGroundVaultDEK,
	generateGroundVaultPRFSalt,
	computePRFSaltId,
	wrapGroundVaultDEK,
	GROUND_VAULT_HKDF_INFO,
	GROUND_VAULT_PRF_SALT_VERSION,
	GROUND_VAULT_WRAP_ALG,
	type GroundVaultAddress,
	type GroundVaultPayload
} from './ground-vault-crypto';
import { base64urlEncode } from '../encoding/base64url';
import { requestCurrentPasskeyPRF } from './ground-vault-unlock';
import { getConstituentAddress, type ConstituentAddress } from './constituent-address';

interface GroundCredentialMetadata {
	districtCredentialId?: string | null;
	district?: string | null;
	districtCommitment?: string | null;
	slotCount?: number | null;
	cellId?: string | null;
	h3Cell?: string | null;
	cellMapRoot?: string | null;
	cellMapVersion?: string | null;
	atlasRoot?: string | null;
	atlasVersion?: string | null;
	source?: string | null;
	issuedAt?: number | null;
	expiresAt?: number | null;
}

interface CellProofMetadata {
	cellId?: string | null;
	cellMapRoot?: string | null;
	districts?: string[] | null;
}

interface GroundVaultStateForRewrap {
	vault?: {
		_id?: string;
		status?: string | null;
	} | null;
		cell?: {
			cellId?: string | null;
			h3Cell?: string | null;
			districts?: string[] | null;
		} | null;
	wrappers?: Array<{
		status?: string | null;
		wrappedDek?: string | null;
	}> | null;
}

export interface PersistGroundVaultInput {
	userId: string;
	address: GroundVaultAddress & { district?: string };
	ground: GroundCredentialMetadata;
	verificationMethod: string;
	coordinates?: { lat: number; lng: number } | null;
	cellProof?: CellProofMetadata | null;
	migrationSource?: string;
}

export type BackfillPasskeyWrapperResult =
	| { status: 'wrapper-added'; groundVaultId: string; passkeyVaultWrapperId: string | null }
	| { status: 'already-wrapped' }
	| { status: 'no-active-vault' }
	| { status: 'address-unavailable' }
	| { status: 'wrapper-unavailable' };

function optionalString(value: string | null | undefined): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalNumber(value: number | null | undefined): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function computeH3Cell(
	ground: GroundCredentialMetadata,
	coordinates?: { lat: number; lng: number } | null
): string | undefined {
	if (ground.h3Cell) return ground.h3Cell;
	if (!coordinates) return undefined;
	return latLngToCell(coordinates.lat, coordinates.lng, 7);
}

async function tryCreatePasskeyWrapper(dek: Uint8Array) {
	if (typeof navigator === 'undefined' || !navigator.credentials) return undefined;

	try {
		const prfSalt = generateGroundVaultPRFSalt();
		const { prfOutput, credentialId } = await requestCurrentPasskeyPRF({
			prfSalt: base64urlEncode(prfSalt)
		});
		return {
			passkeyCredentialId: credentialId,
			rpId: window.location.hostname,
			prfSaltId: await computePRFSaltId(prfSalt),
			prfSalt: base64urlEncode(prfSalt),
			saltVersion: GROUND_VAULT_PRF_SALT_VERSION,
			wrappedDek: await wrapGroundVaultDEK(dek, prfOutput),
			wrapAlg: GROUND_VAULT_WRAP_ALG,
			hkdfInfo: GROUND_VAULT_HKDF_INFO,
			wrapperVersion: 1,
			status: 'active'
		};
	} catch (error) {
		console.warn(
			'[ground-vault] Passkey PRF wrapper unavailable; saved vault without wrapper:',
			error
		);
		return undefined;
	}
}

function toGroundVaultAddress(
	address: Partial<ConstituentAddress> | null | undefined
): (GroundVaultAddress & { district?: string }) | null {
	const street = address?.street?.trim();
	const city = address?.city?.trim();
	const state = address?.state?.trim().toUpperCase();
	const zip = address?.zip?.trim();
	const district = address?.district?.trim().toUpperCase();
	if (!street || !city || !state || !zip) return null;

	return {
		street,
		city,
		state,
		zip,
		...(district ? { district } : {})
	};
}

async function getGroundStateForRewrap(): Promise<GroundVaultStateForRewrap> {
	const response = await fetch('/api/ground/state');
	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		throw new Error(body?.error || body?.message || 'Failed to load ground vault state');
	}
	return response.json();
}

export async function backfillActiveGroundVaultPasskeyWrapper(input: {
	userId: string;
	address?: ConstituentAddress | null;
}): Promise<BackfillPasskeyWrapperResult> {
	const groundState = await getGroundStateForRewrap();
	const activeVaultId = groundState.vault?._id;
		if (!activeVaultId || groundState.vault?.status !== 'active') {
			return { status: 'no-active-vault' };
		}

	const readableAddress = toGroundVaultAddress(
		input.address ?? (await getConstituentAddress(input.userId))
	);
	if (!readableAddress) {
		return { status: 'address-unavailable' };
	}
	const serverDistricts = (groundState.cell?.districts ?? []).filter(
		(district): district is string => typeof district === 'string' && district.length > 0
	).map((district) => district.trim().toUpperCase());
	if (
		readableAddress.district &&
		serverDistricts.length > 0 &&
		!serverDistricts.includes(readableAddress.district)
	) {
		return { status: 'address-unavailable' };
	}
	const district = optionalString(readableAddress.district) ?? serverDistricts[0];

	const dek = generateGroundVaultDEK();
	const aeadAssociatedData = encodeGroundVaultAAD({
		userId: input.userId
	});
	const payload: GroundVaultPayload = {
		address: {
			street: readableAddress.street,
			city: readableAddress.city,
			state: readableAddress.state,
			zip: readableAddress.zip
		},
		district,
		cellId: optionalString(groundState.cell?.cellId),
		h3Cell: optionalString(groundState.cell?.h3Cell),
		normalizedAt: new Date().toISOString()
	};
	const encrypted = await encryptGroundVaultPayload(payload, dek, aeadAssociatedData);
	const wrapper = await tryCreatePasskeyWrapper(dek);
	if (!wrapper) {
		return { status: 'wrapper-unavailable' };
	}

	const response = await fetch('/api/ground/wrapper', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			groundVaultId: activeVaultId,
			vault: {
				ciphertext: encrypted.ciphertext,
				nonce: encrypted.nonce,
				schemaVersion: encrypted.schemaVersion,
				encryptionVersion: encrypted.encryptionVersion,
				dekVersion: encrypted.dekVersion,
				aeadAssociatedData: encrypted.aeadAssociatedData,
				associatedDataHash: encrypted.associatedDataHash
			},
			wrapper
		})
	});

	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		throw new Error(body?.error || body?.message || 'Failed to add passkey wrapper');
	}

	const body = (await response.json()) as {
		status?: string;
		groundVaultId: string;
		passkeyVaultWrapperId: string | null;
	};
	if (body.status === 'already-wrapped') {
		return { status: 'already-wrapped' };
	}
	return {
		status: 'wrapper-added',
		groundVaultId: body.groundVaultId,
		passkeyVaultWrapperId: body.passkeyVaultWrapperId
	};
}

export async function persistGroundVaultForAddress(
	input: PersistGroundVaultInput
): Promise<unknown | null> {
	const districtCredentialId = optionalString(input.ground.districtCredentialId);
	if (!districtCredentialId) return null;

	const cellId = optionalString(input.cellProof?.cellId) ?? optionalString(input.ground.cellId);
	const h3Cell = computeH3Cell(input.ground, input.coordinates);
	const dek = generateGroundVaultDEK();
	const aeadAssociatedData = encodeGroundVaultAAD({
		userId: input.userId
	});
	const payload: GroundVaultPayload = {
		address: {
			street: input.address.street,
			city: input.address.city,
			state: input.address.state,
			zip: input.address.zip
		},
		district: optionalString(input.address.district) ?? optionalString(input.ground.district),
		cellId,
		h3Cell,
		normalizedAt: new Date().toISOString()
	};
	const encrypted = await encryptGroundVaultPayload(payload, dek, aeadAssociatedData);
	const wrapper = await tryCreatePasskeyWrapper(dek);

	const response = await fetch('/api/ground/bundle', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			vault: {
				status: 'active',
				ciphertext: encrypted.ciphertext,
				nonce: encrypted.nonce,
				schemaVersion: encrypted.schemaVersion,
				encryptionVersion: encrypted.encryptionVersion,
				dekVersion: encrypted.dekVersion,
				aeadAssociatedData: encrypted.aeadAssociatedData,
				associatedDataHash: encrypted.associatedDataHash,
				createdByMethod: input.verificationMethod,
				migrationSource: input.migrationSource
			},
			cell: {
				districtCredentialId,
				cellId,
				h3Cell,
				cellMapRoot:
					optionalString(input.cellProof?.cellMapRoot) ?? optionalString(input.ground.cellMapRoot),
				cellMapVersion: optionalString(input.ground.cellMapVersion),
				atlasRoot: optionalString(input.ground.atlasRoot),
				atlasVersion: optionalString(input.ground.atlasVersion),
				districtCommitment: optionalString(input.ground.districtCommitment),
				districts: input.cellProof?.districts ?? undefined,
				slotCount: optionalNumber(input.ground.slotCount),
				source: input.ground.source ?? input.verificationMethod,
				issuedAt: optionalNumber(input.ground.issuedAt) ?? Date.now(),
				expiresAt: optionalNumber(input.ground.expiresAt)
			},
			wrapper
		})
	});

	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		throw new Error(body?.error || body?.message || 'Failed to persist encrypted ground vault');
	}

	return response.json();
}
