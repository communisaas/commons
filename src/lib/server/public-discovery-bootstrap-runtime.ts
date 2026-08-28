import {
	PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_PROTOCOL,
	PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_PATH,
	PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE,
	PUBLIC_DISCOVERY_BOOTSTRAP_SEED_PURPOSE
} from './public-discovery-bootstrap-protocol.mjs';

export {
	PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_PROTOCOL,
	PUBLIC_DISCOVERY_BOOTSTRAP_COMPLETION_PATH,
	PUBLIC_DISCOVERY_BOOTSTRAP_CONTROL_PATH,
	PUBLIC_DISCOVERY_BOOTSTRAP_GENERATION_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_MAXIMUM_AUTHORITY_MS,
	PUBLIC_DISCOVERY_BOOTSTRAP_PATH,
	PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE,
	PUBLIC_DISCOVERY_BOOTSTRAP_SEED_PURPOSE
} from './public-discovery-bootstrap-protocol.mjs';

const PRODUCTION_PUBLIC_HOST = 'commons.email';
const PRODUCTION_ORIGIN_HOST = 'pages-origin.commons.email';
const RELEASE_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const RELEASE_TRANSACTION_PATTERN = /^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function isPublicDiscoveryBootstrapAttempt(request: Request): boolean {
	return (
		request.headers.has(PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER) ||
		request.headers.has(PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER) ||
		request.headers.has(PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER)
	);
}

/**
 * The Access-safe adapter replaces any untrusted boundary marker only after it
 * validates the raw hidden-origin request. Runtime containment consumes that
 * attestation; callers cannot widen the exception to another route or tuple.
 */
export function isAttestedPublicDiscoveryBootstrapRequest(request: Request): boolean {
	const url = new URL(request.url);
	const sourceSha = request.headers.get('x-commons-edge-release-sha');
	const transactionId = request.headers.get('x-commons-edge-release-transaction');
	return (
		url.protocol === 'https:' &&
		url.username === '' &&
		url.password === '' &&
		url.port === '' &&
		url.hostname.toLowerCase() === PRODUCTION_PUBLIC_HOST &&
		url.pathname === PUBLIC_DISCOVERY_BOOTSTRAP_PATH &&
		url.search === '' &&
		url.hash === '' &&
		request.method === 'POST' &&
		request.headers.get(PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER) ===
			PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_PROTOCOL &&
		request.headers.get('x-commons-candidate-origin-host') === PRODUCTION_ORIGIN_HOST &&
		request.headers.get('x-commons-edge-public-host') === PRODUCTION_PUBLIC_HOST &&
		request.headers.get('x-forwarded-host') === PRODUCTION_PUBLIC_HOST &&
		request.headers.get('x-forwarded-proto') === 'https' &&
		request.headers.get('x-public-discovery-refresh-purpose') ===
			PUBLIC_DISCOVERY_BOOTSTRAP_SEED_PURPOSE &&
		request.headers.get(PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER) ===
			PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE &&
		UUID_V4_PATTERN.test(request.headers.get(PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER) ?? '') &&
		sourceSha !== null &&
		RELEASE_SHA_PATTERN.test(sourceSha) &&
		request.headers.get('x-expected-release-sha') === sourceSha &&
		transactionId !== null &&
		RELEASE_TRANSACTION_PATTERN.test(transactionId) &&
		request.headers.get('x-expected-release-transaction') === transactionId &&
		request.headers.get('content-type') === 'application/json'
	);
}
