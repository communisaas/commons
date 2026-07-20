import { describe, expect, it, vi } from 'vitest';

import policy from '../../../config/cloudflare-pages-dev-origin-closure.json';
import {
	validateCloudflarePagesDevOriginClosurePolicy,
	validateCloudflarePagesDevRedirectEntrypoint,
	validateCloudflarePagesDevRedirectItems,
	validateCloudflarePagesDevRedirectList,
	verifyCloudflarePagesDevOriginClosure
} from '../../../scripts/verify-cloudflare-pages-dev-origin-closure.mjs';

const listId = 'a'.repeat(32);

function listEnvelope() {
	return {
		success: true,
		result: [{ id: listId, name: policy.redirectList.name, kind: 'redirect' }],
		result_info: { cursors: {} }
	};
}

function itemsEnvelope() {
	return {
		success: true,
		result: [{ id: 'item-id', redirect: structuredClone(policy.redirectList.items[0]) }],
		result_info: { cursors: {} }
	};
}

function entrypointEnvelope() {
	return {
		success: true,
		result: {
			id: 'ruleset-id',
			kind: policy.entrypoint.kind,
			phase: policy.entrypoint.phase,
			rules: [{ id: 'rule-id', ...structuredClone(policy.entrypoint.requiredFirstRule) }]
		}
	};
}

describe('Cloudflare pages.dev origin closure', () => {
	it('pins one exhaustive include-subdomains redirect with no public probe bypass', () => {
		expect(validateCloudflarePagesDevOriginClosurePolicy(policy)).toBe(policy);
		expect(policy.redirectList.items).toEqual([
			{
				source_url: 'communique-site.pages.dev',
				target_url: 'https://commons.email',
				status_code: 301,
				include_subdomains: true,
				subpath_matching: true,
				preserve_query_string: true,
				preserve_path_suffix: true
			}
		]);
		expect(policy.entrypoint.requiredFirstRule.expression).toContain(
			'http.request.full_uri in $commons_pages_dev_origin_closure_v1'
		);
		expect(policy.entrypoint.requiredFirstRule.expression).toBe(
			'(http.request.full_uri in $commons_pages_dev_origin_closure_v1)'
		);
		expect(policy.releaseProbeBypassPaths).toEqual([]);
	});

	it('accepts only the dedicated list, exact item, and first account redirect rule', () => {
		expect(validateCloudflarePagesDevRedirectList(listEnvelope(), policy)).toBe(listId);
		expect(validateCloudflarePagesDevRedirectItems(itemsEnvelope(), policy)).toEqual({
			itemId: 'item-id'
		});
		expect(validateCloudflarePagesDevRedirectEntrypoint(entrypointEnvelope(), policy)).toEqual({
			rulesetId: 'ruleset-id',
			ruleId: 'rule-id',
			ref: policy.entrypoint.requiredFirstRule.ref
		});
	});

	it('rejects even a release-probe bypass in the committed desired state', () => {
		const drifted = structuredClone(policy) as any;
		drifted.releaseProbeBypassPaths = ['/api/live'];
		expect(() => validateCloudflarePagesDevOriginClosurePolicy(drifted)).toThrow(
			/must not retain any release-probe bypass/
		);
	});

	it.each([
		[
			'no immutable subdomain coverage',
			(fixture: any) => (fixture.result[0].redirect.include_subdomains = false)
		],
		['no subpath coverage', (fixture: any) => (fixture.result[0].redirect.subpath_matching = false)],
		['query loss', (fixture: any) => (fixture.result[0].redirect.preserve_query_string = false)],
		['extra list item', (fixture: any) => fixture.result.push(structuredClone(fixture.result[0]))],
		['paginated proof', (fixture: any) => (fixture.result_info.cursors.after = 'next')]
	])('rejects redirect-item drift: %s', (_label, mutate) => {
		const fixture = itemsEnvelope();
		mutate(fixture);
		expect(() => validateCloudflarePagesDevRedirectItems(fixture, policy)).toThrow();
	});

	it.each([
		['missing result_info', (fixture: any) => delete fixture.result_info],
		['missing cursors', (fixture: any) => delete fixture.result_info.cursors],
		['malformed cursors', (fixture: any) => (fixture.result_info.cursors = [])],
		['wrong total_count', (fixture: any) => (fixture.result_info.total_count = 2)]
	])('rejects non-exhaustive list inventory metadata: %s', (_label, mutate) => {
		const fixture = listEnvelope();
		mutate(fixture);
		expect(() => validateCloudflarePagesDevRedirectList(fixture, policy)).toThrow();
	});

	it.each([
		['missing result_info', (fixture: any) => delete fixture.result_info],
		['missing cursors', (fixture: any) => delete fixture.result_info.cursors],
		['malformed cursors', (fixture: any) => (fixture.result_info.cursors = 'bad')],
		['wrong count', (fixture: any) => (fixture.result_info.count = 0)]
	])('rejects non-exhaustive item metadata: %s', (_label, mutate) => {
		const fixture = itemsEnvelope();
		mutate(fixture);
		expect(() => validateCloudflarePagesDevRedirectItems(fixture, policy)).toThrow();
	});

	it.each([
		['disabled', (fixture: any) => (fixture.result.rules[0].enabled = false)],
		['not first', (fixture: any) => fixture.result.rules.unshift({ ...fixture.result.rules[0], ref: 'other' })],
		['scope drift', (fixture: any) => (fixture.result.rules[0].expression = 'true')],
		['wrong list', (fixture: any) => (fixture.result.rules[0].action_parameters.from_list.name = 'other')]
	])('rejects entry-point drift: %s', (_label, mutate) => {
		const fixture = entrypointEnvelope();
		mutate(fixture);
		expect(() => validateCloudflarePagesDevRedirectEntrypoint(fixture, policy)).toThrow();
	});

	it('reads every exact control-plane object with a read-only token', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(Response.json(listEnvelope()))
			.mockResolvedValueOnce(Response.json(itemsEnvelope()))
			.mockResolvedValueOnce(Response.json(entrypointEnvelope()));
		await expect(
			verifyCloudflarePagesDevOriginClosure({ policy, apiToken: 'read-token', fetchFn })
		).resolves.toEqual({
			rulesetId: 'ruleset-id',
			ruleId: 'rule-id',
			ref: policy.entrypoint.requiredFirstRule.ref
		});
		expect(fetchFn).toHaveBeenCalledTimes(3);
		expect(fetchFn.mock.calls.every(([, init]) => init?.redirect === 'error')).toBe(true);
		expect(String(fetchFn.mock.calls[0][0])).toContain('/accounts/019d1184e655db74b7589794a2a2a533/rules/lists?');
		expect(String(fetchFn.mock.calls[1][0])).toContain(`/rules/lists/${listId}/items?`);
		expect(String(fetchFn.mock.calls[2][0])).toContain(
			'/rulesets/phases/http_request_redirect/entrypoint'
		);
	});

	it('turns missing account redirect read permissions into an external launch gate', async () => {
		const fetchFn = vi.fn().mockResolvedValue(new Response('{}', { status: 403 }));
		await expect(
			verifyCloudflarePagesDevOriginClosure({ policy, apiToken: 'wrong-token', fetchFn })
		).rejects.toThrow(/Account Filter Lists Read.*Bulk URL Redirects Read/);
	});
});
