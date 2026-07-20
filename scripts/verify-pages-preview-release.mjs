#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';

const PAGE_SIZE = 100;
const MAX_PAGES = 2_000;
const RELEASE_MESSAGE_PATTERN =
	/^commons-release-v1 transaction=([1-9][0-9]{0,19}-[1-9][0-9]{0,9}) gate=([a-f0-9]{40}) artifact=([a-f0-9]{64})(?: component=(pages-containment) realm=(preview|production))?$/u;

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {Record<string, any> | null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** @param {unknown} value */
function exactAliasHost(value) {
	if (typeof value !== 'string') return null;
	try {
		const url = new URL(value.includes('://') ? value : `https://${value}`);
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

/** @param {unknown} value */
export function parsePagesReleaseMessage(value) {
	if (typeof value !== 'string') {
		return {
			releaseTransaction: null,
			trustedGateSha: null,
			artifactDigest: null,
			releaseComponent: null,
			releaseRealm: null
		};
	}
	const match = RELEASE_MESSAGE_PATTERN.exec(value);
	if (!match) {
		return {
			releaseTransaction: null,
			trustedGateSha: null,
			artifactDigest: null,
			releaseComponent: null,
			releaseRealm: null
		};
	}
	return {
		releaseTransaction: match[1],
		trustedGateSha: match[2],
		artifactDigest: match[3],
		releaseComponent: match[4] ?? 'pages',
		releaseRealm: match[5] ?? null
	};
}

/**
 * @param {{deployments: unknown, expectedSha: string,expectedTransaction?:string,expectedTrustedGateSha?:string,expectedArtifactDigest?:string,expectedComponent?:'pages'|'pages-containment', branch?: string, project?: string}} input
 */
export function validateExactPreviewRelease({
	deployments,
	expectedSha,
	expectedTransaction,
	expectedTrustedGateSha,
	expectedArtifactDigest,
	expectedComponent,
	branch = 'main',
	project = 'communique-site'
}) {
	invariant(
		/^[a-f0-9]{40}$/.test(expectedSha),
		'Expected preview SHA must be exact lowercase Git SHA.'
	);
	invariant(/^[a-z0-9-]+$/.test(branch), 'Preview branch is invalid.');
	invariant(/^[a-z0-9-]+$/.test(project), 'Pages project is invalid.');
	invariant(Array.isArray(deployments), 'Pages preview deployment inventory must be an array.');
	const candidates = deployments.filter(
		(deployment) => record(record(deployment)?.deployment_trigger)?.metadata?.branch === branch
	);
	invariant(candidates.length > 0, `Pages has no ${branch} preview deployment.`);
	for (const deployment of candidates) {
		invariant(
			typeof record(deployment)?.created_on === 'string' &&
				!Number.isNaN(Date.parse(deployment.created_on)),
			`Pages ${branch} deployment has an invalid creation time.`
		);
	}
	candidates.sort((left, right) => Date.parse(right.created_on) - Date.parse(left.created_on));
	const latest = record(candidates[0]);
	const trigger = record(latest?.deployment_trigger);
	const metadata = record(trigger?.metadata);
	invariant(
		latest?.environment === 'preview' &&
			latest?.latest_stage?.status === 'success' &&
			latest?.is_skipped === false &&
			trigger?.type === 'ad_hoc' &&
			metadata?.branch === branch &&
			metadata?.commit_dirty === false &&
			metadata?.commit_hash === expectedSha,
		`Latest ${branch} preview is not the exact clean successful release ${expectedSha}.`
	);
	const release = parsePagesReleaseMessage(metadata?.commit_message);
	if (
		expectedTransaction !== undefined ||
		expectedTrustedGateSha !== undefined ||
		expectedArtifactDigest !== undefined ||
		expectedComponent !== undefined
	) {
		invariant(
			release.releaseTransaction === expectedTransaction &&
				release.trustedGateSha === expectedTrustedGateSha &&
				release.artifactDigest === expectedArtifactDigest &&
				release.releaseComponent === (expectedComponent ?? 'pages') &&
				(release.releaseComponent !== 'pages-containment' || release.releaseRealm === 'preview'),
			`Latest ${branch} preview does not identify the exact release transaction.`
		);
	}
	const expectedAlias = `${branch}.${project}.pages.dev`;
	invariant(
		Array.isArray(latest.aliases) &&
			latest.aliases.some((alias) => exactAliasHost(alias) === expectedAlias),
		`Latest ${branch} preview does not hold ${expectedAlias}.`
	);
	invariant(
		typeof latest.id === 'string' && latest.id.length > 0,
		`Latest ${branch} preview deployment id is missing.`
	);
	return { deploymentId: latest.id, branch, releaseSha: expectedSha, ...release };
}

/** @param {{base: string, headers: Record<string, string>, fetchFn: typeof fetch}} input */
async function readInventory({ base, headers, fetchFn }) {
	/** @type {unknown[]} */
	const deployments = [];
	let expectedTotal = null;
	let expectedPages = null;
	for (let page = 1; ; page += 1) {
		invariant(page <= MAX_PAGES, 'Pages preview inventory exceeds the bounded page limit.');
		const response = await fetchFn(
			`${base}/deployments?env=preview&page=${page}&per_page=${PAGE_SIZE}`,
			{ headers, redirect: 'error', signal: AbortSignal.timeout(15_000) }
		);
		invariant(response.ok, `Pages preview inventory returned HTTP ${response.status}.`);
		const envelope = record(
			await readBoundedResponseJson(response, 'Pages preview inventory response')
		);
		const rows = envelope?.result;
		const info = record(envelope?.result_info);
		invariant(
			envelope?.success === true && Array.isArray(rows),
			'Pages preview inventory is malformed.'
		);
		invariant(info !== null, 'Pages preview pagination is malformed.');
		invariant(
			Number.isSafeInteger(info.total_pages) &&
				info.total_pages >= 1 &&
				info.total_pages <= MAX_PAGES &&
				Number.isSafeInteger(info.total_count) &&
				info.total_count >= 0,
			'Pages preview pagination is malformed.'
		);
		expectedTotal ??= info.total_count;
		expectedPages ??= info.total_pages;
		invariant(
			info.total_count === expectedTotal && info.total_pages === expectedPages,
			'Pages preview inventory changed during pagination.'
		);
		deployments.push(...rows);
		if (page === expectedPages) break;
	}
	const ids = deployments.map((deployment) => record(deployment)?.id);
	invariant(
		ids.every((id) => typeof id === 'string' && id.length > 0) &&
			new Set(ids).size === ids.length &&
			deployments.length === expectedTotal,
		'Pages preview inventory is incomplete or duplicated.'
	);
	return deployments;
}

/**
 * @param {{accountId: string|undefined, apiToken: string|undefined, expectedSha: string|undefined, expectedTransaction?:string,expectedTrustedGateSha?:string,expectedArtifactDigest?:string,expectedComponent?:'pages'|'pages-containment', branch?: string, fetchFn?: typeof fetch, pagesProject?: string}} input
 */
export async function verifyExactPreviewRelease({
	accountId,
	apiToken,
	expectedSha,
	expectedTransaction,
	expectedTrustedGateSha,
	expectedArtifactDigest,
	expectedComponent,
	branch = 'main',
	fetchFn = fetch,
	pagesProject = 'communique-site'
}) {
	invariant(
		typeof accountId === 'string' && /^[a-f0-9]{32}$/.test(accountId),
		'Invalid account id.'
	);
	invariant(
		typeof apiToken === 'string' && apiToken.length > 0,
		'CLOUDFLARE_API_TOKEN is required.'
	);
	invariant(typeof expectedSha === 'string', 'DEPLOY_SHA is required.');
	const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${pagesProject}`;
	const headers = { Authorization: `Bearer ${apiToken}` };
	const first = await readInventory({ base, headers, fetchFn });
	const second = await readInventory({ base, headers, fetchFn });
	/** @param {unknown[]} rows */
	const fingerprint = (rows) =>
		rows
			.map(
				(/** @type {unknown} */ row) => `${record(row)?.id ?? ''}:${record(row)?.modified_on ?? ''}`
			)
			.sort()
			.join('\n');
	invariant(
		fingerprint(first) === fingerprint(second),
		'Pages preview inventory did not stabilize.'
	);
	return validateExactPreviewRelease({
		deployments: second,
		expectedSha,
		expectedTransaction,
		expectedTrustedGateSha,
		expectedArtifactDigest,
		expectedComponent,
		branch,
		project: pagesProject
	});
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
	try {
		if (process.argv.length !== 2) throw new Error('This verifier accepts no arguments.');
		console.log(
			JSON.stringify(
				await verifyExactPreviewRelease({
					accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
					apiToken: process.env.CLOUDFLARE_API_TOKEN,
					expectedSha: process.env.DEPLOY_SHA,
					expectedTransaction: process.env.DEPLOY_TRANSACTION_ID,
					expectedTrustedGateSha: process.env.DEPLOY_TRUSTED_GATE_SHA,
					expectedArtifactDigest: process.env.DEPLOY_ARTIFACT_DIGEST,
					expectedComponent: /** @type {'pages'|'pages-containment'|undefined} */ (
						process.env.DEPLOY_COMPONENT
					),
					branch: process.env.DEPLOY_BRANCH
				})
			)
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
