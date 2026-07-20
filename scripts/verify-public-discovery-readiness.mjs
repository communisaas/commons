#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_SNAPSHOT_BYTES = 900_000;
const MAX_PUBLIC_TEMPLATE_COUNT = 50;
const MAX_PUBLIC_RELATION_EDGES = 10_000;
const MAX_PUBLIC_CONCEPT_ENTRIES = 10_000;
const MAX_COHERENT_READ_ATTEMPTS = 3;
const MIN_INTERNAL_SECRET_BYTES = 32;
const PUBLIC_TEMPLATE_PROJECTION_VERSION = 4;
const PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_PROJECTION_VERSION = 1;
const PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_MAX_BYTES = 4 * 1024;
export const REQUIRED_LAUNCH_PROJECTION_PLANES = Object.freeze([
	'discoverySource',
	'endorsementCounts',
	'templateList',
	'recipientMetrics',
	'sessionAuthority',
	'campaignReadModel',
	'campaignCounters',
	'debateReadModel',
	'organizationDirectory',
	'coalitionMetrics',
	'networkCharters',
	'supporterBrowse',
	'supporterAudienceActions',
	'accountabilityReadModel',
	'planUsage',
	'subscriptionAuthority',
	'contactAuthority',
	'workflowExecutionCounts',
	'donationConfirmationSummaries',
	'smsReplySummaries'
]);
export const DEFAULT_MAX_SNAPSHOT_AGE_MS = 26 * 60 * 60 * 1000;

/**
 * @typedef {object} ReadinessInput
 * @property {unknown} manifest
 * @property {unknown} allList
 * @property {unknown} excludeCwcList
 * @property {unknown} allRelations
 * @property {unknown} excludeCwcRelations
 * @property {unknown} producerStatus
 */

/**
 * @typedef {object} ReadinessOptions
 * @property {boolean} [requireContent]
 * @property {boolean} [contractOnly]
 * @property {number} [maxAgeMs]
 * @property {number} [now]
 * @property {string} [internalSecret]
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
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function currentTimestamp(value) {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Validate the read-only deploy proof for the compact manifest authority.
 * The recurring public manifest read never touches the wide control row; this
 * direct Convex proof is intentionally deploy/on-demand only.
 *
 * @param {unknown} value
 */
export function validatePublicDiscoveryManifestAuthorityStatus(value) {
	const status = isRecord(value) ? value : null;
	if (!status) {
		throw new Error('PUBLIC_DISCOVERY_NOT_READY: manifestAuthorityStatus is missing');
	}
	const errors = [];
	{
		if (status.ready !== true) errors.push('manifestAuthorityStatus.ready is not true');
		if (status.matches !== true) errors.push('manifestAuthorityStatus.matches is not true');
		if (
			!Number.isSafeInteger(status.bytes) ||
			/** @type {number} */ (status.bytes) <= 0 ||
			/** @type {number} */ (status.bytes) > PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_MAX_BYTES
		) {
			errors.push('manifestAuthorityStatus.bytes exceeds the compact authority bound');
		}
		if (status.maxBytes !== PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_MAX_BYTES) {
			errors.push('manifestAuthorityStatus.maxBytes is not the reviewed 4 KiB bound');
		}
		if (status.projectionVersion !== PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_PROJECTION_VERSION) {
			errors.push('manifestAuthorityStatus.projectionVersion is not the reviewed version');
		}
	}
	if (errors.length > 0) {
		throw new Error(`PUBLIC_DISCOVERY_NOT_READY: ${errors.join('; ')}`);
	}
	return {
		manifestAuthorityBytes: /** @type {number} */ (status?.bytes),
		manifestAuthorityMaxBytes: PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_MAX_BYTES,
		manifestAuthorityProjectionVersion: PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_PROJECTION_VERSION
	};
}

/**
 * Validate the public template projection and return the ids its matching graph
 * is allowed to reference.
 *
 * @param {string} name
 * @param {unknown[]} templates
 * @param {boolean} excludeCwc
 * @param {string[]} errors
 */
function validateTemplateProjection(name, templates, excludeCwc, errors) {
	const ids = new Set();
	if (templates.length > MAX_PUBLIC_TEMPLATE_COUNT) {
		errors.push(`${name}.templates exceeds the ${MAX_PUBLIC_TEMPLATE_COUNT}-card public limit`);
	}
	for (const [index, template] of templates.entries()) {
		if (!isRecord(template) || typeof template.id !== 'string' || template.id.length === 0) {
			errors.push(`${name}.templates[${index}] has no string id`);
			continue;
		}
		if (ids.has(template.id)) {
			errors.push(`${name}.templates[${index}] duplicates id ${template.id}`);
		}
		ids.add(template.id);
		if (typeof template.deliveryMethod !== 'string') {
			errors.push(`${name}.templates[${index}].deliveryMethod is not a string`);
		} else if (excludeCwc && template.deliveryMethod === 'cwc') {
			errors.push(`${name}.templates[${index}] leaks a CWC template`);
		}
		if (template.recipient_config !== null) {
			errors.push(`${name}.templates[${index}].recipient_config is not null`);
		}
		if (!Array.isArray(template.recipientEmails) || template.recipientEmails.length !== 0) {
			errors.push(`${name}.templates[${index}].recipientEmails is not an empty array`);
		}
		if (
			typeof template.recipient_count !== 'number' ||
			!Number.isSafeInteger(template.recipient_count) ||
			template.recipient_count < 0
		) {
			errors.push(`${name}.templates[${index}].recipient_count is not a non-negative integer`);
		}
	}
	return ids;
}

/**
 * @param {string} name
 * @param {unknown[]} edges
 * @param {Set<unknown>} visibleIds
 * @param {'twin' | 'concept'} expectedKind
 * @param {string[]} errors
 */
function validateVisibleEndpoints(name, edges, visibleIds, expectedKind, errors) {
	if (edges.length > MAX_PUBLIC_RELATION_EDGES) {
		errors.push(`${name} exceeds the ${MAX_PUBLIC_RELATION_EDGES}-edge public limit`);
	}
	for (const [index, edge] of edges.entries()) {
		if (!isRecord(edge) || typeof edge.a !== 'string' || typeof edge.b !== 'string') {
			errors.push(`${name}[${index}] has invalid endpoints`);
			continue;
		}
		if (edge.kind !== expectedKind) {
			errors.push(`${name}[${index}].kind is not ${expectedKind}`);
		}
		if (
			(expectedKind === 'twin' &&
				(typeof edge.score !== 'number' || !Number.isFinite(edge.score))) ||
			(expectedKind === 'concept' && typeof edge.concept !== 'string')
		) {
			errors.push(`${name}[${index}] has invalid ${expectedKind} fields`);
		}
		for (const endpoint of [edge.a, edge.b]) {
			if (!visibleIds.has(endpoint)) {
				errors.push(`${name}[${index}] endpoint ${endpoint} is absent from its matching list`);
			}
		}
	}
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

/** @param {string | undefined} value @param {string} name @param {boolean} fallback */
function configuredBoolean(value, name, fallback) {
	if (value === undefined || value === '') return fallback;
	if (value === 'true') return true;
	if (value === 'false') return false;
	throw new Error(`${name} must be true or false`);
}

/**
 * Parse the fail-closed release policy used by the CLI and deploy workflow.
 * Production uses the defaults; non-production explicitly opts into the
 * contract-only mode and permits a legitimately empty corpus.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 */
export function readinessOptionsFromEnv(env) {
	return {
		maxAgeMs: configuredMaxAgeMs(env.PUBLIC_DISCOVERY_MAX_AGE_HOURS),
		requireContent: configuredBoolean(
			env.PUBLIC_DISCOVERY_REQUIRE_CONTENT,
			'PUBLIC_DISCOVERY_REQUIRE_CONTENT',
			true
		),
		contractOnly: configuredBoolean(
			env.PUBLIC_DISCOVERY_CONTRACT_ONLY,
			'PUBLIC_DISCOVERY_CONTRACT_ONLY',
			false
		)
	};
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
	{ manifest, allList, excludeCwcList, allRelations, excludeCwcRelations, producerStatus },
	{
		requireContent = true,
		contractOnly = false,
		maxAgeMs = DEFAULT_MAX_SNAPSHOT_AGE_MS,
		now = Date.now()
	} = {}
) {
	if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
		throw new Error('maxAgeMs must be a positive finite number');
	}
	if (!Number.isFinite(now) || now <= 0) {
		throw new Error('now must be a positive finite timestamp');
	}

	/** @type {string[]} */
	const errors = [];
	const producerState = isRecord(producerStatus) ? producerStatus : null;
	const listState = isRecord(manifest) && isRecord(manifest.list) ? manifest.list : null;
	const relationState =
		isRecord(manifest) && isRecord(manifest.relations) ? manifest.relations : null;

	// Snapshot shape alone cannot expose durable producer failure evidence: a
	// rebuild may intentionally publish a safe remainder while retaining a
	// manifest failure code. The tiny service-ping control plane carries that
	// state, so every release mode must prove it healthy before Pages uploads.
	if (!producerState) {
		errors.push('producerStatus is missing');
	} else {
		if (producerState.ok !== true) errors.push('producerStatus.ok is not true');
		if (producerState.storageReadable !== true) {
			errors.push('producerStatus.storageReadable is not true');
		}
		if (producerState.discoveryManifestPresent !== true) {
			errors.push('producerStatus.discoveryManifestPresent is not true');
		}
		if (producerState.discoverySourcePlaneReady !== true) {
			errors.push('producerStatus.discoverySourcePlaneReady is not true');
		}
		if (producerState.discoveryEndorsementCountsReady !== true) {
			errors.push('producerStatus.discoveryEndorsementCountsReady is not true');
		}
		if (producerState.templateListProjectionReady !== true) {
			errors.push('producerStatus.templateListProjectionReady is not true');
		}
		if (producerState.templateListProjectionStatus !== 'ready') {
			errors.push('producerStatus.templateListProjectionStatus is not ready');
		}
		if (producerState.recipientMetricsReady !== true) {
			errors.push('producerStatus.recipientMetricsReady is not true');
		}
		if (producerState.recipientMetricsStatus !== 'ready') {
			errors.push('producerStatus.recipientMetricsStatus is not ready');
		}
		if (producerState.launchProjectionsReady !== true) {
			errors.push('producerStatus.launchProjectionsReady is not true');
		}
		const launchPlanes = isRecord(producerState.launchProjectionPlanes)
			? producerState.launchProjectionPlanes
			: null;
		if (!launchPlanes) {
			errors.push('producerStatus.launchProjectionPlanes is missing');
		} else {
			const requiredNames = [...REQUIRED_LAUNCH_PROJECTION_PLANES].sort();
			const actualNames = Object.keys(launchPlanes).sort();
			for (const name of requiredNames) {
				if (!Object.hasOwn(launchPlanes, name)) {
					errors.push(`producerStatus.launchProjectionPlanes.${name} is missing`);
					continue;
				}
				const plane = launchPlanes[name];
				if (!isRecord(plane)) {
					errors.push(`producerStatus.launchProjectionPlanes.${name} is invalid`);
					continue;
				}
				if (plane.ready !== true) {
					errors.push(`producerStatus.launchProjectionPlanes.${name}.ready is not true`);
				}
				if (
					typeof plane.status !== 'string' ||
					plane.status.length === 0 ||
					plane.status === 'missing'
				) {
					errors.push(`producerStatus.launchProjectionPlanes.${name}.status is not ready`);
				}
				if (plane.failureCode !== null) {
					errors.push(`producerStatus.launchProjectionPlanes.${name}.failureCode is not null`);
				}
			}
			for (const name of actualNames) {
				if (!REQUIRED_LAUNCH_PROJECTION_PLANES.includes(name)) {
					errors.push(`producerStatus.launchProjectionPlanes.${name} is unexpected`);
				}
			}
		}
		if (producerState.discoveryProducerHealthy !== true) {
			errors.push('producerStatus.discoveryProducerHealthy is not true');
		}

		const overdueAt = producerState.discoveryProducerOverdueAt;
		if (overdueAt !== null) {
			if (!currentTimestamp(overdueAt)) {
				errors.push('producerStatus.discoveryProducerOverdueAt is invalid');
			} else if (now > overdueAt) {
				errors.push(`producerStatus.discoveryProducerOverdueAt is overdue by ${now - overdueAt}ms`);
			}
		}
	}

	if (!listState) errors.push('manifest.list is missing');
	if (!relationState) errors.push('manifest.relations is missing');
	if (listState?.ready !== true) errors.push('manifest.list.ready is not true');
	if (relationState?.ready !== true) errors.push('manifest.relations.ready is not true');
	if (!positiveRevision(listState?.revision)) {
		errors.push('manifest.list.revision is not a positive safe integer');
	}
	if (!positiveRevision(relationState?.revision)) {
		errors.push('manifest.relations.revision is not a positive safe integer');
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
		if (contractOnly) continue;
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
	/** @type {Record<string, Set<unknown>>} */
	const visibleIds = { allList: new Set(), excludeCwcList: new Set() };
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
		if (payload.projectionVersion !== PUBLIC_TEMPLATE_PROJECTION_VERSION) {
			errors.push(`${name}.projectionVersion is not ${PUBLIC_TEMPLATE_PROJECTION_VERSION}`);
		}
		if (!Array.isArray(payload.templates)) {
			errors.push(`${name}.templates is not an array`);
		} else {
			visibleIds[name] = validateTemplateProjection(
				name,
				payload.templates,
				name === 'excludeCwcList',
				errors
			);
			if (requireContent && payload.templates.length === 0) {
				errors.push(`${name}.templates is empty for a populated production release`);
			}
		}
	}

	/** @type {Array<[string, unknown, Set<unknown>]>} */
	const relationPayloads = [
		['allRelations', allRelations, visibleIds.allList],
		['excludeCwcRelations', excludeCwcRelations, visibleIds.excludeCwcList]
	];
	for (const [name, payload, matchingIds] of relationPayloads) {
		if (!isRecord(payload)) {
			errors.push(`${name} payload is missing`);
			continue;
		}
		if (payload.revision !== relationState?.revision) {
			errors.push(`${name}.revision does not match manifest.relations.revision`);
		}
		if (payload.updatedAt !== relationState?.updatedAt) {
			errors.push(`${name}.updatedAt does not match manifest.relations.updatedAt`);
		}
		if (!Array.isArray(payload.twinEdges)) {
			errors.push(`${name}.twinEdges is not an array`);
		} else {
			validateVisibleEndpoints(`${name}.twinEdges`, payload.twinEdges, matchingIds, 'twin', errors);
		}
		if (!isRecord(payload.conceptRelations)) {
			errors.push(`${name}.conceptRelations is missing`);
		} else {
			if (!Array.isArray(payload.conceptRelations.edges)) {
				errors.push(`${name}.conceptRelations.edges is not an array`);
			} else {
				validateVisibleEndpoints(
					`${name}.conceptRelations.edges`,
					payload.conceptRelations.edges,
					matchingIds,
					'concept',
					errors
				);
			}
			if (!isRecord(payload.conceptRelations.conceptMap)) {
				errors.push(`${name}.conceptRelations.conceptMap is not an object`);
			} else {
				const conceptEntries = Object.entries(payload.conceptRelations.conceptMap);
				if (conceptEntries.length > MAX_PUBLIC_CONCEPT_ENTRIES) {
					errors.push(
						`${name}.conceptRelations.conceptMap exceeds the ${MAX_PUBLIC_CONCEPT_ENTRIES}-entry public limit`
					);
				}
				for (const [tag, concept] of conceptEntries) {
					if (typeof concept !== 'string') {
						errors.push(
							`${name}.conceptRelations.conceptMap[${JSON.stringify(tag)}] is not a string`
						);
					}
				}
			}
		}
	}

	const sizes = {
		allList: Buffer.byteLength(JSON.stringify(allList ?? null)),
		excludeCwcList: Buffer.byteLength(JSON.stringify(excludeCwcList ?? null)),
		allRelations: Buffer.byteLength(JSON.stringify(allRelations ?? null)),
		excludeCwcRelations: Buffer.byteLength(JSON.stringify(excludeCwcRelations ?? null))
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
	const readyAllRelations = /** @type {{
	 * twinEdges: unknown[];
	 * conceptRelations: { edges: unknown[] };
	 * }} */ (allRelations);
	const readyExcludeCwcRelations = /** @type {{
	 * twinEdges: unknown[];
	 * conceptRelations: { edges: unknown[] };
	 * }} */ (excludeCwcRelations);
	const readyProducerState = /** @type {{ discoveryProducerOverdueAt: number | null }} */ (
		producerState
	);

	return {
		listRevision: readyListState.revision,
		relationsRevision: readyRelationState.revision,
		listAgeMs: now - readyListState.updatedAt,
		relationsAgeMs: now - readyRelationState.updatedAt,
		allCount: readyAllList.templates.length,
		excludeCwcCount: readyExcludeCwcList.templates.length,
		allTwinEdgeCount: readyAllRelations.twinEdges.length,
		allConceptEdgeCount: readyAllRelations.conceptRelations.edges.length,
		excludeCwcTwinEdgeCount: readyExcludeCwcRelations.twinEdges.length,
		excludeCwcConceptEdgeCount: readyExcludeCwcRelations.conceptRelations.edges.length,
		producerOverdueAt: readyProducerState.discoveryProducerOverdueAt,
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
 * The four public payloads are separate queries, so a producer publication can
 * land between them. Only accept an attempt bracketed by the same manifest
 * generation; otherwise retry a small, fixed number of times rather than
 * falsely blocking a healthy release or looping against Convex indefinitely.
 *
 * @param {unknown} before
 * @param {unknown} after
 */
function sameManifestGeneration(before, after) {
	if (!isRecord(before) || !isRecord(after)) return false;
	for (const family of ['list', 'relations']) {
		const beforeState = before[family];
		const afterState = after[family];
		if (!isRecord(beforeState) || !isRecord(afterState)) return false;
		if (
			beforeState.ready !== afterState.ready ||
			beforeState.revision !== afterState.revision ||
			beforeState.updatedAt !== afterState.updatedAt
		) {
			return false;
		}
	}
	return true;
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
		contractOnly = false,
		maxAgeMs = DEFAULT_MAX_SNAPSHOT_AGE_MS,
		now,
		internalSecret
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
	if (typeof internalSecret !== 'string' || internalSecret.length < MIN_INTERNAL_SECRET_BYTES) {
		throw new Error('INTERNAL_API_SECRET must be configured for producer readiness');
	}

	const client = new ConvexHttpClient(parsedUrl.origin);
	for (let attempt = 1; attempt <= MAX_COHERENT_READ_ATTEMPTS; attempt += 1) {
		const manifestBefore = await withTimeout(
			client.query(anyApi.templates.publicDiscoveryManifest, { _secret: internalSecret }),
			'templates:publicDiscoveryManifest(before)',
			timeoutMs
		);
		const [allList, excludeCwcList, allRelations, excludeCwcRelations] = await Promise.all([
			withTimeout(
				client.query(anyApi.templates.publicDiscoveryList, {
					_secret: internalSecret,
					excludeCwc: false
				}),
				'templates:publicDiscoveryList(all)',
				timeoutMs
			),
			withTimeout(
				client.query(anyApi.templates.publicDiscoveryList, {
					_secret: internalSecret,
					excludeCwc: true
				}),
				'templates:publicDiscoveryList(excludeCwc)',
				timeoutMs
			),
			withTimeout(
				client.query(anyApi.templates.publicDiscoveryRelations, {
					_secret: internalSecret,
					excludeCwc: false
				}),
				'templates:publicDiscoveryRelations(all)',
				timeoutMs
			),
			withTimeout(
				client.query(anyApi.templates.publicDiscoveryRelations, {
					_secret: internalSecret,
					excludeCwc: true
				}),
				'templates:publicDiscoveryRelations(excludeCwc)',
				timeoutMs
			)
		]);
		const manifestAfter = await withTimeout(
			client.query(anyApi.templates.publicDiscoveryManifest, { _secret: internalSecret }),
			'templates:publicDiscoveryManifest(after)',
			timeoutMs
		);

		if (!sameManifestGeneration(manifestBefore, manifestAfter)) continue;

		const manifestAuthorityStatus = await withTimeout(
			client.query(anyApi.templates.publicDiscoveryManifestAuthorityStatus, {
				_secret: internalSecret
			}),
			'templates:publicDiscoveryManifestAuthorityStatus',
			timeoutMs
		);
		const manifestAuthorityReport =
			validatePublicDiscoveryManifestAuthorityStatus(manifestAuthorityStatus);

		// Health is deliberately the terminal read. Durable failure/dirty state
		// can change without advancing public snapshot coordinates, so reading it
		// before the closing manifest would leave a small stale-healthy window.
		const producerStatus = await withTimeout(
			client.query(anyApi.observability.discoveryProducerStatus, { _secret: internalSecret }),
			'observability:discoveryProducerStatus',
			timeoutMs
		);

		return {
			...validatePublicDiscoveryReadiness(
				{
					manifest: manifestAfter,
					allList,
					excludeCwcList,
					allRelations,
					excludeCwcRelations,
					producerStatus
				},
				{ requireContent, contractOnly, maxAgeMs, now: now ?? Date.now() }
			),
			...manifestAuthorityReport
		};
	}

	throw new Error(
		`PUBLIC_DISCOVERY_NOT_READY: producer publication changed during ${MAX_COHERENT_READ_ATTEMPTS} coherent-read attempts`
	);
}

async function main() {
	const convexUrl = process.argv[2] || process.env.PUBLIC_CONVEX_URL;
	try {
		const options = readinessOptionsFromEnv(process.env);
		const report = await verifyPublicDiscoveryReadiness(convexUrl, {
			...options,
			internalSecret: process.env.INTERNAL_API_SECRET
		});
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
