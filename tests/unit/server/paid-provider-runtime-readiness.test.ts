import { describe, expect, it } from 'vitest';

import {
	paidProviderOperatorConfigured,
	paidProviderRuntimeReadiness,
	parsePaidProviderOperatorAllowlist
} from '../../../src/lib/server/paid-provider-runtime-readiness';

const READY_ENV = {
	EXA_API_KEY: 'configured-exa-key',
	FIRECRAWL_API_KEY: 'configured-firecrawl-key',
	GEMINI_API_KEY: 'configured-gemini-key',
	GROQ_API_KEY: 'configured-groq-key',
	PAID_PROVIDER_OPERATOR_USER_IDS: 'launch-operator,backup-operator'
};

describe('paid-provider runtime readiness', () => {
	it('requires every provider secret and one canonical nonempty operator allowlist', () => {
		expect(paidProviderRuntimeReadiness(READY_ENV)).toEqual({
			ready: true,
			operatorAllowlistConfigured: true,
			providerSecretsConfigured: true,
			missingBindings: []
		});
		expect(paidProviderOperatorConfigured(READY_ENV, 'launch-operator')).toBe(true);
		expect(paidProviderOperatorConfigured(READY_ENV, 'not-enrolled')).toBe(false);
	});

	it('fails closed on empty, padded, duplicate, oversized, or control-bearing IDs', () => {
		for (const value of [
			'',
			'launch-operator, backup-operator',
			'launch-operator,launch-operator',
			`${'a'.repeat(129)}`,
			'launch-operator\n'
		]) {
			expect(parsePaidProviderOperatorAllowlist(value)).toBeNull();
			expect(
				paidProviderRuntimeReadiness({ ...READY_ENV, PAID_PROVIDER_OPERATOR_USER_IDS: value })
			).toMatchObject({
				ready: false,
				operatorAllowlistConfigured: false,
				providerSecretsConfigured: true,
				missingBindings: ['PAID_PROVIDER_OPERATOR_USER_IDS']
			});
		}
	});

	it('reports only binding names and never provider values', () => {
		const result = paidProviderRuntimeReadiness({
			...READY_ENV,
			EXA_API_KEY: undefined,
			GROQ_API_KEY: ' short '
		});
		expect(result).toMatchObject({
			ready: false,
			providerSecretsConfigured: false,
			missingBindings: ['EXA_API_KEY', 'GROQ_API_KEY']
		});
		expect(JSON.stringify(result)).not.toContain('short');
		expect(JSON.stringify(result)).not.toContain('configured-');
	});
});
