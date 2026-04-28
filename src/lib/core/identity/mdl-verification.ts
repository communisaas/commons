/**
 * mDL Verification -- Privacy Boundary
 *
 * processCredentialResponse() is THE privacy boundary.
 * Raw disclosed fields (postal_code, city, state, birth_date, document_number)
 * enter this function and ONLY derived facts leave.
 *
 * This code runs in a CF Worker today and moves to a TEE unchanged later.
 *
 * Privacy guarantees:
 * 1. Selective disclosure: location fields plus birth_date/document_number
 *    for private identity binding
 * 2. Raw fields never returned, logged, or stored
 * 3. Ephemeral key pairs (5-min TTL) prevent persistent decryption
 * 4. intentToRetain: false on all fields
 *
 * ISO 18013-5 verification steps:
 * 1. HPKE decrypt session transcript
 * 2. CBOR decode DeviceResponse
 * 3. Extract IssuerSigned namespaces
 * 4. Verify COSE_Sign1 signature against IACA roots
 * 5. Validate MSO valueDigests
 * 6. Check DeviceAuth
 * 7. Extract disclosed fields -> derive district and identity commitment -> discard raw fields
 */
import { compactDecrypt, decodeProtectedHeader } from 'jose';
import {
	OPENID4VP_DC_API_PROTOCOL,
	UNSIGNED_OPENID4VP_DC_API_PROTOCOL,
	LEGACY_OPENID4VP_PROTOCOL
} from '$lib/config/features';

/** Workers KV binding (minimal type for VICAL fallback — avoids @cloudflare/workers-types dependency) */
type KVNamespace = {
	get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>;
	get(key: string): Promise<string | null>;
	put(
		key: string,
		value: string | ArrayBuffer | ArrayBufferView,
		options?: { expirationTtl?: number }
	): Promise<void>;
};

interface MdlVerificationOptions {
	vicalKv?: KVNamespace;
	/** Canonical verifier origin stored with the DC API request session. */
	verifierOrigin?: string;
	/** Direct-post verifier context stored with the OpenID4VP request_uri session. */
	directPost?: {
		clientId: string;
		responseUri: string;
		jwkThumbprint?: Uint8Array | ArrayBuffer | null;
		allowLocalhostHttp?: boolean;
	};
	/** SHA-256 JWK thumbprint for encrypted browser-mediated dc_api.jwt responses. */
	dcApiJwkThumbprint?: Uint8Array | ArrayBuffer | null;
}

/** Result of processing a credential response (discriminated union) */
export type MdlVerificationResult =
	| {
			success: true;
			/** Congressional district derived from address */
			district: string;
			/** State abbreviation */
			state: string;
			/** SHA-256 hash of the credential for dedup */
			credentialHash: string;
			/** Verification method identifier */
			verificationMethod: 'mdl';
			/**
			 * Identity commitment (BN254 field element, hex string).
			 * Computed from document_number + birth_year INSIDE the privacy boundary.
			 * Raw identity fields are discarded after commitment computation.
			 * Always present on success — missing identity fields cause hard failure.
			 */
			identityCommitment: string;
			/**
			 * Census tract GEOID (11-digit) for Shadow Atlas Tree 2 cell mapping.
			 * Resolved from postal_code + city + state via Shadow Atlas geocoding
			 * INSIDE the privacy boundary. Null if geocoding failed (non-fatal).
			 */
			cellId?: string;
	  }
	| {
			success: false;
			error:
				| 'invalid_format'
				| 'decryption_failed'
				| 'signature_invalid'
				| 'unsupported_state'
				| 'expired'
				| 'missing_fields'
				| 'missing_identity_fields'
				| 'unsupported_protocol'
				| 'district_lookup_failed'
				| 'replay_protection_missing'
				| 'mdl_disabled'
				| 'identity_commitment_failed';
			message: string;
			supportedStates?: string[];
	  };

/**
 * Process a credential response from the Digital Credentials API.
 *
 * THIS IS THE PRIVACY BOUNDARY.
 * Raw address data enters this function. Only derived district leaves.
 *
 * @param encryptedData - The encrypted credential data from the wallet
 * @param protocol - 'org-iso-mdoc', 'openid4vp-v1-signed', 'openid4vp-v1-unsigned', or legacy 'openid4vp'
 * @param ephemeralPrivateKey - The ephemeral private key for HPKE decryption
 * @param nonce - Session nonce for replay protection
 */
export async function processCredentialResponse(
	encryptedData: unknown,
	protocol: string,
	ephemeralPrivateKey: CryptoKey,
	nonce: string,
	options?: MdlVerificationOptions
): Promise<MdlVerificationResult> {
	try {
		if (protocol === 'org-iso-mdoc') {
			return await processMdocResponse(encryptedData, ephemeralPrivateKey, nonce, options?.vicalKv);
		} else if (
			protocol === LEGACY_OPENID4VP_PROTOCOL ||
			protocol === UNSIGNED_OPENID4VP_DC_API_PROTOCOL ||
			protocol === OPENID4VP_DC_API_PROTOCOL
		) {
			return await processOid4vpResponse(
				encryptedData,
				ephemeralPrivateKey,
				nonce,
				protocol,
				options
			);
		} else {
			return {
				success: false,
				error: 'unsupported_protocol',
				message: `Unsupported protocol: ${protocol}`
			};
		}
	} catch (err) {
		console.error('[mDL] Verification error:', err instanceof Error ? err.message : err);
		return {
			success: false,
			error: 'invalid_format',
			message: 'Failed to process credential response'
		};
	}
}

/**
 * Process an org-iso-mdoc (ISO 18013-5) response.
 *
 * Steps:
 * 1. CBOR decode the DeviceResponse
 * 2. Extract IssuerSigned data from the mDL document
 * 3. Verify COSE_Sign1 signature (when IACA roots available)
 * 4. Validate MSO valueDigests
 * 5. Extract disclosed fields
 * 6. Derive congressional district and identity commitment
 * 7. Discard raw fields - return only derived facts
 */
async function processMdocResponse(
	data: unknown,
	_ephemeralPrivateKey: CryptoKey,
	nonce: string,
	vicalKv?: KVNamespace
): Promise<MdlVerificationResult> {
	// Nonce is required for replay protection
	if (!nonce) {
		return {
			success: false,
			error: 'invalid_format',
			message: 'Missing nonce for mdoc verification'
		};
	}

	// Dynamic import cbor-web (Workers-compatible)
	const cbor = await loadCborModule();
	const decode = cbor.decode;

	// Step 1: CBOR decode
	let deviceResponse: Record<string, unknown>;
	try {
		// data may be ArrayBuffer or base64 string
		const buffer =
			data instanceof ArrayBuffer
				? new Uint8Array(data)
				: typeof data === 'string'
					? base64ToUint8Array(data)
					: null;

		if (!buffer) {
			return {
				success: false,
				error: 'invalid_format',
				message: 'mdoc data must be ArrayBuffer or base64 string'
			};
		}

		deviceResponse = decode(buffer) as Record<string, unknown>;
	} catch {
		return {
			success: false,
			error: 'invalid_format',
			message: 'Failed to CBOR decode DeviceResponse'
		};
	}

	// Step 2: Navigate CBOR structure to extract address fields
	// DeviceResponse -> documents[0] -> issuerSigned -> namespaces -> org.iso.18013.5.1
	try {
		const documents = deviceResponse?.documents;
		if (!Array.isArray(documents) || documents.length === 0) {
			return {
				success: false,
				error: 'invalid_format',
				message: 'No documents in DeviceResponse'
			};
		}

		const doc = documents[0] as Record<string, unknown>;
		const issuerSigned = doc?.issuerSigned as Record<string, unknown> | undefined;
		if (!issuerSigned) {
			return {
				success: false,
				error: 'invalid_format',
				message: 'No issuerSigned data'
			};
		}

		// Step 2.5: DeviceAuth presence gate (F-1.3, partial — full T3 pending)
		// ISO 18013-5 §9.1.3.6: DeviceAuthentication = [
		//   "DeviceAuthentication", SessionTranscript, docType, DeviceNameSpacesBytes
		// ]
		//
		// What this gate ACTUALLY does (revised after F-1.3 review round 2):
		//   - REJECTS DeviceResponses whose deviceSigned is missing or whose
		//     deviceAuth has neither deviceMac nor deviceSignature. ISO 18013-5
		//     §9.1.3 requires DeviceAuthentication on every conformant response;
		//     this gate enforces that minimum.
		//
		// What this gate DOES NOT do — DO NOT MISTAKE THIS FOR REPLAY DEFENSE:
		//   - Does NOT verify the deviceMac / deviceSignature bytes
		//   - Does NOT extract or compare the SessionTranscript nonce against
		//     the OID4VP request nonce
		//   - Does NOT prevent capture-replay: an attacker who captured Alice's
		//     DeviceResponse can replay it verbatim — the deviceAuth bytes copy
		//     across cleanly because the gate only checks key presence.
		//
		// Net value: rejects wallets that emit non-conformant responses (e.g.,
		// negligent vendors, broken test rigs). Provides ZERO defense against
		// the capture-replay threat that F-1.3 was opened against. Full T3
		// (DeviceAuth verification against reconstructed SessionTranscript) is
		// REQUIRED before the raw mdoc lane (`FEATURES.MDL_MDOC`) is opened.
		// See `docs/security/KNOWN-LIMITATIONS.md` F-1.3 section.
		const deviceSigned = doc?.deviceSigned as Record<string, unknown> | undefined;
		const deviceAuth = deviceSigned?.deviceAuth as Record<string, unknown> | undefined;
		if (!deviceAuth) {
			return {
				success: false,
				error: 'replay_protection_missing',
				message:
					'DeviceAuthentication structure missing — replay protection cannot be evaluated. Full DeviceAuth verification ships with T3 (mDL launch gate).'
			};
		}
		const hasMac = 'deviceMac' in deviceAuth;
		const hasSig = 'deviceSignature' in deviceAuth;
		if (!hasMac && !hasSig) {
			return {
				success: false,
				error: 'replay_protection_missing',
				message: 'DeviceAuth has neither deviceMac nor deviceSignature'
			};
		}
		// Positive-case telemetry — useful when triaging T3 rollout.
		console.log(
			'[mDL] DeviceAuth structure present (kind:',
			hasMac ? 'mac' : 'sig',
			') — full HPKE verification deferred to T3'
		);

		// Step 3: COSE_Sign1 verification
		const issuerAuth = issuerSigned.issuerAuth;
		if (issuerAuth && Array.isArray(issuerAuth)) {
			const { verifyCoseSign1 } = await import('./cose-verify');
			const { getIACARootsForVerification, supportedIACAStates } = await import('./iaca-roots');
			const roots = getIACARootsForVerification();

			if (roots.length > 0) {
				let coseResult = await verifyCoseSign1(issuerAuth, roots);

				// VICAL fallback: if static roots don't have this issuer, try runtime VICAL roots
				if (
					!coseResult.valid &&
					coseResult.reason === 'Issuer certificate not found in IACA trust store'
				) {
					try {
						const { getExpandedIACARoots } = await import('./vical-service');
						const expandedRoots = await getExpandedIACARoots(vicalKv);
						// Only retry if VICAL added new roots beyond static
						if (expandedRoots.length > roots.length) {
							coseResult = await verifyCoseSign1(issuerAuth, expandedRoots);
						}
					} catch (e) {
						console.warn('[mDL] VICAL fallback failed (continuing with static roots):', e);
					}
				}

				if (!coseResult.valid) {
					if (coseResult.reason === 'Issuer certificate not found in IACA trust store') {
						return {
							success: false,
							error: 'unsupported_state',
							message: `This mDL was issued by a state not yet in our trust store. Supported states: ${supportedIACAStates().join(', ')}`,
							supportedStates: supportedIACAStates()
						};
					}
					return {
						success: false,
						error: 'signature_invalid',
						message: `COSE_Sign1 verification failed: ${coseResult.reason}`
					};
				}

				// MSO digest validation: proves extracted field values match the
				// signed digests in the Mobile Security Object. Defense-in-depth —
				// a tampered field would pass COSE signature but fail digest check.
				if (coseResult.mso) {
					const validityError = validateMsoValidity(coseResult.mso);
					if (validityError) return validityError;

					const { validateMsoDigests } = await import('./cose-verify');
					const nsData = (issuerSigned.nameSpaces ?? issuerSigned.namespaces) as
						| Record<string, unknown[]>
						| undefined;
					if (nsData) {
						const digestsValid = await validateMsoDigests(
							coseResult.mso,
							nsData,
							decode,
							(data: unknown) => new Uint8Array(cbor.encode(data))
						);
						if (!digestsValid) {
							return {
								success: false,
								error: 'signature_invalid',
								message: 'MSO digest validation failed — field values do not match signed digests'
							};
						}
					}
				}
			} else {
				return {
					success: false,
					error: 'signature_invalid',
					message: 'No IACA root certificates loaded — cannot verify mDL issuer'
				};
			}
		} else {
			return {
				success: false,
				error: 'signature_invalid',
				message: 'No issuerAuth in credential — cannot verify mDL issuer'
			};
		}

		// Step 4: Extract namespace elements
		const namespaces = (issuerSigned.nameSpaces ?? issuerSigned.namespaces) as
			| Record<string, unknown[]>
			| undefined;
		const mdlNamespace = namespaces?.['org.iso.18013.5.1'];

		if (!mdlNamespace) {
			return {
				success: false,
				error: 'missing_fields',
				message: 'No mDL namespace in issuerSigned data'
			};
		}

		// Step 5: Extract address fields from IssuerSignedItem elements
		// Each element is CBOR-encoded: { digestID, random, elementIdentifier, elementValue }
		const fieldResult = extractMdlFields(mdlNamespace, decode);
		if (fieldResult.duplicateIdentifier) {
			return duplicateMdlElementResult(fieldResult.duplicateIdentifier);
		}
		const fields = fieldResult.fields;

		const postalCode = fields.get('resident_postal_code');
		const city = fields.get('resident_city');
		const state = fields.get('resident_state');

		if (!postalCode || !state) {
			return {
				success: false,
				error: 'missing_fields',
				message: 'Credential missing required address fields (postal_code, state)'
			};
		}

		// Step 5b: Extract identity fields, compute commitment, DISCARD raw fields.
		// The raw document_number and birth_date NEVER leave this function.
		// Only the resulting identity commitment (a single BN254 field element) propagates.
		const documentNumber = fields.get('document_number');
		const birthDateRaw = fields.get('birth_date');
		const birthYear = extractBirthYear(birthDateRaw);

		// Step 6: Resolve district + cellId from postal code + city + state via Shadow Atlas.
		// Uses the self-hosted Nominatim + H3 pipeline — ZIP alone is insufficient because
		// ~94% of Americans live in multi-district states where ZIP crosses district lines.
		// PRIVACY BOUNDARY: After this point, raw address fields are no longer used.
		const location = await resolveLocationFromAddress(postalCode, city ?? '', state);

		if (!location.district) {
			return {
				success: false,
				error: 'district_lookup_failed',
				message: 'Could not determine congressional district from address'
			};
		}

		const district = location.district;
		const cellId = location.cellId;

		// Step 7: Compute credential hash for dedup (hash of the raw data, not address)
		const hashBuffer = await crypto.subtle.digest(
			'SHA-256',
			typeof data === 'string'
				? new TextEncoder().encode(data)
				: new Uint8Array(data as ArrayBuffer)
		);
		const credentialHash = Array.from(new Uint8Array(hashBuffer))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');

		// Identity fields are REQUIRED for sybil-resistant identity commitment.
		// Without document_number + birth_date, we cannot produce a stable commitment,
		// and falling back to credentialHash would allow sybil bypass.
		if (!documentNumber || !birthYear) {
			return {
				success: false,
				error: 'missing_identity_fields',
				message:
					'Your wallet must share birth date and document number for identity verification. Check your wallet settings or try a different wallet.'
			};
		}

		// Compute identity commitment INSIDE the privacy boundary.
		// Raw documentNumber and birthYear are consumed here and never returned.
		const identityCommitment = await computeIdentityCommitmentInBoundary(documentNumber, birthYear);
		if (!identityCommitment) {
			return {
				success: false,
				error: 'identity_commitment_failed',
				message: 'Identity commitment could not be computed — verifier is not configured'
			};
		}

		// documentNumber, birthYear, postalCode, city go out of scope here — DISCARDED.
		// Only district, cellId, credentialHash, and the hashed identityCommitment are returned.
		return {
			success: true,
			district,
			state,
			credentialHash,
			verificationMethod: 'mdl',
			identityCommitment,
			cellId: cellId ?? undefined
		};
	} catch (err) {
		console.error('[mDL] mdoc processing error:', err);
		return { success: false, error: 'invalid_format', message: 'Failed to process mdoc data' };
	}
}

/**
 * Extract mDL fields from namespace elements.
 * Each element may be a CBOR Tagged value (tag 24) containing an IssuerSignedItem.
 */
function extractMdlFields(
	namespaceElements: unknown[],
	decode: (data: Uint8Array) => unknown
): { fields: Map<string, string>; duplicateIdentifier?: string } {
	const fields = new Map<string, string>();
	let duplicateIdentifier: string | undefined;

	for (const element of namespaceElements) {
		try {
			let item: Record<string, unknown> | undefined;

			if (element instanceof Uint8Array) {
				// CBOR-encoded IssuerSignedItem (tag 24 / bstr)
				item = decode(element) as Record<string, unknown>;
			} else if (typeof element === 'object' && element !== null) {
				// Already decoded
				item = element as Record<string, unknown>;
				// Handle CBOR Tagged values
				if ('value' in item && item.value instanceof Uint8Array) {
					item = decode(item.value) as Record<string, unknown>;
				}
			}

			if (item?.elementIdentifier && item?.elementValue !== undefined) {
				const identifier = String(item.elementIdentifier);
				if (fields.has(identifier)) {
					duplicateIdentifier = identifier;
					continue;
				}
				fields.set(identifier, String(item.elementValue));
			}
		} catch {
			// Skip malformed elements
			continue;
		}
	}

	return duplicateIdentifier ? { fields, duplicateIdentifier } : { fields };
}

function duplicateMdlElementResult(identifier: string): MdlVerificationResult {
	return {
		success: false,
		error: 'signature_invalid',
		message: `Duplicate signed mDL element identifier rejected: ${identifier}`
	};
}

/**
 * Process an OpenID4VP response.
 * Chrome 141+ may return credentials via this protocol alongside org-iso-mdoc.
 *
 * OpenID4VP responses contain a VP token. Legacy/test fixtures may present
 * JWT or SD-JWT VP tokens with claims directly. Current Google Wallet mDL
 * responses present `mso_mdoc` as base64url DeviceResponse entries inside a
 * VP token object; those are accepted only after issuerAuth, MSO digest, and
 * DeviceAuth.deviceSignature verification against the stored DC API origin.
 *
 * Accepted formats:
 * 1. `openid4vp-v1-signed`: encrypted `dc_api.jwt` response containing
 *    `vp_token.mdl[]` mso_mdoc DeviceResponse.
 * 2. `openid4vp-v1-unsigned`: `vp_token.mdl[]` mso_mdoc DeviceResponse only.
 * 3. Legacy `openid4vp`: JWT or SD-JWT VP tokens with claims directly.
 *
 * Explicit fail-closed formats:
 * 4. Direct JSON object with claims (rejected — no signature to verify)
 *
 * PRIVACY BOUNDARY: Same as mdoc path — extract address fields,
 * derive district, discard raw address data.
 */
async function processOid4vpResponse(
	data: unknown,
	_ephemeralPrivateKey: CryptoKey,
	nonce: string,
	protocol: string,
	options?: MdlVerificationOptions
): Promise<MdlVerificationResult> {
	try {
		// Step 1: Classify and extract the VP token payload.
		let presentation = extractOid4vpPresentation(data, protocol);
		let encryptedResponse = false;
		if (!presentation) {
			return {
				success: false,
				error: 'invalid_format',
				message: 'Could not extract VP token from OpenID4VP response'
			};
		}
		if (presentation.kind === 'encrypted_response') {
			encryptedResponse = true;
			const decrypted = await decryptOpenId4VpEncryptedResponse(
				presentation.jwe,
				_ephemeralPrivateKey
			);
			if (!decrypted.success) return decrypted.result;
			presentation = extractOid4vpPresentation(decrypted.payload, protocol);
			if (!presentation) {
				return {
					success: false,
					error: 'invalid_format',
					message: 'Decrypted OpenID4VP response did not contain a VP token'
				};
			}
			if (presentation.kind === 'encrypted_response') {
				return {
					success: false,
					error: 'invalid_format',
					message: 'Nested encrypted OpenID4VP responses are not accepted'
				};
			}
		}
		if (presentation.kind === 'unsupported') {
			return {
				success: false,
				error: 'invalid_format',
				message: presentation.message
			};
		}
		if (protocol === OPENID4VP_DC_API_PROTOCOL && !encryptedResponse) {
			return {
				success: false,
				error: 'invalid_format',
				message: 'Signed OpenID4VP DC API responses must be encrypted dc_api.jwt responses'
			};
		}
		if (protocol === OPENID4VP_DC_API_PROTOCOL && !isSha256Digest(options.dcApiJwkThumbprint)) {
			return {
				success: false,
				error: 'invalid_format',
				message: 'Signed OpenID4VP DC API responses require a 32-byte encryption JWK thumbprint'
			};
		}
		if (presentation.kind === 'mso_mdoc') {
			return await processOpenId4VpMsoMdocPresentation(presentation, data, nonce, options);
		}
		if (protocol === OPENID4VP_DC_API_PROTOCOL || protocol === UNSIGNED_OPENID4VP_DC_API_PROTOCOL) {
			return {
				success: false,
				error: 'invalid_format',
				message:
					'OpenID4VP DC API mDL responses must use mso_mdoc DeviceResponse; JWT/SD-JWT VP tokens are not accepted for this protocol'
			};
		}

		const vpToken = presentation.token;

		// Step 2: Verify the JWT/SD-JWT signature before claims are parsed.
		const sigResult = await verifyVpTokenSignature(vpToken);
		if (!sigResult.valid) {
			return {
				success: false,
				error: 'signature_invalid',
				message: `VP token signature verification failed: ${sigResult.reason}`
			};
		}

		// Step 3: Extract claims (only after signature verified)
		const claims = await parseVpToken(vpToken);
		if (!claims) {
			return {
				success: false,
				error: 'invalid_format',
				message: 'Could not parse claims from verified VP token'
			};
		}

		const temporalError = validateJwtTemporalClaims(claims);
		if (temporalError) {
			return {
				success: false,
				error: temporalError.error,
				message: temporalError.message
			};
		}

		// Step 4: Verify nonce (REQUIRED — missing nonce is a failure)
		if (!claims.nonce) {
			return {
				success: false,
				error: 'invalid_format',
				message: 'OpenID4VP response missing nonce — potential replay'
			};
		}
		if (claims.nonce !== nonce) {
			return {
				success: false,
				error: 'invalid_format',
				message: 'OpenID4VP nonce mismatch'
			};
		}

		// Extract address fields from claims
		// Claims may be nested under various structures depending on the wallet
		const postalCode = findClaim(claims, 'resident_postal_code');
		const city = findClaim(claims, 'resident_city');
		const state = findClaim(claims, 'resident_state');

		if (!postalCode || !state) {
			return {
				success: false,
				error: 'missing_fields',
				message: 'OpenID4VP response missing required address fields (postal_code, state)'
			};
		}

		// Extract identity fields, compute commitment, discard raw fields
		const documentNumber = findClaim(claims, 'document_number');
		const birthDateRaw = findClaim(claims, 'birth_date');
		const birthYear = extractBirthYear(birthDateRaw);

		// Resolve district + cellId from postal code + city + state via Shadow Atlas.
		// Uses the self-hosted Nominatim + H3 pipeline for sub-state precision.
		// PRIVACY BOUNDARY: After this point, raw address fields are no longer used.
		const location = await resolveLocationFromAddress(postalCode, city ?? '', state);

		if (!location.district) {
			return {
				success: false,
				error: 'district_lookup_failed',
				message: 'Could not determine congressional district from OpenID4VP claims'
			};
		}

		const district = location.district;
		const cellId = location.cellId;

		// Compute credential hash for dedup
		const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
		const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataStr));
		const credentialHash = Array.from(new Uint8Array(hashBuffer))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');

		// Identity fields are REQUIRED for sybil-resistant identity commitment.
		if (!documentNumber || !birthYear) {
			return {
				success: false,
				error: 'missing_identity_fields',
				message:
					'Your wallet must share birth date and document number for identity verification. Check your wallet settings or try a different wallet.'
			};
		}

		// Compute identity commitment INSIDE the privacy boundary
		const identityCommitment = await computeIdentityCommitmentInBoundary(documentNumber, birthYear);
		if (!identityCommitment) {
			return {
				success: false,
				error: 'identity_commitment_failed',
				message: 'Identity commitment could not be computed — verifier is not configured'
			};
		}

		return {
			success: true,
			district,
			state,
			credentialHash,
			verificationMethod: 'mdl',
			identityCommitment,
			cellId: cellId ?? undefined
		};
	} catch (err) {
		console.error('[mDL] OpenID4VP processing error:', err);
		return {
			success: false,
			error: 'invalid_format',
			message: 'Failed to process OpenID4VP response'
		};
	}
}

async function processOpenId4VpMsoMdocPresentation(
	presentation: Extract<Oid4vpPresentation, { kind: 'mso_mdoc' }>,
	_originalData: unknown,
	nonce: string,
	options?: MdlVerificationOptions
): Promise<MdlVerificationResult> {
	if (!options?.verifierOrigin && !options?.directPost) {
		return {
			success: false,
			error: 'replay_protection_missing',
			message:
				'OpenID4VP mso_mdoc DeviceResponse requires stored verifier handover SessionTranscript context and DeviceAuth verification before it can be accepted'
		};
	}
	if (options.verifierOrigin && options.directPost) {
		return {
			success: false,
			error: 'invalid_format',
			message: 'OpenID4VP mso_mdoc verifier handover context is ambiguous'
		};
	}

	if (presentation.deviceResponses.length !== 1) {
		return {
			success: false,
			error: 'invalid_format',
			message: 'OpenID4VP mso_mdoc response must contain exactly one mDL DeviceResponse'
		};
	}

	const cbor = await loadCborModule();
	const deviceResponseBytes = base64urlDecode(presentation.deviceResponses[0]);
	const deviceResponse = cbor.decode(deviceResponseBytes);
	const documents = getMdocValue(deviceResponse, 'documents');
	if (!Array.isArray(documents) || documents.length !== 1) {
		return {
			success: false,
			error: 'invalid_format',
			message: 'OpenID4VP mso_mdoc DeviceResponse must contain exactly one mDL document'
		};
	}

	const doc = documents[0];
	const docType = getMdocValue(doc, 'docType');
	if (docType !== 'org.iso.18013.5.1.mDL') {
		return {
			success: false,
			error: 'invalid_format',
			message: 'OpenID4VP mso_mdoc DeviceResponse is not an mDL document'
		};
	}

	const issuerSigned = getMdocValue(doc, 'issuerSigned');
	if (!isMapLikeRecord(issuerSigned)) {
		return { success: false, error: 'invalid_format', message: 'No issuerSigned data' };
	}

	const deviceSigned = getMdocValue(doc, 'deviceSigned');
	if (!isMapLikeRecord(deviceSigned)) {
		return {
			success: false,
			error: 'replay_protection_missing',
			message: 'DeviceAuthentication structure missing — replay protection cannot be evaluated'
		};
	}

	const deviceAuth = getMdocValue(deviceSigned, 'deviceAuth');
	if (!isMapLikeRecord(deviceAuth)) {
		return {
			success: false,
			error: 'replay_protection_missing',
			message: 'DeviceAuthentication structure missing — replay protection cannot be evaluated'
		};
	}

	const issuerAuth = asCoseSign1Array(getMdocValue(issuerSigned, 'issuerAuth'));
	if (!issuerAuth) {
		return {
			success: false,
			error: 'signature_invalid',
			message: 'No issuerAuth in mso_mdoc credential — cannot verify mDL issuer'
		};
	}

	const { verifyCoseSign1, validateMsoDigests, verifyDeviceSignature } =
		await import('./cose-verify');
	const { getIACARootsForVerification, supportedIACAStates } = await import('./iaca-roots');
	const roots = getIACARootsForVerification();
	if (roots.length === 0) {
		return {
			success: false,
			error: 'signature_invalid',
			message: 'No IACA root certificates loaded — cannot verify mDL issuer'
		};
	}

	let coseResult = await verifyCoseSign1(issuerAuth, roots);
	if (
		!coseResult.valid &&
		coseResult.reason === 'Issuer certificate not found in IACA trust store'
	) {
		try {
			const { getExpandedIACARoots } = await import('./vical-service');
			const expandedRoots = await getExpandedIACARoots(options.vicalKv);
			if (expandedRoots.length > roots.length) {
				coseResult = await verifyCoseSign1(issuerAuth, expandedRoots);
			}
		} catch (e) {
			console.warn('[mDL] VICAL fallback failed (continuing with static roots):', e);
		}
	}

	if (!coseResult.valid) {
		if (coseResult.reason === 'Issuer certificate not found in IACA trust store') {
			return {
				success: false,
				error: 'unsupported_state',
				message: `This mDL was issued by a state not yet in our trust store. Supported states: ${supportedIACAStates().join(', ')}`,
				supportedStates: supportedIACAStates()
			};
		}
		return {
			success: false,
			error: 'signature_invalid',
			message: `COSE_Sign1 verification failed: ${coseResult.reason}`
		};
	}

	const msoError = validateOpenId4VpMsoMdocMso(coseResult.mso, docType);
	if (msoError) return msoError;

	const namespacesValue =
		getMdocValue(issuerSigned, 'nameSpaces') ?? getMdocValue(issuerSigned, 'namespaces');
	const namespaceRecord = namespaceElementsToRecord(namespacesValue);
	if (!namespaceRecord) {
		return {
			success: false,
			error: 'missing_fields',
			message: 'No issuer-signed namespaces in mso_mdoc credential'
		};
	}

	const digestsValid = await validateMsoDigests(
		coseResult.mso,
		namespaceRecord,
		cbor.decode,
		(data: unknown) => new Uint8Array(cbor.encode(data))
	);
	if (!digestsValid) {
		return {
			success: false,
			error: 'signature_invalid',
			message: 'MSO digest validation failed — field values do not match signed digests'
		};
	}

	if (!coseResult.mso.deviceKeyInfo?.deviceKey) {
		return {
			success: false,
			error: 'replay_protection_missing',
			message: 'MSO deviceKeyInfo.deviceKey missing — DeviceAuth cannot be verified'
		};
	}

	const deviceSignature = asCoseSign1Array(getMdocValue(deviceAuth, 'deviceSignature'));
	if (!deviceSignature) {
		return {
			success: false,
			error: 'replay_protection_missing',
			message: 'OpenID4VP mso_mdoc DeviceAuth.deviceSignature is required for verification'
		};
	}

	const deviceNameSpacesValue =
		getMdocValue(deviceSigned, 'nameSpaces') ?? getMdocValue(deviceSigned, 'namespaces');
	const deviceNameSpacesBytes = getTaggedCborBytes(deviceNameSpacesValue);
	if (!deviceNameSpacesBytes) {
		return {
			success: false,
			error: 'replay_protection_missing',
			message: 'DeviceSigned.nameSpaces bytes missing — DeviceAuthenticationBytes cannot be rebuilt'
		};
	}

	const sessionTranscript = await buildOpenId4VpMdocSessionTranscript(nonce, options);
	const deviceAuthentication = [
		'DeviceAuthentication',
		sessionTranscript,
		docType,
		taggedCborBytes(24, deviceNameSpacesBytes)
	] as const;
	const deviceAuthenticationBytes = encodeMdocAuthCbor(
		taggedCborBytes(24, encodeMdocAuthCbor(deviceAuthentication))
	);

	const deviceAuthResult = await verifyDeviceSignature(
		deviceSignature,
		coseResult.mso.deviceKeyInfo.deviceKey,
		deviceAuthenticationBytes
	);
	if (!deviceAuthResult.valid) {
		return {
			success: false,
			error: 'signature_invalid',
			message: `DeviceAuth.deviceSignature verification failed: ${deviceAuthResult.reason}`
		};
	}

	const mdlNamespace = namespaceRecord['org.iso.18013.5.1'];
	if (!mdlNamespace) {
		return {
			success: false,
			error: 'missing_fields',
			message: 'No mDL namespace in issuerSigned data'
		};
	}

	const fieldResult = extractMdlFields(mdlNamespace, cbor.decode);
	if (fieldResult.duplicateIdentifier) {
		return duplicateMdlElementResult(fieldResult.duplicateIdentifier);
	}
	const fields = fieldResult.fields;
	const credentialHash = await sha256Hex(deviceResponseBytes);
	return deriveMdlResultFromFields(fields, credentialHash, 'OpenID4VP mso_mdoc');
}

async function decryptOpenId4VpEncryptedResponse(
	jwe: string,
	privateKey: CryptoKey
): Promise<
	| { success: true; payload: unknown }
	| { success: false; result: Extract<MdlVerificationResult, { success: false }> }
> {
	if (!jwe || !isCompactJwe(jwe)) {
		return {
			success: false,
			result: {
				success: false,
				error: 'decryption_failed',
				message: 'OpenID4VP dc_api.jwt response must be a compact JWE'
			}
		};
	}

	try {
		const header = decodeProtectedHeader(jwe);
			if (
				header.alg !== 'ECDH-ES' ||
				header.enc !== 'A256GCM' ||
				header.kid !== '1'
			) {
			return {
				success: false,
				result: {
					success: false,
					error: 'decryption_failed',
					message: 'Unsupported OpenID4VP dc_api.jwt encryption header'
				}
			};
		}
		const { plaintext } = await compactDecrypt(jwe, privateKey);
		const decoded = new TextDecoder().decode(plaintext);
		return { success: true, payload: JSON.parse(decoded) as unknown };
	} catch {
		return {
			success: false,
			result: {
				success: false,
				error: 'decryption_failed',
				message: 'Failed to decrypt OpenID4VP dc_api.jwt response'
			}
		};
	}
}

function isSha256Digest(value: Uint8Array | ArrayBuffer | null | undefined): boolean {
	if (value == null) return false;
	const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
	return bytes.length === 32;
}

async function buildOpenId4VpMdocSessionTranscript(nonce: string, options: MdlVerificationOptions) {
	if (options.directPost) {
		const { buildOpenId4VpDirectSessionTranscript } = await import('./oid4vp-direct-handover');
		const { sessionTranscript } = await buildOpenId4VpDirectSessionTranscript({
			clientId: options.directPost.clientId,
			nonce,
			responseUri: options.directPost.responseUri,
			jwkThumbprint: options.directPost.jwkThumbprint ?? null,
			allowLocalhostHttp: options.directPost.allowLocalhostHttp ?? false
		});
		return sessionTranscript;
	}

	if (options.verifierOrigin) {
		const { buildOpenId4VpDcApiSessionTranscript } = await import('./oid4vp-dc-api-handover');
		const { sessionTranscript } = await buildOpenId4VpDcApiSessionTranscript({
			origin: options.verifierOrigin,
			nonce,
			jwkThumbprint: options.dcApiJwkThumbprint ?? null
		});
		return sessionTranscript;
	}

	throw new Error('OpenID4VP mso_mdoc handover context missing');
}

async function deriveMdlResultFromFields(
	fields: Map<string, string>,
	credentialHash: string,
	source: string
): Promise<MdlVerificationResult> {
	const postalCode = fields.get('resident_postal_code');
	const city = fields.get('resident_city');
	const state = fields.get('resident_state');

	if (!postalCode || !state) {
		return {
			success: false,
			error: 'missing_fields',
			message: `${source} response missing required address fields (postal_code, state)`
		};
	}

	const documentNumber = fields.get('document_number');
	const birthDateRaw = fields.get('birth_date');
	const birthYear = extractBirthYear(birthDateRaw);
	const location = await resolveLocationFromAddress(postalCode, city ?? '', state);

	if (!location.district) {
		return {
			success: false,
			error: 'district_lookup_failed',
			message: `Could not determine congressional district from ${source} claims`
		};
	}

	if (!documentNumber || !birthYear) {
		return {
			success: false,
			error: 'missing_identity_fields',
			message:
				'Your wallet must share birth date and document number for identity verification. Check your wallet settings or try a different wallet.'
		};
	}

	const identityCommitment = await computeIdentityCommitmentInBoundary(documentNumber, birthYear);
	if (!identityCommitment) {
		return {
			success: false,
			error: 'identity_commitment_failed',
			message: 'Identity commitment could not be computed — verifier is not configured'
		};
	}

	return {
		success: true,
		district: location.district,
		state,
		credentialHash,
		verificationMethod: 'mdl',
		identityCommitment,
		cellId: location.cellId ?? undefined
	};
}

function validateOpenId4VpMsoMdocMso(
	mso: { docType?: string; validityInfo: { validFrom: Date; validUntil: Date } },
	expectedDocType: string
): MdlVerificationResult | null {
	if (mso.docType !== expectedDocType) {
		return {
			success: false,
			error: 'signature_invalid',
			message: 'MSO docType does not match the mDL DeviceResponse document type'
		};
	}

	return validateMsoValidity(mso);
}

function validateMsoValidity(mso: {
	validityInfo: { validFrom: Date; validUntil: Date };
}): MdlVerificationResult | null {
	const validFrom = mso.validityInfo.validFrom;
	const validUntil = mso.validityInfo.validUntil;
	const validFromMs = validFrom.getTime();
	const validUntilMs = validUntil.getTime();

	if (
		!Number.isFinite(validFromMs) ||
		!Number.isFinite(validUntilMs) ||
		validFromMs > validUntilMs
	) {
		return {
			success: false,
			error: 'signature_invalid',
			message: 'MSO validityInfo is invalid'
		};
	}

	const now = Date.now();
	const skewMs = 60_000;
	if (validFromMs > now + skewMs) {
		return {
			success: false,
			error: 'invalid_format',
			message: 'mDL MSO is not valid yet'
		};
	}
	if (validUntilMs <= now - skewMs) {
		return {
			success: false,
			error: 'expired',
			message: 'mDL MSO has expired'
		};
	}

	return null;
}

type Oid4vpPresentation =
	| { kind: 'jwt'; token: string }
	| { kind: 'encrypted_response'; jwe: string }
	| { kind: 'mso_mdoc'; credentialId: string; deviceResponses: string[] }
	| { kind: 'unsupported'; message: string };

/**
 * Extract and classify OpenID4VP response payloads.
 *
 * DigitalCredential.data may be:
 * - a raw JWT/SD-JWT string from legacy/test integrations
 * - a JSON string with `{ vp_token: ... }`
 * - a full `{ protocol, data }` DigitalCredential-like envelope
 * - a `dc_api.jwt` authorization response with encrypted `response`
 * - a `mso_mdoc` VP token object like `{ "mdl": ["<base64url DeviceResponse>"] }`
 */
function extractOid4vpPresentation(
	data: unknown,
	expectedProtocol: string,
	depth = 0
): Oid4vpPresentation | null {
	if (depth > 2) {
		return {
			kind: 'unsupported',
			message: 'OpenID4VP response envelope is nested too deeply'
		};
	}

	if (typeof data === 'string') {
		const trimmed = data.trim();
		if (trimmed.startsWith('{')) {
			try {
				const parsed = JSON.parse(trimmed) as unknown;
				return extractOid4vpPresentation(parsed, expectedProtocol, depth);
			} catch {
				return null;
			}
		}
		if (isCompactJwe(trimmed)) {
			return { kind: 'encrypted_response', jwe: trimmed };
		}
		if (isJwtOrSdJwt(trimmed)) {
			return { kind: 'jwt', token: trimmed };
		}
	}

	if (typeof data === 'object' && data !== null) {
		const obj = data as Record<string, unknown>;

		if (typeof obj.protocol === 'string' && obj.protocol !== expectedProtocol) {
			return {
				kind: 'unsupported',
				message: `OpenID4VP response protocol mismatch: expected ${expectedProtocol}, got ${obj.protocol}`
			};
		}

		const hasEncryptedResponse =
			typeof obj.response === 'string' || typeof obj.identityToken === 'string';
		if (hasEncryptedResponse && ('data' in obj || 'vp_token' in obj)) {
			return {
				kind: 'unsupported',
				message: 'OpenID4VP response envelope is ambiguous: contains encrypted response and VP data'
			};
		}

		if (hasEncryptedResponse) {
			return {
				kind: 'encrypted_response',
				jwe: typeof obj.response === 'string' ? obj.response : (obj.identityToken as string)
			};
		}

		if ('data' in obj) {
			if ('vp_token' in obj) {
				return {
					kind: 'unsupported',
					message: 'OpenID4VP response envelope is ambiguous: contains both data and vp_token'
				};
			}
			if (typeof obj.protocol !== 'string') {
				return {
					kind: 'unsupported',
					message: 'OpenID4VP response data envelope is missing protocol'
				};
			}
			const nested = extractOid4vpPresentation(obj.data, expectedProtocol, depth + 1);
			if (nested) return nested;
		}

		const vpToken = obj.vp_token;
		if (typeof vpToken === 'string') {
			if (isCompactJwe(vpToken)) {
				return { kind: 'encrypted_response', jwe: vpToken };
			}
			if (isJwtOrSdJwt(vpToken)) {
				return { kind: 'jwt', token: vpToken };
			}
			return {
				kind: 'unsupported',
				message: 'OpenID4VP vp_token string is not a JWT, SD-JWT, or compact JWE'
			};
		}

		if (typeof vpToken === 'object' && vpToken !== null) {
			const mdocPresentation = extractMsoMdocPresentation(vpToken as Record<string, unknown>);
			if (mdocPresentation) return mdocPresentation;
			return {
				kind: 'unsupported',
				message: 'OpenID4VP vp_token object does not contain an mso_mdoc credential array'
			};
		}
	}

	return null;
}

function isJwtOrSdJwt(token: string): boolean {
	const [jwtPart] = token.split('~');
	return jwtPart.split('.').length === 3;
}

function isCompactJwe(token: string): boolean {
	return token.split('.').length === 5;
}

function extractMsoMdocPresentation(
	vpToken: Record<string, unknown>
): Extract<Oid4vpPresentation, { kind: 'mso_mdoc' }> | null {
	for (const [credentialId, value] of Object.entries(vpToken)) {
		if (
			credentialId === 'mdl' &&
			Array.isArray(value) &&
			value.length > 0 &&
			value.every(isBase64UrlDeviceResponseCandidate)
		) {
			return { kind: 'mso_mdoc', credentialId, deviceResponses: value as string[] };
		}
	}
	return null;
}

function isBase64UrlDeviceResponseCandidate(value: unknown): boolean {
	return typeof value === 'string' && value.length > 16 && /^[A-Za-z0-9_-]+$/.test(value);
}

interface CborModule {
	decode: (data: Uint8Array | ArrayBuffer) => unknown;
	encode: (data: unknown) => ArrayBuffer | Uint8Array;
}

async function loadCborModule(): Promise<CborModule> {
	const cborModule = (await import('cbor-web')) as unknown as {
		default?: Partial<CborModule>;
		decode?: CborModule['decode'];
		encode?: CborModule['encode'];
	};
	const cbor = cborModule.default ?? cborModule;
	if (typeof cbor.decode !== 'function' || typeof cbor.encode !== 'function') {
		throw new Error('cbor-web encode/decode unavailable');
	}
	return {
		decode: cbor.decode,
		encode: cbor.encode
	};
}

function getMdocValue(value: unknown, key: string): unknown {
	if (value instanceof Map) return value.get(key);
	if (isRecord(value)) return value[key];
	return undefined;
}

function isMapLikeRecord(value: unknown): value is Map<unknown, unknown> | Record<string, unknown> {
	return value instanceof Map || isRecord(value);
}

function asCoseSign1Array(value: unknown): unknown[] | null {
	if (Array.isArray(value)) return value;
	if (isRecord(value) && value.tag === 18 && Array.isArray(value.value)) {
		return value.value;
	}
	return null;
}

function namespaceElementsToRecord(value: unknown): Record<string, unknown[]> | null {
	const out: Record<string, unknown[]> = {};

	if (value instanceof Map) {
		for (const [key, elements] of value.entries()) {
			if (typeof key === 'string' && Array.isArray(elements)) {
				out[key] = elements;
			}
		}
	} else if (isRecord(value)) {
		for (const [key, elements] of Object.entries(value)) {
			if (Array.isArray(elements)) {
				out[key] = elements;
			}
		}
	} else {
		return null;
	}

	return Object.keys(out).length > 0 ? out : null;
}

function getTaggedCborBytes(value: unknown): Uint8Array | null {
	if (isRecord(value) && value.tag === 24 && value.value instanceof Uint8Array) {
		return new Uint8Array(value.value);
	}
	return null;
}

interface TaggedCborBytes {
	readonly type: 'tagged-cbor-bytes';
	readonly tag: number;
	readonly bytes: Uint8Array;
}

function taggedCborBytes(tag: number, bytes: Uint8Array): TaggedCborBytes {
	return { type: 'tagged-cbor-bytes', tag, bytes: new Uint8Array(bytes) };
}

type MdocAuthCborValue =
	| string
	| Uint8Array
	| null
	| TaggedCborBytes
	| readonly MdocAuthCborValue[];

function encodeMdocAuthCbor(value: MdocAuthCborValue): Uint8Array {
	if (typeof value === 'string') {
		return encodeCborBytes(3, new TextEncoder().encode(value));
	}
	if (value instanceof Uint8Array) {
		return encodeCborBytes(2, value);
	}
	if (value === null) {
		return new Uint8Array([0xf6]);
	}
	if (isTaggedCborBytes(value)) {
		return concatBytes([encodeCborHead(6, value.tag), encodeCborBytes(2, value.bytes)]);
	}
	if (Array.isArray(value)) {
		return concatBytes([encodeCborHead(4, value.length), ...value.map(encodeMdocAuthCbor)]);
	}
	throw new Error('Unsupported mdoc auth CBOR value');
}

function isTaggedCborBytes(value: unknown): value is TaggedCborBytes {
	return isRecord(value) && value.type === 'tagged-cbor-bytes' && value.bytes instanceof Uint8Array;
}

function encodeCborBytes(majorType: number, bytes: Uint8Array): Uint8Array {
	return concatBytes([encodeCborHead(majorType, bytes.length), bytes]);
}

function encodeCborHead(majorType: number, length: number): Uint8Array {
	if (majorType < 0 || majorType > 7) throw new Error('Invalid CBOR major type');
	if (!Number.isSafeInteger(length) || length < 0) throw new Error('Invalid CBOR length');

	const prefix = majorType << 5;
	if (length < 24) return new Uint8Array([prefix | length]);
	if (length <= 0xff) return new Uint8Array([prefix | 24, length]);
	if (length <= 0xffff) return new Uint8Array([prefix | 25, length >> 8, length & 0xff]);
	if (length <= 0xffffffff) {
		return new Uint8Array([
			prefix | 26,
			(length >>> 24) & 0xff,
			(length >>> 16) & 0xff,
			(length >>> 8) & 0xff,
			length & 0xff
		]);
	}
	throw new Error('CBOR length too large');
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
	const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const out = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify a VP token (JWT or SD-JWT) signature using Web Crypto.
 *
 * For JWT: verifies the header.payload.signature using a leaf certificate from
 * the header's `x5c` chain. The leaf certificate must chain to the same IACA
 * trust store used by the raw mdoc COSE path. Header-provided `jwk` keys are
 * intentionally rejected because they do not establish issuer trust.
 *
 * For SD-JWT: verifies the base JWT signature only (disclosures are
 * bound by the `_sd_alg` hash in the payload).
 */
async function verifyVpTokenSignature(
	token: string
): Promise<{ valid: true } | { valid: false; reason: string }> {
	// Split off SD-JWT disclosures
	const [jwtPart] = token.split('~');
	const segments = jwtPart.split('.');

	if (segments.length !== 3) {
		return { valid: false, reason: 'JWT must have exactly 3 segments (header.payload.signature)' };
	}

	const [headerB64, payloadB64, signatureB64] = segments;

	// Decode header to determine algorithm and key
	let header: Record<string, unknown>;
	try {
		header = JSON.parse(base64urlDecodeString(headerB64)) as Record<string, unknown>;
	} catch {
		return { valid: false, reason: 'Failed to decode JWT header' };
	}

	const alg = header.alg as string;
	if (!alg) {
		return { valid: false, reason: 'JWT header missing alg field' };
	}

	// Map JWT algorithm to Web Crypto parameters
	const algMap: Record<string, { name: string; hash: string; namedCurve?: string }> = {
		ES256: { name: 'ECDSA', hash: 'SHA-256', namedCurve: 'P-256' },
		ES384: { name: 'ECDSA', hash: 'SHA-384', namedCurve: 'P-384' },
		ES512: { name: 'ECDSA', hash: 'SHA-512', namedCurve: 'P-521' }
	};

	const cryptoAlg = algMap[alg];
	if (!cryptoAlg) {
		return {
			valid: false,
			reason: `Unsupported JWT algorithm: ${alg}. Only ECDSA (ES256/ES384/ES512) supported.`
		};
	}

	// Extract public key from a trusted x5c certificate. Do not accept `jwk`:
	// a wallet-controlled key verifies syntax but proves nothing about DMV/IACA issuance.
	let publicKey: CryptoKey;
	try {
		if (header.jwk && typeof header.jwk === 'object') {
			return {
				valid: false,
				reason:
					'OpenID4VP mDL JWT must use an x5c certificate anchored to IACA roots; embedded jwk is not accepted'
			};
		} else if (header.x5c && Array.isArray(header.x5c) && header.x5c.length > 0) {
			const certB64 = header.x5c[0] as string;
			if (typeof certB64 !== 'string' || certB64.length === 0) {
				return { valid: false, reason: 'JWT x5c leaf certificate must be a base64 string' };
			}
			const certDer = base64Decode(certB64);

			const [
				{ getIACARootsForVerification, supportedIACAStates },
				{ verifyCertificateAgainstIacaRoots }
			] = await Promise.all([import('./iaca-roots'), import('./cose-verify')]);
			const roots = getIACARootsForVerification();
			if (roots.length === 0) {
				return {
					valid: false,
					reason: 'No IACA root certificates loaded — cannot verify OpenID4VP issuer'
				};
			}

			const trustResult = await verifyCertificateAgainstIacaRoots(certDer, roots);
			if (!trustResult.trusted) {
				return {
					valid: false,
					reason: `x5c leaf certificate is not anchored to IACA trust store (${trustResult.reason}). Supported states: ${supportedIACAStates().join(', ')}`
				};
			}

			publicKey = await importEcPublicKeyFromCertDer(certDer, cryptoAlg);
		} else {
			return {
				valid: false,
				reason: 'JWT header must contain an x5c certificate chain for issuer verification'
			};
		}
	} catch (err) {
		return {
			valid: false,
			reason: `Failed to import signing key: ${err instanceof Error ? err.message : 'unknown'}`
		};
	}

	// Verify signature
	try {
		const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
		const signature = base64urlDecode(signatureB64);

		// JWT uses raw R||S encoding for ECDSA (not DER)
		const verified = await crypto.subtle.verify(
			{ name: cryptoAlg.name, hash: cryptoAlg.hash },
			publicKey,
			signature as BufferSource,
			signedData as BufferSource
		);

		if (!verified) {
			return { valid: false, reason: 'JWT signature is invalid' };
		}

		return { valid: true };
	} catch (err) {
		return {
			valid: false,
			reason: `Signature verification error: ${err instanceof Error ? err.message : 'unknown'}`
		};
	}
}

/**
 * Import an EC public key from a DER-encoded X.509 certificate.
 * Extracts the SubjectPublicKeyInfo and imports via Web Crypto.
 */
async function importEcPublicKeyFromCertDer(
	certDer: Uint8Array,
	alg: { name: string; namedCurve?: string }
): Promise<CryptoKey> {
	// X.509 certificates contain the SubjectPublicKeyInfo (SPKI) structure.
	// Web Crypto can import SPKI directly from the raw certificate via 'spki' format.
	// However, importKey('spki') expects raw SPKI, not the full certificate.
	// For simplicity, we use the raw format with the full cert and let the runtime handle it.
	// CF Workers supports importing from DER-encoded certificates.
	return crypto.subtle.importKey(
		'spki',
		extractSpkiFromCert(certDer) as BufferSource,
		{ name: alg.name, namedCurve: alg.namedCurve! } as EcKeyImportParams,
		false,
		['verify']
	);
}

/**
 * Extract SubjectPublicKeyInfo (SPKI) from a DER-encoded X.509 certificate.
 * Walks the ASN.1 structure: Certificate → TBSCertificate → subjectPublicKeyInfo.
 *
 * Returns the complete DER-encoded SPKI for Web Crypto importKey('spki').
 */
function extractSpkiFromCert(cert: Uint8Array): Uint8Array {
	let pos = 0;

	// Read a DER tag + length, return { tag, contentStart, contentLength, totalLength }
	function readTL(): { tag: number; contentStart: number; contentLength: number } {
		const tag = cert[pos++];
		let len = cert[pos++];
		if (len & 0x80) {
			const numBytes = len & 0x7f;
			len = 0;
			for (let i = 0; i < numBytes; i++) {
				len = (len << 8) | cert[pos++];
			}
		}
		return { tag, contentStart: pos, contentLength: len };
	}

	// Skip an entire TLV element
	function skip(): void {
		const { contentLength } = readTL();
		pos += contentLength;
	}

	// Outer SEQUENCE (Certificate)
	readTL();
	// TBSCertificate SEQUENCE
	readTL();

	// version [0] EXPLICIT — optional context tag 0xa0
	if (cert[pos] === 0xa0) skip();

	skip(); // serialNumber
	skip(); // signature AlgorithmIdentifier
	skip(); // issuer Name
	skip(); // validity Validity
	skip(); // subject Name

	// subjectPublicKeyInfo — return the complete TLV
	const spkiStart = pos;
	const { contentLength } = readTL();
	pos += contentLength;
	return cert.slice(spkiStart, pos);
}

/**
 * Base64 (standard, NOT base64url) decode to Uint8Array
 */
function base64Decode(b64: string): Uint8Array {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

/**
 * Base64url decode to Uint8Array
 */
function base64urlDecode(b64url: string): Uint8Array {
	// Pad to standard base64
	let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
	while (b64.length % 4) b64 += '=';
	return base64Decode(b64);
}

/**
 * Parse a VP token (JWT or SD-JWT) and extract the payload claims.
 *
 * JWT: header.payload.signature
 * SD-JWT: header.payload.signature~disclosure1~disclosure2~...
 *
 * Disclosures in SD-JWT are base64url-encoded JSON arrays: [salt, name, value]
 */
async function parseVpToken(token: string): Promise<Record<string, unknown> | null> {
	// Split off SD-JWT disclosures if present
	const [jwtPart, ...disclosureParts] = token.split('~');

	// Parse the JWT payload
	const jwtSegments = jwtPart.split('.');
	if (jwtSegments.length < 2) {
		return null;
	}

	const payloadB64 = jwtSegments[1];
	try {
		const payloadJson = base64urlDecodeString(payloadB64);
		const payload = JSON.parse(payloadJson) as Record<string, unknown>;

		// If there are SD-JWT disclosures, merge them into the payload
		if (disclosureParts.some(Boolean)) {
			const valid = await mergeDisclosures(payload, disclosureParts);
			if (!valid) return null;
		}

		return payload;
	} catch {
		return null;
	}
}

/**
 * Merge SD-JWT disclosures into the payload only if each disclosure hash is
 * committed in a signed `_sd` array. This prevents attackers from appending
 * unbound disclosures after the JWT signature.
 *
 * Each disclosure is a base64url-encoded JSON array: [salt, claim_name, claim_value]
 */
async function mergeDisclosures(
	payload: Record<string, unknown>,
	disclosures: string[]
): Promise<boolean> {
	const sdAlg = typeof payload._sd_alg === 'string' ? payload._sd_alg.toLowerCase() : 'sha-256';
	if (sdAlg !== 'sha-256') return false;

	for (const disclosure of disclosures) {
		if (!disclosure) continue; // Skip empty segments (trailing ~)
		try {
			const decoded = JSON.parse(base64urlDecodeString(disclosure));
			if (!Array.isArray(decoded) || decoded.length < 3) {
				return false;
			}
			const [_salt, name, value] = decoded;
			if (typeof name !== 'string' || isUnsafeClaimName(name)) {
				return false;
			}

			const disclosureDigest = await sha256Base64Url(disclosure);
			const target = findDisclosureTarget(payload, disclosureDigest);
			if (!target || Object.prototype.hasOwnProperty.call(target, name)) {
				return false;
			}

			target[name] = value;
		} catch {
			return false;
		}
	}

	return true;
}

function findDisclosureTarget(
	value: unknown,
	disclosureDigest: string
): Record<string, unknown> | null {
	if (!isRecord(value)) return null;

	const sd = value._sd;
	if (Array.isArray(sd) && sd.includes(disclosureDigest)) {
		return value;
	}

	for (const nested of Object.values(value)) {
		const found = findDisclosureTarget(nested, disclosureDigest);
		if (found) return found;
	}

	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnsafeClaimName(name: string): boolean {
	return name === '__proto__' || name === 'constructor' || name === 'prototype';
}

async function sha256Base64Url(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	const bytes = new Uint8Array(digest);
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function validateJwtTemporalClaims(
	claims: Record<string, unknown>
): { error: 'expired' | 'invalid_format'; message: string } | null {
	const now = Math.floor(Date.now() / 1000);
	const skewSeconds = 60;

	const exp = readNumericDateClaim(claims, 'exp');
	if (exp.invalid) return { error: 'invalid_format', message: 'OpenID4VP exp claim is invalid' };
	if (exp.value !== undefined && exp.value <= now - skewSeconds) {
		return { error: 'expired', message: 'OpenID4VP response has expired' };
	}

	const nbf = readNumericDateClaim(claims, 'nbf');
	if (nbf.invalid) return { error: 'invalid_format', message: 'OpenID4VP nbf claim is invalid' };
	if (nbf.value !== undefined && nbf.value > now + skewSeconds) {
		return { error: 'invalid_format', message: 'OpenID4VP response is not valid yet' };
	}

	const iat = readNumericDateClaim(claims, 'iat');
	if (iat.invalid) return { error: 'invalid_format', message: 'OpenID4VP iat claim is invalid' };
	if (iat.value !== undefined && iat.value > now + skewSeconds) {
		return { error: 'invalid_format', message: 'OpenID4VP response was issued in the future' };
	}

	return null;
}

function readNumericDateClaim(
	claims: Record<string, unknown>,
	name: 'exp' | 'nbf' | 'iat'
): { value?: number; invalid?: true } {
	const value = claims[name];
	if (value === undefined || value === null) return {};
	if (typeof value === 'number' && Number.isFinite(value)) return { value };
	if (typeof value === 'string' && /^\d+$/.test(value)) return { value: Number(value) };
	return { invalid: true };
}

/**
 * Find a claim value by name in a claims object.
 * Searches top-level, nested under common mDL namespaces,
 * and inside credentialSubject/claims structures.
 */
function findClaim(claims: Record<string, unknown>, name: string): string | null {
	// Direct top-level claim
	if (typeof claims[name] === 'string') {
		return claims[name] as string;
	}

	// Nested under mDL namespace
	const mdlNs = claims['org.iso.18013.5.1'] as Record<string, unknown> | undefined;
	if (mdlNs && typeof mdlNs[name] === 'string') {
		return mdlNs[name] as string;
	}

	// Nested under credentialSubject
	const subject = claims.credentialSubject as Record<string, unknown> | undefined;
	if (subject && typeof subject[name] === 'string') {
		return subject[name] as string;
	}

	const nestedClaims = claims.claims as Record<string, unknown> | undefined;
	if (nestedClaims && typeof nestedClaims[name] === 'string') {
		return nestedClaims[name] as string;
	}

	// Nested under vc.credentialSubject
	const vc = claims.vc as Record<string, unknown> | undefined;
	if (vc) {
		const vcSubject = vc.credentialSubject as Record<string, unknown> | undefined;
		if (vcSubject && typeof vcSubject[name] === 'string') {
			return vcSubject[name] as string;
		}
	}

	return null;
}

/**
 * Decode a base64url-encoded string to UTF-8 text.
 * Handles missing padding and url-safe characters.
 */
function base64urlDecodeString(str: string): string {
	// Convert base64url to standard base64
	let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
	// Add padding
	while (base64.length % 4 !== 0) {
		base64 += '=';
	}
	return atob(base64);
}

/**
 * Resolve congressional district AND cell ID from (postalCode, city, state) via Shadow Atlas.
 *
 * Fully sovereign pipeline:
 *   1. Self-hosted Nominatim geocode (city, state, zip → coordinates)
 *   2. H3 + IPFS district lookup (coordinates → district + cell_id)
 *
 * PRIVACY: city/state/zip sent to self-hosted Nominatim (our infrastructure, not a third party).
 *
 * This is the primary resolver for both mDL verification (postal_code + city + state from
 * the credential) and manual address entry (street geocoded separately via resolveAddress).
 * ZIP alone is insufficient — ~94% of Americans live in multi-district states where ZIP
 * codes can span congressional boundaries.
 */
async function resolveLocationFromAddress(
	postalCode: string,
	city: string,
	state: string
): Promise<{ district: string | null; cellId: string | null }> {
	try {
		const { resolveAddress } = await import('$lib/core/shadow-atlas/client');
		const result = await resolveAddress({
			street: '',
			city,
			state,
			zip: postalCode
		});

		const district = result.officials?.district_code ?? result.district?.id ?? null;
		const cellId = result.cell_id ?? null;

		// No silent XX-AL fallback: returning an at-large code for users in multi-district
		// states is the same bug that state-first-match encoded. If Shadow Atlas can't place
		// the address, fail and let the caller prompt the user to correct their address.
		return { district, cellId };
	} catch (err) {
		console.error('[mDL] Location resolution failed:', err instanceof Error ? err.message : err);
		return { district: null, cellId: null };
	}
}

/**
 * Resolve cell ID from address via Shadow Atlas geocoding.
 *
 * Exported for backward compatibility and direct use by tests.
 * Delegates to Shadow Atlas's sovereign Nominatim + H3 pipeline.
 *
 * Non-fatal: returns null on any failure. Shadow Atlas registration is deferred.
 */
export async function resolveCellIdFromAddress(
	postalCode: string,
	city: string,
	state: string
): Promise<string | null> {
	const result = await resolveLocationFromAddress(postalCode, city, state);
	return result.cellId;
}

/**
 * Extract birth year from various birth_date formats.
 *
 * ISO 18013-5 birth_date may be:
 * - CBOR tag 1004 full-date string: "1990-05-15" (decoded by cbor-web as string)
 * - Plain CBOR integer: year directly (e.g. 1990) or Unix timestamp
 * - extractMdlFields converts everything to String() — so we handle both
 */
function extractBirthYear(raw: string | null | undefined): number | undefined {
	if (!raw) return undefined;

	// Check if it's a numeric string that could be a year or Unix timestamp
	const numValue = Number(raw);
	if (!isNaN(numValue) && Number.isInteger(numValue)) {
		// Direct year (1900-2099 range)
		if (numValue >= 1900 && numValue <= 2099) return numValue;
		// Unix timestamp (seconds since epoch) — convert to year
		if (numValue > 100000000) {
			const d = new Date(numValue * 1000);
			return isNaN(d.getTime()) ? undefined : d.getUTCFullYear();
		}
	}

	// ISO 8601 date string: "YYYY-MM-DD" or "YYYY"
	const yearMatch = raw.match(/^(\d{4})/);
	return yearMatch ? parseInt(yearMatch[1], 10) : undefined;
}

/**
 * Compute identity commitment INSIDE the privacy boundary.
 *
 * Uses the same pipeline as identity-binding.ts computeIdentityCommitment():
 * SHA-256(SHA-256(domain:salt:documentNumber:US:birthYear:mdl)) mod BN254
 *
 * This function is called within processMdocResponse/processOid4vpResponse
 * so that raw identity fields never leave the privacy boundary.
 */
async function computeIdentityCommitmentInBoundary(
	documentNumber: string,
	birthYear: number
): Promise<string | null> {
	// FROZEN: changing this prefix would invalidate all existing identity commitments
	const DOMAIN_PREFIX = 'commons-identity-v1';
	const COMMITMENT_SALT = process.env.IDENTITY_COMMITMENT_SALT;

	if (!COMMITMENT_SALT) {
		console.error('[mDL] IDENTITY_COMMITMENT_SALT not configured — identity commitment failed');
		return null;
	}

	// Normalize inputs identically to identity-binding.ts computeIdentityCommitment()
	const normalized = [
		DOMAIN_PREFIX,
		COMMITMENT_SALT,
		documentNumber.toUpperCase().trim(),
		'US', // mDL is US-only
		birthYear.toString(),
		'mdl'
	].join(':');

	// Double-hash with domain separation for preimage resistance
	const innerBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
	const outerBuf = await crypto.subtle.digest('SHA-256', innerBuf);
	const rawHex = Array.from(new Uint8Array(outerBuf))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');

	// Reduce mod BN254 — ensures valid field element for ZK circuit
	const BN254_MODULUS =
		21888242871839275222246405745257275088548364400416034343698204186575808495617n;
	const value = BigInt('0x' + rawHex);
	const reduced = value % BN254_MODULUS;
	return reduced.toString(16).padStart(64, '0');
}

/** Convert base64 string to Uint8Array */
function base64ToUint8Array(base64: string): Uint8Array {
	const binaryString = atob(base64);
	const bytes = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}
	return bytes;
}
