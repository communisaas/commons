import type { Handle } from '@sveltejs/kit';
import { matchPublicDiscoveryManifestRefreshSecretValues } from '$lib/server/public-discovery-manifest-refresh-auth';
import { matchInternalSecretValues } from '$lib/server/internal/secret-auth';
import { PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX } from '$lib/server/public-template-og-queue';
import {
	isAttestedPublicDiscoveryBootstrapRequest,
	isPublicDiscoveryBootstrapAttempt,
	PUBLIC_DISCOVERY_BOOTSTRAP_COMPLETION_PATH,
	PUBLIC_DISCOVERY_BOOTSTRAP_GENERATION_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE,
	PUBLIC_DISCOVERY_BOOTSTRAP_SEED_PURPOSE
} from '$lib/server/public-discovery-bootstrap-runtime';

const BUILD_RELEASE_SHA = import.meta.env.VITE_RELEASE_SHA as string | undefined;

export const PUBLIC_DISCOVERY_MANIFEST_REFRESH_PATH =
	'/api/internal/public-discovery-manifest-refresh';

const PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_URL =
	'https://public-discovery-manifest-refresh-gate.internal/reserve';
const PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_COMPLETION_URL =
	'https://public-discovery-manifest-refresh-gate.internal/complete';
const PUBLIC_DISCOVERY_BOOTSTRAP_COMPLETION_URL = `https://public-discovery-manifest-refresh-gate.internal${PUBLIC_DISCOVERY_BOOTSTRAP_COMPLETION_PATH}`;
const PUBLIC_TEMPLATE_OG_QUEUE_ATTEMPT_RESERVATION_URL =
	'https://public-discovery-manifest-refresh-gate.internal/reserve-og-queue-attempts';
const PUBLIC_TEMPLATE_OG_RELEASE_SHA_HEADER = 'x-public-template-og-release-sha';
const PUBLIC_TEMPLATE_OG_RELEASE_TRANSACTION_HEADER = 'x-public-template-og-release-transaction';
// At the account-wide 100,000-request Free ceiling, 750 ms × 128 MiB stays
// below the 13,000 GB-s/day Durable Object allocation even as a conservative
// client-deadline proxy. The synchronous SQLite handler should finish far sooner.
const PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_TIMEOUT_MS = 750;
export const PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL = '3';
export const PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL_HEADER =
	'x-public-discovery-refresh-gate-protocol';
export const PUBLIC_DISCOVERY_MANIFEST_REFRESH_RETRY_MAX_SECONDS = 300;
export const PUBLIC_DISCOVERY_PAGE_BACKFILL_CONTINUATION_HEADER =
	'x-public-discovery-page-backfill-continuation';
export const PUBLIC_DISCOVERY_PAGE_BACKFILL_CONTINUATION_RETRY_SECONDS = 120;
export const PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PURPOSE_HEADER =
	'x-public-discovery-refresh-purpose';
export const PUBLIC_DISCOVERY_MANIFEST_REFRESH_LEASE_HEADER = 'x-public-discovery-refresh-lease';
export const PUBLIC_DISCOVERY_MANIFEST_REFRESH_COMPLETION_HEADER =
	'x-public-discovery-refresh-completion';
const PUBLIC_DISCOVERY_MANIFEST_REFRESH_DEPLOY_SEED_PURPOSE =
	PUBLIC_DISCOVERY_BOOTSTRAP_SEED_PURPOSE;
export const PUBLIC_DISCOVERY_MANIFEST_REFRESH_PAGE_CONTINUATION_PURPOSE =
	'page-backfill-continuation';
const PUBLIC_DISCOVERY_BOOTSTRAP_PRODUCTION_REALM =
	'backend=https://quirky-chinchilla-352.convex.cloud';
const PUBLIC_DISCOVERY_BOOTSTRAP_RESPONSE_MAXIMUM_BYTES = 4 * 1024;
const PUBLIC_DISCOVERY_BOOTSTRAP_GENERATION_PATTERN =
	/^list=([1-9][0-9]{0,19}):((?:0|[1-9][0-9]{0,15}));relations=([1-9][0-9]{0,19}):((?:0|[1-9][0-9]{0,15}))$/u;

type RefreshGateStub = {
	fetch(request: Request): Promise<Response>;
};

function rejection(status: 401 | 405 | 503, message: string): Response {
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: {
			'cache-control': 'no-store',
			'content-type': 'application/json; charset=utf-8',
			...(status === 405 ? { allow: 'POST' } : {})
		}
	});
}

function coalesced(retryAfterSeconds: number): Response {
	return new Response(
		JSON.stringify({
			coalesced: true,
			gateProtocol: PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL,
			ok: true,
			retryAfterSeconds
		}),
		{
			status: 202,
			headers: {
				'cache-control': 'no-store',
				'content-type': 'application/json; charset=utf-8',
				[PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL_HEADER]:
					PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL,
				'retry-after': String(retryAfterSeconds)
			}
		}
	);
}

function boundedRetryAfter(value: string | null): number | null {
	if (value === null || !/^\d{1,3}$/.test(value)) return null;
	const seconds = Number(value);
	return Number.isSafeInteger(seconds) &&
		seconds >= 1 &&
		seconds <= PUBLIC_DISCOVERY_MANIFEST_REFRESH_RETRY_MAX_SECONDS
		? seconds
		: null;
}

async function boundedResponseText(response: Response, maximumBytes: number): Promise<string> {
	if (!response.body) return '';
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let bytes = 0;
	let result = '';
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > maximumBytes) {
				await reader.cancel();
				throw new Error('RESPONSE_TOO_LARGE');
			}
			result += decoder.decode(value, { stream: true });
		}
		result += decoder.decode();
		return result;
	} finally {
		reader.releaseLock();
	}
}

function exactObjectKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function checkedReadyFamily(value: unknown): { revision: number; withdrawalEpoch: number } | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const family = value as Record<string, unknown>;
	if (
		!exactObjectKeys(family, ['ready', 'retiredRevision', 'revision', 'withdrawalEpoch']) ||
		family.ready !== true ||
		!Number.isSafeInteger(family.revision) ||
		(family.revision as number) < 1 ||
		!Number.isSafeInteger(family.retiredRevision) ||
		(family.retiredRevision as number) < 0 ||
		(family.retiredRevision as number) >= (family.revision as number) ||
		!Number.isSafeInteger(family.withdrawalEpoch) ||
		(family.withdrawalEpoch as number) < 0
	) {
		return null;
	}
	return {
		revision: family.revision as number,
		withdrawalEpoch: family.withdrawalEpoch as number
	};
}

async function checkedBootstrapReadyGeneration(response: Response): Promise<string | null> {
	if (
		response.status !== 200 ||
		response.headers.get('cache-control') !== 'no-store' ||
		!/^application\/json(?:;\s*charset=utf-8)?$/iu.test(
			response.headers.get('content-type') ?? ''
		) ||
		response.headers.has(PUBLIC_DISCOVERY_PAGE_BACKFILL_CONTINUATION_HEADER) ||
		response.headers.has('retry-after')
	) {
		return null;
	}
	let source: string;
	try {
		source = await boundedResponseText(
			response.clone(),
			PUBLIC_DISCOVERY_BOOTSTRAP_RESPONSE_MAXIMUM_BYTES
		);
	} catch {
		return null;
	}
	let value: unknown;
	try {
		value = JSON.parse(source);
	} catch {
		return null;
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const body = value as Record<string, unknown>;
	if (!exactObjectKeys(body, ['generation', 'list', 'ok', 'relations']) || body.ok !== true) {
		return null;
	}
	const list = checkedReadyFamily(body.list);
	const relations = checkedReadyFamily(body.relations);
	if (!list || !relations || typeof body.generation !== 'string') return null;
	const match = PUBLIC_DISCOVERY_BOOTSTRAP_GENERATION_PATTERN.exec(body.generation);
	if (
		!match ||
		!match.slice(1).every((coordinate) => Number.isSafeInteger(Number(coordinate))) ||
		Number(match[1]) !== list.revision ||
		Number(match[2]) !== list.withdrawalEpoch ||
		Number(match[3]) !== relations.revision ||
		Number(match[4]) !== relations.withdrawalEpoch ||
		response.headers.get(PUBLIC_DISCOVERY_BOOTSTRAP_GENERATION_HEADER) !== body.generation
	) {
		return null;
	}
	return body.generation;
}

function backendGateRealm(configured: unknown): string | null {
	if (typeof configured !== 'string' || configured.length === 0) return null;
	try {
		const url = new URL(configured);
		if (
			url.protocol !== 'https:' ||
			url.username ||
			url.password ||
			url.pathname !== '/' ||
			url.search ||
			url.hash
		) {
			return null;
		}
		return `backend=${url.origin.toLowerCase()}`;
	} catch {
		return null;
	}
}

type OgQueueAttemptReservation = {
	remaining: number;
	resetAtMs: number;
	status: 'exhausted' | 'reserved';
};

function readOgQueueAttemptReservation(
	value: unknown,
	httpStatus: number
): OgQueueAttemptReservation | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const result = value as Record<string, unknown>;
	if (
		Object.keys(result).sort().join('\0') !== 'remaining\0resetAtMs\0status' ||
		(result.status !== 'reserved' && result.status !== 'exhausted') ||
		!Number.isSafeInteger(result.remaining) ||
		(result.remaining as number) < 0 ||
		(result.remaining as number) > PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX ||
		!Number.isSafeInteger(result.resetAtMs) ||
		(result.resetAtMs as number) <= 0 ||
		(result.status === 'reserved' && httpStatus !== 200) ||
		(result.status === 'exhausted' && (httpStatus !== 429 || result.remaining !== 0))
	) {
		return null;
	}
	return result as OgQueueAttemptReservation;
}

/**
 * Capability authentication for the manifest writer is deliberately outside
 * general session authentication. A forged refresh request is rejected before
 * any session cookie can cause a Convex lookup, and before R2/Cache routing.
 */
export const handlePublicDiscoveryManifestRefreshCapability: Handle = async ({
	event,
	resolve
}) => {
	if (event.url.pathname !== PUBLIC_DISCOVERY_MANIFEST_REFRESH_PATH) return resolve(event);
	if (event.request.method !== 'POST') return rejection(405, 'Method Not Allowed');
	const bootstrapAttempt = isPublicDiscoveryBootstrapAttempt(event.request);
	const bootstrapAuthorityLease = event.request.headers.get(
		PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER
	);
	const bootstrap =
		bootstrapAttempt &&
		isAttestedPublicDiscoveryBootstrapRequest(event.request) &&
		event.request.headers.get(PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER) ===
			PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE &&
		bootstrapAuthorityLease !== null;
	if (bootstrapAttempt && !bootstrap) return rejection(401, 'Unauthorized');

	const platformEnv = event.platform?.env;
	const active = platformEnv
		? platformEnv.DISCOVERY_MANIFEST_REFRESH_SECRET
		: process.env.DISCOVERY_MANIFEST_REFRESH_SECRET;
	const previous = platformEnv
		? platformEnv.DISCOVERY_MANIFEST_REFRESH_SECRET_PREVIOUS
		: process.env.DISCOVERY_MANIFEST_REFRESH_SECRET_PREVIOUS;
	const auth = matchPublicDiscoveryManifestRefreshSecretValues(
		event.request.headers.get('x-public-discovery-manifest-refresh-secret'),
		active,
		previous
	);
	if (!auth.ok) {
		return rejection(
			auth.reason === 'not_configured' ? 503 : 401,
			auth.reason === 'not_configured'
				? 'DISCOVERY_MANIFEST_REFRESH_SECRET not configured'
				: 'Unauthorized'
		);
	}

	const deploymentSeed =
		event.request.headers.get(PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PURPOSE_HEADER) ===
		PUBLIC_DISCOVERY_MANIFEST_REFRESH_DEPLOY_SEED_PURPOSE;
	if (bootstrap && !deploymentSeed) return rejection(401, 'Unauthorized');
	const purpose = event.request.headers.get(PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PURPOSE_HEADER);
	if (
		purpose !== null &&
		purpose !== PUBLIC_DISCOVERY_MANIFEST_REFRESH_DEPLOY_SEED_PURPOSE &&
		purpose !== PUBLIC_DISCOVERY_MANIFEST_REFRESH_PAGE_CONTINUATION_PURPOSE
	) {
		return rejection(401, 'Unauthorized');
	}
	const pageBackfillContinuation =
		purpose === PUBLIC_DISCOVERY_MANIFEST_REFRESH_PAGE_CONTINUATION_PURPOSE;
	const continuationSignal = event.request.headers.get(
		PUBLIC_DISCOVERY_PAGE_BACKFILL_CONTINUATION_HEADER
	);
	if (continuationSignal !== null && continuationSignal !== '1') {
		return rejection(401, 'Unauthorized');
	}
	const continuationRequested = pageBackfillContinuation || continuationSignal === '1';
	if (deploymentSeed) {
		const expectedReleaseSha = event.request.headers.get('x-expected-release-sha');
		const expectedReleaseTransaction = event.request.headers.get('x-expected-release-transaction');
		const releaseTransactionId = platformEnv?.PUBLIC_RELEASE_TRANSACTION_ID;
		const releaseMatches =
			typeof BUILD_RELEASE_SHA === 'string' &&
			/^[a-f0-9]{40}$/.test(BUILD_RELEASE_SHA) &&
			expectedReleaseSha === BUILD_RELEASE_SHA &&
			typeof releaseTransactionId === 'string' &&
			/^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/.test(releaseTransactionId) &&
			expectedReleaseTransaction === releaseTransactionId;
		const releaseAuth = matchInternalSecretValues(
			event.request.headers.get('x-internal-secret'),
			platformEnv?.INTERNAL_API_SECRET,
			platformEnv?.INTERNAL_API_SECRET_PREVIOUS
		);
		if (!releaseMatches || !releaseAuth.ok) {
			return rejection(401, 'Unauthorized');
		}
	}

	// The bearer proves capability before the request spends a Durable Object
	// operation. The backend-named SQLite object bounds ordinary work to five
	// minutes. A 120-second continuation is possible only after this hook reports
	// a resolved route's typed incomplete response against a one-shot gate lease;
	// caller purpose alone never mints the grant.
	const realm = backendGateRealm(platformEnv?.PUBLIC_CONVEX_URL);
	const gate = platformEnv?.PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE;
	const releaseTransactionId = platformEnv?.PUBLIC_RELEASE_TRANSACTION_ID;
	if (
		!realm ||
		(bootstrap && realm !== PUBLIC_DISCOVERY_BOOTSTRAP_PRODUCTION_REALM) ||
		!gate ||
		typeof BUILD_RELEASE_SHA !== 'string' ||
		!/^[a-f0-9]{40}$/.test(BUILD_RELEASE_SHA) ||
		typeof releaseTransactionId !== 'string' ||
		!/^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/.test(releaseTransactionId)
	) {
		return rejection(503, 'Public discovery manifest refresh gate unavailable');
	}
	let admittedGate: {
		bootstrapAuthorityLease?: string;
		lease: string;
		stub: RefreshGateStub;
	};
	try {
		const id = gate.idFromName(realm);
		const stub = gate.get(id);
		const gateHeaders = new Headers();
		gateHeaders.set(PUBLIC_TEMPLATE_OG_RELEASE_SHA_HEADER, BUILD_RELEASE_SHA);
		gateHeaders.set(PUBLIC_TEMPLATE_OG_RELEASE_TRANSACTION_HEADER, releaseTransactionId);
		if (deploymentSeed) {
			gateHeaders.set(
				PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PURPOSE_HEADER,
				PUBLIC_DISCOVERY_MANIFEST_REFRESH_DEPLOY_SEED_PURPOSE
			);
		} else if (pageBackfillContinuation) {
			gateHeaders.set(
				PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PURPOSE_HEADER,
				PUBLIC_DISCOVERY_MANIFEST_REFRESH_PAGE_CONTINUATION_PURPOSE
			);
		}
		if (bootstrap) {
			gateHeaders.set(
				PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER,
				PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE
			);
			gateHeaders.set(PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER, bootstrapAuthorityLease!);
		}
		if (continuationRequested) {
			gateHeaders.set(PUBLIC_DISCOVERY_PAGE_BACKFILL_CONTINUATION_HEADER, '1');
		}
		const reservation = await stub.fetch(
			new Request(PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_URL, {
				headers: gateHeaders,
				method: 'POST',
				signal: AbortSignal.timeout(PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_TIMEOUT_MS)
			})
		);
		if (
			reservation.headers.get(PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL_HEADER) !==
			PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL
		) {
			return rejection(503, 'Public discovery manifest refresh gate unavailable');
		}
		if (reservation.status === 202) {
			const retryAfterSeconds = boundedRetryAfter(reservation.headers.get('retry-after'));
			if (retryAfterSeconds === null) {
				return rejection(503, 'Public discovery manifest refresh gate unavailable');
			}
			return coalesced(retryAfterSeconds);
		}
		if (reservation.status !== 200) {
			return rejection(503, 'Public discovery manifest refresh gate unavailable');
		}
		const lease = reservation.headers.get(PUBLIC_DISCOVERY_MANIFEST_REFRESH_LEASE_HEADER);
		if (
			lease === null ||
			!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(lease)
		) {
			return rejection(503, 'Public discovery manifest refresh gate unavailable');
		}
		if (
			bootstrap &&
			(reservation.headers.get(PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER) !==
				PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE ||
				reservation.headers.get(PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER) !==
					bootstrapAuthorityLease)
		) {
			return rejection(503, 'Public discovery bootstrap authority unavailable');
		}
		admittedGate = {
			...(bootstrap ? { bootstrapAuthorityLease: bootstrapAuthorityLease! } : {}),
			lease,
			stub
		};
	} catch {
		return rejection(503, 'Public discovery manifest refresh gate unavailable');
	}
	const activeGate = admittedGate;
	event.locals.reservePublicTemplateOgQueueAttempts = async (messageKeys) => {
		if (
			messageKeys.length < 1 ||
			messageKeys.length > 16 ||
			new Set(messageKeys).size !== messageKeys.length ||
			messageKeys.some((key) => typeof key !== 'string')
		) {
			throw new Error('PUBLIC_TEMPLATE_OG_QUEUE_DAILY_BUDGET_PROTOCOL');
		}
		const reservation = await activeGate.stub.fetch(
			new Request(PUBLIC_TEMPLATE_OG_QUEUE_ATTEMPT_RESERVATION_URL, {
				body: JSON.stringify({
					...(activeGate.bootstrapAuthorityLease
						? {
								bootstrapLeaseId: activeGate.bootstrapAuthorityLease,
								bootstrapProvenance: PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE
							}
						: {}),
					leaseId: activeGate.lease,
					messageKeys,
					sourceSha: BUILD_RELEASE_SHA,
					transactionId: releaseTransactionId
				}),
				headers: { 'content-type': 'application/json' },
				method: 'POST',
				signal: AbortSignal.timeout(PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_TIMEOUT_MS)
			})
		);
		if (
			(reservation.status !== 200 && reservation.status !== 429) ||
			reservation.headers.get(PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL_HEADER) !==
				PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL
		) {
			throw new Error('PUBLIC_TEMPLATE_OG_QUEUE_DAILY_BUDGET_UNAVAILABLE');
		}
		let source: string;
		try {
			source = await boundedResponseText(reservation, 512);
		} catch {
			throw new Error('PUBLIC_TEMPLATE_OG_QUEUE_DAILY_BUDGET_PROTOCOL');
		}
		if (source.length < 1 || source.length > 512) {
			throw new Error('PUBLIC_TEMPLATE_OG_QUEUE_DAILY_BUDGET_PROTOCOL');
		}
		let value: unknown;
		try {
			value = JSON.parse(source);
		} catch {
			throw new Error('PUBLIC_TEMPLATE_OG_QUEUE_DAILY_BUDGET_PROTOCOL');
		}
		const result = readOgQueueAttemptReservation(value, reservation.status);
		if (!result) throw new Error('PUBLIC_TEMPLATE_OG_QUEUE_DAILY_BUDGET_PROTOCOL');
		return result;
	};

	event.locals.publicDiscoveryManifestRefreshAuthenticated = true;
	event.locals.publicDiscoveryPageArtifactBackfillAuthorized = deploymentSeed;
	const response = await resolve(event);
	const continuationResult = response.headers.get(
		PUBLIC_DISCOVERY_PAGE_BACKFILL_CONTINUATION_HEADER
	);
	if (
		(continuationResult !== null && continuationResult !== '1') ||
		(continuationResult === '1' && response.status !== 202) ||
		(response.status === 202 && continuationResult !== '1')
	) {
		return rejection(503, 'Public discovery manifest refresh completion protocol invalid');
	}
	let bootstrapGeneration: string | null = null;
	if (bootstrap) {
		if (response.status === 200) {
			bootstrapGeneration = await checkedBootstrapReadyGeneration(response);
			if (bootstrapGeneration === null) {
				return rejection(503, 'Public discovery bootstrap ready proof invalid');
			}
		} else if (response.status !== 202 || continuationResult !== '1') {
			// A dependency failure keeps the short-lived authority armed for a
			// bounded retry; it can never be mistaken for terminal completion.
			return response;
		}
	}
	try {
		const completionHeaders = new Headers({
			[PUBLIC_DISCOVERY_MANIFEST_REFRESH_COMPLETION_HEADER]: bootstrap
				? bootstrapGeneration
					? 'ready'
					: 'incomplete'
				: continuationResult === '1'
					? 'incomplete'
					: 'complete',
			[PUBLIC_DISCOVERY_MANIFEST_REFRESH_LEASE_HEADER]: admittedGate.lease
		});
		if (bootstrap) {
			completionHeaders.set(
				PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER,
				PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE
			);
			completionHeaders.set(
				PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER,
				admittedGate.bootstrapAuthorityLease!
			);
			completionHeaders.set(PUBLIC_TEMPLATE_OG_RELEASE_SHA_HEADER, BUILD_RELEASE_SHA);
			completionHeaders.set(PUBLIC_TEMPLATE_OG_RELEASE_TRANSACTION_HEADER, releaseTransactionId);
			if (bootstrapGeneration) {
				completionHeaders.set(PUBLIC_DISCOVERY_BOOTSTRAP_GENERATION_HEADER, bootstrapGeneration);
			}
		}
		const completion = await admittedGate.stub.fetch(
			new Request(
				bootstrap
					? PUBLIC_DISCOVERY_BOOTSTRAP_COMPLETION_URL
					: PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_COMPLETION_URL,
				{
					headers: completionHeaders,
					method: 'POST',
					signal: AbortSignal.timeout(PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_TIMEOUT_MS)
				}
			)
		);
		if (
			completion.status !== 200 ||
			completion.headers.get(PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL_HEADER) !==
				PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL ||
			(bootstrap &&
				(completion.headers.get(PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER) !==
					PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE ||
					completion.headers.get(PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER) !==
						admittedGate.bootstrapAuthorityLease ||
					(bootstrapGeneration !== null &&
						completion.headers.get(PUBLIC_DISCOVERY_BOOTSTRAP_GENERATION_HEADER) !==
							bootstrapGeneration)))
		) {
			return rejection(503, 'Public discovery manifest refresh completion unavailable');
		}
	} catch {
		return rejection(503, 'Public discovery manifest refresh completion unavailable');
	}
	const headers = new Headers(response.headers);
	headers.set(
		PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL_HEADER,
		PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL
	);
	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText
	});
};
