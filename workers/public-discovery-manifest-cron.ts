import { CONVEX_WORK_BUDGET_MANIFEST_CRON_HTTP_TIMEOUT_SECONDS } from '../src/lib/server/convex-work-budget-policy';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';

export interface PublicDiscoveryManifestCronEnv {
	DISCOVERY_MANIFEST_REFRESH_SECRET: string;
	DISCOVERY_MANIFEST_REFRESH_SECRET_NONPROD?: string;
	PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL: string;
	PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL_NONPROD?: string;
}

interface PublicDiscoveryManifestCronExecutionContext {
	waitUntil(promise: Promise<unknown>): void;
}

const PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL = '3';
const PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL_HEADER =
	'x-public-discovery-refresh-gate-protocol';
export const PUBLIC_DISCOVERY_MANIFEST_CRON_HTTP_TIMEOUT_MS =
	CONVEX_WORK_BUDGET_MANIFEST_CRON_HTTP_TIMEOUT_SECONDS * 1000;

function refreshSecretBytes(secret: string): number {
	return new TextEncoder().encode(secret).byteLength;
}

function refreshEndpoint(raw: string): URL {
	const url = new URL(raw);
	if (
		url.protocol !== 'https:' ||
		url.username ||
		url.password ||
		url.pathname !== '/api/internal/public-discovery-manifest-refresh' ||
		url.search ||
		url.hash
	) {
		throw new Error('PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL_INVALID');
	}
	return url;
}

function refreshSecret(value: unknown, name = 'DISCOVERY_MANIFEST_REFRESH_SECRET'): string {
	if (typeof value !== 'string' || refreshSecretBytes(value) < 32) {
		throw new Error(`${name}_NOT_CONFIGURED`);
	}
	return value;
}

async function refreshOne(endpoint: URL, secret: string): Promise<void> {
	const response = await fetch(endpoint, {
		body: '{}',
		headers: {
			'content-type': 'application/json',
			'x-public-discovery-manifest-refresh-secret': secret
		},
		method: 'POST',
		redirect: 'error',
		signal: AbortSignal.timeout(PUBLIC_DISCOVERY_MANIFEST_CRON_HTTP_TIMEOUT_MS)
	});
	// A gate reservation that loses the five-minute ordinary race returns 202. That is
	// observable coalescing, not proof that this realm actually materialized a
	// manifest. Fail this scheduled attempt and let the next cron tick retry.
	if (response.status !== 200) {
		throw new Error(`PUBLIC_DISCOVERY_MANIFEST_CRON_FAILED:${response.status}`);
	}
	if (
		response.headers.get(PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL_HEADER) !==
		PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL
	) {
		throw new Error('PUBLIC_DISCOVERY_MANIFEST_CRON_GATE_PROTOCOL_INVALID');
	}
	let result: unknown;
	try {
		result = await readBoundedResponseJson(response, 'Public discovery manifest refresh response');
	} catch {
		throw new Error('PUBLIC_DISCOVERY_MANIFEST_CRON_RESULT_INVALID');
	}
	if (!validRefreshResult(result)) {
		throw new Error('PUBLIC_DISCOVERY_MANIFEST_CRON_RESULT_INVALID');
	}
}

function validRefreshFamily(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	const family = value as Record<string, unknown>;
	const ready = family.ready;
	const revision = family.revision;
	const retiredRevision = family.retiredRevision;
	return (
		typeof ready === 'boolean' &&
		Number.isSafeInteger(revision) &&
		(revision as number) >= 0 &&
		Number.isSafeInteger(retiredRevision) &&
		(retiredRevision as number) >= 0 &&
		Number.isSafeInteger(family.withdrawalEpoch) &&
		(family.withdrawalEpoch as number) >= 0 &&
		(ready
			? (retiredRevision as number) < (revision as number)
			: (retiredRevision as number) >= (revision as number))
	);
}

function validRefreshResult(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	const result = value as Record<string, unknown>;
	return (
		result.ok === true && validRefreshFamily(result.list) && validRefreshFamily(result.relations)
	);
}

export async function refreshPublicDiscoveryManifest(
	env: PublicDiscoveryManifestCronEnv
): Promise<void> {
	const secret = refreshSecret(env.DISCOVERY_MANIFEST_REFRESH_SECRET);
	await refreshOne(refreshEndpoint(env.PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL), secret);
}

/** One scheduled invocation keeps both live backend realms authoritative. */
export async function refreshAllPublicDiscoveryManifests(
	env: PublicDiscoveryManifestCronEnv
): Promise<void> {
	const productionSecret = refreshSecret(env.DISCOVERY_MANIFEST_REFRESH_SECRET);
	const productionEndpoint = refreshEndpoint(env.PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL);
	const tasks: Array<{ endpoint: URL; secret: string }> = [
		{ endpoint: productionEndpoint, secret: productionSecret }
	];
	if (env.PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL_NONPROD !== undefined) {
		const nonprodEndpoint = refreshEndpoint(env.PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL_NONPROD);
		const nonprodSecret = refreshSecret(
			env.DISCOVERY_MANIFEST_REFRESH_SECRET_NONPROD,
			'DISCOVERY_MANIFEST_REFRESH_SECRET_NONPROD'
		);
		if (nonprodEndpoint.href === productionEndpoint.href || nonprodSecret === productionSecret) {
			throw new Error('PUBLIC_DISCOVERY_MANIFEST_CRON_REALMS_NOT_ISOLATED');
		}
		tasks.push({ endpoint: nonprodEndpoint, secret: nonprodSecret });
	}
	const results = await Promise.allSettled(
		tasks.map(({ endpoint, secret }) => refreshOne(endpoint, secret))
	);
	const failed = results.flatMap((result, index) => (result.status === 'rejected' ? [index] : []));
	if (failed.length > 0) {
		throw new Error(`PUBLIC_DISCOVERY_MANIFEST_CRON_REALM_FAILURE:${failed.join(',')}`);
	}
}

export default {
	async scheduled(
		_controller: unknown,
		env: PublicDiscoveryManifestCronEnv,
		ctx: PublicDiscoveryManifestCronExecutionContext
	): Promise<void> {
		ctx.waitUntil(refreshAllPublicDiscoveryManifests(env));
	}
};
