/**
 * The copy is downgrade-only, so the interesting assertions are the silences.
 *
 * Every tier here is produced by calling `deriveDeliveryTier` on evidence shapes
 * a real producer emits — the one exception is explicitly labelled as a value a
 * client forged, which is the case the rule exists for.
 */
import { describe, expect, it } from 'vitest';
import { deriveDeliveryTier, type StandingEvidence } from '$lib/core/agents/target-class';
import {
	countUnestablishedTargets,
	describeDeliveryTier
} from '$lib/core/agents/delivery-tier-copy';

/** Grounded, self-published, officeholder title on a seat address → tier A. */
const OFFICEHOLDER: StandingEvidence = {
	email: 'mayor@cityofx.gov',
	title: 'Mayor',
	groundedThisRun: true,
	groundingSourceUrl: 'https://www.cityofx.gov/mayor'
};

/** Grounded, self-published seat channel with an ordinary title → tier B. */
const SEAT_CHANNEL: StandingEvidence = {
	email: 'planning@county.gov',
	title: 'Senior Planner',
	groundedThisRun: true,
	groundingSourceUrl: 'https://county.gov/planning'
};

/** Grounded personal mailbox with no seat form → tier C. */
const PERSONAL_MAILBOX: StandingEvidence = {
	email: 'jane.doe@dept.edu',
	title: 'Program Coordinator',
	groundedThisRun: true,
	groundingSourceUrl: 'https://dept.edu/directory'
};

function tierOf(evidence: StandingEvidence): string {
	return deriveDeliveryTier(evidence).deliveryTier;
}

describe('describeDeliveryTier', () => {
	it('speaks only about the unestablished route', () => {
		const tier = tierOf(PERSONAL_MAILBOX);
		expect(tier).toBe('C');

		const copy = describeDeliveryTier(tier);
		expect(typeof copy).toBe('string');
		expect((copy ?? '').length).toBeGreaterThan(0);
	});

	it('says nothing for an officeholder route', () => {
		expect(tierOf(OFFICEHOLDER)).toBe('A');
		expect(describeDeliveryTier(tierOf(OFFICEHOLDER))).toBeNull();
	});

	it('says nothing for a seat channel', () => {
		expect(tierOf(SEAT_CHANNEL)).toBe('B');
		expect(describeDeliveryTier(tierOf(SEAT_CHANNEL))).toBeNull();
	});

	it('says nothing when there is no tier at all', () => {
		expect(describeDeliveryTier(undefined)).toBeNull();
		expect(describeDeliveryTier(null)).toBeNull();
	});

	it('says nothing for a value it does not recognise', () => {
		expect(describeDeliveryTier('Z')).toBeNull();
		expect(describeDeliveryTier('c')).toBeNull();
		expect(describeDeliveryTier(3)).toBeNull();
		expect(describeDeliveryTier({ deliveryTier: 'C' })).toBeNull();
	});

	it('never renders the tier letter or the internal reason code', () => {
		const derivation = deriveDeliveryTier(PERSONAL_MAILBOX);
		const copy = describeDeliveryTier(derivation.deliveryTier) ?? '';

		expect(copy).not.toMatch(/(?<![\w-])[ABC](?![\w-])/);
		expect(copy).not.toContain(derivation.reason);
		expect(copy).not.toContain('_');
		expect(copy.toLowerCase()).not.toContain('unverified');
		expect(copy.toLowerCase()).not.toContain('untrusted');
	});
});

describe('countUnestablishedTargets', () => {
	it('counts only the unestablished entries of a mixed roster', () => {
		const roster = [
			{ name: 'A. Officeholder', ...deriveDeliveryTier(OFFICEHOLDER) },
			{ name: 'B. Seat', ...deriveDeliveryTier(SEAT_CHANNEL) },
			{ name: 'C. Personal', ...deriveDeliveryTier(PERSONAL_MAILBOX) },
			{ name: 'D. No address', ...deriveDeliveryTier({ groundedThisRun: true }) }
		];

		expect(countUnestablishedTargets(roster)).toBe(2);
	});

	it('answers zero rather than throwing on an empty or missing list', () => {
		expect(countUnestablishedTargets([])).toBe(0);
		expect(countUnestablishedTargets(undefined)).toBe(0);
	});

	it('tolerates entries that are not decision-maker objects at all', () => {
		const junk = [null, 'not an object', 42, { name: 'no tier here' }, undefined];

		expect(countUnestablishedTargets(junk)).toBe(0);
		expect(
			countUnestablishedTargets([...junk, { name: 'C. Personal', ...deriveDeliveryTier(PERSONAL_MAILBOX) }])
		).toBe(1);
	});

	it('a client-forged tier can only remove a caution, never add a claim', () => {
		// Hand-written literal on purpose: this is a value a client asserted, not
		// one any producer derived. Forging the reassuring tier buys silence.
		const forged = { name: 'Forged', email: 'jane.doe@dept.edu', deliveryTier: 'A' };

		expect(countUnestablishedTargets([forged])).toBe(0);
		expect(describeDeliveryTier(forged.deliveryTier)).toBeNull();
	});
});
