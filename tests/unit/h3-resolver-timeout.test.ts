/**
 * H3 — Resolver fetch timeout
 *
 * The hung-resolver bug surfaced in G4r: the only timeout on the resolver
 * fetch was the 15-min worker sweep, but the witness TTL is 30 min, so a
 * resolver hang could already corrupt the retry path before any
 * orphan-cleanup ran. H3 wraps the fetch with AbortSignal.timeout and
 * surfaces a typed `resolver_timeout_*ms` deliveryError on the catch.
 *
 * convex/submissions.ts can't be unit-imported (Convex runtime, internal
 * APIs, generated types). Static-source assertions pin the contract.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('H3 — Resolver fetch timeout', () => {
	const submissionsPath = path.resolve(process.cwd(), 'convex/submissions.ts');

	it('wraps the resolver fetch with AbortSignal.timeout', async () => {
		const source = await fs.readFile(submissionsPath, 'utf8');
		// Find the /resolve fetch site and verify it carries an AbortSignal.timeout
		// option in the same fetch call. Anchored to the /resolve URL so we don't
		// match unrelated fetches in the file.
		const idx = source.indexOf('/resolve`');
		expect(idx, 'resolver fetch site not found').toBeGreaterThan(0);
		// AbortSignal.timeout must appear inside this fetch call (within the
		// nearest closing `})` after the URL). Cheap heuristic: scan a 1.5 KB
		// window after the URL.
		const window = source.slice(idx, idx + 1500);
		expect(window).toMatch(/signal:\s*AbortSignal\.timeout\(/);
	});

	it('uses a 30-second default timeout (within witness TTL margin)', async () => {
		const source = await fs.readFile(submissionsPath, 'utf8');
		// Pin the named constant. If someone halves it to a value that ends up
		// fighting normal TEE crypto latency (or extends past witness TTL),
		// they should see this test bark.
		expect(source).toMatch(/RESOLVER_FETCH_TIMEOUT_MS\s*=\s*30_000/);
	});

	it('catches AbortSignal timeouts and surfaces a typed resolver_timeout deliveryError', async () => {
		const source = await fs.readFile(submissionsPath, 'utf8');
		// The catch block must:
		// 1. Detect TimeoutError (DOMException name) so it tells "timeout" apart
		//    from "fetch network error" — observability matters for triage.
		// 2. Persist the deliveryError as `resolver_timeout_${ms}ms` for ops to
		//    grep, vs the generic `resolver_network_error`.
		expect(source).toMatch(/err instanceof DOMException.*err\.name === 'TimeoutError'/);
		expect(source).toMatch(/resolver_timeout_\$\{RESOLVER_FETCH_TIMEOUT_MS\}ms/);
		expect(source).toMatch(/resolver_network_error/);
	});

	it('updates deliveryStatus to failed before throwing (so retry loop sees the failure)', async () => {
		const source = await fs.readFile(submissionsPath, 'utf8');
		// The fetch-fail branch must call updateDeliveryStatus(failed) BEFORE
		// throwing, otherwise the worker re-claim path would think the
		// submission is still processing. Anchor the catch via the unique
		// resolver_network_error literal we just added.
		const idx = source.indexOf("'resolver_network_error'");
		expect(idx).toBeGreaterThan(0);
		const window = source.slice(idx, idx + 2000);
		const updateIdx = window.indexOf('updateDeliveryStatus');
		const throwIdx = window.indexOf('throw new Error');
		expect(updateIdx).toBeGreaterThan(0);
		expect(throwIdx).toBeGreaterThan(updateIdx);
	});
});
