/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';

import {
	API_V1_EDGE_PROTOCOL_VERSION,
	API_V1_EDGE_REQUEST_HEADER,
	API_V1_RATE_TIER_HEADER
} from '$lib/server/api-v1/rate-tier-signal';
import {
	EDGE_PROTOCOL_HEADER,
	EDGE_PROTOCOL_VERSION,
	RATE_TIER_RESPONSE_HEADER
} from '../../../workers/api-v1-edge/src/index';
import hooksSource from '../../../src/hooks.server.ts?raw';
import pagesWrangler from '../../../wrangler.toml?raw';
import edgeWrangler from '../../../workers/api-v1-edge/wrangler.toml?raw';

describe('API v1 edge deployment contract', () => {
	it('keeps the Pages and module-Worker hop protocol in lockstep', () => {
		expect(EDGE_PROTOCOL_HEADER).toBe(API_V1_EDGE_REQUEST_HEADER);
		expect(EDGE_PROTOCOL_VERSION).toBe(API_V1_EDGE_PROTOCOL_VERSION);
		expect(RATE_TIER_RESPONSE_HEADER).toBe(API_V1_RATE_TIER_HEADER);
	});

	it('isolates the tier signal before auth in the Pages hook chain', () => {
		expect(hooksSource.indexOf('handleApiV1RateTierSignal,')).toBeLessThan(
			hooksSource.indexOf('handleAuth,')
		);
		expect(hooksSource).toContain("response.headers.set(API_V1_RATE_TIER_HEADER, signal)");
	});

	it('keeps unsupported ratelimit bindings out of Pages config', () => {
		expect(pagesWrangler).not.toContain('[[ratelimits]]');
	});

	it('puts the live route only behind the explicit production Worker environment', () => {
		const production = edgeWrangler.indexOf('[env.production]');
		const route = edgeWrangler.indexOf('commons.email/api/v1/*');
		expect(production).toBeGreaterThanOrEqual(0);
		expect(route).toBeGreaterThan(production);
		expect(edgeWrangler.slice(0, production)).not.toContain('commons.email/api/v1/*');
		expect(edgeWrangler.match(/\[\[env\.production\.ratelimits\]\]/g)).toHaveLength(6);
	});

	it('pins same-zone fetches to the private origin behind the Worker route', () => {
		expect(edgeWrangler).toContain('compatibility_flags = ["global_fetch_private_origin"]');
		expect(edgeWrangler).not.toContain('global_fetch_strictly_public');
	});

	it('keeps rotating uncached credentials behind a narrow cold-start budget', () => {
		const limitsFor = (binding: string) =>
			[...edgeWrangler.matchAll(new RegExp(`name = "${binding}"[\\s\\S]*?limit = (\\d+)`, 'g'))].map(
				(match) => Number(match[1])
			);

		expect(limitsFor('COLD_TOKEN_LIMIT')).toEqual([10, 10]);
		expect(limitsFor('COLD_IP_LIMIT')).toEqual([100, 100]);
	});
});
