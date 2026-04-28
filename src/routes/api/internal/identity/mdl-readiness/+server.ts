import { dev } from '$app/environment';
import { json, error } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { verifyCronSecretRaw } from '$lib/server/cron-auth';
import {
	FEATURES,
	MDL_DIRECT_QR_ALLOWED_ORIGIN,
	OPENID4VP_DC_API_PROTOCOL,
	isMdlDirectQrEnabled
} from '$lib/config/features';
import {
	DIRECT_MDL_SESSION_TTL_SECONDS,
	DIRECT_MDL_TRANSPORT,
	type DirectMdlSession
} from '$lib/server/direct-mdl-session';
import {
	DIRECT_MDL_REQUEST_OBJECT_CONTENT_TYPE,
	DIRECT_MDL_REQUEST_URI_METHOD,
	getDirectMdlRequestObjectSignerConfig,
	signDirectMdlRequestObject,
	validateDirectMdlRequestObjectSignerConfig
} from '$lib/server/direct-mdl-request-object';
import {
	DC_API_OPENID4VP_RESPONSE_MODE,
	buildDcApiOpenId4VpRequestPayload,
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
	const directQrEnabled = isMdlDirectQrEnabled();
	const directOriginCheck = directQrEnabled
		? checkAllowedDirectOrigin(originCheck.origin)
		: optionalDirectQrCheck('direct_qr_allowed_origin', 'Direct QR origin policy is disabled');
	const dcApiSignerCheck =
		originCheck.check.status === 'ok'
			? await checkDcApiRequestSigner(smokeEnv, originCheck.origin)
			: blockedDcApiRequestSignerCheck();
	const signerCheck =
		directQrEnabled && originCheck.check.status === 'ok' && directOriginCheck.status === 'ok'
			? await checkDirectRequestSigner(smokeEnv, originCheck.origin)
			: directQrEnabled
				? blockedDirectRequestSignerCheck()
				: optionalDirectQrCheck('direct_request_signer', 'Direct QR signer is disabled');
	const checks: ReadinessCheck[] = [
		checkBoolean('openid4vp_enabled', FEATURES.MDL_ANDROID_OID4VP, 'OpenID4VP is enabled'),
		checkBoolean(
			'openid4vp_signed_protocol',
			OPENID4VP_DC_API_PROTOCOL === 'openid4vp-v1-signed',
			'Browser-mediated OpenID4VP uses the signed DC API protocol'
		),
		checkOptionalBoolean('direct_qr_enabled', directQrEnabled, 'Direct OpenID4VP QR is enabled'),
		checkBoolean('raw_mdoc_disabled', !FEATURES.MDL_MDOC, 'Raw org-iso-mdoc remains disabled'),
		checkBoolean('ios_lane_disabled', !FEATURES.MDL_IOS, 'iOS lane remains disabled'),
		originCheck.check,
		directOriginCheck,
		checkKvBinding('dc_session_kv', Boolean(smokeEnv?.DC_SESSION_KV), 'DC_SESSION_KV is bound'),
		dcApiSignerCheck,
		directQrEnabled
			? checkDirectSessionKvBinding(smokeEnv, originCheck.origin)
			: optionalDirectQrCheck('direct_mdl_session_kv', 'Direct QR session KV is disabled'),
		signerCheck
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
				MDL_DIRECT_QR: FEATURES.MDL_DIRECT_QR,
				MDL_MDOC: FEATURES.MDL_MDOC,
				MDL_IOS: FEATURES.MDL_IOS
			},
			bindings: {
				DC_SESSION_KV: Boolean(smokeEnv?.DC_SESSION_KV),
				DIRECT_MDL_SESSION_KV: Boolean(smokeEnv?.DIRECT_MDL_SESSION_KV)
			},
			directRequest: directQrEnabled
				? {
						authorizationRequestScheme: 'openid4vp://authorize',
						allowedOrigin: MDL_DIRECT_QR_ALLOWED_ORIGIN ?? null,
						requestUriMethod: DIRECT_MDL_REQUEST_URI_METHOD,
						requestObjectContentType: DIRECT_MDL_REQUEST_OBJECT_CONTENT_TYPE,
						responseMode: DIRECT_MDL_TRANSPORT,
						walletNonceRequired: true,
						sessionTtlSeconds: DIRECT_MDL_SESSION_TTL_SECONDS
					}
				: null,
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

function checkAllowedDirectOrigin(origin: string | undefined): ReadinessCheck {
	if (!isMdlDirectQrEnabled()) {
		return {
			id: 'direct_qr_allowed_origin',
			status: 'blocked',
			message: 'Direct QR allowed origin cannot be checked while direct QR is disabled'
		};
	}
	if (!MDL_DIRECT_QR_ALLOWED_ORIGIN) {
		return {
			id: 'direct_qr_allowed_origin',
			status: 'blocked',
			message: 'Direct QR allowed origin is not configured'
		};
	}
	if (!origin || origin !== MDL_DIRECT_QR_ALLOWED_ORIGIN) {
		return {
			id: 'direct_qr_allowed_origin',
			status: 'blocked',
			message: 'Direct QR allowed origin must match PUBLIC_APP_URL and the request origin'
		};
	}
	return {
		id: 'direct_qr_allowed_origin',
		status: 'ok',
		message: 'Direct QR allowed origin matches the deployment origin'
	};
}

function checkBoolean(id: string, ok: boolean, message: string): ReadinessCheck {
	return {
		id,
		status: ok ? 'ok' : 'blocked',
		message: ok ? message : `${message} is not true`
	};
}

function checkOptionalBoolean(id: string, ok: boolean, message: string): ReadinessCheck {
	return {
		id,
		status: ok ? 'ok' : 'warning',
		message: ok ? message : `${message} is disabled`
	};
}

function optionalDirectQrCheck(id: string, message: string): ReadinessCheck {
	return { id, status: 'warning', message };
}

function checkKvBinding(id: string, ok: boolean, message: string): ReadinessCheck {
	if (!ok) {
		return {
			id,
			status: 'blocked',
			message: `${id} is not bound`
		};
	}
	return {
		id,
		status: message.includes('fallback') ? 'warning' : 'ok',
		message
	};
}

function checkDirectSessionKvBinding(
	smokeEnv: SmokeEnv | undefined,
	origin: string | undefined
): ReadinessCheck {
	if (smokeEnv?.DIRECT_MDL_SESSION_KV) {
		return {
			id: 'direct_mdl_session_kv',
			status: 'ok',
			message: 'DIRECT_MDL_SESSION_KV is bound'
		};
	}
	if (origin === 'https://commons.email') {
		return {
			id: 'direct_mdl_session_kv',
			status: 'blocked',
			message: 'DIRECT_MDL_SESSION_KV is required for production direct QR'
		};
	}
	if (smokeEnv?.DC_SESSION_KV) {
		return {
			id: 'direct_mdl_session_kv',
			status: 'warning',
			message: 'Direct sessions will use DC_SESSION_KV fallback'
		};
	}
	return {
		id: 'direct_mdl_session_kv',
		status: 'blocked',
		message: 'direct_mdl_session_kv is not bound'
	};
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
		return {
			id: 'dc_api_request_signer',
			status: 'ok',
			message: 'OpenID4VP Request Object signer imports and signs'
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

function blockedDirectRequestSignerCheck(): ReadinessCheck {
	return {
		id: 'direct_request_signer',
		status: 'blocked',
		message: 'Direct Request Object signer cannot be checked until direct QR origin policy passes'
	};
}

async function checkDirectRequestSigner(
	smokeEnv: SmokeEnv | undefined,
	origin: string | undefined
): Promise<ReadinessCheck> {
	if (!origin) {
		return {
			id: 'direct_request_signer',
			status: 'blocked',
			message: 'Direct Request Object signer cannot be checked without PUBLIC_APP_URL'
		};
	}

	try {
		const config = getDirectMdlRequestObjectSignerConfig(smokeEnv);
		const now = Date.now();
		const hostname = new URL(origin).hostname;
		await validateDirectMdlRequestObjectSignerConfig(config, hostname, { now });
		const session: DirectMdlSession = {
			id: '00000000-0000-4000-8000-000000000000',
			desktopUserId: 'mdl-readiness',
			transport: DIRECT_MDL_TRANSPORT,
			clientId: `x509_san_dns:${new URL(origin).hostname}`,
			responseUri: new URL('/api/identity/direct-mdl/complete', origin).toString(),
			requestUri: new URL(
				'/api/identity/direct-mdl/request/00000000-0000-4000-8000-000000000000',
				origin
			).toString(),
			nonce: 'readinessNonce0001',
			state: 'readinessState0001',
			transactionId: 'readinessTxn0001',
			status: 'created',
			createdAt: now,
			expiresAt: now + DIRECT_MDL_SESSION_TTL_SECONDS * 1000
		};
		await signDirectMdlRequestObject(session, config, {
			now,
			expectedRequestUri: session.requestUri,
			expectedResponseUri: session.responseUri
		});
		return {
			id: 'direct_request_signer',
			status: 'ok',
			message: 'Direct Request Object signer imports and signs'
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : 'DIRECT_MDL_SIGNER_UNAVAILABLE';
		return {
			id: 'direct_request_signer',
			status: 'blocked',
			message: `Direct Request Object signer failed readiness: ${message}`
		};
	}
}
