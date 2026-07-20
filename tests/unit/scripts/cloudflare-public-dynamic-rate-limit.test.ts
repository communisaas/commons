import { describe, expect, it, vi } from 'vitest';

import inventory from '../../../config/anonymous-dynamic-route-cost-inventory.json';
import policy from '../../../config/cloudflare-public-dynamic-rate-limit.json';
import {
	PUBLIC_DYNAMIC_EXACT_PATHS,
	PUBLIC_DYNAMIC_PATH_PREFIXES,
	publicDynamicPathMatchesPolicy,
	validateAnonymousDynamicRouteInventoryCoverage,
	validatePublicDynamicRateLimitPolicy,
	validatePublicDynamicRateLimitRuleset,
	validatePublicDynamicRateLimitZone,
	verifyCloudflarePublicDynamicRateLimit
} from '../../../scripts/verify-cloudflare-public-dynamic-rate-limit.mjs';

const zoneId = 'd'.repeat(32);

function zoneEnvelope() {
	return {
		success: true,
		result_info: { total_pages: 1 },
		result: [
			{
				id: zoneId,
				name: policy.zone.name,
				status: 'active',
				account: { id: policy.zone.accountId },
				plan: { name: policy.zone.plan }
			}
		]
	};
}

function rulesetEnvelope() {
	return {
		success: true,
		result: {
			id: 'ruleset-id',
			kind: policy.ruleset.kind,
			phase: policy.ruleset.phase,
			rules: [{ id: 'rule-id', ...structuredClone(policy.ruleset.rules[0]) }]
		}
	};
}

describe('Cloudflare public dynamic Free-plan cost shield', () => {
	it('pins one pre-origin all-method rule covering the independent anonymous cost inventory', () => {
		expect(validatePublicDynamicRateLimitPolicy(policy)).toBe(policy);
		expect(validateAnonymousDynamicRouteInventoryCoverage(inventory, policy)).toEqual({
			methodScope: 'all',
			protectedExamples: 36,
			bypassExamples: 2
		});
		expect(policy.ruleset.scope.methodScope).toBe('all');
		expect(policy.ruleset.rules[0].expression).toContain('starts_with(http.request.uri.path, "/s/")');
		expect(policy.ruleset.rules[0].expression).toContain(
			'starts_with(http.request.uri.path, "/template-modal/")'
		);
		expect(policy.ruleset.rules[0].expression).not.toContain('cf.client.bot');
		expect(policy.ruleset.rules[0].action).toBe('block');
		expect(policy.ruleset.scope.exactPaths).toEqual(PUBLIC_DYNAMIC_EXACT_PATHS);
		expect(policy.ruleset.scope.prefixes).toEqual(PUBLIC_DYNAMIC_PATH_PREFIXES);
		for (const path of ['/', '/api/waitlist', '/browse', '/directory', '/governance', '/org']) {
			expect(PUBLIC_DYNAMIC_EXACT_PATHS).toContain(path);
		}
		for (const prefix of [
			'/api/auth/passkey/',
			'/c/',
			'/d/',
			'/dm/',
			'/e/',
			'/embed/',
			'/n/',
			'/og/',
			'/org/invite/',
			'/s/',
			'/template-modal/',
			'/api/templates/',
			'/api/debates/',
			'/api/positions/count/'
		]) {
			expect(PUBLIC_DYNAMIC_PATH_PREFIXES).toContain(prefix);
		}
		expect(policy.ruleset.rules[0].ratelimit).toEqual({
			characteristics: ['cf.colo.id', 'ip.src'],
			mitigation_timeout: 10,
			period: 10,
			requests_per_period: 6,
			requests_to_origin: false
		});
		expect(policy.ruleset.capacityModel).toMatchObject({
			workersFreeAccountRequestsPerDay: 100_000,
			nominalSingleIpColoAdmissionsPerDay: 51_840,
			admissionsPerPeriod: 6,
			periodsPerDay: 8_640
		});
		for (const pathname of inventory.requiredWafPathExamples) {
			expect(publicDynamicPathMatchesPolicy(pathname, policy), pathname).toBe(true);
		}
		for (const pathname of inventory.requiredBypassPathExamples) {
			expect(publicDynamicPathMatchesPolicy(pathname, policy), pathname).toBe(false);
		}
	});

	it('covers public account-bootstrap routes before they can spend the global work budget', () => {
		for (const pathname of [
			'/api/waitlist',
			'/api/auth/passkey/authenticate',
			'/api/auth/passkey/current',
			'/org/invite/example-token'
		]) {
			expect(publicDynamicPathMatchesPolicy(pathname, policy), pathname).toBe(true);
		}
	});

	it('rejects the former debate-family inventory gap', () => {
		const drifted = structuredClone(policy) as any;
		drifted.ruleset.scope.prefixes = drifted.ruleset.scope.prefixes.map((prefix: string) =>
			prefix === '/api/debates/' ? '/api/debates/by-template/' : prefix
		);
		drifted.ruleset.rules[0].expression = drifted.ruleset.rules[0].expression.replace(
			'starts_with(http.request.uri.path, "/api/debates/")',
			'starts_with(http.request.uri.path, "/api/debates/by-template/")'
		);
		expect(() => validateAnonymousDynamicRouteInventoryCoverage(inventory, drifted)).toThrow(
			/api\/debates\/debate-id\/arguments/
		);
	});

	it('accepts only the exact active Free zone and exact single live rule', () => {
		expect(validatePublicDynamicRateLimitZone(zoneEnvelope(), policy)).toBe(zoneId);
		expect(validatePublicDynamicRateLimitRuleset(rulesetEnvelope(), policy)).toEqual({
			zone: policy.zone.name,
			plan: policy.zone.plan,
			ruleId: 'rule-id',
			ref: policy.ruleset.rules[0].ref
		});
	});

	it.each([
		['disabled', (fixture: any) => (fixture.result.rules[0].enabled = false)],
		['scope drift', (fixture: any) => (fixture.result.rules[0].expression = 'true')],
		['challenge reset bypass', (fixture: any) => (fixture.result.rules[0].action = 'managed_challenge')],
		[
			'verified-bot bypass',
			(fixture: any) => (fixture.result.rules[0].expression += ' and not cf.client.bot')
		],
		['zero-duration mitigation', (fixture: any) => (fixture.result.rules[0].ratelimit.mitigation_timeout = 0)],
		['origin-only counting', (fixture: any) => (fixture.result.rules[0].ratelimit.requests_to_origin = true)],
		['extra rule', (fixture: any) => fixture.result.rules.push({ ...fixture.result.rules[0], id: 'extra' })]
	])('rejects %s', (_name, mutate) => {
		const fixture = rulesetEnvelope();
		mutate(fixture);
		expect(() => validatePublicDynamicRateLimitRuleset(fixture, policy)).toThrow();
	});

	it('turns missing Zone WAF Read into an explicit external launch gate', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify(zoneEnvelope()), { status: 200 }))
			.mockResolvedValueOnce(new Response('{"success":false}', { status: 403 }));
		await expect(
			verifyCloudflarePublicDynamicRateLimit({ policy, inventory, apiToken: 'test-token', fetchFn })
		).rejects.toThrow(/Zone WAF Read/);
		expect(fetchFn.mock.calls.every(([, init]) => init?.redirect === 'error')).toBe(true);
	});
});
