import { describe, expect, it, vi } from 'vitest';
import configSource from '../../../wrangler.public-discovery-bootstrap.toml?raw';

import {
	PUBLIC_DISCOVERY_BOOTSTRAP_BACKEND,
	PUBLIC_DISCOVERY_BOOTSTRAP_BUCKET,
	PUBLIC_DISCOVERY_BOOTSTRAP_MODE,
	PUBLIC_DISCOVERY_BOOTSTRAP_QUEUE,
	PUBLIC_DISCOVERY_BOOTSTRAP_ROUTE,
	PUBLIC_DISCOVERY_BOOTSTRAP_WORKER,
	parsePublicDiscoveryBootstrapDeploymentArgs,
	validatePublicDiscoveryBootstrapDeployment,
	validatePublicDiscoveryBootstrapRoute,
	validatePublicDiscoveryBootstrapSourceConfig,
	verifyPublicDiscoveryBootstrapDeployment,
	verifyPublicDiscoveryBootstrapRouteLive
} from '../../../scripts/verify-public-discovery-bootstrap-deployment.mjs';

const SHA = 'a'.repeat(40);
const TRANSACTION = '123-1';
const VERSION = 'b'.repeat(32);

function settings(extra: Array<Record<string, unknown>> = []) {
	return {
		result: {
			compatibility_date: '2025-04-01',
			bindings: [
				{ name: 'PUBLIC_CONVEX_URL', text: PUBLIC_DISCOVERY_BOOTSTRAP_BACKEND, type: 'plain_text' },
				{ name: 'PUBLIC_DISCOVERY_BOOTSTRAP_MODE', text: PUBLIC_DISCOVERY_BOOTSTRAP_MODE, type: 'plain_text' },
				{ name: 'PUBLIC_RELEASE_TRANSACTION_ID', text: TRANSACTION, type: 'plain_text' },
				{ name: 'PUBLIC_DISCOVERY_R2', bucket_name: PUBLIC_DISCOVERY_BOOTSTRAP_BUCKET, type: 'r2_bucket' },
				{ name: 'PUBLIC_TEMPLATE_OG_QUEUE', queue_name: PUBLIC_DISCOVERY_BOOTSTRAP_QUEUE, type: 'queue' },
				{
					name: 'PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE',
					class_name: 'PublicDiscoveryManifestRefreshGate',
					script_name: 'commons-public-discovery-manifest-gate',
					namespace_id: 'gate-id',
					type: 'durable_object_namespace'
				},
				{
					name: 'CONVEX_WORK_BUDGET',
					class_name: 'ConvexWorkBudget',
					script_name: 'commons-convex-work-budget',
					namespace_id: 'budget-id',
					type: 'durable_object_namespace'
				},
				{ name: 'DISCOVERY_MANIFEST_REFRESH_SECRET', type: 'secret_text' },
				{ name: 'INTERNAL_API_SECRET', type: 'secret_text' },
				...extra
			],
			compatibility_flags: ['nodejs_compat', 'nodejs_als', 'global_fetch_strictly_public'],
			limits: { cpu_ms: 10 }
		}
	};
}

const subdomain = { result: { enabled: false, previews_enabled: false } };
const deployment = { versions: [{ percentage: 100, version_id: VERSION }] };
const version = {
	id: VERSION,
	annotations: {
		'workers/tag': SHA,
		'workers/message': `Commons release transaction=${TRANSACTION} component=bootstrap`
	}
};

describe('public-discovery bootstrap deployment', () => {
	it('pins the source config to one private exact path and existing Free authorities', () => {
		expect(validatePublicDiscoveryBootstrapSourceConfig(configSource)).toEqual({
			backend: PUBLIC_DISCOVERY_BOOTSTRAP_BACKEND,
			bucket: PUBLIC_DISCOVERY_BOOTSTRAP_BUCKET,
			cpuMilliseconds: 10,
			queue: PUBLIC_DISCOVERY_BOOTSTRAP_QUEUE,
			route: PUBLIC_DISCOVERY_BOOTSTRAP_ROUTE,
			worker: PUBLIC_DISCOVERY_BOOTSTRAP_WORKER
		});
		expect(configSource).not.toContain('custom_domain');
		expect(configSource).not.toContain('workers.dev');
	});

	it('accepts only the exact live bindings, CPU ceiling, source, and transaction', () => {
		expect(
			validatePublicDiscoveryBootstrapDeployment({
				settings: settings(),
				subdomain,
				deployment,
				version,
				expectedSourceSha: SHA,
				expectedTransactionId: TRANSACTION
			})
		).toMatchObject({
			proof: 'public-discovery-bootstrap-deployment',
			releaseSha: SHA,
			transactionId: TRANSACTION,
			versionId: VERSION
		});
	});

	it('combines only live settings, subdomain, and complete route inventory with Wrangler evidence', async () => {
		const routeInventory = {
			success: true,
			result: [
				{ pattern: PUBLIC_DISCOVERY_BOOTSTRAP_ROUTE, script: PUBLIC_DISCOVERY_BOOTSTRAP_WORKER }
			],
			result_info: { total_count: 1, total_pages: 1 }
		};
		const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			const value = url.endsWith('/settings')
				? settings()
				: url.endsWith('/subdomain')
					? subdomain
					: routeInventory;
			return new Response(JSON.stringify(value), {
				headers: { 'content-type': 'application/json' }
			});
		});

		await expect(
			verifyPublicDiscoveryBootstrapDeployment({
				accountId: 'c'.repeat(32),
				activeDeployment: deployment,
				activeVersion: version,
				apiToken: 'token',
				expectedSourceSha: SHA,
				expectedTransactionId: TRANSACTION,
				fetchFn,
				zoneId: 'd'.repeat(32)
			})
		).resolves.toMatchObject({ routePresent: true, versionId: VERSION });
		expect(fetchFn).toHaveBeenCalledTimes(3);
		expect(fetchFn.mock.calls.map(([url]) => String(url))).not.toEqual(
			expect.arrayContaining([expect.stringMatching(/\/deployments|\/versions/u)])
		);

		const absentFetch = vi.fn(async () =>
			new Response(
				JSON.stringify({
					success: true,
					result: [],
					result_info: { total_count: 0, total_pages: 1 }
				}),
				{ headers: { 'content-type': 'application/json' } }
			)
		);
		await expect(
			verifyPublicDiscoveryBootstrapRouteLive({
				apiToken: 'token',
				expectedPresent: false,
				fetchFn: absentFetch,
				zoneId: 'd'.repeat(32)
			})
		).resolves.toEqual({ present: false, route: PUBLIC_DISCOVERY_BOOTSTRAP_ROUTE });
	});

	it('rejects ambient binding, realm, exposure, CPU, and active-version drift', () => {
		expect(() =>
			validatePublicDiscoveryBootstrapDeployment({
				settings: settings([{ name: 'SESSION_KV', type: 'kv_namespace' }]),
				subdomain,
				deployment,
				version,
				expectedSourceSha: SHA,
				expectedTransactionId: TRANSACTION
			})
		).toThrow(/ambient authority/i);
		const crossed = settings();
		crossed.result.bindings[0].text = 'https://preview.example.convex.cloud';
		expect(() =>
			validatePublicDiscoveryBootstrapDeployment({
				settings: crossed,
				subdomain,
				deployment,
				version,
				expectedSourceSha: SHA,
				expectedTransactionId: TRANSACTION
			})
		).toThrow(/backend is crossed/i);
		const highCpu = settings();
		highCpu.result.limits.cpu_ms = 11;
		expect(() =>
			validatePublicDiscoveryBootstrapDeployment({
				settings: highCpu,
				subdomain,
				deployment,
				version,
				expectedSourceSha: SHA,
				expectedTransactionId: TRANSACTION
			})
		).toThrow(/CPU ceiling/i);
		expect(() =>
			validatePublicDiscoveryBootstrapDeployment({
				settings: settings(),
				subdomain: { result: { enabled: true, previews_enabled: false } },
				deployment,
				version,
				expectedSourceSha: SHA,
				expectedTransactionId: TRANSACTION
			})
		).toThrow(/workers\.dev/i);
		expect(() =>
			validatePublicDiscoveryBootstrapDeployment({
				settings: settings(),
				subdomain,
				deployment,
				version: { ...version, annotations: { ...version.annotations, 'workers/tag': 'c'.repeat(40) } },
				expectedSourceSha: SHA,
				expectedTransactionId: TRANSACTION
			})
		).toThrow(/exact-source/i);
	});

	it('proves exact route presence and terminal absence without tolerating overlap', () => {
		const present = {
			success: true,
			result: [{ pattern: PUBLIC_DISCOVERY_BOOTSTRAP_ROUTE, script: PUBLIC_DISCOVERY_BOOTSTRAP_WORKER }],
			result_info: { total_count: 1, total_pages: 1 }
		};
		expect(validatePublicDiscoveryBootstrapRoute(present, true)).toEqual({
			present: true,
			route: PUBLIC_DISCOVERY_BOOTSTRAP_ROUTE
		});
		expect(
			validatePublicDiscoveryBootstrapRoute(
				{ success: true, result: [], result_info: { total_count: 0, total_pages: 1 } },
				false
			)
		).toEqual({ present: false, route: PUBLIC_DISCOVERY_BOOTSTRAP_ROUTE });
		expect(() =>
			validatePublicDiscoveryBootstrapRoute(
				{
					success: true,
					result: [{ pattern: 'pages-origin.commons.email/*', script: 'ambient-worker' }]
				},
				true
			)
		).toThrow(/overlapping Worker route/i);
		expect(() => validatePublicDiscoveryBootstrapRoute(present, false)).toThrow(/overlapping/i);
	});

	it('rejects source config authority expansion and route aliases', () => {
		expect(() =>
			validatePublicDiscoveryBootstrapSourceConfig(
				`${configSource}\n[[kv_namespaces]]\nbinding = "EXTRA"\nid = "${'d'.repeat(32)}"\n`
			)
		).toThrow(/forbidden authority/i);
		expect(() =>
			validatePublicDiscoveryBootstrapSourceConfig(
				configSource.replace(PUBLIC_DISCOVERY_BOOTSTRAP_ROUTE, 'pages-origin.commons.email/*')
			)
		).toThrow(/exact hidden-origin/i);
	});

	it('parses separate exact deployment and terminal route-proof commands', () => {
		expect(
			parsePublicDiscoveryBootstrapDeploymentArgs([
				'deployment',
				'--config',
				'bootstrap.toml',
				'--expected-source-sha',
				SHA,
				'--expected-transaction',
				TRANSACTION,
				'--deployment-status',
				'deployment.json',
				'--active-version',
				'version.json'
			])
		).toEqual({
			activeVersion: 'version.json',
			command: 'deployment',
			config: 'bootstrap.toml',
			deploymentStatus: 'deployment.json',
			expectedSourceSha: SHA,
			expectedTransactionId: TRANSACTION
		});
		expect(parsePublicDiscoveryBootstrapDeploymentArgs(['route', '--expected', 'absent'])).toEqual(
			{ command: 'route', expectedPresent: false }
		);
		for (const args of [
			['route', '--expected', 'maybe'],
			['route', '--expected', 'absent', '--config', 'x'],
			['deployment', '--config', 'x'],
			['deployment', '--config', 'x', '--config', 'y']
		]) {
			expect(() => parsePublicDiscoveryBootstrapDeploymentArgs(args)).toThrow();
		}
	});
});
