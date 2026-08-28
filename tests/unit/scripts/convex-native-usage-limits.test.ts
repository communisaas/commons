import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { captureConvexTeamUsageAttestation } from '../../../scripts/capture-convex-team-usage-attestation.mjs';
import {
	CONVEX_TEAM_QUOTA_SIGNATURE_NAMESPACE,
	CONVEX_USAGE_BY_PROJECT_QUERY_ID,
	CONVEX_USAGE_SUMMARY_QUERY_ID,
	canonicalConvexTeamUsageAttestationBytes
} from '../../../scripts/convex-team-usage-attestation.mjs';
import {
	deploymentDatabaseIoGbToBytes,
	validateConvexNativeTeamUsageProof,
	validateConvexNativeUsageLimitConfig,
	validateConvexNativeUsageLimitProof,
	verifyConvexNativeUsageLimits
} from '../../../scripts/verify-convex-native-usage-limits.mjs';

const config = JSON.parse(readFileSync('config/convex-native-usage-limits.json', 'utf8'));
const NOW = Date.parse('2026-07-20T06:00:00.000Z');
const SOURCE_SHA = 'a'.repeat(40);
const PRINCIPAL = 'quota-release-operator';
const MIB = 1024 * 1024;
const TEAM_USAGE_BYTES = 128 * MIB;
const COMMONS_USAGE_BYTES = 96 * MIB;

let temporaryDirectory: string;
let signingKeyPath: string;
let allowedSignersPath: string;

beforeAll(() => {
	temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'commons-quota-test-'));
	signingKeyPath = path.join(temporaryDirectory, 'quota_ed25519');
	allowedSignersPath = path.join(temporaryDirectory, 'allowed-signers');
	execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', signingKeyPath], {
		stdio: 'ignore'
	});
	const publicKey = readFileSync(`${signingKeyPath}.pub`, 'utf8').trim();
	writeFileSync(
		allowedSignersPath,
		`${PRINCIPAL} namespaces="${CONVEX_TEAM_QUOTA_SIGNATURE_NAMESPACE}" ${publicKey}\n`
	);
});

afterAll(() => {
	rmSync(temporaryDirectory, { force: true, recursive: true });
});

function limitsResponse(overrides: Record<string, unknown> = {}) {
	return {
		usageLimits: [
			{
				enabled: true,
				id: 'native-limit-1',
				limit: 1,
				limitType: 'disable',
				metric: 'databaseIoGb',
				window: 'month',
				...overrides
			}
		]
	};
}

function usageResponse(currentMonth = 0.0625, overrides: Record<string, unknown> = {}) {
	return {
		metrics: {
			databaseIoGb: {
				unit: 'GB',
				usage: { current_day: Math.min(0.01, currentMonth), current_month: currentMonth }
			}
		},
		seedStatus: 'complete',
		...overrides
	};
}

function deploymentResponses(production = 0.0625, preview = 0.03125) {
	return {
		production: {
			limitsResponse: limitsResponse(),
			usageResponse: usageResponse(production)
		},
		preview: {
			limitsResponse: limitsResponse(),
			usageResponse: usageResponse(preview)
		}
	};
}

function teamAttestation() {
	return {
		billingPeriod: { end: '2026-07-31', start: '2026-07-01' },
		capturedAt: '2026-07-20T05:55:00.000Z',
		expiresAt: '2026-07-20T06:40:00.000Z',
		operator: {
			principal: PRINCIPAL,
			signatureNamespace: CONVEX_TEAM_QUOTA_SIGNATURE_NAMESPACE
		},
		projects: [
			{
				currentDatabaseIoBytes: String(8 * MIB),
				devDeploymentName: 'kindhearted-manatee-209',
				disposition: 'quiescent',
				id: 1646861,
				maximumAdditionalNonPagesDatabaseIoBytes: '0',
				name: 'superhero-hotel',
				prodDeploymentName: 'useful-dachshund-223',
				slug: 'superhero-hotel'
			},
			{
				currentDatabaseIoBytes: String(COMMONS_USAGE_BYTES),
				devDeploymentName: 'outstanding-firefly-831',
				disposition: 'quiescent',
				id: 1867656,
				maximumAdditionalNonPagesDatabaseIoBytes: '0',
				name: 'commons',
				prodDeploymentName: 'quirky-chinchilla-352',
				slug: 'commons'
			},
			{
				currentDatabaseIoBytes: String(8 * MIB),
				devDeploymentName: 'secret-echidna-126',
				disposition: 'quiescent',
				id: 1958834,
				maximumAdditionalNonPagesDatabaseIoBytes: '0',
				name: 'vcn-engine',
				prodDeploymentName: 'disciplined-turtle-925',
				slug: 'vcn-engine'
			},
			{
				currentDatabaseIoBytes: String(16 * MIB),
				devDeploymentName: 'colorless-turtle-682',
				disposition: 'quiescent',
				id: 2189493,
				maximumAdditionalNonPagesDatabaseIoBytes: '0',
				name: 'bob-site',
				prodDeploymentName: 'careful-cardinal-138',
				slug: 'bob-site'
			}
		],
		schemaVersion: 1,
		source: {
			apiOrigin: 'https://api.convex.dev',
			dashboardOrigin: 'https://dashboard.convex.dev',
			futureWorkAllowanceWindowSeconds: 3360,
			providerRefreshIntervalSeconds: 600,
			reconciliationQueryId: CONVEX_USAGE_BY_PROJECT_QUERY_ID,
			summaryQueryId: CONVEX_USAGE_SUMMARY_QUERY_ID
		},
		sourceSha: SOURCE_SHA,
		team: {
			databaseIoBytesUsed: String(TEAM_USAGE_BYTES),
			databaseIoQuotaBytes: String(1024 ** 3),
			id: 422260,
			orbSubscription: null,
			slug: 'eric-mockler',
			suspended: false,
			usageState: 'Default'
		}
	};
}

function signedAttestation(attestation = teamAttestation()) {
	const attestationBytes = canonicalConvexTeamUsageAttestationBytes(attestation);
	const signatureBytes = execFileSync(
		'ssh-keygen',
		['-Y', 'sign', '-f', signingKeyPath, '-n', CONVEX_TEAM_QUOTA_SIGNATURE_NAMESPACE, '-'],
		{ input: attestationBytes, stdio: ['pipe', 'pipe', 'ignore'] }
	);
	return { attestationBytes, signatureBytes };
}

const dashboardTeam = {
	creator: 7,
	defaultRegion: 'aws-us-east-1',
	id: 422260,
	managedBy: null,
	name: 'Eric Mockler',
	referralCode: null,
	referredBy: null,
	slug: 'eric-mockler',
	suspended: false
};

const dashboardProjects = config.teamUsageAuthority.expectedProjects.map(
	(project: Record<string, unknown>, index: number) => ({
		createTime: 1_700_000_000_000 + index,
		devDeploymentName: project.devDeploymentName,
		id: project.id,
		name: project.name,
		prodDeploymentName: project.prodDeploymentName,
		slug: project.slug,
		teamId: 422260
	})
);

const billingPeriod = { end: '2026-07-31', start: '2026-07-01' };
const usageState = { teamId: 422260, usageState: 'Default' };
const entitlements = { teamMaxDatabaseBandwidth: 1024 ** 3 };
const summaryRows = [
	[
		'422260',
		'prod',
		'aws-us-east-1',
		'2026-07-20',
		String(TEAM_USAGE_BYTES),
		null,
		null,
		null,
		null,
		null,
		null,
		null,
		null,
		null
	]
];
const perProjectRows = [
	['422260', '1646861', 'prod', '2026-07-20', String(4 * MIB), String(4 * MIB)],
	['422260', '1867656', 'prod', '2026-07-20', String(64 * MIB), String(32 * MIB)],
	['422260', '1958834', 'prod', '2026-07-20', String(4 * MIB), String(4 * MIB)],
	['422260', '2189493', 'prod', '2026-07-20', String(8 * MIB), String(8 * MIB)]
];

function projectPolicy() {
	return {
		projects: config.teamUsageAuthority.expectedProjects.map((project: Record<string, unknown>) => ({
			disposition: 'quiescent',
			maximumAdditionalNonPagesDatabaseIoBytes: '0',
			projectId: project.id
		})),
		schemaVersion: 1
	};
}

function dashboardFetch(
	overrides: {
		authorityAfter?: Partial<{
			billing: unknown;
			entitlements: unknown;
			projects: unknown;
			state: unknown;
			subscription: unknown;
			teams: unknown;
		}>;
		billing?: unknown;
		entitlements?: unknown;
		perProject?: unknown;
		projects?: unknown;
		state?: unknown;
		subscription?: unknown;
		summary?: unknown;
		teams?: unknown;
	} = {}
) {
	const counters = new Map<string, number>();
	const before = {
		billing: overrides.billing ?? billingPeriod,
		entitlements: overrides.entitlements ?? entitlements,
		projects: overrides.projects ?? dashboardProjects,
		state: overrides.state ?? usageState,
		subscription: overrides.subscription ?? null,
		teams: overrides.teams ?? [dashboardTeam]
	};
	const after = { ...before, ...(overrides.authorityAfter ?? {}) };
	return vi.fn(async (input: string | URL | Request, init: RequestInit) => {
		void init;
		const url = String(input);
		let key: keyof typeof before;
		let body: unknown;
		if (url.endsWith('/api/dashboard/teams')) {
			key = 'teams';
		} else if (url.includes('/usage/current_billing_period')) {
			key = 'billing';
		} else if (url.includes('/usage/team_usage_state')) {
			key = 'state';
		} else if (url.includes('/get_entitlements')) {
			key = 'entitlements';
		} else if (url.includes('/get_orb_subscription')) {
			key = 'subscription';
		} else if (url.endsWith('/api/teams/eric-mockler/projects')) {
			key = 'projects';
		} else if (url.includes(`queryId=${CONVEX_USAGE_SUMMARY_QUERY_ID}`)) {
			return Response.json(overrides.summary ?? summaryRows);
		} else if (url.includes(`queryId=${CONVEX_USAGE_BY_PROJECT_QUERY_ID}`)) {
			return Response.json(overrides.perProject ?? perProjectRows);
		} else {
			return new Response('unknown fixture URL', { status: 404 });
		}
		const count = counters.get(key) ?? 0;
		counters.set(key, count + 1);
		body = count === 0 ? before[key] : after[key];
		return Response.json(body);
	});
}

describe('Convex native and shared-team actual-I/O release proof', () => {
	it('pins binary-GiB backstops, exact team authority, and zero Commons non-Pages work', () => {
		expect(validateConvexNativeUsageLimitConfig(config)).toBe(config);
		expect(config).toMatchObject({
			schemaVersion: 4,
			constraints: {
				minimumDatabaseIoLimitGb: 1,
				pagesMonthlyAdmissionReserveBytes: 512 * MIB,
				teamFreeMonthlyDatabaseIoBytes: 1024 ** 3
			},
			teamUsageAuthority: {
				futureWorkAllowanceWindowSeconds: 3360,
				maximumCaptureAgeSeconds: 2700,
				maximumLifetimeSeconds: 2700,
				minimumFinalProofRemainingValiditySeconds: 180,
				minimumFirstProofRemainingValiditySeconds: 2100,
				mode: 'operator-local-dashboard-capture-ssh-attestation',
				requiredCommonsNonPagesDisposition: 'quiescent',
				teamId: 422260,
				teamSlug: 'eric-mockler'
			},
			normalReleaseAuthority: {
				requiredReplacementAuthorityKinds: [
					'paid-no-shared-hard-disable',
					'quota-isolation'
				],
				reasonCode: 'SHARED_FREE_BROWSER_DIRECT_UNARBITRATED',
				status: 'blocked-shared-free'
			}
		});
		expect(config.teamUsageAuthority.expectedProjects).toHaveLength(4);
		for (const environment of ['production', 'preview']) {
			expect(config.environments[environment].limits).toEqual([
				{
					enabled: true,
					limit: 1,
					limitType: 'disable',
					metric: 'databaseIoGb',
					window: 'month'
				}
			]);
		}
	});

	it('converts the Deployment API GB label as binary GiB and exactly reconciles the observed counters', () => {
		expect(deploymentDatabaseIoGbToBytes(0.0625)).toBe(64 * MIB);
		expect(
			deploymentDatabaseIoGbToBytes(4.015712767839432) +
				deploymentDatabaseIoGbToBytes(0.08603430446237326)
		).toBe(4_404_217_383);
	});

	it('keeps each exact live native limit and complete deployment counter as a backstop', () => {
		expect(
			validateConvexNativeUsageLimitProof({
				config,
				environment: 'production',
				limitsResponse: limitsResponse(),
				usageResponse: usageResponse(0.0625)
			})
		).toMatchObject({
			currentMonthBytes: 64 * MIB,
			currentMonthGb: 0.0625,
			deploymentUrl: 'https://quirky-chinchilla-352.convex.cloud',
			environment: 'production',
			limitGb: 1,
			seedStatus: 'complete'
		});
	});

	it('accepts only a fresh exact-SHA receipt whose exhaustive project total leaves the full Pages reserve', () => {
		expect(
			validateConvexNativeTeamUsageProof({
				attestation: teamAttestation(),
				config,
				environment: 'production',
				expectedSourceSha: SOURCE_SHA,
				nowMs: NOW,
				responses: deploymentResponses()
			})
		).toMatchObject({
			commonsDeploymentBytes: COMMONS_USAGE_BYTES,
			environment: 'production',
			nativeLimitRole: 'per-deployment-backstop',
			teamProof: {
				additionalAllowanceBytes: '0',
				availableHeadroomBytes: String(896 * MIB),
				commonsNonPagesAllowanceBytes: '0',
				pagesReserveBytes: String(512 * MIB),
				projectCount: 4,
				usageState: 'Default'
			}
		});
	});

	it('rejects partial inventory, unsafe state, stale SHA/time, unbounded Commons work, and insufficient team headroom', () => {
		const cases = [
			(attestation: ReturnType<typeof teamAttestation>) => attestation.projects.pop(),
			(attestation: ReturnType<typeof teamAttestation>) => (attestation.team.usageState = 'Approaching'),
			(attestation: ReturnType<typeof teamAttestation>) =>
				((attestation.team as { orbSubscription: unknown }).orbSubscription = {
					planType: 'CONVEX_STARTER_PLUS',
					status: 'active'
				}),
			(attestation: ReturnType<typeof teamAttestation>) => (attestation.sourceSha = 'b'.repeat(40)),
			(attestation: ReturnType<typeof teamAttestation>) =>
				(attestation.capturedAt = '2026-07-20T05:40:00.000Z'),
			(attestation: ReturnType<typeof teamAttestation>) => {
				attestation.projects[1].disposition = 'bounded';
				attestation.projects[1].maximumAdditionalNonPagesDatabaseIoBytes = '1';
			},
			(attestation: ReturnType<typeof teamAttestation>) => {
				attestation.team.databaseIoBytesUsed = String(600 * MIB);
				attestation.projects[3].currentDatabaseIoBytes = String(488 * MIB);
			}
		];
		for (const mutate of cases) {
			const attestation = teamAttestation();
			mutate(attestation);
			expect(() =>
				validateConvexNativeTeamUsageProof({
					attestation,
					config,
					environment: 'production',
					expectedSourceSha: SOURCE_SHA,
					nowMs: NOW,
					responses: deploymentResponses()
				})
			).toThrow();
		}
	});

	it('rejects dashboard totals that do not exactly reconcile to both pinned Commons deployments', () => {
		const attestation = teamAttestation();
		attestation.projects[1].currentDatabaseIoBytes = String(COMMONS_USAGE_BYTES + 1);
		attestation.team.databaseIoBytesUsed = String(TEAM_USAGE_BYTES + 1);
		expect(() =>
			validateConvexNativeTeamUsageProof({
				attestation,
				config,
				environment: 'preview',
				expectedSourceSha: SOURCE_SHA,
				nowMs: NOW,
				responses: deploymentResponses()
			})
		).toThrow('do not exactly reconcile');
	});

	it('rejects drifted limits, incomplete usage, or a crossed deployment stop', () => {
		for (const candidate of [
			{ usageLimits: [] },
			{ usageLimits: [...limitsResponse().usageLimits, ...limitsResponse().usageLimits] },
			limitsResponse({ enabled: false }),
			limitsResponse({ limit: 2 })
		]) {
			expect(() =>
				validateConvexNativeUsageLimitProof({
					config,
					environment: 'production',
					limitsResponse: candidate,
					usageResponse: usageResponse()
				})
			).toThrow();
		}
		expect(() =>
			validateConvexNativeUsageLimitProof({
				config,
				environment: 'production',
				limitsResponse: limitsResponse(),
				usageResponse: usageResponse(0.2, { seedStatus: 'partial' })
			})
		).toThrow('not complete');
		expect(() =>
			validateConvexNativeUsageLimitProof({
				config,
				environment: 'production',
				limitsResponse: limitsResponse(),
				usageResponse: usageResponse(1)
			})
		).toThrow('crossed its native hard limit');
	});

	it('verifies a canonical SSH-signed receipt before four read-only Deployment API calls', async () => {
		const evidence = signedAttestation();
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(Response.json(limitsResponse()))
			.mockResolvedValueOnce(Response.json(usageResponse(0.0625)))
			.mockResolvedValueOnce(Response.json(limitsResponse()))
			.mockResolvedValueOnce(Response.json(usageResponse(0.03125)));
		await expect(
			verifyConvexNativeUsageLimits({
				allowedSignersPath,
				apiToken: 'view-only-token',
				...evidence,
				config,
				environment: 'production',
				expectedSourceSha: SOURCE_SHA,
				fetchFn,
				nowMs: NOW
			})
		).resolves.toMatchObject({
			commonsDeploymentBytes: COMMONS_USAGE_BYTES,
			releaseAuthorization: 'diagnostic-only',
			signature: {
				namespace: CONVEX_TEAM_QUOTA_SIGNATURE_NAMESPACE,
				principal: PRINCIPAL
			}
		});
		expect(fetchFn).toHaveBeenCalledTimes(4);
		expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
			'https://quirky-chinchilla-352.convex.cloud/api/v1/list_usage_limits',
			'https://quirky-chinchilla-352.convex.cloud/api/v1/get_current_usage',
			'https://outstanding-firefly-831.convex.cloud/api/v1/list_usage_limits',
			'https://outstanding-firefly-831.convex.cloud/api/v1/get_current_usage'
		]);
		for (const [, init] of fetchFn.mock.calls) {
			expect(init.headers).toEqual({
				Accept: 'application/json',
				Authorization: 'Convex view-only-token'
			});
			expect(init.method).toBeUndefined();
			expect(init.redirect).toBe('error');
		}
	});

	it('fully reconciles a valid shared-Free receipt but never promotes it into full normal authority', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(Response.json(limitsResponse()))
			.mockResolvedValueOnce(Response.json(usageResponse(0.0625)))
			.mockResolvedValueOnce(Response.json(limitsResponse()))
			.mockResolvedValueOnce(Response.json(usageResponse(0.03125)));
		await expect(
			verifyConvexNativeUsageLimits({
				allowedSignersPath,
				apiToken: 'view-only-token',
				...signedAttestation(),
				config,
				environment: 'production',
				expectedSourceSha: SOURCE_SHA,
				fetchFn,
				minimumRemainingValiditySeconds: 2100,
				nowMs: NOW,
				releasePurpose: 'full-normal-release'
			})
		).rejects.toThrow('Full normal release is blocked');
		expect(fetchFn).toHaveBeenCalledTimes(4);
	});

	it('requires enough signed lifetime for both canary and final-upload phases', async () => {
		const fetchFn = vi.fn();
		await expect(
			verifyConvexNativeUsageLimits({
				allowedSignersPath,
				apiToken: 'view-only-token',
				...signedAttestation(),
				config,
				environment: 'production',
				expectedSourceSha: SOURCE_SHA,
				fetchFn,
				minimumRemainingValiditySeconds: 2800,
				nowMs: NOW
			})
		).rejects.toThrow('does not retain enough validity');
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('fails closed before network reads on noncanonical, tampered, or wrongly signed evidence', async () => {
		const attestation = teamAttestation();
		const evidence = signedAttestation(attestation);
		const attempts = [
			{ ...evidence, attestationBytes: Buffer.from(JSON.stringify(attestation)) },
			{
				...evidence,
				attestationBytes: canonicalConvexTeamUsageAttestationBytes({
					...attestation,
					sourceSha: 'b'.repeat(40)
				})
			},
			{ ...evidence, signatureBytes: Buffer.from('not an ssh signature') }
		];
		for (const attempt of attempts) {
			const fetchFn = vi.fn();
			await expect(
				verifyConvexNativeUsageLimits({
					allowedSignersPath,
					apiToken: 'view-only-token',
					...attempt,
					config,
					environment: 'production',
					expectedSourceSha: SOURCE_SHA,
					fetchFn,
					nowMs: NOW
				})
			).rejects.toThrow();
			expect(fetchFn).not.toHaveBeenCalled();
		}
	});
});

describe('operator-local exhaustive Convex dashboard capture', () => {
	// captureConvexTeamUsageAttestation refuses to run when process.env.CI is
	// 'true' — broad dashboard access is operator-local only, and that guard has
	// its own test below. Every OTHER case here exercises the operator path, so
	// it must run as an operator would: with CI unset. Without this the happy
	// path tripped the guard and failed in CI while passing on every laptop.
	let ciBeforeSuite: string | undefined;
	beforeAll(() => {
		ciBeforeSuite = process.env.CI;
		delete process.env.CI;
	});
	afterAll(() => {
		if (ciBeforeSuite === undefined) delete process.env.CI;
		else process.env.CI = ciBeforeSuite;
	});

	it('uses the official authority endpoints twice, reconciles exact query rows, and never persists the token', async () => {
		const fetchFn = dashboardFetch();
		const attestation = await captureConvexTeamUsageAttestation({
			accessToken: 'operator-local-access-token',
			config,
			fetchFn: fetchFn as unknown as typeof fetch,
			nowMs: NOW,
			operatorPrincipal: PRINCIPAL,
			projectPolicy: projectPolicy(),
			sourceSha: SOURCE_SHA
		});
		const expected = teamAttestation();
		expected.capturedAt = '2026-07-20T06:00:00.000Z';
		expected.expiresAt = '2026-07-20T06:45:00.000Z';
		expect(attestation).toEqual(expected);
		expect(fetchFn).toHaveBeenCalledTimes(14);
		expect(
			fetchFn.mock.calls.filter(([url]) => String(url).endsWith('/get_orb_subscription'))
		).toHaveLength(2);
		for (const [, init] of fetchFn.mock.calls) {
			expect(init.headers).toEqual({
				Accept: 'application/json',
				Authorization: 'Bearer operator-local-access-token',
				Origin: 'https://dashboard.convex.dev'
			});
			expect(init.method).toBeUndefined();
			expect(init.redirect).toBe('error');
		}
		const serialized = canonicalConvexTeamUsageAttestationBytes(attestation).toString('utf8');
		expect(serialized).not.toContain('operator-local-access-token');
		expect(serialized.endsWith('\n')).toBe(true);
	});

	it('rejects non-Default state, entitlement drift, inventory drift, and a moving authority fence', async () => {
		const extraProject = {
			...dashboardProjects[3],
			id: 9999999,
			name: 'unknown',
			slug: 'unknown'
		};
		const candidates = [
			dashboardFetch({ state: { teamId: 422260, usageState: 'Disabled' } }),
			dashboardFetch({ entitlements: { teamMaxDatabaseBandwidth: 1_000_000_000 } }),
			dashboardFetch({ subscription: { planType: 'CONVEX_STARTER_PLUS', status: 'active' } }),
			dashboardFetch({ projects: [...dashboardProjects, extraProject] }),
			dashboardFetch({
				authorityAfter: { state: { teamId: 422260, usageState: 'Approaching' } }
			}),
			dashboardFetch({
				authorityAfter: { subscription: { planType: 'CONVEX_STARTER_PLUS', status: 'active' } }
			})
		];
		for (const fetchFn of candidates) {
			await expect(
				captureConvexTeamUsageAttestation({
					accessToken: 'operator-local-access-token',
					config,
					fetchFn: fetchFn as unknown as typeof fetch,
					nowMs: NOW,
					operatorPrincipal: PRINCIPAL,
					projectPolicy: projectPolicy(),
					sourceSha: SOURCE_SHA
				})
			).rejects.toThrow();
		}
	});

	it('rejects _rest, unknown projects, null/noncanonical integers, and summary mismatch', async () => {
		const candidates = [
			dashboardFetch({
				perProject: [['_rest', '_rest', 'prod', '2026-07-20', '1', '0']]
			}),
			dashboardFetch({
				perProject: [['422260', '9999999', 'prod', '2026-07-20', '1', '0']]
			}),
			dashboardFetch({
				perProject: [['422260', '1646861', 'prod', '2026-07-20', null, '0']]
			}),
			dashboardFetch({
				perProject: [['422260', '1646861', 'prod', '2026-07-20', '01', '0']]
			}),
			dashboardFetch({
				summary: [
					['422260', 'prod', 'aws-us-east-1', '2026-07-20', '1', null, null, null, null, null, null, null, null, null]
				]
			})
		];
		for (const fetchFn of candidates) {
			await expect(
				captureConvexTeamUsageAttestation({
					accessToken: 'operator-local-access-token',
					config,
					fetchFn: fetchFn as unknown as typeof fetch,
					nowMs: NOW,
					operatorPrincipal: PRINCIPAL,
					projectPolicy: projectPolicy(),
					sourceSha: SOURCE_SHA
				})
			).rejects.toThrow();
		}
	});

	it('forbids the broad dashboard credential in CI', async () => {
		const previousCi = process.env.CI;
		process.env.CI = 'true';
		try {
			await expect(
				captureConvexTeamUsageAttestation({
					accessToken: 'operator-local-access-token',
					config,
					fetchFn: dashboardFetch() as unknown as typeof fetch,
					nowMs: NOW,
					operatorPrincipal: PRINCIPAL,
					projectPolicy: projectPolicy(),
					sourceSha: SOURCE_SHA
				})
			).rejects.toThrow('forbidden in CI');
		} finally {
			if (previousCi === undefined) delete process.env.CI;
			else process.env.CI = previousCi;
		}
	});
});
