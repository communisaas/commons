/**
 * Debate chain-gate fail-closed contract.
 *
 * Debate routes can write state off-chain via Convex while also expecting
 * DebateMarket authority on-chain. When the chain is unconfigured, dev builds
 * proceed off-chain only; production must fail closed (503) unless an operator
 * explicitly opts in via env flag — silently accepting off-chain state would
 * create an integrity gap.
 *
 * Two layers locked here:
 *   1. Behavior of `allowChainMisconfig` itself (throw vs proceed).
 *   2. Wiring: every debate route that pairs an off-chain write with an
 *      on-chain write calls the gate with its own op label, and the routes
 *      report honest chainStatus values instead of stub responses.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';

const mockEnv = vi.hoisted(() => ({}) as Record<string, string | undefined>);

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

import { allowChainMisconfig } from '../../../src/lib/server/debate-chain-gate';

function source(path: string): string {
	return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const savedProcessFlag = process.env.DEBATE_ALLOW_OFFCHAIN_FALLBACK;

describe('allowChainMisconfig behavior', () => {
	beforeEach(() => {
		for (const key of Object.keys(mockEnv)) delete mockEnv[key];
		delete process.env.DEBATE_ALLOW_OFFCHAIN_FALLBACK;
	});

	afterAll(() => {
		if (savedProcessFlag === undefined) {
			delete process.env.DEBATE_ALLOW_OFFCHAIN_FALLBACK;
		} else {
			process.env.DEBATE_ALLOW_OFFCHAIN_FALLBACK = savedProcessFlag;
		}
	});

	it('proceeds outside production (dev/test fall back off-chain)', () => {
		mockEnv.NODE_ENV = 'development';
		expect(allowChainMisconfig({ op: 'debates/create' })).toBe(true);
	});

	it('fails closed in production without explicit opt-in: throws 503', () => {
		mockEnv.NODE_ENV = 'production';
		let thrown: (Error & { status?: number }) | undefined;
		try {
			allowChainMisconfig({ op: 'debates/create' });
		} catch (err) {
			thrown = err as Error & { status?: number };
		}
		expect(thrown).toBeDefined();
		expect(thrown?.status).toBe(503);
		// Error names the failing op and the operator escape hatch.
		expect(thrown?.message).toContain('[debates/create]');
		expect(thrown?.message).toContain('DEBATE_ALLOW_OFFCHAIN_FALLBACK');
	});

	it('proceeds in production when the opt-in env flag is exactly "1"', () => {
		mockEnv.NODE_ENV = 'production';
		mockEnv.DEBATE_ALLOW_OFFCHAIN_FALLBACK = '1';
		expect(allowChainMisconfig({ op: 'debates/resolve' })).toBe(true);
	});

	it('does not accept truthy-but-not-"1" opt-in values', () => {
		mockEnv.NODE_ENV = 'production';
		mockEnv.DEBATE_ALLOW_OFFCHAIN_FALLBACK = 'true';
		expect(() => allowChainMisconfig({ op: 'debates/resolve' })).toThrow();
	});

	it('honors a custom allowEnvVar and ignores the default flag for it', () => {
		mockEnv.NODE_ENV = 'production';
		mockEnv.DEBATE_ALLOW_OFFCHAIN_FALLBACK = '1';
		// Custom key requested but unset → still fail-closed.
		expect(() => allowChainMisconfig({ op: 'debates/claim', allowEnvVar: 'CUSTOM_CHAIN_FLAG' })).toThrow();
		mockEnv.CUSTOM_CHAIN_FLAG = '1';
		expect(allowChainMisconfig({ op: 'debates/claim', allowEnvVar: 'CUSTOM_CHAIN_FLAG' })).toBe(true);
	});

	it('reads the opt-in from process.env as a fallback', () => {
		mockEnv.NODE_ENV = 'production';
		process.env.DEBATE_ALLOW_OFFCHAIN_FALLBACK = '1';
		expect(allowChainMisconfig({ op: 'debates/commit' })).toBe(true);
	});
});

describe('debate routes wire the chain gate', () => {
	const gatedRoutes: ReadonlyArray<readonly [opLabel: string, path: string]> = [
		['debates/create', 'src/routes/api/debates/create/+server.ts'],
		['debates/arguments', 'src/routes/api/debates/[debateId]/arguments/+server.ts'],
		['debates/claim', 'src/routes/api/debates/[debateId]/claim/+server.ts'],
		['debates/resolve', 'src/routes/api/debates/[debateId]/resolve/+server.ts'],
		['debates/cosign', 'src/routes/api/debates/[debateId]/cosign/+server.ts'],
		['debates/commit', 'src/routes/api/debates/[debateId]/commit/+server.ts'],
		['debates/reveal', 'src/routes/api/debates/[debateId]/reveal/+server.ts']
	];

	it.each(gatedRoutes)('%s calls allowChainMisconfig with its own op label', (opLabel, path) => {
		const src = source(path);
		expect(src).toContain("from '$lib/server/debate-chain-gate'");
		expect(src).toContain(`allowChainMisconfig({ op: '${opLabel}' })`);
	});
});

describe('debate routes report honest chain status, never stub responses', () => {
	it('create distinguishes offchain_only from onchain_proposed', () => {
		const src = source('src/routes/api/debates/create/+server.ts');
		expect(src).toContain("chainStatus: offchainOnly ? 'offchain_only' : 'onchain_proposed'");
	});

	it('arguments reports verification + chain status separately', () => {
		const src = source('src/routes/api/debates/[debateId]/arguments/+server.ts');
		expect(src).toContain('let offchainOnly = false;');
		expect(src).toContain("verificationStatus: serverVerified ? 'verified' : 'pending'");
		expect(src).toContain('chainStatus: offchainOnly');
		expect(src).toContain("'onchain_verified'");
		expect(src).toContain("'pending_client_tx'");
	});

	it('claim records the off-chain boundary without implying settlement', () => {
		const src = source('src/routes/api/debates/[debateId]/claim/+server.ts');
		expect(src).toContain("status: 'claim_recorded'");
		expect(src).toContain("chainStatus: 'offchain_recorded'");
		expect(src).toContain('no payout or on-chain settlement was executed');
	});

	it('resolve distinguishes onchain_resolved from offchain_resolved', () => {
		const src = source('src/routes/api/debates/[debateId]/resolve/+server.ts');
		expect(src).toContain(
			"chainStatus: resolvedFromChain ? 'onchain_resolved' : 'offchain_resolved'"
		);
	});

	it('no route describes its fallback as a stub', () => {
		for (const path of [
			'src/routes/api/debates/create/+server.ts',
			'src/routes/api/debates/[debateId]/arguments/+server.ts',
			'src/routes/api/debates/[debateId]/claim/+server.ts',
			'src/routes/api/debates/[debateId]/resolve/+server.ts'
		]) {
			expect(source(path), path).not.toMatch(/returning stub|off-chain stub|stub response/i);
		}
	});
});
