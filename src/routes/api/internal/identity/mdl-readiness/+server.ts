import { dev } from '$app/environment';
import { json, error } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { CompactEncrypt, importJWK } from 'jose';
import type { RequestHandler } from './$types';
import { verifyCronSecretRaw } from '$lib/server/cron-auth';
import { FEATURES, OPENID4VP_DC_API_PROTOCOL } from '$lib/config/features';
import { processCredentialResponse } from '$lib/core/identity/mdl-verification';
import {
	DC_API_OPENID4VP_RESPONSE_MODE,
	buildDcApiOpenId4VpRequestPayload,
	calculateJwkThumbprintBytes,
	getDcApiOpenId4VpSignerConfig,
	signDcApiOpenId4VpRequest,
	validateDcApiOpenId4VpSignerConfig
} from '$lib/server/dc-api-openid4vp-request';

type CheckStatus = 'ok' | 'warning' | 'blocked';

type ReadinessCheck = {
	id: string;
	status: CheckStatus;
	message: string;
};

type SmokeEnv = NonNullable<App.Platform['env']>;

export const GET: RequestHandler = async ({ request, platform, url }) => {
	requireInternalSecret(request);

	const smokeEnv = platform?.env as SmokeEnv | undefined;
	const requestOrigin = readinessRequestOrigin(request, url.origin);
	const originCheck = checkPublicAppUrl(smokeEnv?.PUBLIC_APP_URL, requestOrigin);
	const dcSessionKvCheck = await checkDcSessionKv(smokeEnv?.DC_SESSION_KV);
	const dcApiSignerCheck =
		originCheck.check.status === 'ok'
			? await checkDcApiRequestSigner(smokeEnv, originCheck.origin)
			: blockedDcApiRequestSignerCheck();
	const checks: ReadinessCheck[] = [
		checkBoolean('openid4vp_enabled', FEATURES.MDL_ANDROID_OID4VP, 'OpenID4VP is enabled'),
		checkBoolean(
			'openid4vp_signed_protocol',
			OPENID4VP_DC_API_PROTOCOL === 'openid4vp-v1-signed',
			'Browser-mediated OpenID4VP uses the signed DC API protocol'
		),
			checkBoolean('raw_mdoc_disabled', !FEATURES.MDL_MDOC, 'Raw org-iso-mdoc remains disabled'),
			checkBoolean('ios_lane_disabled', !FEATURES.MDL_IOS, 'iOS lane remains disabled'),
			originCheck.check,
			dcSessionKvCheck,
			dcApiSignerCheck
		];

	const blockers = checks.filter((check) => check.status === 'blocked');
	const warnings = checks.filter((check) => check.status === 'warning');
	const status = blockers.length === 0 ? 'ok' : 'blocked';

	return json(
		{
			status,
			checks,
			blockers: blockers.map((check) => check.id),
			warnings: warnings.map((check) => check.id),
			featureFlags: {
				MDL_ANDROID_OID4VP: FEATURES.MDL_ANDROID_OID4VP,
				MDL_MDOC: FEATURES.MDL_MDOC,
				MDL_IOS: FEATURES.MDL_IOS
			},
			bindings: {
				DC_SESSION_KV: Boolean(smokeEnv?.DC_SESSION_KV)
			},
			digitalCredentials: {
				protocol: OPENID4VP_DC_API_PROTOCOL,
				responseMode: DC_API_OPENID4VP_RESPONSE_MODE,
				requestObject: 'signed'
			}
		},
		{ status: status === 'ok' ? 200 : 503 }
	);
};

function requireInternalSecret(request: Request): void {
	const expected = privateEnv.INTERNAL_API_SECRET;
	if (!expected) throw error(503, 'INTERNAL_API_SECRET not configured');
	const provided = request.headers.get('x-internal-secret');
	if (!verifyCronSecretRaw(provided, expected)) throw error(403, 'Invalid internal secret');
}

function readinessRequestOrigin(request: Request, fallback: string): string {
	const override = request.headers.get('x-readiness-origin')?.trim();
	if (!override) return fallback;
	try {
		return new URL(override).origin;
	} catch {
		return fallback;
	}
}

function checkBoolean(id: string, ok: boolean, message: string): ReadinessCheck {
	return {
		id,
		status: ok ? 'ok' : 'blocked',
		message: ok ? message : `${message} is not true`
	};
}

async function checkDcSessionKv(kv: KVNamespace | undefined): Promise<ReadinessCheck> {
	if (!kv) {
		return {
			id: 'dc_session_kv',
			status: 'blocked',
			message: 'DC_SESSION_KV is not bound'
		};
	}

	const probeKey = `mdl-readiness:${Date.now()}:${randomHex(8)}`;
	try {
		await kv.put(probeKey, 'ok', { expirationTtl: 60 });
		const value = await kv.get(probeKey);
		await kv.delete(probeKey);
		if (value !== 'ok') throw new Error('KV_READ_MISMATCH');
		return {
			id: 'dc_session_kv',
			status: 'ok',
			message: 'DC_SESSION_KV can write, read, and delete verifier sessions'
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : 'KV_UNAVAILABLE';
		return {
			id: 'dc_session_kv',
			status: 'blocked',
			message: `DC_SESSION_KV lifecycle probe failed: ${message}`
		};
	}
}

function checkPublicAppUrl(configuredOrigin: string | undefined, requestOrigin: string) {
	const origin = configuredOrigin ?? (dev ? requestOrigin : undefined);
	if (!origin) {
		return {
			origin: undefined,
			check: {
				id: 'public_app_url',
				status: 'blocked',
				message: 'PUBLIC_APP_URL is required for deployed mDL verifier origins'
			} satisfies ReadinessCheck
		};
	}

	let parsed: URL;
	try {
		parsed = new URL(origin);
	} catch {
		return {
			origin: undefined,
			check: {
				id: 'public_app_url',
				status: 'blocked',
				message: 'PUBLIC_APP_URL is not a valid URL'
			} satisfies ReadinessCheck
		};
	}

	const localhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
	if (parsed.protocol !== 'https:' && !(dev && parsed.protocol === 'http:' && localhost)) {
		return {
			origin: undefined,
			check: {
				id: 'public_app_url',
				status: 'blocked',
				message: 'PUBLIC_APP_URL must use HTTPS outside local development'
			} satisfies ReadinessCheck
		};
	}

	if (!dev && parsed.origin !== requestOrigin) {
		return {
			origin: undefined,
			check: {
				id: 'public_app_url',
				status: 'blocked',
				message: 'PUBLIC_APP_URL must match the smoke-test request origin'
			} satisfies ReadinessCheck
		};
	}

	return {
		origin: parsed.origin,
		check: {
			id: 'public_app_url',
			status: 'ok',
			message: 'PUBLIC_APP_URL is a valid verifier origin'
		} satisfies ReadinessCheck
	};
}

function blockedDcApiRequestSignerCheck(): ReadinessCheck {
	return {
		id: 'dc_api_request_signer',
		status: 'blocked',
		message: 'OpenID4VP Request Object signer cannot be checked until PUBLIC_APP_URL passes'
	};
}

async function checkDcApiRequestSigner(
	smokeEnv: SmokeEnv | undefined,
	origin: string | undefined
): Promise<ReadinessCheck> {
	if (!origin) {
		return {
			id: 'dc_api_request_signer',
			status: 'blocked',
			message: 'OpenID4VP Request Object signer cannot be checked without PUBLIC_APP_URL'
		};
	}

	try {
		const config = getDcApiOpenId4VpSignerConfig(smokeEnv);
		const now = Date.now();
		await validateDcApiOpenId4VpSignerConfig(config, { now });
		const keyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
			'deriveKey',
			'deriveBits'
		]);
		const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
		const jwkThumbprint = await calculateJwkThumbprintBytes(publicJwk);
		const payload = await buildDcApiOpenId4VpRequestPayload({
			nonce: 'readinessNonce0001',
			origin,
			encryptionPublicJwk: publicJwk,
			leafCertificateX5c: config.x5c[0]
		});
		await signDcApiOpenId4VpRequest(payload, config, {
			now,
			expiresAt: now + 300_000
		});
		await checkDcApiEncryptedResponseHandling({
			origin,
			privateKey: keyPair.privateKey,
			publicJwk,
			jwkThumbprint
		});
			return {
				id: 'dc_api_request_signer',
				status: 'ok',
				message:
					'OpenID4VP Request Object signer imports, signs, and extracts encrypted dc_api.jwt envelopes'
			};
	} catch (err) {
		const message = err instanceof Error ? err.message : 'MDL_OPENID4VP_SIGNER_UNAVAILABLE';
		return {
			id: 'dc_api_request_signer',
			status: 'blocked',
			message: `OpenID4VP Request Object signer failed readiness: ${message}`
		};
	}
}

async function checkDcApiEncryptedResponseHandling(input: {
	origin: string;
	privateKey: CryptoKey;
	publicJwk: JsonWebKey;
	jwkThumbprint: Uint8Array;
}): Promise<void> {
	const encryptedResponse = await encryptReadinessDcApiJwt(
		{ vp_token: { mdl: [] } },
		input.publicJwk
	);
	const result = await processCredentialResponse(
		JSON.stringify({ response: encryptedResponse }),
		OPENID4VP_DC_API_PROTOCOL,
		input.privateKey,
		'readinessNonce0001',
		{
			verifierOrigin: input.origin,
			dcApiJwkThumbprint: input.jwkThumbprint
		}
	);

	if (result.success || result.error !== 'invalid_format' || !result.message.includes('mso_mdoc')) {
			throw new Error('MDL_OPENID4VP_ENCRYPTED_RESPONSE_PROBE_FAILED');
		}
}

function randomHex(byteLength: number): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

async function encryptReadinessDcApiJwt(payload: unknown, publicJwk: JsonWebKey): Promise<string> {
	const encryptionKey = await importJWK(
		{
			kty: publicJwk.kty,
			crv: publicJwk.crv,
			x: publicJwk.x,
			y: publicJwk.y,
			use: 'enc',
			kid: '1',
			alg: 'ECDH-ES'
		},
		'ECDH-ES'
	);
	const payloadBytes = Uint8Array.from(new TextEncoder().encode(JSON.stringify(payload)));
	return new CompactEncrypt(payloadBytes)
		.setProtectedHeader({ alg: 'ECDH-ES', enc: 'A256GCM', kid: '1' })
		.encrypt(encryptionKey);
}
