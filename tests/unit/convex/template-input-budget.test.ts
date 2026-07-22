import { describe, expect, it } from 'vitest';
import { SEED_TEMPLATES } from '../../../convex/seedData';
import {
	MAX_TEMPLATE_CONFIG_BYTES,
	validateBoundedJson,
	validateGeographicScope,
	validateTemplateInputBudgets
} from '../../../convex/lib/templateInputBudget';

const TINY_BUDGET = {
	maxBytes: 5,
	maxDepth: 3,
	maxNodes: 5,
	maxContainerEntries: 3
};

describe('bounded template authoring JSON', () => {
	it('counts compact UTF-8 bytes rather than JavaScript string length', () => {
		expect(validateBoundedJson('abc', TINY_BUDGET)).toMatchObject({ ok: true, bytes: 5 });
		expect(validateBoundedJson('🙂', TINY_BUDGET)).toEqual({
			ok: false,
			reason: 'max_bytes',
			actual: 6,
			limit: 5
		});
	});

	it('rejects cycles, excessive depth, nodes, and container fanout before serialization', () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(validateBoundedJson(cyclic, TINY_BUDGET)).toMatchObject({
			ok: false,
			reason: 'cycle'
		});
		expect(validateBoundedJson({ a: { b: { c: true } } }, TINY_BUDGET)).toMatchObject({
			ok: false,
			reason: 'max_depth'
		});
		expect(validateBoundedJson([true, true, true, true], TINY_BUDGET)).toMatchObject({
			ok: false,
			reason: 'max_container_entries'
		});
		expect(
			validateBoundedJson([true, true, true], {
				...TINY_BUDGET,
				maxBytes: 100,
				maxNodes: 3
			})
		).toMatchObject({ ok: false, reason: 'max_nodes' });
		expect(validateBoundedJson({ a: true, b: true, c: true }, TINY_BUDGET)).toMatchObject({
			ok: false,
			reason: 'max_bytes'
		});
	});

	it('caps all three configuration objects as one budget', () => {
		const result = validateTemplateInputBudgets({
			title: 'Title',
			slug: 'title',
			description: 'Description',
			messageBody: 'Body',
			preview: 'Preview',
			type: 'direct',
			deliveryMethod: 'email',
			deliveryConfig: { first: 'x'.repeat(MAX_TEMPLATE_CONFIG_BYTES / 2) },
			recipientConfig: { second: 'x'.repeat(MAX_TEMPLATE_CONFIG_BYTES / 2) }
		});

		expect(result).toMatchObject({ ok: false, scope: 'configs', reason: 'max_bytes' });
	});

	it('separates full-document and public-projection byte ceilings', () => {
		const full = validateTemplateInputBudgets({
			title: 'Title',
			slug: 'title',
			description: 'Description',
			messageBody: 'Body',
			preview: 'Preview',
			type: 'direct',
			deliveryMethod: 'email',
			researchLog: Array.from({ length: 17 }, () => 'x'.repeat(1_000))
		});
		expect(full).toMatchObject({
			ok: false,
			scope: 'authoring_input',
			reason: 'max_bytes'
		});

		const publicProjection = validateTemplateInputBudgets({
			title: 'Title',
			slug: 'title',
			description: 'Description',
			messageBody: 'x'.repeat(13_000),
			preview: 'Preview',
			type: 'direct',
			deliveryMethod: 'email'
		});
		expect(publicProjection).toMatchObject({
			ok: false,
			scope: 'public_input',
			reason: 'max_bytes'
		});
	});

	it('accepts only the bounded discriminated GeoScope union', () => {
		expect(validateGeographicScope({ type: 'international' })).toEqual({ ok: true });
		expect(
			validateGeographicScope({ type: 'nationwide', country: 'MY', displayName: 'Malaysia' })
		).toEqual({ ok: true });
		expect(
			validateGeographicScope({
				type: 'subnational',
				country: 'US',
				subdivision: 'US-CA',
				locality: 'Los Angeles'
			})
		).toEqual({ ok: true });
		expect(
			validateGeographicScope({ type: 'subnational', country: 'us', locality: 'Austin' })
		).toMatchObject({ ok: false, reason: 'invalid_geographic_scope' });
		expect(
			validateGeographicScope({
				type: 'subnational',
				country: 'US',
				locality: 'Austin',
				ballast: 'x'
			})
		).toMatchObject({ ok: false, reason: 'invalid_geographic_scope' });
	});

	it('budgets flattened public scopes and jurisdictions instead of ignoring seed-only fields', () => {
		const base = {
			title: 'Title',
			slug: 'title',
			description: 'Description',
			messageBody: 'Body',
			preview: 'Preview',
			type: 'direct',
			deliveryMethod: 'email'
		};
		const scope = {
			countryCode: 'US',
			displayText: 'United States',
			scopeLevel: 'country',
			confidence: 1,
			extractionMethod: 'seed'
		};

		expect(
			validateTemplateInputBudgets({
				...base,
				scopes: Array.from({ length: 101 }, () => scope)
			})
		).toMatchObject({
			ok: false,
			scope: 'public_input',
			reason: 'max_container_entries',
			actual: 101,
			limit: 100
		});
		expect(
			validateTemplateInputBudgets({
				...base,
				jurisdictions: [{ jurisdictionType: 'x'.repeat(920_000) }]
			})
		).toMatchObject({ ok: false, scope: 'authoring_input', reason: 'max_bytes' });
		expect(
			validateTemplateInputBudgets({
				...base,
				scopes: 'not-an-array' as never
			})
		).toMatchObject({ ok: false, scope: 'public_input', reason: 'invalid_json_value' });
	});

	it('keeps every committed seed template inside every aggregate budget', () => {
		expect(SEED_TEMPLATES.length).toBeGreaterThan(0);
		for (const seed of SEED_TEMPLATES) {
			expect(
				validateTemplateInputBudgets({
					title: seed.title,
					slug: seed.slug,
					description: seed.description,
					messageBody: seed.messageBody,
					preview: seed.preview,
					type: seed.type,
					deliveryMethod: seed.deliveryMethod,
					domain: seed.domain,
					topics: seed.topics,
					sources: seed.sources,
					researchLog: seed.researchLog,
					deliveryConfig: seed.deliveryConfig,
					cwcConfig: seed.cwcConfig,
					recipientConfig: seed.recipientConfig,
					geographicScope: { type: 'nationwide', country: seed.countryCode },
					scopes: seed.scopes,
					jurisdictions: seed.jurisdictions,
					contentHash: seed.contentHash,
					status: 'published',
					isPublic: true
				})
			).toEqual({ ok: true });
		}
	});
});
