#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_SNAPSHOT_BYTES = 900_000;
export const DEFAULT_MAX_SNAPSHOT_AGE_MS = 26 * 60 * 60 * 1000;

/**
 * @typedef {object} ReadinessInput
 * @property {unknown} manifest
 * @property {unknown} allList
 * @property {unknown} excludeCwcList
 * @property {unknown} relations
 */

/**
 * @typedef {object} ReadinessOptions
 * @property {boolean} [requireContent]
 * @property {number} [maxAgeMs]
 * @property {number} [now]
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function positiveRevision(value) {
	return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function currentTimestamp(value) {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** @param {string | undefined} value */
function configuredMaxAgeMs(value) {
	if (value === undefined || value === '') return DEFAULT_MAX_SNAPSHOT_AGE_MS;
	const hours = Number(value);
	if (!Number.isFinite(hours) || hours <= 0) {
		throw new Error('PUBLIC_DISCOVERY_MAX_AGE_HOURS must be a positive number');
	}
	return hours * 60 * 60 * 1000;
}

/**
 * Validate the producer-readiness hyperedge before an edge consumer deploys.
 * A valid empty materialization is supported by Convex, but production release
 * callers retain `requireContent: true` so an accidentally cold corpus cannot
 * be mistaken for the known populated Commons deployment.
 *
 * @param {ReadinessInput} input
 * @param {ReadinessOptions} [options]
 */
export function validatePublicDiscoveryReadiness(
	{ manifest, allList, excludeCwcList, relations },
	{ requireContent = true, maxAgeMs = DEFAULT_MAX_SNAPSHOT_AGE_MS, now = Date.now() } = {}
) {
	if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
		throw new Error('maxAgeMs must be a positive finite number');
	}
	if (!Number.isFinite(now) || now <= 0) {
		throw new Error('now must be a positive finite timestamp');
	}

	/** @type {string[]} */
	const errors = [];
	const listState = isRecord(manifest) && isRecord(manifest.list) ? manifest.list : null;
	const relationState =
		isRecord(manifest) && isRecord(manifest.relations) ? manifest.relations : null;

	if (!listState) errors.push('manifest.list is missing');
	if (!relationState) errors.push('manifest.relations is missing');
	if (listState?.ready !== true) errors.push('manifest.list.ready is not true');
	if (relationState?.ready !== true) errors.push('manifest.relations.ready is not true');
	if (!positiveRevision(listState?.revision)) errors.push('manifest.list.revision is not positive');
	if (!positiveRevision(relationState?.revision)) {
		errors.push('manifest.relations.revision is not positive');
	}
	if (!currentTimestamp(listState?.updatedAt)) errors.push('manifest.list.updatedAt is invalid');
	if (!currentTimestamp(relationState?.updatedAt)) {
		errors.push('manifest.relations.updatedAt is invalid');
	}
	/** @type {Array<[string, unknown]>} */
	const manifestTimestamps = [
		['manifest.list', listState?.updatedAt],
		['manifest.relations', relationState?.updatedAt]
	];
	for (const [name, updatedAt] of manifestTimestamps) {
		if (!currentTimestamp(updatedAt)) continue;
		const ageMs = now - updatedAt;
		if (ageMs < 0) {
			errors.push(`${name}.updatedAt is in the future`);
		} else if (ageMs > maxAgeMs) {
			errors.push(`${name}.updatedAt is stale by ${ageMs - maxAgeMs}ms`);
		}
	}

	/** @type {Array<[string, unknown]>} */
	const listPayloads = [
		['allList', allList],
		['excludeCwcList', excludeCwcList]
	];
	for (const [name, payload] of listPayloads) {
		if (!isRecord(payload)) {
			errors.push(`${name} is missing`);
			continue;
		}
		if (payload.revision !== listState?.revision) {
			errors.push(`${name}.revision does not match manifest.list.revision`);
		}
		if (payload.updatedAt !== listState?.updatedAt) {
			errors.push(`${name}.updatedAt does not match manifest.list.updatedAt`);
		}
		if (!Array.isArray(payload.templates)) {
			errors.push(`${name}.templates is not an array`);
		} else if (requireContent && payload.templates.length === 0) {
			errors.push(`${name}.templates is empty for a populated production release`);
		}
	}

	if (!isRecord(relations)) {
		errors.push('relations payload is missing');
	} else {
		if (relations.revision !== relationState?.revision) {
			errors.push('relations.revision does not match manifest.relations.revision');
		}
		if (relations.updatedAt !== relationState?.updatedAt) {
			errors.push('relations.updatedAt does not match manifest.relations.updatedAt');
		}
		if (!Array.isArray(relations.twinEdges)) errors.push('relations.twinEdges is not an array');
		if (!isRecord(relations.conceptRelations)) {
			errors.push('relations.conceptRelations is missing');
		} else {
			if (!Array.isArray(relations.conceptRelations.edges)) {
				errors.push('relations.conceptRelations.edges is not an array');
			}
			if (!isRecord(relations.conceptRelations.conceptMap)) {
				errors.push('relations.conceptRelations.conceptMap is not an object');
			}
		}
	}

	const sizes = {
		allList: Buffer.byteLength(JSON.stringify(allList ?? null)),
		excludeCwcList: Buffer.byteLength(JSON.stringify(excludeCwcList ?? null)),
		relations: Buffer.byteLength(JSON.stringify(relations ?? null))
	};
	for (const [name, bytes] of Object.entries(sizes)) {
		if (bytes > MAX_SNAPSHOT_BYTES) {
			errors.push(`${name} serialized payload is ${bytes} bytes, above ${MAX_SNAPSHOT_BYTES}`);
		}
	}

	if (errors.length > 0) {
		throw new Error(`PUBLIC_DISCOVERY_NOT_READY:\n- ${errors.join('\n- ')}`);
	}

	// The checks above establish these report-only views. Keep the network
	// payloads unknown until validation so malformed producer responses fail
	// closed instead of being trusted through a broad input type.
	const readyListState = /** @type {{ revision: number; updatedAt: number }} */ (listState);
	const readyRelationState = /** @type {{ revision: number; updatedAt: number }} */ (relationState);
	const readyAllList = /** @type {{ templates: unknown[] }} */ (allList);
	const readyExcludeCwcList = /** @type {{ templates: unknown[] }} */ (excludeCwcList);
	const readyRelations = /** @type {{
	 * twinEdges: unknown[];
	 * conceptRelations: { edges: unknown[] };
	 * }} */ (relations);

	return {
		listRevision: readyListState.revision,
		relationsRevision: readyRelationState.revision,
		listAgeMs: now - readyListState.updatedAt,
		relationsAgeMs: now - readyRelationState.updatedAt,
		allCount: readyAllList.templates.length,
		excludeCwcCount: readyExcludeCwcList.templates.length,
		twinEdgeCount: readyRelations.twinEdges.length,
		conceptEdgeCount: readyRelations.conceptRelations.edges.length,
		sizes
	};
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {string} label
 * @param {number} timeoutMs
 * @returns {Promise<T>}
 */
async function withTimeout(promise, label, timeoutMs) {
	let timeout;
	try {
		const timeoutPromise = /** @type {Promise<never>} */ (
			new Promise((_, reject) => {
				timeout = setTimeout(
					() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
					timeoutMs
				);
			})
		);
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * @param {string | undefined} convexUrl
 * @param {ReadinessOptions & { timeoutMs?: number }} [options]
 */
export async function verifyPublicDiscoveryReadiness(
	convexUrl,
	{
		timeoutMs = DEFAULT_TIMEOUT_MS,
		requireContent = true,
		maxAgeMs = DEFAULT_MAX_SNAPSHOT_AGE_MS,
		now = Date.now()
	} = {}
) {
	if (typeof convexUrl !== 'string') {
		throw new Error('A valid https://*.convex.cloud URL is required');
	}
	let parsedUrl;
	try {
		parsedUrl = new URL(convexUrl);
	} catch {
		throw new Error('A valid https://*.convex.cloud URL is required');
	}
	if (
		parsedUrl.protocol !== 'https:' ||
		!parsedUrl.hostname.endsWith('.convex.cloud') ||
		parsedUrl.username !== '' ||
		parsedUrl.password !== '' ||
		parsedUrl.pathname !== '/' ||
		parsedUrl.search !== '' ||
		parsedUrl.hash !== ''
	) {
		throw new Error('A valid https://*.convex.cloud URL is required');
	}

	const client = new ConvexHttpClient(parsedUrl.origin);
	const manifest = await withTimeout(
		client.query(anyApi.templates.publicDiscoveryManifest, {}),
		'templates:publicDiscoveryManifest',
		timeoutMs
	);
	const [allList, excludeCwcList, relations] = await Promise.all([
		withTimeout(
			client.query(anyApi.templates.publicDiscoveryList, { excludeCwc: false }),
			'templates:publicDiscoveryList(all)',
			timeoutMs
		),
		withTimeout(
			client.query(anyApi.templates.publicDiscoveryList, { excludeCwc: true }),
			'templates:publicDiscoveryList(excludeCwc)',
			timeoutMs
		),
		withTimeout(
			client.query(anyApi.templates.publicDiscoveryRelations, {}),
			'templates:publicDiscoveryRelations',
			timeoutMs
		)
	]);

	return validatePublicDiscoveryReadiness(
		{ manifest, allList, excludeCwcList, relations },
		{ requireContent, maxAgeMs, now }
	);
}

async function main() {
	const convexUrl = process.argv[2] || process.env.PUBLIC_CONVEX_URL;
	try {
		const maxAgeMs = configuredMaxAgeMs(process.env.PUBLIC_DISCOVERY_MAX_AGE_HOURS);
		const report = await verifyPublicDiscoveryReadiness(convexUrl, { maxAgeMs });
		console.log(`Public discovery producer ready: ${JSON.stringify(report)}`);
	} catch (error) {
		console.error(
			`Public discovery producer readiness failed: ${error instanceof Error ? error.message : String(error)}`
		);
		process.exitCode = 1;
	}
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) await main();
