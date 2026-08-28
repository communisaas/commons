#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';
import {
	CONVEX_TEAM_QUOTA_SIGNATURE_NAMESPACE,
	canonicalConvexTeamUsageAttestationBytes,
	validateConvexTeamUsageAttestation,
	verifyConvexTeamUsageAttestationSignature
} from './convex-team-usage-attestation.mjs';

const CONFIG_PATH = 'config/convex-native-usage-limits.json';
const DEFAULT_ALLOWED_SIGNERS_PATH = '.github/convex-quota-allowed-signers';
const ENVIRONMENTS = /** @type {const} */ (['production', 'preview']);
const GIB_BYTES = 1024 ** 3;

/** @typedef {'preview'|'production'} Environment */

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
function finiteNonnegative(value, label) {
	invariant(
		typeof value === 'number' && Number.isFinite(value) && value >= 0,
		`${label} is invalid.`
	);
	return value;
}

/** Convex labels this value GB, but the authoritative dashboard reconciles it as binary GiB. @param {unknown} value */
export function deploymentDatabaseIoGbToBytes(value) {
	const gib = finiteNonnegative(value, 'Convex database-I/O GiB value');
	const bytes = Math.ceil(gib * GIB_BYTES);
	invariant(Number.isSafeInteger(bytes), 'Convex binary-GiB byte conversion overflowed.');
	return bytes;
}

/** @param {unknown} rawConfig */
export function validateConvexNativeUsageLimitConfig(rawConfig) {
	const config = record(rawConfig);
	invariant(config, 'Native usage-limit config must be an object.');
	exactKeys(
		config,
		[
			'constraints',
			'deploymentApiBasePath',
			'environments',
			'normalReleaseAuthority',
			'schemaVersion',
			'teamUsageAuthority'
		],
		'Native usage-limit config'
	);
	invariant(config.schemaVersion === 4, 'Native usage-limit config schema must be 4.');
	invariant(config.deploymentApiBasePath === '/api/v1', 'Native Deployment API path drifted.');

	const constraints = record(config.constraints);
	invariant(constraints, 'Native usage-limit constraints are missing.');
	exactKeys(
		constraints,
		[
			'minimumDatabaseIoLimitGb',
			'pagesMonthlyAdmissionReserveBytes',
			'teamFreeMonthlyDatabaseIoBytes'
		],
		'Native usage-limit constraints'
	);
	invariant(
		constraints.minimumDatabaseIoLimitGb === 1 &&
			constraints.pagesMonthlyAdmissionReserveBytes === 512 * 1024 * 1024 &&
			constraints.teamFreeMonthlyDatabaseIoBytes === GIB_BYTES,
		'Native limits must preserve the 1 GiB deployment backstop, 512 MiB Pages reserve, and exact 1 GiB team entitlement.'
	);

	const authority = record(config.teamUsageAuthority);
	invariant(authority, 'Team usage authority config is missing.');
	exactKeys(
		authority,
		[
			'expectedProjects',
			'futureWorkAllowanceWindowSeconds',
			'maximumCaptureAgeSeconds',
			'maximumFutureSkewSeconds',
			'maximumLifetimeSeconds',
			'mode',
			'minimumFinalProofRemainingValiditySeconds',
			'minimumFirstProofRemainingValiditySeconds',
			'requiredCommonsProjectId',
			'requiredCommonsNonPagesDisposition',
			'requiredCommonsProjectSlug',
			'signatureNamespace',
			'teamId',
			'teamSlug'
		],
		'Team usage authority config'
	);
	invariant(
		authority.mode === 'operator-local-dashboard-capture-ssh-attestation' &&
			authority.teamId === 422260 &&
			authority.teamSlug === 'eric-mockler' &&
			authority.signatureNamespace === CONVEX_TEAM_QUOTA_SIGNATURE_NAMESPACE &&
			authority.maximumCaptureAgeSeconds === 2700 &&
			authority.maximumLifetimeSeconds === 2700 &&
			authority.maximumFutureSkewSeconds === 60 &&
			authority.futureWorkAllowanceWindowSeconds === 3360 &&
			authority.minimumFirstProofRemainingValiditySeconds === 2100 &&
			authority.minimumFinalProofRemainingValiditySeconds === 180 &&
			authority.requiredCommonsProjectId === 1867656 &&
			authority.requiredCommonsNonPagesDisposition === 'quiescent' &&
			authority.requiredCommonsProjectSlug === 'commons',
		'Team usage authority identity, signature, or freshness policy drifted.'
	);
	const exactProjects = [
		{
			id: 1646861,
			slug: 'superhero-hotel',
			name: 'superhero-hotel',
			prodDeploymentName: 'useful-dachshund-223',
			devDeploymentName: 'kindhearted-manatee-209'
		},
		{
			id: 1867656,
			slug: 'commons',
			name: 'commons',
			prodDeploymentName: 'quirky-chinchilla-352',
			devDeploymentName: 'outstanding-firefly-831'
		},
		{
			id: 1958834,
			slug: 'vcn-engine',
			name: 'vcn-engine',
			prodDeploymentName: 'disciplined-turtle-925',
			devDeploymentName: 'secret-echidna-126'
		},
		{
			id: 2189493,
			slug: 'bob-site',
			name: 'bob-site',
			prodDeploymentName: 'careful-cardinal-138',
			devDeploymentName: 'colorless-turtle-682'
		}
	];
	invariant(
		JSON.stringify(authority.expectedProjects) === JSON.stringify(exactProjects),
		'Trusted exhaustive Convex project inventory drifted.'
	);
	const normalReleaseAuthority = record(config.normalReleaseAuthority);
	invariant(normalReleaseAuthority, 'Normal release authority config is missing.');
	exactKeys(
		normalReleaseAuthority,
		['reasonCode', 'requiredReplacementAuthorityKinds', 'status'],
		'Normal release authority config'
	);
	invariant(
		normalReleaseAuthority.status === 'blocked-shared-free' &&
			normalReleaseAuthority.reasonCode === 'SHARED_FREE_BROWSER_DIRECT_UNARBITRATED' &&
			JSON.stringify(normalReleaseAuthority.requiredReplacementAuthorityKinds) ===
				JSON.stringify(['paid-no-shared-hard-disable', 'quota-isolation']),
		'Full normal release must remain blocked until a reviewed non-shared-Free authority replaces this config.'
	);

	const environments = record(config.environments);
	invariant(environments, 'Native usage-limit environments are missing.');
	exactKeys(environments, ['preview', 'production'], 'Native usage-limit environments');
	for (const environment of ENVIRONMENTS) {
		const realm = record(environments[environment]);
		invariant(realm, `Native usage-limit ${environment} config is missing.`);
		exactKeys(realm, ['deploymentUrl', 'limits'], `Native usage-limit ${environment} config`);
		invariant(
			realm.deploymentUrl ===
				(environment === 'production'
					? 'https://quirky-chinchilla-352.convex.cloud'
					: 'https://outstanding-firefly-831.convex.cloud'),
			`Native usage-limit ${environment} deployment URL drifted.`
		);
		invariant(
			Array.isArray(realm.limits) && realm.limits.length === 1,
			`${environment} needs one limit.`
		);
		const limit = record(realm.limits[0]);
		invariant(limit, `Native usage-limit ${environment} limit is invalid.`);
		exactKeys(
			limit,
			['enabled', 'limit', 'limitType', 'metric', 'window'],
			`Native usage-limit ${environment} limit`
		);
		invariant(
			limit.metric === 'databaseIoGb' &&
				limit.window === 'month' &&
				limit.limitType === 'disable' &&
				limit.limit === 1 &&
				limit.enabled === true,
			`${environment} must have exactly one enabled monthly 1 GiB database-I/O disable limit.`
		);
	}
	return config;
}

/**
 * Per-deployment proof. `databaseIoGb` is binary GiB despite its API label.
 * @param {{config: unknown, environment: Environment, limitsResponse: unknown, usageResponse: unknown}} input
 */
export function validateConvexNativeUsageLimitProof({
	config: rawConfig,
	environment,
	limitsResponse,
	usageResponse
}) {
	const config = validateConvexNativeUsageLimitConfig(rawConfig);
	invariant(ENVIRONMENTS.includes(environment), 'Invalid native-limit environment.');
	const realm = record(record(config.environments)?.[environment]);
	const expected = record(Array.isArray(realm?.limits) ? realm.limits[0] : null);
	invariant(realm && expected, `Native usage-limit ${environment} config is missing.`);

	const listed = record(limitsResponse);
	invariant(listed, 'Convex list_usage_limits response must be an object.');
	exactKeys(listed, ['usageLimits'], 'Convex list_usage_limits response');
	invariant(
		Array.isArray(listed.usageLimits) && listed.usageLimits.length === 1,
		'Convex usage-limit set is not exact.'
	);
	const actual = record(listed.usageLimits[0]);
	invariant(actual, 'Convex usage-limit entry is invalid.');
	exactKeys(
		actual,
		['enabled', 'id', 'limit', 'limitType', 'metric', 'window'],
		'Convex usage-limit entry'
	);
	invariant(
		typeof actual.id === 'string' && actual.id.length > 0,
		'Convex usage-limit ID is missing.'
	);
	for (const key of ['enabled', 'limit', 'limitType', 'metric', 'window']) {
		invariant(actual[key] === expected[key], `Convex native usage-limit ${key} drifted.`);
	}

	const usage = record(usageResponse);
	invariant(usage, 'Convex get_current_usage response must be an object.');
	exactKeys(usage, ['metrics', 'seedStatus'], 'Convex get_current_usage response');
	invariant(usage.seedStatus === 'complete', 'Convex native usage backfill is not complete.');
	const databaseIo = record(record(usage.metrics)?.databaseIoGb);
	invariant(databaseIo, 'Convex current database-I/O usage is missing.');
	exactKeys(databaseIo, ['unit', 'usage'], 'Convex database-I/O usage');
	invariant(databaseIo.unit === 'GB', 'Convex database-I/O unit drifted.');
	const windows = record(databaseIo.usage);
	invariant(windows, 'Convex database-I/O windows are missing.');
	exactKeys(windows, ['current_day', 'current_month'], 'Convex database-I/O windows');
	const currentDay = finiteNonnegative(windows.current_day, 'Convex current-day database I/O');
	const currentMonth = finiteNonnegative(
		windows.current_month,
		'Convex current-month database I/O'
	);
	invariant(currentDay <= currentMonth, 'Convex current-day usage exceeds current-month usage.');
	invariant(
		currentMonth < expected.limit,
		`Convex ${environment} database I/O crossed its native hard limit.`
	);
	const currentMonthBytes = deploymentDatabaseIoGbToBytes(currentMonth);
	return {
		currentDayGb: currentDay,
		currentMonthBytes,
		currentMonthGb: currentMonth,
		deploymentUrl: realm.deploymentUrl,
		environment,
		limitGb: expected.limit,
		seedStatus: usage.seedStatus,
		usageLimitId: actual.id
	};
}

/**
 * @param {{attestation: unknown, config: unknown, environment: Environment, expectedSourceSha: string, nowMs?: number, responses: Record<Environment, {limitsResponse: unknown, usageResponse: unknown}>}} input
 */
export function validateConvexNativeTeamUsageProof({
	attestation,
	config: rawConfig,
	environment,
	expectedSourceSha,
	nowMs = Date.now(),
	responses
}) {
	const config = validateConvexNativeUsageLimitConfig(rawConfig);
	const teamProof = validateConvexTeamUsageAttestation({
		attestation,
		constraints: config.constraints,
		expectedSourceSha,
		nowMs,
		teamUsageAuthority: config.teamUsageAuthority
	});
	/** @type {Record<Environment, ReturnType<typeof validateConvexNativeUsageLimitProof>>} */
	const deployments = /** @type {any} */ ({});
	for (const realm of ENVIRONMENTS) {
		const proof = record(responses?.[realm]);
		invariant(proof, `Convex ${realm} native proof responses are missing.`);
		exactKeys(proof, ['limitsResponse', 'usageResponse'], `Convex ${realm} native proof responses`);
		deployments[realm] = validateConvexNativeUsageLimitProof({
			config,
			environment: realm,
			limitsResponse: proof.limitsResponse,
			usageResponse: proof.usageResponse
		});
	}
	const commonsDeploymentBytes = ENVIRONMENTS.reduce(
		(total, realm) => total + deployments[realm].currentMonthBytes,
		0
	);
	const attestationRecord = record(attestation);
	invariant(
		attestationRecord && Array.isArray(attestationRecord.projects),
		'Validated Convex team attestation projects are missing.'
	);
	const commonsProject = attestationRecord.projects.find(
		(project) => record(project)?.id === config.teamUsageAuthority.requiredCommonsProjectId
	);
	invariant(
		commonsProject &&
			BigInt(commonsProject.currentDatabaseIoBytes) === BigInt(commonsDeploymentBytes),
		'Commons Deployment API counters do not exactly reconcile to the signed dashboard project total.'
	);
	return {
		commonsDeploymentBytes,
		deployments,
		environment,
		nativeLimitRole: 'per-deployment-backstop',
		teamProof
	};
}

/**
 * @param {{allowedSignersPath?: string, apiToken: string|undefined, attestationBytes: Buffer, config?: unknown, environment: Environment, expectedSourceSha: string, fetchFn?: typeof fetch, minimumRemainingValiditySeconds?: number, nowMs?: number, releasePurpose?: 'diagnostic'|'full-normal-release', signatureBytes: Buffer}} input
 */
export async function verifyConvexNativeUsageLimits({
	allowedSignersPath = DEFAULT_ALLOWED_SIGNERS_PATH,
	apiToken,
	attestationBytes,
	config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')),
	environment,
	expectedSourceSha,
	fetchFn = fetch,
	minimumRemainingValiditySeconds = 0,
	nowMs = Date.now(),
	releasePurpose = 'diagnostic',
	signatureBytes
}) {
	const checkedConfig = validateConvexNativeUsageLimitConfig(config);
	invariant(
		typeof apiToken === 'string' && apiToken.length > 0,
		'CONVEX_USAGE_LIMITS_VIEW_TOKEN is required.'
	);
	invariant(
		Buffer.isBuffer(attestationBytes) && attestationBytes.length <= 128 * 1024,
		'Signed quota attestation bytes are invalid.'
	);
	let attestation;
	try {
		attestation = JSON.parse(attestationBytes.toString('utf8'));
	} catch {
		throw new Error('Signed quota attestation is not valid JSON.');
	}
	invariant(
		attestationBytes.equals(canonicalConvexTeamUsageAttestationBytes(attestation)),
		'Signed quota attestation is not in canonical form.'
	);
	const signature = verifyConvexTeamUsageAttestationSignature({
		allowedSignersPath,
		attestation,
		signature: signatureBytes
	});
	validateConvexTeamUsageAttestation({
		attestation,
		constraints: checkedConfig.constraints,
		expectedSourceSha,
		minimumRemainingValiditySeconds,
		nowMs,
		teamUsageAuthority: checkedConfig.teamUsageAuthority
	});
	invariant(
		releasePurpose === 'diagnostic' || releasePurpose === 'full-normal-release',
		'Convex quota release purpose is invalid.'
	);

	const headers = { Accept: 'application/json', Authorization: `Convex ${apiToken}` };
	const requests = ENVIRONMENTS.flatMap((realm) => {
		const deployment = checkedConfig.environments[realm];
		const base = `${deployment.deploymentUrl}${checkedConfig.deploymentApiBasePath}`;
		return [
			fetchFn(`${base}/list_usage_limits`, {
				headers,
				redirect: 'error',
				signal: AbortSignal.timeout(15_000)
			}),
			fetchFn(`${base}/get_current_usage`, {
				headers,
				redirect: 'error',
				signal: AbortSignal.timeout(15_000)
			})
		];
	});
	const fetched = await Promise.all(requests);
	/** @type {Record<Environment, {limitsResponse: unknown, usageResponse: unknown}>} */
	const responses = /** @type {any} */ ({});
	for (const [index, realm] of ENVIRONMENTS.entries()) {
		const limits = fetched[index * 2];
		const usage = fetched[index * 2 + 1];
		invariant(limits.ok, `Convex ${realm} list_usage_limits returned HTTP ${limits.status}.`);
		invariant(usage.ok, `Convex ${realm} get_current_usage returned HTTP ${usage.status}.`);
		responses[realm] = {
			limitsResponse: await readBoundedResponseJson(
				limits,
				`Convex ${realm} list_usage_limits response`
			),
			usageResponse: await readBoundedResponseJson(
				usage,
				`Convex ${realm} get_current_usage response`
			)
		};
	}
	const proof = validateConvexNativeTeamUsageProof({
		attestation,
		config: checkedConfig,
		environment,
		expectedSourceSha,
		nowMs,
		responses
	});
	if (releasePurpose === 'full-normal-release') {
		invariant(
			checkedConfig.normalReleaseAuthority.status !== 'blocked-shared-free',
			'Full normal release is blocked: shared-Free team accounting cannot bound browser-direct Convex work. Keep containment active until a new reviewed verifier proves quota isolation or paid authority without the shared hard-disable.'
		);
	}
	return {
		...proof,
		releaseAuthorization: 'diagnostic-only',
		signature
	};
}

/** @param {string[]} argv */
function parseArgs(argv) {
	if (argv.length === 3 && argv[0] === '--environment' && argv[2] === '--config-only') {
		invariant(
			argv[1] === 'production' || argv[1] === 'preview',
			'Invalid config-only environment.'
		);
		return { configOnly: true, environment: /** @type {Environment} */ (argv[1]) };
	}
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		invariant(
			argv[index]?.startsWith('--') && argv[index + 1],
			'Verifier arguments must be --key value pairs.'
		);
		invariant(!values.has(argv[index]), `Duplicate verifier argument: ${argv[index]}.`);
		values.set(argv[index], argv[index + 1]);
	}
	for (const required of [
		'--environment',
		'--source-sha',
		'--attestation',
		'--signature',
		'--allowed-signers',
		'--purpose',
		'--minimum-validity-seconds'
	]) {
		invariant(values.has(required), `Missing verifier argument ${required}.`);
	}
	invariant(values.size === 7, 'Unknown verifier argument.');
	const environment = values.get('--environment');
	invariant(
		environment === 'production' || environment === 'preview',
		'Invalid verifier environment.'
	);
	const purpose = values.get('--purpose');
	invariant(
		purpose === 'diagnostic' || purpose === 'full-normal-release',
		'Invalid verifier purpose.'
	);
	const minimumValiditySeconds = Number(values.get('--minimum-validity-seconds'));
	invariant(
		Number.isSafeInteger(minimumValiditySeconds) && minimumValiditySeconds >= 0,
		'Invalid verifier minimum validity.'
	);
	return {
		allowedSigners: values.get('--allowed-signers'),
		attestation: values.get('--attestation'),
		configOnly: false,
		environment: /** @type {Environment} */ (environment),
		minimumValiditySeconds,
		purpose,
		signature: values.get('--signature'),
		sourceSha: values.get('--source-sha')
	};
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const args = parseArgs(process.argv.slice(2));
		if (args.configOnly) {
			validateConvexNativeUsageLimitConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
			console.log(JSON.stringify({ config: 'valid', environment: args.environment }));
		} else {
			console.log(
				JSON.stringify(
					await verifyConvexNativeUsageLimits({
						allowedSignersPath: args.allowedSigners,
						apiToken: process.env.CONVEX_USAGE_LIMITS_VIEW_TOKEN,
						attestationBytes: fs.readFileSync(args.attestation),
						environment: args.environment,
						expectedSourceSha: args.sourceSha,
						minimumRemainingValiditySeconds: args.minimumValiditySeconds,
						releasePurpose: args.purpose,
						signatureBytes: fs.readFileSync(args.signature)
					})
				)
			);
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
