#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';

const CLOUDFLARE_API_ORIGIN = 'https://api.cloudflare.com';
const CLOUDFLARE_API_PREFIX = '/client/v4';
const DEFAULT_PROJECT = 'communique-site';
const DEFAULT_REQUEST_ATTEMPTS = 5;
const DEFAULT_VERIFY_ATTEMPTS = 12;
const DEFAULT_VERIFY_DELAY_MS = 5_000;
const REQUEST_TIMEOUT_MS = 20_000;
const DEPLOYMENT_ID_RE = /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;
const RELEASE_SHA_RE = /^[a-f0-9]{40}$/;
const RELEASE_MESSAGE_RE =
	/^commons-release-v1 transaction=([1-9][0-9]{0,19}-[1-9][0-9]{0,9}) gate=([a-f0-9]{40}) artifact=([a-f0-9]{64})(?: component=(pages-containment) realm=(preview|production))?$/;

/** @typedef {(delayMs: number) => Promise<unknown>} SleepFn */

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @param {string} [label] */
export function assertPagesDeploymentId(value, label = 'Pages deployment ID') {
	invariant(
		typeof value === 'string' && DEPLOYMENT_ID_RE.test(value),
		`${label} must be one exact lowercase Cloudflare deployment ID.`
	);
	return value;
}

/** @param {unknown} value @param {string} [label] */
export function assertReleaseSha(value, label = 'release SHA') {
	invariant(
		typeof value === 'string' && RELEASE_SHA_RE.test(value),
		`${label} must be an exact lowercase 40-character Git SHA.`
	);
	return value;
}

/** @param {unknown} value */
function assertAccountId(value) {
	invariant(
		typeof value === 'string' && /^[a-f0-9]{32}$/.test(value),
		'CLOUDFLARE_ACCOUNT_ID must be an exact lowercase 32-character account ID.'
	);
	return value;
}

/** @param {unknown} value */
function assertProjectName(value) {
	invariant(
		typeof value === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/.test(value),
		'CF_PAGES_PROJECT must be one lowercase Pages project name.'
	);
	return value;
}

/** @param {unknown} accountId @param {unknown} [projectName] */
export function pagesProjectApiUrl(accountId, projectName = DEFAULT_PROJECT) {
	return `${CLOUDFLARE_API_ORIGIN}${CLOUDFLARE_API_PREFIX}/accounts/${assertAccountId(accountId)}/pages/projects/${assertProjectName(projectName)}`;
}

/** @param {unknown} accountId @param {unknown} projectName @param {unknown} deploymentId */
export function pagesRollbackApiUrl(accountId, projectName, deploymentId) {
	return `${pagesProjectApiUrl(accountId, projectName)}/deployments/${assertPagesDeploymentId(deploymentId)}/rollback`;
}

/** @param {unknown} value @param {string} label @param {number} maximum */
function requirePositiveInteger(value, label, maximum) {
	invariant(
		typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= maximum,
		`${label} must be an integer between 1 and ${maximum}.`
	);
	return value;
}

/** @param {number} status */
function retryableStatus(status) {
	return status === 429 || status >= 500;
}

/** @param {Response | null} response @param {number} attempt */
function retryDelayMs(response, attempt) {
	const raw = response?.headers.get('retry-after');
	const seconds = raw === null || raw === undefined ? Number.NaN : Number(raw);
	const fromDate = raw ? Date.parse(raw) - Date.now() : Number.NaN;
	return Math.min(
		10_000,
		Number.isFinite(seconds) && seconds > 0
			? seconds * 1_000
			: Number.isFinite(fromDate) && fromDate > 0
				? fromDate
				: 250 * 2 ** (attempt - 1)
	);
}

/**
 * @param {{
 *   url: string,
 *   token: string | undefined,
 *   method?: string,
 *   fetchFn?: typeof fetch,
 *   sleepFn?: SleepFn,
 *   attempts?: number
 * }} options
 * @returns {Promise<any>}
 */
async function requestEnvelope({
	url,
	token,
	method = 'GET',
	fetchFn = fetch,
	sleepFn = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
	attempts = DEFAULT_REQUEST_ATTEMPTS
}) {
	invariant(typeof token === 'string' && token.length > 0, 'CLOUDFLARE_API_TOKEN is required.');
	requirePositiveInteger(attempts, 'Cloudflare request attempts', 10);

	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		let response;
		try {
			response = await fetchFn(url, {
				method,
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: 'application/json'
				},
				redirect: 'error',
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
			});
		} catch (error) {
			if (attempt === attempts) throw error;
			await sleepFn(retryDelayMs(null, attempt));
			continue;
		}

		const envelope = await readBoundedResponseJson(response, 'Cloudflare Pages API response');
		if (response.ok && envelope?.success === true) return envelope;
		if (attempt < attempts && retryableStatus(response.status)) {
			await sleepFn(retryDelayMs(response, attempt));
			continue;
		}
		throw new Error(
			`Cloudflare Pages API ${method} ${new URL(url).pathname} failed with HTTP ${response.status}: ${JSON.stringify(envelope?.errors ?? [])}`
		);
	}
	throw new Error('Cloudflare Pages API retry loop ended unexpectedly.');
}

/** @param {any} project @param {string} projectName */
function canonicalReleaseFromProject(project, projectName) {
	invariant(
		project !== null && typeof project === 'object',
		'Cloudflare returned no Pages project.'
	);
	invariant(
		project.source?.config?.production_deployments_enabled === false &&
			project.source?.config?.preview_deployment_setting === 'none',
		'Native Cloudflare Pages production and preview deployments must remain disabled.'
	);
	const deployment = project.canonical_deployment;
	invariant(
		deployment !== null && typeof deployment === 'object',
		'Cloudflare Pages project has no canonical production deployment.'
	);
	const deploymentId = assertPagesDeploymentId(deployment.id, 'Canonical deployment ID');
	const releaseSha = assertReleaseSha(
		deployment.deployment_trigger?.metadata?.commit_hash,
		'Canonical deployment release SHA'
	);
	invariant(
		deployment.environment === 'production',
		'Canonical Pages deployment is not a production deployment.'
	);
	invariant(
		deployment.latest_stage?.status === 'success',
		'Canonical Pages deployment is not a successful deployment.'
	);
	const branch = deployment.deployment_trigger?.metadata?.branch;
	invariant(branch === 'production', 'Canonical Pages deployment was not built from production.');
	const releaseMessage = deployment.deployment_trigger?.metadata?.commit_message;
	const releaseMatch =
		typeof releaseMessage === 'string' ? RELEASE_MESSAGE_RE.exec(releaseMessage) : null;
	const releaseTransaction = releaseMatch?.[1] ?? null;
	const trustedGateSha = releaseMatch?.[2] ?? null;
	const artifactDigest = releaseMatch?.[3] ?? null;
	const releaseComponent = releaseMatch?.[4] ?? (releaseMatch ? 'pages' : null);
	const releaseRealm = releaseMatch?.[5] ?? null;
	if (releaseComponent === 'pages-containment') {
		invariant(releaseRealm === 'production', 'Production containment metadata crossed realms.');
	}

	let url;
	try {
		url = new URL(deployment.url);
	} catch {
		throw new Error('Canonical Pages deployment URL is invalid.');
	}
	const expectedSuffix = `.${projectName}.pages.dev`;
	invariant(
		url.protocol === 'https:' &&
			url.username === '' &&
			url.password === '' &&
			url.port === '' &&
			url.pathname === '/' &&
			url.search === '' &&
			url.hash === '' &&
			/^[a-z0-9-]+$/.test(url.hostname.slice(0, -expectedSuffix.length)) &&
			url.hostname.endsWith(expectedSuffix),
		'Canonical Pages deployment URL is not an exact immutable project URL.'
	);

	return {
		deploymentId,
		releaseSha,
		releaseTransaction,
		trustedGateSha,
		artifactDigest,
		releaseComponent,
		releaseRealm,
		url: url.origin
	};
}

/**
 * @param {{
 *   token: string | undefined,
 *   accountId: string | undefined,
 *   projectName?: string,
 *   fetchFn?: typeof fetch,
 *   sleepFn?: SleepFn,
 *   requestAttempts?: number
 * }} options
 */
export async function captureProductionCanonical({
	token,
	accountId,
	projectName = DEFAULT_PROJECT,
	fetchFn,
	sleepFn,
	requestAttempts
}) {
	const exactProjectName = assertProjectName(projectName);
	const envelope = await requestEnvelope({
		url: pagesProjectApiUrl(accountId, exactProjectName),
		token,
		fetchFn,
		sleepFn,
		attempts: requestAttempts ?? DEFAULT_REQUEST_ATTEMPTS
	});
	return canonicalReleaseFromProject(envelope.result, exactProjectName);
}

/**
 * @param {{
 *   token: string | undefined,
 *   accountId: string | undefined,
 *   projectName?: string,
 *   deploymentId: string | undefined,
 *   expectedReleaseSha: string | undefined,
 *   failedReleaseSha: string | undefined,
 *   failedTransactionId: string | undefined,
 *   fetchFn?: typeof fetch,
 *   sleepFn?: SleepFn,
 *   requestAttempts?: number,
 *   verificationAttempts?: number,
 *   verificationDelayMs?: number
 * }} options
 */
export async function rollbackProductionCanonical({
	token,
	accountId,
	projectName = DEFAULT_PROJECT,
	deploymentId,
	expectedReleaseSha,
	failedReleaseSha,
	failedTransactionId,
	fetchFn,
	sleepFn = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
	requestAttempts,
	verificationAttempts = DEFAULT_VERIFY_ATTEMPTS,
	verificationDelayMs = DEFAULT_VERIFY_DELAY_MS
}) {
	const exactProjectName = assertProjectName(projectName);
	const exactDeploymentId = assertPagesDeploymentId(deploymentId, 'Rollback deployment ID');
	const exactReleaseSha = assertReleaseSha(expectedReleaseSha, 'Rollback release SHA');
	invariant(
		typeof failedTransactionId === 'string' &&
			/^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/.test(failedTransactionId),
		'Failed rollback transaction is required.'
	);
	const exactFailedReleaseSha = assertReleaseSha(failedReleaseSha, 'Failed rollback release SHA');
	const before = await captureProductionCanonical({
		token,
		accountId,
		projectName: exactProjectName,
		fetchFn,
		sleepFn,
		requestAttempts
	});
	invariant(
		before.releaseSha === exactFailedReleaseSha &&
			before.releaseTransaction === failedTransactionId,
		'PUBLIC_TEMPLATE_OG_RELEASE_SUPERSEDED:production-pages'
	);
	requirePositiveInteger(verificationAttempts, 'Rollback verification attempts', 60);
	invariant(
		Number.isSafeInteger(verificationDelayMs) &&
			verificationDelayMs >= 0 &&
			verificationDelayMs <= 30_000,
		'Rollback verification delay must be an integer between 0 and 30000 milliseconds.'
	);

	const rollbackEnvelope = await requestEnvelope({
		url: pagesRollbackApiUrl(accountId, exactProjectName, exactDeploymentId),
		token,
		method: 'POST',
		fetchFn,
		sleepFn,
		attempts: requestAttempts ?? DEFAULT_REQUEST_ATTEMPTS
	});
	const rollbackResult = canonicalReleaseFromProject(
		{
			canonical_deployment: rollbackEnvelope.result,
			source: {
				config: {
					production_deployments_enabled: false,
					preview_deployment_setting: 'none'
				}
			}
		},
		exactProjectName
	);
	invariant(
		rollbackResult.deploymentId === exactDeploymentId &&
			rollbackResult.releaseSha === exactReleaseSha,
		'Cloudflare rollback response did not identify the exact captured deployment and SHA.'
	);

	for (let attempt = 1; attempt <= verificationAttempts; attempt += 1) {
		const current = await captureProductionCanonical({
			token,
			accountId,
			projectName: exactProjectName,
			fetchFn,
			sleepFn,
			requestAttempts
		});
		if (current.deploymentId === exactDeploymentId && current.releaseSha === exactReleaseSha) {
			return current;
		}
		if (attempt < verificationAttempts) await sleepFn(verificationDelayMs);
	}
	throw new Error(
		`Cloudflare did not restore canonical deployment ${exactDeploymentId} at ${exactReleaseSha}.`
	);
}

/** @param {string[]} argv */
export function parseProductionControlArgs(argv) {
	invariant(argv.length > 0, 'Expected one command: capture or rollback.');
	const command = argv[0];
	invariant(
		command === 'capture' || command === 'rollback',
		'Expected one command: capture or rollback.'
	);
	let deploymentId;
	let expectedReleaseSha;
	let failedReleaseSha;
	let failedTransactionId;

	for (let index = 1; index < argv.length; index += 1) {
		const flag = argv[index];
		const value = argv[index + 1];
		invariant(value !== undefined && !value.startsWith('--'), `${flag} requires a value.`);
		if (flag === '--deployment-id') {
			invariant(deploymentId === undefined, '--deployment-id may only be supplied once.');
			deploymentId = value;
		} else if (flag === '--expected-release-sha') {
			invariant(
				expectedReleaseSha === undefined,
				'--expected-release-sha may only be supplied once.'
			);
			expectedReleaseSha = value;
		} else if (flag === '--failed-release-sha') {
			invariant(failedReleaseSha === undefined, '--failed-release-sha may only be supplied once.');
			failedReleaseSha = value;
		} else if (flag === '--failed-transaction-id') {
			invariant(
				failedTransactionId === undefined,
				'--failed-transaction-id may only be supplied once.'
			);
			failedTransactionId = value;
		} else {
			throw new Error(`Unknown argument: ${flag}`);
		}
		index += 1;
	}

	if (command === 'capture') {
		invariant(
			deploymentId === undefined &&
				expectedReleaseSha === undefined &&
				failedReleaseSha === undefined &&
				failedTransactionId === undefined,
			'capture does not accept rollback arguments.'
		);
	} else {
		assertPagesDeploymentId(deploymentId, '--deployment-id');
		assertReleaseSha(expectedReleaseSha, '--expected-release-sha');
		assertReleaseSha(failedReleaseSha, '--failed-release-sha');
		invariant(
			typeof failedTransactionId === 'string' &&
				/^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/.test(failedTransactionId),
			'--failed-transaction-id is invalid.'
		);
	}
	return { command, deploymentId, expectedReleaseSha, failedReleaseSha, failedTransactionId };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
	try {
		const args = parseProductionControlArgs(process.argv.slice(2));
		const common = {
			token: process.env.CLOUDFLARE_API_TOKEN,
			accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
			projectName: process.env.CF_PAGES_PROJECT ?? DEFAULT_PROJECT
		};
		const result =
			args.command === 'capture'
				? await captureProductionCanonical(common)
				: await rollbackProductionCanonical({
						...common,
						deploymentId: args.deploymentId,
						expectedReleaseSha: args.expectedReleaseSha,
						failedReleaseSha: args.failedReleaseSha,
						failedTransactionId: args.failedTransactionId
					});
		console.log(JSON.stringify(result));
	} catch (error) {
		console.error(
			`Cloudflare Pages production control failed: ${error instanceof Error ? error.message : String(error)}`
		);
		process.exitCode = 1;
	}
}
