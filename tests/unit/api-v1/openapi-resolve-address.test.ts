/**
 * Unit Tests: OpenAPI spec coverage for POST /api/v1/resolve-address.
 *
 * Asserts the published spec describes what the handler ACTUALLY returns:
 * a metered, plan-gated POST; a nested data.asOf object carrying two distinct
 * freshness clocks (never a single scalar); and the real emitted error codes
 * (RATE_LIMITED for 429, RESOLVE_QUOTA_EXCEEDED for 402). Separate from the
 * handler test in resolve-address.test.ts — this guards the contract surface.
 */

import { describe, it, expect } from 'vitest';
import { openApiSpec } from '$lib/server/api-v1/openapi';
import { DISTRICT_COVERAGE } from '$lib/core/shadow-atlas/coverage';

// JSON round-trip to assert the spec is a plain serializable object (as served).
const spec = JSON.parse(JSON.stringify(openApiSpec));

describe('OpenAPI: /resolve-address', () => {
	it('defines a POST operation with a required requestBody', () => {
		const path = spec.paths['/resolve-address'];
		expect(path).toBeDefined();
		expect(path.post).toBeDefined();
		expect(path.post.operationId).toBe('resolveAddress');
		expect(path.post.requestBody.required).toBe(true);
		expect(path.post.requestBody.content['application/json'].schema.$ref).toBe(
			'#/components/schemas/ResolveAddressInput'
		);
	});

	it('documents the metered, per-plan, finite-free-trial posture', () => {
		const description: string = spec.paths['/resolve-address'].post.description;
		expect(description.toLowerCase()).toContain('metered');
		expect(description.toLowerCase()).toContain('per plan');
		expect(description.toLowerCase()).toContain('free-trial');
	});

	it('keys honest responses for 200/400/401/402/403/429', () => {
		const responses = spec.paths['/resolve-address'].post.responses;
		for (const code of ['200', '400', '401', '402', '403', '429']) {
			expect(responses[code], `missing response ${code}`).toBeDefined();
		}
		expect(responses['402'].$ref).toBe('#/components/responses/PaymentRequired');
		expect(responses['429'].$ref).toBe('#/components/responses/TooManyRequests');
	});

	it('exposes a nested asOf object with two distinct clocks, no bare scalar asOf', () => {
		const result = spec.components.schemas.ResolveAddressResult;
		const asOf = result.properties.asOf;
		expect(asOf.type).toBe('object');
		expect(asOf.properties.boundaryAsOf).toBeDefined();
		expect(asOf.properties.officialsAsOf).toBeDefined();

		// Each clock is string|null (honest degraded vintage).
		expect(asOf.properties.boundaryAsOf.type).toEqual(['string', 'null']);
		expect(asOf.properties.officialsAsOf.type).toEqual(['string', 'null']);

		// There must be NO bare scalar `asOf` string anywhere in the schema.
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain('"asOf":{"type":"string"}');
		expect(serialized).not.toContain('"asOf":{"type":["string","null"]}');
	});

	it('keeps warning as its own field, separate from the asOf clocks', () => {
		const props = spec.components.schemas.ResolveAddressResult.properties;
		expect(props.warning).toBeDefined();
		expect(props.warning.type).toEqual(['string', 'null']);
	});

	it('documents district as the handler\'s OBJECT shape ({id,name,jurisdiction,district_type}), nullable for outside-coverage', () => {
		const district =
			spec.components.schemas.ResolveAddressResult.properties.district;
		// The handler returns r.district verbatim — an object, never a bare id
		// string. A string-typed spec breaks every client generated from it on
		// the endpoint's primary success case.
		expect(district.type).toEqual(['object', 'null']);
		expect(Object.keys(district.properties)).toEqual([
			'id',
			'name',
			'jurisdiction',
			'district_type'
		]);
		expect(district.description.toLowerCase()).toContain('outside coverage');
	});

	it("pins the legacy district.district_type to exactly ['congressional'] — no implied multi-type promise", () => {
		const districtType =
			spec.components.schemas.ResolveAddressResult.properties.district.properties.district_type;
		expect(districtType.enum).toEqual(['congressional']);
	});

	it('documents districts as an array of ResolvedDistrict with the exact required wire fields', () => {
		const districts = spec.components.schemas.ResolveAddressResult.properties.districts;
		expect(districts).toBeDefined();
		expect(districts.type).toBe('array');
		expect(districts.items.$ref).toBe('#/components/schemas/ResolvedDistrict');

		const resolved = spec.components.schemas.ResolvedDistrict;
		expect(resolved.required).toEqual(['id', 'geoid', 'name', 'jurisdiction', 'district_type']);
	});

	it('documents coverage as ResolveCoverage with required disclosure keys and the exact class enum', () => {
		const coverage = spec.components.schemas.ResolveAddressResult.properties.coverage;
		expect(coverage.$ref).toBe('#/components/schemas/ResolveCoverage');

		const resolveCoverage = spec.components.schemas.ResolveCoverage;
		expect(resolveCoverage.required).toEqual(['boundaryTypes', 'officialsTypes']);
		expect(
			resolveCoverage.properties.boundaryTypes.additionalProperties.properties.coverage.enum
		).toEqual(['national', 'partial']);
	});

	it('names every served district_type from the live coverage table in the spec (anti-drift)', () => {
		// Mirrors the zod-schema-match pattern above: the ResolvedDistrict
		// district_type description enumerates the served types, so serving a new
		// slot without updating the published contract fails red here.
		const description: string =
			spec.components.schemas.ResolvedDistrict.properties.district_type.description;
		for (const districtType of Object.keys(DISTRICT_COVERAGE.boundaryTypes)) {
			expect(description, `spec missing served district_type ${districtType}`).toContain(
				districtType
			);
		}
	});

	it('matches the live zod addressSchema for ResolveAddressInput', () => {
		const input = spec.components.schemas.ResolveAddressInput;
		expect(input.required).toEqual(['street', 'city', 'state', 'zip']);
		expect(input.properties.state.minLength).toBe(2);
		expect(input.properties.state.maxLength).toBe(2);
		expect(input.properties.country.enum).toEqual(['US', 'CA']);
		expect(input.required).not.toContain('country');
	});

	it('carries provenance source + tigerVintage on ResolutionProvenance — and NOTHING else', () => {
		const provenance = spec.components.schemas.ResolutionProvenance;
		// Exact-set assertion: the handler emits exactly {source, tigerVintage}
		// (client.ts provenance), so any future phantom field in the spec fails here.
		expect(Object.keys(provenance.properties)).toEqual(['source', 'tigerVintage']);
		expect(provenance.required).toContain('source');
	});

	it('enumerates EVERY typed 502 code the handler emits (anti-drift on the outage contract)', () => {
		// The handler's five infra-outage branches each emit a distinct typed code
		// (+server.ts: ATLAS/METERING/METERING_WRITE/AUTH/RATE_LIMITER + the generic
		// RESOLVE_FAILED). The spec's 502 description claims an exhaustive "is one
		// of:" list — adding a new typed 502 to the handler without documenting it
		// here must fail red, like the provenance exact-set assertion.
		const desc: string = spec.paths['/resolve-address'].post.responses['502'].description;
		for (const code of [
			'ATLAS_UNAVAILABLE',
			'METERING_UNAVAILABLE',
			'METERING_WRITE_FAILED',
			'AUTH_UNAVAILABLE',
			'RATE_LIMITER_UNAVAILABLE',
			'RESOLVE_FAILED'
		]) {
			expect(desc, `502 description missing code ${code}`).toContain(code);
		}
	});

	it('defines TooManyRequests with the real emitted RATE_LIMITED code', () => {
		const tmr = spec.components.responses.TooManyRequests;
		expect(tmr).toBeDefined();
		expect(tmr.content['application/json'].schema.$ref).toBe(
			'#/components/schemas/ErrorEnvelope'
		);
		expect(tmr.content['application/json'].example.error.code).toBe('RATE_LIMITED');
	});

	it('defines PaymentRequired with the real RESOLVE_QUOTA_EXCEEDED code', () => {
		const pr = spec.components.responses.PaymentRequired;
		expect(pr).toBeDefined();
		expect(pr.content['application/json'].schema.$ref).toBe(
			'#/components/schemas/ErrorEnvelope'
		);
		expect(pr.content['application/json'].example.error.code).toBe('RESOLVE_QUOTA_EXCEEDED');
	});
});
