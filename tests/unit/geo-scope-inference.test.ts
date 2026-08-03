/**
 * Geographic-scope inference contract.
 *
 * One inference serves every authoring surface, so these cases pin the shape
 * both surfaces now emit: ISO 3166-2 subdivisions (`US-CA`, never a bare `CA`),
 * word-boundary state matching, territory coverage, and the
 * resolved-targets → audience-guidance → nationwide-fallback precedence.
 */
import { describe, expect, it } from 'vitest';
import {
	extractUsLocality,
	extractUsState,
	inferGeoScope
} from '$lib/core/geo-scope-inference';

const orgs = (...organizations: string[]) => organizations.map((organization) => ({ organization }));

describe('inferGeoScope — resolved decision-maker organizations', () => {
	it('resolves a locality shared by every organization, with an ISO subdivision', () => {
		const result = inferGeoScope({
			decisionMakers: orgs(
				'San Francisco Board of Supervisors',
				'San Francisco Department of Public Health'
			)
		});

		expect(result.scope).toMatchObject({
			type: 'subnational',
			country: 'US',
			locality: 'San Francisco',
			subdivision: 'US-CA'
		});
		expect(result.source).toBe('resolved-targets');
		expect(result.label).toBe('San Francisco, California, United States');
	});

	it('resolves a state shared by every organization and labels it', () => {
		const result = inferGeoScope({
			decisionMakers: orgs('Texas House of Representatives', 'Texas Senate')
		});

		expect(result.scope).toMatchObject({
			type: 'subnational',
			country: 'US',
			subdivision: 'US-TX'
		});
		expect(result.source).toBe('resolved-targets');
		expect(result.label.length).toBeGreaterThan(0);
	});

	it('resolves uniformly federal organizations to nationwide US', () => {
		const result = inferGeoScope({
			decisionMakers: orgs('U.S. Senate', 'United States Congress')
		});

		expect(result.scope).toMatchObject({ type: 'nationwide', country: 'US' });
		expect(result.source).toBe('resolved-targets');
	});

	it('falls back to nationwide when organizations span different states', () => {
		const result = inferGeoScope({
			decisionMakers: orgs(
				'Texas Department of Transportation',
				'California Department of Education'
			)
		});

		expect(result.scope).toMatchObject({ type: 'nationwide', country: 'US' });
		expect(result.source).toBe('fallback');
	});

	it('resolves a US territory', () => {
		const result = inferGeoScope({
			decisionMakers: orgs('Puerto Rico Department of Education')
		});

		expect(result.scope).toMatchObject({
			type: 'subnational',
			country: 'US',
			subdivision: 'US-PR'
		});
	});

	it('matches state names on word boundaries, so Indianapolis is not Indiana', () => {
		const subdivisionOf = (organization: string) => {
			const scope = inferGeoScope({ decisionMakers: orgs(organization) }).scope;
			return scope.type === 'subnational' ? scope.subdivision : undefined;
		};

		expect(subdivisionOf('Indianapolis City Council')).not.toBe('US-IN');
		expect(subdivisionOf('Indianapolis')).not.toBe('US-IN');
	});

	it('returns the nationwide fallback for an empty decision-maker list', () => {
		const result = inferGeoScope({ decisionMakers: [] });

		expect(result.scope).toMatchObject({ type: 'nationwide', country: 'US' });
		expect(result.source).toBe('fallback');
	});

	it('is deterministic for the same organizations', () => {
		const decisionMakers = orgs('San Francisco Board of Supervisors');

		expect(inferGeoScope({ decisionMakers })).toEqual(inferGeoScope({ decisionMakers }));
	});
});

describe('inferGeoScope — audience guidance precedence', () => {
	it('consults guidance only when the organizations yield nothing', () => {
		const withTargets = inferGeoScope({
			decisionMakers: orgs('Texas House of Representatives', 'Texas Senate'),
			audienceGuidance: 'San Francisco neighborhood associations'
		});

		expect(withTargets.scope).toMatchObject({ subdivision: 'US-TX' });
		expect(withTargets.source).toBe('resolved-targets');

		const withoutTargets = inferGeoScope({
			decisionMakers: [],
			audienceGuidance: 'San Francisco neighborhood associations'
		});

		expect(withoutTargets.scope).toMatchObject({
			type: 'subnational',
			country: 'US',
			locality: 'San Francisco',
			subdivision: 'US-CA'
		});
		expect(withoutTargets.source).toBe('audience-guidance');
	});

	it('reads a state out of guidance when no locality is named', () => {
		const result = inferGeoScope({
			decisionMakers: [],
			audienceGuidance: 'Texas small-business owners'
		});

		expect(result.scope).toMatchObject({ type: 'subnational', subdivision: 'US-TX' });
		expect(result.source).toBe('audience-guidance');
	});
});

describe('inferGeoScope — two-letter locality abbreviations', () => {
	const localityOf = (organization: string) => {
		const scope = inferGeoScope({ decisionMakers: orgs(organization) }).scope;
		return scope.type === 'subnational' ? scope.locality : undefined;
	};

	it('does not read the place-name prefix "La" as Los Angeles', () => {
		expect(localityOf('La Crosse Common Council')).not.toBe('Los Angeles');
		expect(localityOf('La Crosse County Board of Supervisors')).not.toBe('Los Angeles');
		expect(extractUsLocality('La Crosse Common Council')?.locality).not.toBe('Los Angeles');
	});

	it('does not read the Spanish article "la" in guidance as Los Angeles', () => {
		const result = inferGeoScope({
			decisionMakers: [],
			audienceGuidance: 'Vecinos de la comunidad que asisten a la reunión del ayuntamiento'
		});

		expect(result.scope).toMatchObject({ type: 'nationwide', country: 'US' });
		expect(result.source).toBe('fallback');
	});

	it('still resolves the spelled-out locality', () => {
		expect(localityOf('Los Angeles City Council')).toBe('Los Angeles');
		expect(extractUsLocality('Los Angeles City Council')).toMatchObject({
			locality: 'Los Angeles',
			state: 'CA'
		});
	});

	it('still resolves an uppercase abbreviation that a locality word corroborates', () => {
		expect(localityOf('LA City Council')).toBe('Los Angeles');
		expect(localityOf('LA County Board of Supervisors, CA')).toBe('Los Angeles');
		expect(localityOf('SF Board of Supervisors')).toBe('San Francisco');
	});

	it('does not read an uncorroborated abbreviation as a locality', () => {
		expect(extractUsLocality('Voters comparing AC and DC charging standards')).toBeNull();
		expect(extractUsLocality('Applicants must attach the SF-424 budget form')).toBeNull();
	});

	it('does not read a lowercase abbreviation in prose as a locality', () => {
		const result = inferGeoScope({
			decisionMakers: [],
			audienceGuidance: 'households that depend on dc power during outages'
		});

		expect(result.scope).toMatchObject({ type: 'nationwide', country: 'US' });
		expect(result.source).toBe('fallback');
	});
});

describe('extractors', () => {
	it('extracts state names and codes, and rejects substring matches', () => {
		expect(extractUsState('California Air Resources Board')).toBe('CA');
		expect(extractUsState('Austin, TX Transportation Department')).toBe('TX');
		expect(extractUsState('Indianapolis City Council')).toBeNull();
	});

	it('extracts localities from common organization patterns', () => {
		expect(extractUsLocality('City of Oakland')).toMatchObject({ locality: 'Oakland' });
		expect(extractUsLocality('San Francisco Board of Supervisors')).toMatchObject({
			locality: 'San Francisco',
			state: 'CA'
		});
		expect(extractUsLocality('Texas House of Representatives')).toBeNull();
	});
});
