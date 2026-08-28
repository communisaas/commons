#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';

export const DEFAULT_PAGES_PROJECT = 'communique-site';
export const DEFAULT_ALLOWED_ALIAS_BRANCHES = ['production'];
const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 16;
const MAX_RETRIES = 8;
const PAGE_SIZE = 25;
const MAX_DEPLOYMENT_PAGES = 2_000;
const MAX_STABILITY_ATTEMPTS = 3;
const MAX_RECONCILE_PASSES = 8;
const DEPLOYMENT_ID_RE = /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;

/**
 * @typedef {{
 *   id: string,
 *   aliases?: unknown,
 *   deployment_trigger?: { metadata?: { branch?: unknown, commit_hash?: unknown } },
 *   latest_stage?: { status?: unknown }
 * }} PagesDeployment
 */

/**
 * @typedef {{
 *   canonical_deployment?: PagesDeployment | null,
 *   source?: { config?: {
 *     production_deployments_enabled?: unknown,
 *     preview_deployment_setting?: unknown
 *   } }
 * }} PagesProject
 */

/**
 * @typedef {{
 *   page?: unknown,
 *   per_page?: unknown,
 *   total_count?: unknown,
 *   total_pages?: unknown
 * }} PagesResultInfo
 */

/**
 * @typedef {{
 *   success?: unknown,
 *   result?: unknown,
 *   result_info?: PagesResultInfo,
 *   errors?: unknown
 * }} CloudflareEnvelope
 */

/** @typedef {{ api: (path?: string, init?: RequestInit) => Promise<CloudflareEnvelope> }} CloudflareClient */

class CloudflareApiError extends Error {
	/**
	 * @param {string} message
	 * @param {number} status
	 * @param {string | null} retryAfter
	 */
	constructor(message, status, retryAfter) {
		super(message);
		this.name = 'CloudflareApiError';
		this.status = status;
		this.retryAfter = retryAfter;
	}
}

/**
 * @param {unknown} condition
 * @param {string} message
 * @returns {asserts condition}
 */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {PagesDeployment} deployment */
function deploymentBranch(deployment) {
	const branch = deployment.deployment_trigger?.metadata?.branch;
	return typeof branch === 'string' && branch.length > 0 ? branch : null;
}

/** @param {PagesDeployment} deployment */
function deploymentCommitHash(deployment) {
	const hash = deployment.deployment_trigger?.metadata?.commit_hash;
	return typeof hash === 'string' && hash.length > 0 ? hash : null;
}

/** @param {PagesDeployment} deployment */
function deploymentAliases(deployment) {
	/** @type {string[]} */
	const aliases = [];
	if (!Array.isArray(deployment.aliases)) return aliases;
	for (const alias of deployment.aliases) {
		if (typeof alias === 'string' && alias.length > 0) aliases.push(alias);
	}
	return aliases;
}

/** @param {string} alias */
function aliasHostname(alias) {
	try {
		const url = new URL(alias.includes('://') ? alias : `https://${alias}`);
		if (
			url.protocol !== 'https:' ||
			url.username ||
			url.password ||
			url.port ||
			(url.pathname !== '/' && url.pathname !== '') ||
			url.search ||
			url.hash
		) {
			return null;
		}
		return url.hostname.toLowerCase();
	} catch {
		return null;
	}
}

/**
 * Keep the active production deployment and only the deployment currently
 * holding an exact, explicitly supported Pages branch alias. Branch metadata
 * plus an arbitrary custom alias is not authority to retain an artifact.
 *
 * @param {PagesDeployment[]} deployments
 * @param {{
 *   canonicalDeploymentId: string,
 *   projectName?: string,
 *   allowedAliasBranches?: string[]
 * }} options
 */
export function partitionPagesDeployments(
	deployments,
	{
		canonicalDeploymentId,
		projectName = DEFAULT_PAGES_PROJECT,
		allowedAliasBranches = DEFAULT_ALLOWED_ALIAS_BRANCHES
	}
) {
	invariant(
		typeof canonicalDeploymentId === 'string' && canonicalDeploymentId.length > 0,
		'Canonical deployment ID is required.'
	);
	invariant(
		typeof projectName === 'string' && /^[a-z0-9-]+$/.test(projectName),
		'Pages project name must be lowercase letters, numbers, or hyphens.'
	);
	for (const branch of allowedAliasBranches) {
		invariant(
			typeof branch === 'string' && /^[a-z0-9-]+$/.test(branch),
			'Allowed Pages alias branches must be lowercase letters, numbers, or hyphens.'
		);
	}
	const allowed = new Set(allowedAliasBranches);
	/** @type {PagesDeployment[]} */
	const keep = [];
	/** @type {PagesDeployment[]} */
	const prune = [];
	const exactAliasHolders = new Map();

	for (const deployment of deployments) {
		invariant(
			typeof deployment?.id === 'string' && deployment.id.length > 0,
			'Cloudflare returned a deployment without an ID.'
		);
		const branch = deploymentBranch(deployment);
		const expectedAlias = branch ? `${branch}.${projectName}.pages.dev` : null;
		const isCanonical = deployment.id === canonicalDeploymentId;
		const isAllowedAlias =
			branch !== null &&
			expectedAlias !== null &&
			allowed.has(branch) &&
			deploymentAliases(deployment).some((alias) => aliasHostname(alias) === expectedAlias);
		if (isAllowedAlias) {
			const priorHolder = exactAliasHolders.get(expectedAlias);
			invariant(
				priorHolder === undefined || priorHolder === deployment.id,
				`Cloudflare returned multiple deployments holding the exact ${expectedAlias} branch alias.`
			);
			exactAliasHolders.set(expectedAlias, deployment.id);
		}
		(isCanonical || isAllowedAlias ? keep : prune).push(deployment);
	}

	return { keep, prune };
}

/** @param {PagesProject} project */
export function assertPagesProjectPublicationGate(project) {
	const config = project?.source?.config;
	invariant(config, 'Cloudflare Pages project is missing Git source configuration.');
	invariant(
		config.production_deployments_enabled === false,
		'Native Cloudflare production deployments must be disabled.'
	);
	invariant(
		config.preview_deployment_setting === 'none',
		'Native Cloudflare preview deployments must be disabled.'
	);
}

/**
 * @param {{
 *   token: string | undefined,
 *   accountId: string | undefined,
 *   projectName?: string,
 *   fetchFn?: typeof fetch
 * }} options
 * @returns {CloudflareClient}
 */
function createCloudflareClient({
	token,
	accountId,
	projectName = DEFAULT_PAGES_PROJECT,
	fetchFn
}) {
	invariant(typeof token === 'string' && token.length > 0, 'CLOUDFLARE_API_TOKEN is required.');
	invariant(
		typeof accountId === 'string' && /^[a-f0-9]{32}$/i.test(accountId),
		'CLOUDFLARE_ACCOUNT_ID must be a 32-character account ID.'
	);
	invariant(
		typeof projectName === 'string' && /^[a-z0-9-]+$/.test(projectName),
		'CF_PAGES_PROJECT must be a lowercase Pages project name.'
	);
	const request = fetchFn ?? fetch;
	const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}`;

	/**
	 * @param {string} [path]
	 * @param {RequestInit} [init]
	 * @returns {Promise<CloudflareEnvelope>}
	 */
	async function api(path = '', init = {}) {
		for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
			try {
				const headers = new Headers(init.headers);
				headers.set('Authorization', `Bearer ${token}`);
				const response = await request(`${base}${path}`, {
					...init,
					headers,
					redirect: 'error',
					signal: AbortSignal.timeout(20_000)
				});
				/** @type {CloudflareEnvelope | null} */
				let body = null;
				try {
					const decoded = await readBoundedResponseJson(response, 'Cloudflare Pages API response');
					if (decoded && typeof decoded === 'object') {
						body = /** @type {CloudflareEnvelope} */ (decoded);
					}
				} catch {
					body = null;
				}

				if (response.ok && body?.success === true) return body;

				const error = new CloudflareApiError(
					`Cloudflare Pages API ${init.method ?? 'GET'} ${path || '/'} failed with HTTP ${response.status}: ${JSON.stringify(body?.errors ?? [])}`,
					response.status,
					response.headers.get('retry-after')
				);
				if (!isRetryable(error) || attempt === MAX_RETRIES) throw error;
				await retryDelay(error, attempt);
			} catch (error) {
				if (error instanceof CloudflareApiError) throw error;
				if (attempt === MAX_RETRIES) throw error;
				await retryDelay(null, attempt);
			}
		}
		throw new Error('Cloudflare Pages API retry loop ended unexpectedly.');
	}

	return { api };
}

/** @param {CloudflareApiError} error */
function isRetryable(error) {
	return error.status === 429 || error.status >= 500;
}

/**
 * @param {CloudflareApiError | null} error
 * @param {number} attempt
 */
async function retryDelay(error, attempt) {
	const raw = error?.retryAfter;
	const seconds = raw === null || raw === undefined ? Number.NaN : Number(raw);
	const dateDelay = raw ? Date.parse(raw) - Date.now() : Number.NaN;
	const delayMs = Math.min(
		30_000,
		Number.isFinite(seconds) && seconds > 0
			? seconds * 1000
			: Number.isFinite(dateDelay) && dateDelay > 0
				? dateDelay
				: 250 * 2 ** (attempt - 1)
	);
	await new Promise((resolve) => setTimeout(resolve, delayMs));
}

/** @param {unknown} value */
function requireProject(value) {
	invariant(
		value !== null && typeof value === 'object',
		'Cloudflare returned an invalid Pages project.'
	);
	return /** @type {PagesProject} */ (value);
}

/**
 * @param {unknown} value
 * @param {number} page
 */
function requireDeployments(value, page) {
	invariant(
		Array.isArray(value),
		`Cloudflare returned an invalid deployment list on page ${page}.`
	);
	for (const row of value) {
		invariant(
			row !== null &&
				typeof row === 'object' &&
				typeof (/** @type {{ id?: unknown }} */ (row).id) === 'string' &&
				/** @type {{ id: string }} */ (row).id.length > 0,
			`Cloudflare returned a deployment without an ID on page ${page}.`
		);
	}
	return /** @type {PagesDeployment[]} */ (value);
}

/**
 * @param {PagesResultInfo | undefined} info
 * @param {number} expectedPage
 */
function requirePagination(info, expectedPage) {
	invariant(
		info !== undefined,
		`Cloudflare omitted deployment pagination on page ${expectedPage}.`
	);
	const { page, total_count: totalCount, total_pages: totalPages } = info;
	invariant(
		page === undefined || page === expectedPage,
		`Cloudflare returned deployment page ${String(page)} while page ${expectedPage} was requested.`
	);
	invariant(
		Number.isSafeInteger(totalPages) &&
			Number(totalPages) >= 1 &&
			Number(totalPages) <= MAX_DEPLOYMENT_PAGES,
		'Cloudflare returned an invalid deployment page count.'
	);
	invariant(
		Number.isSafeInteger(totalCount) && Number(totalCount) >= 0,
		'Cloudflare returned an invalid deployment total count.'
	);
	return { totalPages: Number(totalPages), totalCount: Number(totalCount) };
}

/** @param {CloudflareClient} client */
async function readDeploymentInventoryOnce(client) {
	const firstPage = await client.api(`/deployments?page=1&per_page=${PAGE_SIZE}`);
	const expected = requirePagination(firstPage.result_info, 1);
	/** @type {PagesDeployment[]} */
	const deployments = [];
	const seenIds = new Set();

	for (let page = 1; page <= expected.totalPages; page += 1) {
		const response =
			page === 1 ? firstPage : await client.api(`/deployments?page=${page}&per_page=${PAGE_SIZE}`);
		const pagination = requirePagination(response.result_info, page);
		invariant(
			pagination.totalPages === expected.totalPages &&
				pagination.totalCount === expected.totalCount,
			'Cloudflare deployment inventory changed while it was being paginated.'
		);
		for (const deployment of requireDeployments(response.result, page)) {
			invariant(
				!seenIds.has(deployment.id),
				'Cloudflare deployment pagination returned a duplicate ID.'
			);
			seenIds.add(deployment.id);
			deployments.push(deployment);
		}
	}

	invariant(
		deployments.length === expected.totalCount,
		`Cloudflare deployment inventory returned ${deployments.length} unique rows but reported ${expected.totalCount}.`
	);
	return deployments;
}

/** @param {PagesDeployment[]} deployments */
function inventoryFingerprint(deployments) {
	return deployments
		.map((deployment) =>
			[
				deployment.id,
				deploymentBranch(deployment) ?? '',
				deploymentCommitHash(deployment) ?? '',
				...deploymentAliases(deployment)
					.map((alias) => aliasHostname(alias) ?? `invalid:${alias}`)
					.sort()
			].join('|')
		)
		.sort()
		.join('\n');
}

/** @param {CloudflareClient} client */
async function readPagesState(client) {
	for (let attempt = 1; attempt <= MAX_STABILITY_ATTEMPTS; attempt += 1) {
		const beforeResponse = await client.api();
		const beforeProject = requireProject(beforeResponse.result);
		assertPagesProjectPublicationGate(beforeProject);
		const beforeCanonicalId = beforeProject.canonical_deployment?.id;
		invariant(
			beforeCanonicalId,
			'Cloudflare Pages project has no canonical production deployment.'
		);

		try {
			const firstInventory = await readDeploymentInventoryOnce(client);
			const secondInventory = await readDeploymentInventoryOnce(client);
			const afterResponse = await client.api();
			const afterProject = requireProject(afterResponse.result);
			assertPagesProjectPublicationGate(afterProject);
			const afterCanonicalId = afterProject.canonical_deployment?.id;
			invariant(
				afterCanonicalId,
				'Cloudflare Pages project has no canonical production deployment.'
			);

			if (
				beforeCanonicalId === afterCanonicalId &&
				inventoryFingerprint(firstInventory) === inventoryFingerprint(secondInventory)
			) {
				invariant(
					secondInventory.some((deployment) => deployment.id === afterCanonicalId),
					'Canonical Pages deployment is missing from the stable deployment inventory.'
				);
				return { project: afterProject, deployments: secondInventory };
			}
		} catch (error) {
			if (attempt === MAX_STABILITY_ATTEMPTS) throw error;
			continue;
		}
	}
	throw new Error('Cloudflare Pages deployment inventory did not stabilize.');
}

/**
 * @param {string | undefined} value
 * @param {string} name
 * @param {number} fallback
 * @param {number} [maximum]
 */
function parsePositiveInteger(value, name, fallback, maximum = Number.MAX_SAFE_INTEGER) {
	if (value === undefined) return fallback;
	const parsed = Number(value);
	invariant(
		Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum,
		`${name} must be a positive integer no greater than ${maximum}.`
	);
	return parsed;
}

/**
 * @param {PagesProject} project
 * @param {string | undefined} expectedProductionSha
 */
function assertExpectedProductionSha(project, expectedProductionSha) {
	if (expectedProductionSha === undefined) return;
	invariant(
		/^[a-f0-9]{40}$/.test(expectedProductionSha),
		'--expected-production-sha must be an exact lowercase 40-character Git SHA.'
	);
	const actualSha = project.canonical_deployment
		? deploymentCommitHash(project.canonical_deployment)
		: null;
	invariant(
		actualSha === expectedProductionSha,
		`Canonical Pages deployment SHA ${actualSha ?? 'missing'} does not match ${expectedProductionSha}.`
	);
}

/**
 * @param {CloudflareClient} client
 * @param {PagesDeployment} deployment
 */
async function deleteDeployment(client, deployment) {
	try {
		await client.api(`/deployments/${deployment.id}?force=true`, { method: 'DELETE' });
		return true;
	} catch (error) {
		if (error instanceof CloudflareApiError && error.status === 404) return false;
		throw error;
	}
}

/**
 * @param {CloudflareClient} client
 * @param {PagesDeployment[]} deployments
 * @param {number} concurrency
 */
async function pruneDeployments(client, deployments, concurrency) {
	let cursor = 0;
	let processed = 0;
	let deleted = 0;
	async function worker() {
		while (true) {
			const index = cursor;
			cursor += 1;
			if (index >= deployments.length) return;
			if (await deleteDeployment(client, deployments[index])) deleted += 1;
			processed += 1;
			if (processed % 50 === 0 || processed === deployments.length) {
				console.log(`Processed ${processed}/${deployments.length} stale Pages deployments.`);
			}
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, deployments.length) }, worker));
	return deleted;
}

/**
 * @param {{
 *   token: string | undefined,
 *   accountId: string | undefined,
 *   projectName?: string,
 *   allowedAliasBranches?: string[],
 *   prune?: boolean,
 *   maxDelete?: number,
 *   concurrency?: number,
 *   expectedProductionSha?: string,
 *   preserveDeploymentIds?: string[],
 *   fetchFn?: typeof fetch
 * }} options
 */
export async function reconcilePagesExposure({
	token,
	accountId,
	projectName = DEFAULT_PAGES_PROJECT,
	allowedAliasBranches = DEFAULT_ALLOWED_ALIAS_BRANCHES,
	prune = false,
	maxDelete,
	concurrency = DEFAULT_CONCURRENCY,
	expectedProductionSha,
	preserveDeploymentIds = [],
	fetchFn
}) {
	invariant(
		Number.isSafeInteger(concurrency) && concurrency > 0 && concurrency <= MAX_CONCURRENCY,
		`Concurrency must be between 1 and ${MAX_CONCURRENCY}.`
	);
	invariant(
		maxDelete === undefined || (Number.isSafeInteger(maxDelete) && maxDelete > 0),
		'maxDelete must be a positive integer when provided.'
	);
	assertExpectedProductionSha(
		{
			canonical_deployment: {
				id: 'validation',
				deployment_trigger: { metadata: { commit_hash: expectedProductionSha } }
			}
		},
		expectedProductionSha
	);
	const preservedIds = new Set();
	for (const deploymentId of preserveDeploymentIds) {
		invariant(
			typeof deploymentId === 'string' && DEPLOYMENT_ID_RE.test(deploymentId),
			'Preserved Pages deployment IDs must be exact lowercase Cloudflare deployment IDs.'
		);
		invariant(!preservedIds.has(deploymentId), 'Preserved Pages deployment IDs must be unique.');
		preservedIds.add(deploymentId);
	}

	const client = createCloudflareClient({ token, accountId, projectName, fetchFn });
	let state = await readPagesState(client);
	assertExpectedProductionSha(state.project, expectedProductionSha);
	let partition = partitionPagesDeployments(state.deployments, {
		canonicalDeploymentId: state.project.canonical_deployment?.id ?? '',
		projectName,
		allowedAliasBranches
	});
	let deleted = 0;
	let remainingBudget = maxDelete ?? Number.POSITIVE_INFINITY;
	let prunable = partition.prune.filter((deployment) => !preservedIds.has(deployment.id));

	if (prune) {
		for (let pass = 1; prunable.length > 0 && remainingBudget > 0; pass += 1) {
			invariant(
				pass <= MAX_RECONCILE_PASSES,
				'Cloudflare Pages inventory kept changing during reconciliation.'
			);
			const selected = prunable.slice(0, remainingBudget);
			deleted += await pruneDeployments(client, selected, concurrency);
			remainingBudget -= selected.length;

			state = await readPagesState(client);
			assertExpectedProductionSha(state.project, expectedProductionSha);
			partition = partitionPagesDeployments(state.deployments, {
				canonicalDeploymentId: state.project.canonical_deployment?.id ?? '',
				projectName,
				allowedAliasBranches
			});
			prunable = partition.prune.filter((deployment) => !preservedIds.has(deployment.id));
		}
	}

	if (prune && maxDelete === undefined) {
		invariant(
			prunable.length === 0,
			`${prunable.length} unprotected stale Pages deployments remain after reconciliation.`
		);
	}
	const preserved = partition.prune.filter((deployment) => preservedIds.has(deployment.id)).length;

	return {
		canonicalDeploymentId: state.project.canonical_deployment?.id ?? '',
		total: state.deployments.length,
		kept: partition.keep.length,
		stale: prunable.length,
		preserved,
		deleted
	};
}

/**
 * @param {string[]} argv
 */
export function parseCliArgs(argv) {
	let prune = false;
	/** @type {string | undefined} */
	let maxDelete;
	/** @type {string | undefined} */
	let expectedProductionSha;
	/** @type {string[]} */
	const preserveDeploymentIds = [];

	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		switch (flag) {
			case '--prune':
				invariant(!prune, '--prune may only be supplied once.');
				prune = true;
				break;
			case '--max-delete':
				invariant(maxDelete === undefined, '--max-delete may only be supplied once.');
				maxDelete = argv[index + 1];
				invariant(
					maxDelete !== undefined && !maxDelete.startsWith('--'),
					'--max-delete requires a value.'
				);
				index += 1;
				break;
			case '--expected-production-sha':
				invariant(
					expectedProductionSha === undefined,
					'--expected-production-sha may only be supplied once.'
				);
				expectedProductionSha = argv[index + 1];
				invariant(
					expectedProductionSha !== undefined && !expectedProductionSha.startsWith('--'),
					'--expected-production-sha requires a value.'
				);
				index += 1;
				break;
			case '--preserve-deployment-id': {
				const deploymentId = argv[index + 1];
				invariant(
					deploymentId !== undefined && !deploymentId.startsWith('--'),
					'--preserve-deployment-id requires a value.'
				);
				invariant(
					DEPLOYMENT_ID_RE.test(deploymentId),
					'--preserve-deployment-id must be an exact lowercase Cloudflare deployment ID.'
				);
				invariant(
					!preserveDeploymentIds.includes(deploymentId),
					'--preserve-deployment-id values must be unique.'
				);
				preserveDeploymentIds.push(deploymentId);
				index += 1;
				break;
			}
			default:
				throw new Error(`Unknown argument: ${flag}`);
		}
	}

	invariant(maxDelete === undefined || prune, '--max-delete requires --prune.');
	return { prune, maxDelete, expectedProductionSha, preserveDeploymentIds };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
	try {
		const args = parseCliArgs(process.argv.slice(2));
		const allowedAliasBranches = (
			process.env.CF_PAGES_ALLOWED_ALIAS_BRANCHES ?? DEFAULT_ALLOWED_ALIAS_BRANCHES.join(',')
		)
			.split(',')
			.map((branch) => branch.trim())
			.filter(Boolean);
		const result = await reconcilePagesExposure({
			token: process.env.CLOUDFLARE_API_TOKEN,
			accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
			projectName: process.env.CF_PAGES_PROJECT ?? DEFAULT_PAGES_PROJECT,
			allowedAliasBranches,
			prune: args.prune,
			maxDelete:
				args.maxDelete === undefined
					? undefined
					: parsePositiveInteger(args.maxDelete, '--max-delete', 1),
			concurrency: parsePositiveInteger(
				process.env.CF_PAGES_PRUNE_CONCURRENCY,
				'CF_PAGES_PRUNE_CONCURRENCY',
				DEFAULT_CONCURRENCY,
				MAX_CONCURRENCY
			),
			expectedProductionSha: args.expectedProductionSha,
			preserveDeploymentIds: args.preserveDeploymentIds
		});
		console.log(
			`Cloudflare Pages exposure: total=${result.total}; kept=${result.kept}; ` +
				`stale=${result.stale}; preserved=${result.preserved}; deleted=${result.deleted}; canonical=${result.canonicalDeploymentId}.`
		);
		if (!args.prune && result.stale > 0) process.exitCode = 1;
	} catch (error) {
		console.error(
			`Cloudflare Pages exposure reconciliation failed: ${error instanceof Error ? error.message : String(error)}`
		);
		process.exitCode = 1;
	}
}
