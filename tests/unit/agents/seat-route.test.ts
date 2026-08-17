import { describe, expect, it } from 'vitest';
import * as seatRouteModule from '$lib/core/agents/seat-route';
import {
	SEAT_LOCAL_PARTS,
	STANDING_ORDER,
	classifySeatRoute,
	compareTargetOrder,
	deriveRouteProvenance,
	deriveStanding,
	type RouteProvenance,
	type StandingVerdict
} from '$lib/core/agents/seat-route';

describe('seat route classification', () => {
	it.each([
		'president@osu.edu',
		'chancellor@illinois.edu',
		'superintendent@pgcps.org',
		'info@example.gov',
		'press@example.gov',
		'contact@example.gov',
		'Mayor@example.gov',
		'DOC.Info@example.gov',
		'ExecutiveDirector@example.org'
	])('classifies the closed member %s as a seat', (email) => {
		const result = classifySeatRoute(email, { candidateName: undefined });

		expect(result?.form).toBe('seat');
		expect(result?.lexiconHit).toBe(result?.localPart);
	});

	it.each(['pressoffice@example.gov', 'MOComms@example.gov', 'cdec_communications@example.gov', 'TGHnews@example.gov'])(
		'declines the accepted compound recall bound %s',
		(email) => {
			const result = classifySeatRoute(email, { candidateName: undefined });

			expect(result).toMatchObject({ form: 'indeterminate', lexiconHit: null });
		}
	);

	it('classifies both UConn addresses as person-form despite page proximity', () => {
		const opts = { candidateName: 'Paige Rasid' };

		expect(classifySeatRoute('rasid@uconn.edu', opts)).toMatchObject({
			form: 'person-form',
			nameTokenMatch: true,
			lexiconHit: null
		});
		expect(classifySeatRoute('paige.rasid@uconn.edu', opts)).toMatchObject({
			form: 'person-form',
			nameTokenMatch: true,
			lexiconHit: null
		});
	});

	it('lets a person-name token override an exact lexicon member', () => {
		expect(classifySeatRoute('board@example.gov', { candidateName: 'Board Jones' })).toMatchObject({
			form: 'person-form',
			nameTokenMatch: true,
			lexiconHit: null
		});
	});

	it('pins the three-character name-token threshold on both sides', () => {
		expect(classifySeatRoute('le.gal@univ.fr', { candidateName: 'Le Gal' })).toMatchObject({
			form: 'person-form',
			nameTokenMatch: true,
			lexiconHit: null
		});
		expect(classifySeatRoute('in.fo@example.gov', { candidateName: 'In Fo' })).toMatchObject({
			form: 'seat',
			nameTokenMatch: false,
			lexiconHit: 'info'
		});
	});

	it('demotes but records a closed lexicon hit', () => {
		expect(
			classifySeatRoute('president@example.edu', { candidateName: undefined, demote: true })
		).toEqual({
			form: 'indeterminate',
			localPart: 'president',
			nameTokenMatch: false,
			lexiconHit: 'president'
		});
	});

	it('returns no verdict for a missing or malformed address', () => {
		expect(classifySeatRoute(undefined, { candidateName: undefined })).toBeUndefined();
		expect(classifySeatRoute('not-an-address', { candidateName: undefined })).toBeUndefined();
	});

	it('refuses to classify when candidate-name evidence is omitted', () => {
		expect(() => classifySeatRoute('press@example.gov', {} as never)).toThrow(
			'explicit candidateName evidence'
		);
	});

	it('keeps the lexicon normalized, closed, and immutable at runtime', () => {
		expect(Object.isFrozen(SEAT_LOCAL_PARTS)).toBe(true);
		expect(SEAT_LOCAL_PARTS.has('DOC.Info')).toBe(false);
		expect(SEAT_LOCAL_PARTS.has('docinfo')).toBe(true);
		expect(SEAT_LOCAL_PARTS.has('pressoffice')).toBe(false);

		expect(() => (SEAT_LOCAL_PARTS as Set<string>).add('pressoffice')).toThrow(TypeError);
		expect(() => (SEAT_LOCAL_PARTS as Set<string>).delete('president')).toThrow(TypeError);
		expect(() => (SEAT_LOCAL_PARTS as Set<string>).clear()).toThrow(TypeError);
		expect(SEAT_LOCAL_PARTS.has('pressoffice')).toBe(false);
		expect(SEAT_LOCAL_PARTS.has('president')).toBe(true);
	});
});

describe('route provenance', () => {
	const seat = classifySeatRoute('president@example.edu', { candidateName: undefined });

	it('requires grounding, a seat, and a non-empty source for an office route', () => {
		expect(
			deriveRouteProvenance({
				seat,
				emailGrounded: true,
				emailSource: 'https://example.edu/president'
			})
		).toEqual({ provenance: 'for-office', source: 'https://example.edu/president' });

		expect(deriveRouteProvenance({ seat, emailGrounded: true })).toEqual({
			provenance: 'none',
			reason: 'unknown'
		});
		expect(
			deriveRouteProvenance({ seat, emailGrounded: true, emailSource: '   ' })
		).toEqual({ provenance: 'none', reason: 'unknown' });
	});

	it('keeps grounded non-seat routes untied and source-bound', () => {
		const person = classifySeatRoute('paige.rasid@uconn.edu', {
			candidateName: 'Paige Rasid'
		});

		expect(
			deriveRouteProvenance({
				seat: person,
				emailGrounded: true,
				emailSource: 'https://president.uconn.edu/contact'
			})
		).toEqual({
			provenance: 'on-page-untied',
			source: 'https://president.uconn.edu/contact'
		});
	});

	it.each(['blocked', 'absent', 'ungrounded'] as const)(
		'carries the real emailless R2 %s reason without manufacturing a source',
		(contactRouteStatus) => {
			expect(deriveRouteProvenance({ contactRouteStatus })).toEqual({
				provenance: 'none',
				reason: contactRouteStatus
			});
		}
	);

	it('does not publish a route after MX detaches an undeliverable address', () => {
		expect(
			deriveRouteProvenance({
				seat: undefined,
				emailGrounded: true,
				emailSource: 'https://district.example.org/staff',
				contactRouteStatus: 'undeliverable'
			})
		).toEqual({ provenance: 'none', reason: 'undeliverable' });
	});

	it('allows only an explicit block-scoped association to assert beside-person', () => {
		expect(
			deriveRouteProvenance({
				seat: classifySeatRoute('jane.smith@example.gov', { candidateName: 'Jane Smith' }),
				blockScopedAssociation: true,
				emailSource: 'https://example.gov/directory'
			})
		).toEqual({ provenance: 'beside-person', source: 'https://example.gov/directory' });
	});
});

describe('standing derivation', () => {
	it('uses the in-the-building floor with an explicit basis', () => {
		expect(deriveStanding({})).toEqual({
			standing: 'in-the-building',
			basis: 'model-inferred'
		});
	});

	it('respects page, registry, title, and model basis precedence', () => {
		expect(
			deriveStanding({
				pageStatedRole: 'Committee Chair',
				registryRoleField: 'Registrar',
				title: 'Mayor',
				roleCategory: 'shapes'
			})
		).toEqual({ standing: 'gates', basis: 'page-stated' });
		expect(
			deriveStanding({ registryRoleField: 'Registrar', title: 'Mayor', roleCategory: 'shapes' })
		).toEqual({ standing: 'administers', basis: 'registry-field' });
		expect(deriveStanding({ title: 'Mayor', roleCategory: 'shapes' })).toEqual({
			standing: 'decides',
			basis: 'title-inferred'
		});
		expect(deriveStanding({ title: 'Resident', roleCategory: 'shapes' })).toEqual({
			standing: 'coalition',
			basis: 'model-inferred'
		});
	});

	it('reserves channel-of-record for explicit page-stated evidence', () => {
		expect(deriveStanding({ pageStatedRole: 'Official channel of record' })).toEqual({
			standing: 'channel-of-record',
			basis: 'page-stated'
		});
		expect(deriveStanding({ title: 'Official channel of record' }).standing).not.toBe(
			'channel-of-record'
		);
		expect(deriveStanding({ roleCategory: 'votes' }).standing).not.toBe('channel-of-record');
	});
});

describe('target ordering', () => {
	type Target = Parameters<typeof compareTargetOrder>[0];
	const expectedStandingOrder = [
		'channel-of-record',
		'decides',
		'gates',
		'administers',
		'staffs-a-decider',
		'designated-subject-contact',
		'coalition',
		'in-the-building'
	] as const satisfies readonly StandingVerdict['standing'][];
	const expectedProvenanceOrder = [
		'beside-person',
		'for-office',
		'on-page-untied',
		'none'
	] as const satisfies readonly RouteProvenance['provenance'][];
	const standing = (
		value: StandingVerdict['standing'],
		basis: StandingVerdict['basis'] = 'title-inferred'
	): StandingVerdict => ({
		standing: value,
		basis
	});
	const provenance = (value: RouteProvenance['provenance']): RouteProvenance =>
		value === 'none'
			? { provenance: value, reason: 'unknown' }
			: { provenance: value, source: 'https://example.gov/source' };
	const standingOptions: readonly Target['standing'][] = [
		...expectedStandingOrder.map((value) => standing(value)),
		undefined
	];
	const provenanceOptions: readonly Target['routeProvenance'][] = [
		...expectedProvenanceOrder.map((value) => provenance(value)),
		undefined
	];
	const clockOptions = [undefined, Number.MIN_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER] as const;
	const ordinalSign = (left: number, right: number): -1 | 0 | 1 =>
		left < right ? -1 : left > right ? 1 : 0;
	const target = (
		standingValue: Target['standing'],
		clockRank: Target['clockRank'],
		provenanceValue: Target['routeProvenance']
	): Target => ({
		standing: standingValue,
		clockRank,
		routeProvenance: provenanceValue
	});

	it('returns zero for a real tie', () => {
		const target = {
			standing: standing('decides'),
			clockRank: 2,
			routeProvenance: provenance('for-office')
		};

		expect(compareTargetOrder(target, { ...target })).toBe(0);
	});

	it('respects standing order before other ordinals', () => {
		expect(STANDING_ORDER).toEqual(expectedStandingOrder);
		for (let index = 0; index < expectedStandingOrder.length - 1; index += 1) {
			expect(
				compareTargetOrder(
					{ standing: standing(expectedStandingOrder[index]), clockRank: 50 },
					{ standing: standing(expectedStandingOrder[index + 1]), clockRank: 1 }
				)
			).toBe(-1);
		}
	});

	it('sorts missing standing after the explicit lowest standing', () => {
		expect(
			compareTargetOrder({ standing: standing('in-the-building') }, {})
		).toBe(-1);
		expect(
			compareTargetOrder({}, { standing: standing('in-the-building') })
		).toBe(1);
	});

	it('makes standing dominate every clock and provenance combination', () => {
		for (let leftStanding = 0; leftStanding < standingOptions.length; leftStanding += 1) {
			for (let rightStanding = 0; rightStanding < standingOptions.length; rightStanding += 1) {
				if (leftStanding === rightStanding) continue;

				for (const leftClock of clockOptions) {
					for (const rightClock of clockOptions) {
						for (const leftProvenance of provenanceOptions) {
							for (const rightProvenance of provenanceOptions) {
								expect(
									compareTargetOrder(
										target(standingOptions[leftStanding], leftClock, leftProvenance),
										target(standingOptions[rightStanding], rightClock, rightProvenance)
									)
								).toBe(ordinalSign(leftStanding, rightStanding));
							}
						}
					}
				}
			}
		}

		// This is the smallest known counterexample to a weighted standing/provenance sum.
		expect(
			compareTargetOrder(
				target(standing('decides'), Number.MAX_SAFE_INTEGER, provenance('none')),
				target(standing('gates'), Number.MIN_SAFE_INTEGER, provenance('beside-person'))
			)
		).toBe(-1);
	});

	it('uses clock only under a standing tie and before every provenance combination', () => {
		const definedClockOptions = clockOptions.filter(
			(value): value is number => value !== undefined
		);

		for (const standingValue of standingOptions) {
			for (let leftClock = 0; leftClock < definedClockOptions.length; leftClock += 1) {
				for (let rightClock = 0; rightClock < definedClockOptions.length; rightClock += 1) {
					if (leftClock === rightClock) continue;

					for (const leftProvenance of provenanceOptions) {
						for (const rightProvenance of provenanceOptions) {
							expect(
								compareTargetOrder(
									target(standingValue, definedClockOptions[leftClock], leftProvenance),
									target(standingValue, definedClockOptions[rightClock], rightProvenance)
								)
							).toBe(ordinalSign(leftClock, rightClock));
						}
					}
				}
			}
		}
	});

	it('uses provenance only after standing and clock tie or when clock is unavailable', () => {
		for (const standingValue of standingOptions) {
			for (const leftClock of clockOptions) {
				for (const rightClock of clockOptions) {
					const clockIsTiedOrIgnored =
						leftClock === rightClock || leftClock === undefined || rightClock === undefined;
					if (!clockIsTiedOrIgnored) continue;

					for (let leftProvenance = 0; leftProvenance < provenanceOptions.length; leftProvenance += 1) {
						for (
							let rightProvenance = 0;
							rightProvenance < provenanceOptions.length;
							rightProvenance += 1
						) {
							expect(
								compareTargetOrder(
									target(standingValue, leftClock, provenanceOptions[leftProvenance]),
									target(standingValue, rightClock, provenanceOptions[rightProvenance])
								)
							).toBe(ordinalSign(leftProvenance, rightProvenance));
						}
					}
				}
			}
		}
	});

	it('ignores clock rank when either target lacks it', () => {
		expect(
			compareTargetOrder(
				{
					standing: standing('decides'),
					clockRank: 99,
					routeProvenance: provenance('beside-person')
				},
				{
					standing: standing('decides'),
					routeProvenance: provenance('for-office')
				}
			)
		).toBe(-1);
	});

	it('returns only antisymmetric ordinal signs and preserves distinct real ties', () => {
		const targets = expectedStandingOrder.flatMap((standingValue, clockRank) =>
			expectedProvenanceOrder.flatMap((provenanceValue) => [
				{
					standing: standing(standingValue),
					clockRank,
					routeProvenance: provenance(provenanceValue)
				},
				{
					standing: standing(standingValue, 'model-inferred'),
					routeProvenance: provenance(provenanceValue)
				}
			])
		);
		let foundDistinctTie = false;

		for (let leftIndex = 0; leftIndex < targets.length; leftIndex += 1) {
			for (let rightIndex = 0; rightIndex < targets.length; rightIndex += 1) {
				const forward = compareTargetOrder(targets[leftIndex], targets[rightIndex]);
				const reverse = compareTargetOrder(targets[rightIndex], targets[leftIndex]);

				expect([-1, 0, 1]).toContain(forward);
				expect(reverse).toBe(forward === 0 ? 0 : -forward);
				if (
					leftIndex !== rightIndex &&
					forward === 0 &&
					JSON.stringify(targets[leftIndex]) !== JSON.stringify(targets[rightIndex])
				) {
					foundDistinctTie = true;
				}
			}
		}

		expect(foundDistinctTie).toBe(true);
	});

	it('exposes no nested function that can combine standing and provenance into a number', () => {
		const reachableFunctions: string[] = [];
		const seen = new Set<object>();
		const visit = (value: unknown, path: string): void => {
			if (typeof value === 'function') {
				reachableFunctions.push(path);
				return;
			}
			if (typeof value !== 'object' || value === null || seen.has(value)) return;
			seen.add(value);

			for (const key of Reflect.ownKeys(value)) {
				let nestedValue: unknown;
				try {
					nestedValue = Reflect.get(value, key);
				} catch {
					continue;
				}
				visit(nestedValue, `${path}.${String(key)}`);
			}
		};

		visit(seatRouteModule, 'seatRouteModule');

		expect(reachableFunctions.sort()).toEqual(
			[
				'seatRouteModule.classifySeatRoute',
				'seatRouteModule.compareTargetOrder',
				'seatRouteModule.deriveRouteProvenance',
				'seatRouteModule.deriveStanding',
				// `(name: string | undefined) => boolean` — reads a published label and
				// nothing else. It cannot see standing or provenance, so it cannot
				// combine them, which is the property this list exists to hold.
				'seatRouteModule.nameIsRoleLabel'
			].sort()
		);
	});
});
