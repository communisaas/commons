#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	CONVEX_TEAM_QUOTA_SIGNATURE_NAMESPACE,
	CONVEX_USAGE_BY_PROJECT_QUERY_ID,
	CONVEX_USAGE_SUMMARY_QUERY_ID,
	canonicalConvexTeamUsageAttestationBytes,
	canonicalJson,
	validateConvexTeamUsageAttestation
} from './convex-team-usage-attestation.mjs';
import { validateConvexNativeUsageLimitConfig } from './verify-convex-native-usage-limits.mjs';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';

const CONFIG_PATH = 'config/convex-native-usage-limits.json';
const API_ORIGIN = 'https://api.convex.dev';
const DASHBOARD_ORIGIN = 'https://dashboard.convex.dev';

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {Record<string, any> | null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** @param {Record<string, any>} value @param {readonly string[]} keys @param {string} label */
function exactKeys(value, keys, label) {
	invariant(
		JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()),
		`${label} shape drifted.`
	);
}

/** @param {unknown} value @param {string} label */
function canonicalInteger(value, label) {
	invariant(typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value), `${label} is invalid.`);
	return BigInt(value);
}

/** @param {unknown} row @param {number} length @param {string} label */
function exactUsageRow(row, length, label) {
	invariant(
		Array.isArray(row) &&
			row.length === length &&
			row.every((cell) => cell === null || typeof cell === 'string'),
		`${label} row shape drifted.`
	);
	return row;
}

/** @param {string} base @param {Record<string, string>} query */
function queryUrl(base, query) {
	const url = new URL(base);
	for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
	return url.href;
}

/**
 * @param {{accessToken: string, config?: unknown, fetchFn?: typeof fetch, nowMs?: number, operatorPrincipal: string, projectPolicy: unknown, sourceSha: string}} input
 */
export async function captureConvexTeamUsageAttestation({
	accessToken,
	config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')),
	fetchFn = fetch,
	nowMs,
	operatorPrincipal,
	projectPolicy: rawProjectPolicy,
	sourceSha
}) {
	const checkedConfig = validateConvexNativeUsageLimitConfig(config);
	const authority = checkedConfig.teamUsageAuthority;
	invariant(
		typeof accessToken === 'string' && accessToken.length >= 20,
		'CONVEX_DASHBOARD_ACCESS_TOKEN is required for operator-local capture.'
	);
	invariant(process.env.CI !== 'true', 'Broad Convex dashboard access is forbidden in CI.');
	invariant(/^[a-f0-9]{40}$/.test(sourceSha), 'Capture source SHA is invalid.');
	invariant(
		typeof operatorPrincipal === 'string' && /^[A-Za-z0-9._@+-]{1,120}$/.test(operatorPrincipal),
		'Capture operator principal is invalid.'
	);
	invariant(
		nowMs === undefined || (Number.isSafeInteger(nowMs) && nowMs >= 0),
		'Capture clock is invalid.'
	);

	const headers = {
		Accept: 'application/json',
		Authorization: `Bearer ${accessToken}`,
		Origin: DASHBOARD_ORIGIN
	};
	/** @param {string} url @param {string} label */
	const readJson = async (url, label) => {
		const response = await fetchFn(url, {
			headers,
			redirect: 'error',
			signal: AbortSignal.timeout(15_000)
		});
		invariant(response.ok, `${label} returned HTTP ${response.status}.`);
		return readBoundedResponseJson(response, `${label} response`);
	};

	const readAuthorityCoordinates = () =>
		Promise.all([
			readJson(`${API_ORIGIN}/api/dashboard/teams`, 'Convex team inventory'),
			readJson(
				`${API_ORIGIN}/api/dashboard/teams/${authority.teamId}/usage/current_billing_period`,
				'Convex current billing period'
			),
			readJson(
				`${API_ORIGIN}/api/dashboard/teams/${authority.teamId}/usage/team_usage_state`,
				'Convex team usage state'
			),
			readJson(
				`${API_ORIGIN}/api/dashboard/teams/${authority.teamId}/get_entitlements`,
				'Convex team entitlements'
			),
			readJson(
				`${API_ORIGIN}/api/dashboard/teams/${authority.teamId}/get_orb_subscription`,
				'Convex team Orb subscription'
			),
			readJson(`${API_ORIGIN}/api/teams/${authority.teamSlug}/projects`, 'Convex project inventory')
		]);
	const authorityBefore = await readAuthorityCoordinates();
	const [
		teamsResponse,
		billingResponse,
		stateResponse,
		entitlementsResponse,
		orbSubscriptionResponse,
		projectsResponse
	] = authorityBefore;

	invariant(Array.isArray(teamsResponse), 'Convex team inventory must be an array.');
	const matchingTeams = teamsResponse.filter(
		(team) => record(team)?.id === authority.teamId || record(team)?.slug === authority.teamSlug
	);
	invariant(matchingTeams.length === 1, 'Exact Convex team authority is missing or ambiguous.');
	const team = record(matchingTeams[0]);
	invariant(team, 'Convex team authority is invalid.');
	exactKeys(
		team,
		[
			'creator',
			'defaultRegion',
			'id',
			'managedBy',
			'name',
			'referralCode',
			'referredBy',
			'slug',
			'suspended'
		],
		'Convex team authority'
	);
	invariant(
		team.id === authority.teamId && team.slug === authority.teamSlug && team.suspended === false,
		'Convex team authority is wrong or suspended.'
	);

	const billingPeriod = record(billingResponse);
	invariant(billingPeriod, 'Convex billing period is invalid.');
	exactKeys(billingPeriod, ['end', 'start'], 'Convex billing period');
	const usageState = record(stateResponse);
	invariant(usageState, 'Convex usage state is invalid.');
	exactKeys(usageState, ['teamId', 'usageState'], 'Convex usage state');
	invariant(
		usageState.teamId === authority.teamId && usageState.usageState === 'Default',
		'Convex team usage state must be Default before capture.'
	);
	const entitlements = record(entitlementsResponse);
	invariant(
		entitlements &&
			Object.hasOwn(entitlements, 'teamMaxDatabaseBandwidth') &&
			entitlements.teamMaxDatabaseBandwidth ===
				checkedConfig.constraints.teamFreeMonthlyDatabaseIoBytes,
		'Convex team database-I/O entitlement is missing or not exactly 1 GiB.'
	);
	invariant(
		orbSubscriptionResponse === null,
		'Convex shared-Free diagnostic capture requires an exact null Orb subscription.'
	);

	/** @param {string} queryId */
	const usageQuery = (queryId) =>
		queryUrl(`${API_ORIGIN}/api/dashboard/teams/${authority.teamId}/usage/query`, {
			queryId,
			from: billingPeriod.start,
			to: billingPeriod.end
		});
	const [summaryResponse, byProjectResponse] = await Promise.all([
		readJson(usageQuery(CONVEX_USAGE_SUMMARY_QUERY_ID), 'Convex team database-I/O summary'),
		readJson(
			usageQuery(CONVEX_USAGE_BY_PROJECT_QUERY_ID),
			'Convex per-project database-I/O reconciliation'
		)
	]);
	invariant(Array.isArray(summaryResponse), 'Convex usage summary must be an array.');
	let summaryBytes = 0n;
	for (const rawRow of summaryResponse) {
		const row = exactUsageRow(rawRow, 14, 'Convex usage summary');
		invariant(row[0] === String(authority.teamId), 'Convex usage summary team ID drifted.');
		invariant(
			typeof row[1] === 'string' && row[1].length > 0,
			'Summary deployment class is invalid.'
		);
		invariant(typeof row[2] === 'string' && row[2].length > 0, 'Summary region is invalid.');
		summaryBytes += canonicalInteger(row[4], 'Summary database I/O');
	}

	invariant(Array.isArray(projectsResponse), 'Convex project inventory must be an array.');
	const projects = projectsResponse.map((rawProject) => {
		const project = record(rawProject);
		invariant(project, 'Convex project inventory entry is invalid.');
		exactKeys(
			project,
			['createTime', 'devDeploymentName', 'id', 'name', 'prodDeploymentName', 'slug', 'teamId'],
			'Convex project inventory entry'
		);
		invariant(
			Number.isSafeInteger(project.id) &&
				project.id > 0 &&
				project.teamId === authority.teamId &&
				(typeof project.createTime === 'number' || typeof project.createTime === 'string'),
			'Convex project identity, team, or creation time is invalid.'
		);
		for (const field of ['devDeploymentName', 'name', 'prodDeploymentName', 'slug']) {
			invariant(
				typeof project[field] === 'string' && project[field].length > 0,
				`Convex project ${field} is invalid.`
			);
		}
		return project;
	});
	projects.sort((left, right) => left.id - right.id);
	invariant(
		new Set(projects.map(({ id }) => id)).size === projects.length &&
			new Set(projects.map(({ slug }) => slug)).size === projects.length &&
			JSON.stringify(
				projects.map(({ id, slug, name, prodDeploymentName, devDeploymentName }) => ({
					id,
					slug,
					name,
					prodDeploymentName,
					devDeploymentName
				}))
			) === JSON.stringify(authority.expectedProjects),
		'Convex project inventory is duplicated or incomplete.'
	);
	const projectById = new Map(projects.map((project) => [project.id, project]));

	invariant(Array.isArray(byProjectResponse), 'Convex per-project usage must be an array.');
	const usageByProject = new Map(projects.map((project) => [project.id, 0n]));
	let reconciledBytes = 0n;
	for (const rawRow of byProjectResponse) {
		const row = exactUsageRow(rawRow, 6, 'Convex per-project usage');
		invariant(row[0] === String(authority.teamId), 'Per-project usage team ID drifted.');
		invariant(row[1] !== '_rest', 'Per-project usage contains an unassignable _rest bucket.');
		invariant(
			typeof row[1] === 'string' && /^(?:0|[1-9]\d*)$/.test(row[1]),
			'Per-project usage project ID is invalid.'
		);
		const projectId = Number(row[1]);
		invariant(
			Number.isSafeInteger(projectId) && projectById.has(projectId),
			'Per-project usage references an unknown project.'
		);
		invariant(
			typeof row[2] === 'string' && row[2].length > 0,
			'Per-project deployment class is invalid.'
		);
		invariant(
			typeof row[3] === 'string' &&
				/^\d{4}-\d{2}-\d{2}$/.test(row[3]) &&
				billingPeriod.start <= row[3] &&
				row[3] <= billingPeriod.end,
			'Per-project usage date is outside the billing period.'
		);
		const bytes =
			canonicalInteger(row[4], 'Per-project database ingress') +
			canonicalInteger(row[5], 'Per-project database egress');
		usageByProject.set(projectId, (usageByProject.get(projectId) ?? 0n) + bytes);
		reconciledBytes += bytes;
	}
	invariant(
		reconciledBytes === summaryBytes,
		'Convex summary and per-project database I/O do not reconcile.'
	);
	const projectPolicy = record(rawProjectPolicy);
	invariant(projectPolicy, 'Quota project disposition policy must be an object.');
	exactKeys(projectPolicy, ['projects', 'schemaVersion'], 'Quota project disposition policy');
	invariant(
		projectPolicy.schemaVersion === 1 && Array.isArray(projectPolicy.projects),
		'Quota project policy schema is invalid.'
	);
	const dispositions = new Map();
	for (const rawDisposition of projectPolicy.projects) {
		const disposition = record(rawDisposition);
		invariant(disposition, 'Quota project disposition is invalid.');
		exactKeys(
			disposition,
			['disposition', 'maximumAdditionalNonPagesDatabaseIoBytes', 'projectId'],
			'Quota project disposition'
		);
		invariant(
			Number.isSafeInteger(disposition.projectId) &&
				projectById.has(disposition.projectId) &&
				!dispositions.has(disposition.projectId),
			'Quota project disposition references an unknown or duplicate project.'
		);
		const allowance = canonicalInteger(
			disposition.maximumAdditionalNonPagesDatabaseIoBytes,
			'Quota project disposition allowance'
		);
		invariant(
			(disposition.disposition === 'quiescent' && allowance === 0n) ||
				(disposition.disposition === 'bounded' && allowance > 0n),
			'Quota project disposition must be quiescent/zero or bounded/positive.'
		);
		dispositions.set(disposition.projectId, disposition);
	}
	invariant(
		dispositions.size === projects.length,
		'Quota project disposition policy is not exhaustive.'
	);

	const authorityAfter = await readAuthorityCoordinates();
	invariant(
		canonicalJson(authorityAfter) === canonicalJson(authorityBefore),
		'Convex team state, billing period, entitlement, or project inventory changed during capture.'
	);
	const capturedAtMs = nowMs === undefined ? Date.now() : nowMs;
	const capturedAt = new Date(capturedAtMs).toISOString();
	const expiresAt = new Date(capturedAtMs + authority.maximumLifetimeSeconds * 1000).toISOString();
	const attestation = {
		billingPeriod: { end: billingPeriod.end, start: billingPeriod.start },
		capturedAt,
		expiresAt,
		operator: {
			principal: operatorPrincipal,
			signatureNamespace: CONVEX_TEAM_QUOTA_SIGNATURE_NAMESPACE
		},
		projects: projects.map((project) => {
			const disposition = dispositions.get(project.id);
			return {
				currentDatabaseIoBytes: String(usageByProject.get(project.id) ?? 0n),
				devDeploymentName: project.devDeploymentName,
				disposition: disposition.disposition,
				id: project.id,
				maximumAdditionalNonPagesDatabaseIoBytes:
					disposition.maximumAdditionalNonPagesDatabaseIoBytes,
				name: project.name,
				prodDeploymentName: project.prodDeploymentName,
				slug: project.slug
			};
		}),
		schemaVersion: 1,
		source: {
			apiOrigin: API_ORIGIN,
			dashboardOrigin: DASHBOARD_ORIGIN,
			futureWorkAllowanceWindowSeconds: authority.futureWorkAllowanceWindowSeconds,
			providerRefreshIntervalSeconds: 600,
			reconciliationQueryId: CONVEX_USAGE_BY_PROJECT_QUERY_ID,
			summaryQueryId: CONVEX_USAGE_SUMMARY_QUERY_ID
		},
		sourceSha,
		team: {
			databaseIoBytesUsed: summaryBytes.toString(),
			databaseIoQuotaBytes: String(entitlements.teamMaxDatabaseBandwidth),
			id: team.id,
			orbSubscription: orbSubscriptionResponse,
			slug: team.slug,
			suspended: team.suspended,
			usageState: usageState.usageState
		}
	};
	validateConvexTeamUsageAttestation({
		attestation,
		constraints: checkedConfig.constraints,
		expectedSourceSha: sourceSha,
		nowMs: capturedAtMs,
		teamUsageAuthority: authority
	});
	return attestation;
}

/** @param {string[]} argv */
function parseArgs(argv) {
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		invariant(
			argv[index]?.startsWith('--') && argv[index + 1],
			'Capture arguments must be --key value pairs.'
		);
		invariant(!values.has(argv[index]), `Duplicate capture argument: ${argv[index]}.`);
		values.set(argv[index], argv[index + 1]);
	}
	for (const required of ['--source-sha', '--operator-principal', '--project-policy', '--output']) {
		invariant(values.has(required), `Missing capture argument ${required}.`);
	}
	invariant(values.size === 4, 'Unknown capture argument.');
	return Object.fromEntries([...values].map(([key, value]) => [key.slice(2), value]));
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const args = parseArgs(process.argv.slice(2));
		const projectPolicy = JSON.parse(fs.readFileSync(args['project-policy'], 'utf8'));
		const attestation = await captureConvexTeamUsageAttestation({
			accessToken: process.env.CONVEX_DASHBOARD_ACCESS_TOKEN ?? '',
			operatorPrincipal: args['operator-principal'],
			projectPolicy,
			sourceSha: args['source-sha']
		});
		const output = path.resolve(args.output);
		fs.writeFileSync(output, canonicalConvexTeamUsageAttestationBytes(attestation), {
			mode: 0o600
		});
		console.log(
			`Captured canonical Convex team quota receipt at ${output}; dashboard token was not persisted.`
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
