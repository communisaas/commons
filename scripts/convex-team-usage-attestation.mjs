#!/usr/bin/env node

import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const CONVEX_TEAM_QUOTA_SIGNATURE_NAMESPACE = 'commons-convex-team-quota-v1';
export const CONVEX_USAGE_SUMMARY_QUERY_ID = 'b63fe48d-320c-401a-8682-0a0b36b50e2b';
export const CONVEX_USAGE_BY_PROJECT_QUERY_ID = '9f606f77-521d-44bb-83ef-b1057b0fb1c9';

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
function decimalBigInt(value, label) {
	invariant(typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value), `${label} is invalid.`);
	return BigInt(value);
}

/** @param {unknown} value @param {string} label */
function canonicalInstant(value, label) {
	invariant(typeof value === 'string', `${label} is invalid.`);
	const parsed = Date.parse(value);
	invariant(
		Number.isFinite(parsed) && new Date(parsed).toISOString() === value,
		`${label} must be a canonical UTC ISO instant.`
	);
	return parsed;
}

/** @param {unknown} value @param {string} label */
function canonicalDate(value, label) {
	invariant(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), `${label} is invalid.`);
	const parsed = Date.parse(`${value}T00:00:00.000Z`);
	invariant(
		Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value,
		`${label} is not a real UTC date.`
	);
	return value;
}

/** @param {unknown} value @returns {string} */
export function canonicalJson(value) {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') {
		return JSON.stringify(value);
	}
	if (typeof value === 'number') {
		invariant(Number.isSafeInteger(value), 'Canonical quota JSON numbers must be safe integers.');
		return String(value);
	}
	if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
	const object = record(value);
	invariant(object, 'Canonical quota JSON contains an unsupported value.');
	return `{${Object.keys(object)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
		.join(',')}}`;
}

/** @param {Record<string, any>} attestation */
export function canonicalConvexTeamUsageAttestationBytes(attestation) {
	return Buffer.from(`${canonicalJson(attestation)}\n`, 'utf8');
}

/**
 * Validate the signed semantic receipt. Project allowances cover the provider's
 * ten-minute refresh lag plus capture-to-release TOCTOU; the Pages reserve is
 * held separately for the full reviewed monthly admission envelope.
 * @param {{attestation: unknown, constraints: Record<string, any>, expectedSourceSha: string, minimumRemainingValiditySeconds?: number, nowMs?: number, teamUsageAuthority: Record<string, any>}} input
 */
export function validateConvexTeamUsageAttestation({
	attestation: rawAttestation,
	constraints,
	expectedSourceSha,
	minimumRemainingValiditySeconds = 0,
	nowMs = Date.now(),
	teamUsageAuthority
}) {
	invariant(/^[a-f0-9]{40}$/.test(expectedSourceSha), 'Expected quota source SHA is invalid.');
	invariant(Number.isSafeInteger(nowMs) && nowMs >= 0, 'Quota verification clock is invalid.');
	invariant(
		Number.isSafeInteger(minimumRemainingValiditySeconds) && minimumRemainingValiditySeconds >= 0,
		'Quota minimum remaining validity is invalid.'
	);
	const attestation = record(rawAttestation);
	invariant(attestation, 'Convex team usage attestation must be an object.');
	exactKeys(
		attestation,
		[
			'billingPeriod',
			'capturedAt',
			'expiresAt',
			'operator',
			'projects',
			'schemaVersion',
			'source',
			'sourceSha',
			'team'
		],
		'Convex team usage attestation'
	);
	invariant(attestation.schemaVersion === 1, 'Convex team usage attestation schema must be 1.');
	invariant(
		attestation.sourceSha === expectedSourceSha,
		'Quota attestation is for a different release SHA.'
	);

	const source = record(attestation.source);
	invariant(source, 'Quota attestation source is missing.');
	exactKeys(
		source,
		[
			'apiOrigin',
			'dashboardOrigin',
			'futureWorkAllowanceWindowSeconds',
			'providerRefreshIntervalSeconds',
			'reconciliationQueryId',
			'summaryQueryId'
		],
		'Quota attestation source'
	);
	invariant(
		source.apiOrigin === 'https://api.convex.dev' &&
			source.dashboardOrigin === 'https://dashboard.convex.dev' &&
			source.providerRefreshIntervalSeconds === 600 &&
			source.futureWorkAllowanceWindowSeconds ===
				teamUsageAuthority.futureWorkAllowanceWindowSeconds &&
			source.futureWorkAllowanceWindowSeconds ===
				source.providerRefreshIntervalSeconds +
					teamUsageAuthority.maximumLifetimeSeconds +
					teamUsageAuthority.maximumFutureSkewSeconds &&
			source.summaryQueryId === CONVEX_USAGE_SUMMARY_QUERY_ID &&
			source.reconciliationQueryId === CONVEX_USAGE_BY_PROJECT_QUERY_ID,
		'Quota attestation dashboard query authority drifted.'
	);

	const operator = record(attestation.operator);
	invariant(operator, 'Quota attestation operator is missing.');
	exactKeys(operator, ['principal', 'signatureNamespace'], 'Quota attestation operator');
	invariant(
		typeof operator.principal === 'string' && /^[A-Za-z0-9._@+-]{1,120}$/.test(operator.principal),
		'Quota attestation operator principal is invalid.'
	);
	invariant(
		operator.signatureNamespace === CONVEX_TEAM_QUOTA_SIGNATURE_NAMESPACE,
		'Quota attestation signature namespace is invalid.'
	);

	const capturedAtMs = canonicalInstant(attestation.capturedAt, 'Quota capturedAt');
	const expiresAtMs = canonicalInstant(attestation.expiresAt, 'Quota expiresAt');
	invariant(
		capturedAtMs <= nowMs + teamUsageAuthority.maximumFutureSkewSeconds * 1000 &&
			nowMs - capturedAtMs <= teamUsageAuthority.maximumCaptureAgeSeconds * 1000 &&
			expiresAtMs > capturedAtMs &&
			expiresAtMs - capturedAtMs <= teamUsageAuthority.maximumLifetimeSeconds * 1000 &&
			nowMs <= expiresAtMs,
		'Quota attestation is stale, expired, future-dated, or overlong.'
	);
	invariant(
		expiresAtMs - nowMs >= minimumRemainingValiditySeconds * 1000,
		'Quota attestation does not retain enough validity for this release phase.'
	);

	const billingPeriod = record(attestation.billingPeriod);
	invariant(billingPeriod, 'Quota billing period is missing.');
	exactKeys(billingPeriod, ['end', 'start'], 'Quota billing period');
	const periodStart = canonicalDate(billingPeriod.start, 'Quota billing-period start');
	const periodEnd = canonicalDate(billingPeriod.end, 'Quota billing-period end');
	const today = new Date(nowMs).toISOString().slice(0, 10);
	invariant(
		periodStart <= today && today <= periodEnd && periodStart <= periodEnd,
		'Quota billing period does not contain the current UTC date.'
	);

	const team = record(attestation.team);
	invariant(team, 'Quota team is missing.');
	exactKeys(
		team,
		[
			'databaseIoBytesUsed',
			'databaseIoQuotaBytes',
			'id',
			'orbSubscription',
			'slug',
			'suspended',
			'usageState'
		],
		'Quota team'
	);
	invariant(
		team.id === teamUsageAuthority.teamId &&
			team.slug === teamUsageAuthority.teamSlug &&
			team.suspended === false &&
			team.orbSubscription === null &&
			team.usageState === 'Default',
		'Convex team must be the exact active shared-Free authority in Default usage state.'
	);
	const databaseIoBytesUsed = decimalBigInt(team.databaseIoBytesUsed, 'Team database I/O used');
	const databaseIoQuotaBytes = decimalBigInt(team.databaseIoQuotaBytes, 'Team database I/O quota');
	invariant(
		databaseIoQuotaBytes === BigInt(constraints.teamFreeMonthlyDatabaseIoBytes),
		'Quota attestation team allowance drifted.'
	);

	invariant(
		Array.isArray(attestation.projects) &&
			Array.isArray(teamUsageAuthority.expectedProjects) &&
			attestation.projects.length === teamUsageAuthority.expectedProjects.length,
		'Quota attestation project inventory is incomplete.'
	);
	let projectUsageBytes = 0n;
	let additionalAllowanceBytes = 0n;
	const projectIds = new Set();
	const projectSlugs = new Set();
	const deploymentNames = new Set();
	let commonsProject = null;
	let previousProjectId = -1;
	for (const [projectIndex, rawProject] of attestation.projects.entries()) {
		const project = record(rawProject);
		invariant(project, 'Quota project entry is invalid.');
		exactKeys(
			project,
			[
				'currentDatabaseIoBytes',
				'devDeploymentName',
				'disposition',
				'id',
				'maximumAdditionalNonPagesDatabaseIoBytes',
				'name',
				'prodDeploymentName',
				'slug'
			],
			'Quota project entry'
		);
		invariant(
			Number.isSafeInteger(project.id) && project.id > previousProjectId,
			'Quota projects must be sorted by unique positive project ID.'
		);
		previousProjectId = project.id;
		invariant(!projectIds.has(project.id), 'Quota project ID is duplicated.');
		projectIds.add(project.id);
		invariant(
			typeof project.slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.slug),
			'Quota project slug is invalid.'
		);
		invariant(!projectSlugs.has(project.slug), 'Quota project slug is duplicated.');
		projectSlugs.add(project.slug);
		invariant(
			typeof project.name === 'string' &&
				project.name.length >= 1 &&
				project.name.length <= 120 &&
				!/\p{Cc}/u.test(project.name),
			'Quota project name is invalid.'
		);
		for (const deploymentName of [project.devDeploymentName, project.prodDeploymentName]) {
			invariant(
				typeof deploymentName === 'string' &&
					/^[a-z]+(?:-[a-z]+)*-[0-9]+$/.test(deploymentName) &&
					!deploymentNames.has(deploymentName),
				'Quota deployment inventory is invalid or duplicated.'
			);
			deploymentNames.add(deploymentName);
		}
		const expectedProject = teamUsageAuthority.expectedProjects[projectIndex];
		invariant(
			project.id === expectedProject.id &&
				project.slug === expectedProject.slug &&
				project.name === expectedProject.name &&
				project.prodDeploymentName === expectedProject.prodDeploymentName &&
				project.devDeploymentName === expectedProject.devDeploymentName,
			'Quota project inventory differs from the exact trusted team inventory.'
		);
		const currentBytes = decimalBigInt(project.currentDatabaseIoBytes, 'Project database I/O used');
		const maximumAdditionalBytes = decimalBigInt(
			project.maximumAdditionalNonPagesDatabaseIoBytes,
			'Project maximum additional non-Pages database I/O'
		);
		invariant(
			(project.disposition === 'quiescent' && maximumAdditionalBytes === 0n) ||
				(project.disposition === 'bounded' && maximumAdditionalBytes > 0n),
			'Each quota project must be explicitly quiescent or carry a positive bounded allowance.'
		);
		projectUsageBytes += currentBytes;
		additionalAllowanceBytes += maximumAdditionalBytes;
		if (project.id === teamUsageAuthority.requiredCommonsProjectId) commonsProject = project;
	}
	invariant(
		projectUsageBytes === databaseIoBytesUsed,
		'Per-project database I/O does not reconcile to the team total.'
	);
	invariant(
		commonsProject &&
			commonsProject.slug === teamUsageAuthority.requiredCommonsProjectSlug &&
			commonsProject.prodDeploymentName === 'quirky-chinchilla-352' &&
			commonsProject.devDeploymentName === 'outstanding-firefly-831' &&
			commonsProject.disposition === teamUsageAuthority.requiredCommonsNonPagesDisposition,
		'Quota inventory does not contain the exact Commons project authority.'
	);
	const commonsNonPagesAllowanceBytes = decimalBigInt(
		commonsProject.maximumAdditionalNonPagesDatabaseIoBytes,
		'Commons non-Pages allowance'
	);
	invariant(
		commonsNonPagesAllowanceBytes === 0n,
		'Commons must remain quiescent with zero non-Pages database-I/O allowance for a shared-Free normal release.'
	);
	const pagesReserveBytes = BigInt(constraints.pagesMonthlyAdmissionReserveBytes);
	const requiredHeadroomBytes = pagesReserveBytes + additionalAllowanceBytes;
	const availableHeadroomBytes = databaseIoQuotaBytes - databaseIoBytesUsed;
	invariant(
		databaseIoBytesUsed < databaseIoQuotaBytes && availableHeadroomBytes >= requiredHeadroomBytes,
		'Exhaustive shared-team database I/O cannot fit the Pages reserve plus every signed project allowance. Remain in containment or quota-isolate Commons.'
	);

	return {
		additionalAllowanceBytes: additionalAllowanceBytes.toString(),
		availableHeadroomBytes: availableHeadroomBytes.toString(),
		capturedAt: attestation.capturedAt,
		commonsNonPagesAllowanceBytes: commonsNonPagesAllowanceBytes.toString(),
		databaseIoBytesUsed: databaseIoBytesUsed.toString(),
		expiresAt: attestation.expiresAt,
		pagesReserveBytes: pagesReserveBytes.toString(),
		projectCount: attestation.projects.length,
		remainingValiditySeconds: Math.floor((expiresAtMs - nowMs) / 1000),
		requiredHeadroomBytes: requiredHeadroomBytes.toString(),
		teamId: team.id,
		teamSlug: team.slug,
		usageState: team.usageState
	};
}

/**
 * @param {{allowedSignersPath: string, attestation: Record<string, any>, signature: Buffer|string}} input
 */
export function verifyConvexTeamUsageAttestationSignature({
	allowedSignersPath,
	attestation,
	signature
}) {
	const principal = attestation.operator?.principal;
	invariant(
		typeof principal === 'string' && /^[A-Za-z0-9._@+-]{1,120}$/.test(principal),
		'Quota attestation signer principal is invalid.'
	);
	const signatureBytes = Buffer.isBuffer(signature) ? signature : Buffer.from(signature, 'utf8');
	invariant(
		signatureBytes.length > 0 && signatureBytes.length <= 32 * 1024,
		'Quota signature size is invalid.'
	);
	const absoluteAllowedSigners = path.resolve(allowedSignersPath);
	const allowedStats = statSync(absoluteAllowedSigners);
	invariant(
		allowedStats.isFile() && allowedStats.size <= 32 * 1024,
		'Quota allowed-signers trust root is invalid.'
	);
	const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'commons-convex-quota-'));
	const signaturePath = path.join(temporaryDirectory, 'quota.sig');
	try {
		writeFileSync(signaturePath, signatureBytes, { mode: 0o600 });
		const result = spawnSync(
			'ssh-keygen',
			[
				'-Y',
				'verify',
				'-f',
				absoluteAllowedSigners,
				'-I',
				principal,
				'-n',
				CONVEX_TEAM_QUOTA_SIGNATURE_NAMESPACE,
				'-s',
				signaturePath
			],
			{
				input: canonicalConvexTeamUsageAttestationBytes(attestation),
				encoding: 'buffer',
				maxBuffer: 1024 * 1024
			}
		);
		invariant(
			result.status === 0,
			`Quota attestation signature is not valid for an allowed operator: ${Buffer.from(
				result.stderr ?? ''
			)
				.toString('utf8')
				.trim()}`
		);
		const output = Buffer.from(result.stdout ?? '')
			.toString('utf8')
			.trim();
		const fingerprint = /\bkey (SHA256:[A-Za-z0-9+/=]+)$/.exec(output)?.[1];
		invariant(fingerprint, 'OpenSSH quota verification did not report a key fingerprint.');
		return {
			keyFingerprint: fingerprint,
			namespace: CONVEX_TEAM_QUOTA_SIGNATURE_NAMESPACE,
			principal
		};
	} finally {
		rmSync(temporaryDirectory, { force: true, recursive: true });
	}
}
