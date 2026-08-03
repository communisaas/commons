/**
 * One canonical recipient count.
 *
 * The number a sender is shown on a card and the address list that becomes the
 * real mailto `To:` line now derive from a single module, `recipientRoster`.
 * These tests pin that collapse: the divergences that used to let a card
 * advertise a recipient the send path never delivered, the one-way bound that
 * remains, the narrower anonymous-detail carve-out that must NOT collapse into
 * the private count, and the source-text contract that keeps the old
 * duplicates from growing back.
 */
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
	parseRecipientConfigObject,
	publishableRosterCount,
	recipientIntentCount,
	recipientRosterFromConfig
} from '../../convex/lib/recipientRoster';
import { publicRecipientIntentCount } from '../../convex/lib/publicTemplateDiscoverySource';
import { recipientEmailsFromConfig } from '$lib/types/template';

// ============================================================================
// Fixtures that used to disagree
// ============================================================================

/**
 * Each config produced a DIFFERENT number depending on which reader asked.
 * The old card arithmetic read only `decisionMakers` then a strict top-level
 * `emails`; the old public counter read five array fields plus a top-level
 * `email`. The gap between them was a card advertising recipients the mailto
 * never addressed.
 */
const DIVERGENCE_FIXTURES: ReadonlyArray<readonly [string, Record<string, unknown>, number]> = [
	// `recipients` was invisible to the send-path reader entirely: shown 2, delivered 0.
	['alternative multi-target shape', { recipients: ['alder@city.gov', 'clerk@city.gov'] }, 2],
	// One junk element used to void the whole list: shown 1, delivered 0.
	['emails carrying a junk element', { emails: ['alder@city.gov', 123, null] }, 1],
	// Custom recipients were counted but never extracted: shown 2, delivered 1.
	[
		'structured authoring shape',
		{
			decisionMakers: [{ name: 'Alder', email: 'alder@city.gov' }],
			customRecipients: [{ name: 'Clerk', email: 'clerk@city.gov' }]
		},
		2
	]
];

describe('one canonical count across every reader', () => {
	it.each(DIVERGENCE_FIXTURES)(
		'agrees on %s',
		(_label, config, expectedCount) => {
			const roster = recipientRosterFromConfig(config);

			// The count the card shows.
			expect(recipientIntentCount(config)).toBe(expectedCount);
			// The count the anonymous discovery payload publishes.
			expect(publicRecipientIntentCount(config)).toBe(expectedCount);
			// The addresses the send path actually delivers to.
			expect(recipientEmailsFromConfig(config)).toEqual(roster);
			// Shown count == distinct delivered-address count.
			expect(roster).toHaveLength(expectedCount);
			expect(new Set(roster).size).toBe(roster.length);
		}
	);

	it.each(DIVERGENCE_FIXTURES)('parses the JSON-string form of %s identically', (_label, config) => {
		const serialized = JSON.stringify(config);
		expect(parseRecipientConfigObject(serialized)).toEqual(config);
		expect(recipientRosterFromConfig(serialized)).toEqual(recipientRosterFromConfig(config));
		expect(recipientIntentCount(serialized)).toBe(recipientIntentCount(config));
	});
});

// ============================================================================
// The asymmetries that remain, and are frozen
//
// Intent counts entries a config names; the roster counts distinct deliverable
// addresses. Two things separate them, and the second is the one real templates
// actually exhibit — every seeded config whose intent exceeds its roster does so
// through shared addresses, with no address-less entry involved at all.
// ============================================================================

const BOUND_FIXTURES: ReadonlyArray<unknown> = [
	...DIVERGENCE_FIXTURES.map(([, config]) => config),
	null,
	undefined,
	'{not json',
	[],
	{},
	{ emails: [] },
	{ emails: 'alder@city.gov' },
	{ email: 'alder@city.gov' },
	{ emails: [], decisionMakers: [{ name: 'X' }] },
	{
		decisionMakers: [{ email: 'one@example.test' }, { email: 'two@example.test' }],
		customRecipients: [{ email: 'three@example.test' }],
		recipientEmails: ['one@example.test', 'two@example.test', 'three@example.test'],
		emails: ['one@example.test', 'two@example.test', 'three@example.test']
	}
];

describe('roster never exceeds intent', () => {
	it('bounds the roster by the intent count for every config shape', () => {
		for (const config of BOUND_FIXTURES) {
			const roster = recipientRosterFromConfig(config);
			expect({
				config,
				withinBound: roster.length <= recipientIntentCount(config)
			}).toEqual({ config, withinBound: true });
		}
	});

	it('accounts for the whole intent-to-roster gap: address-less entries plus shared addresses', () => {
		// The dominant cause is SHARED addresses, not missing ones — several
		// decision-makers reachable at one staff inbox. A one-way `roster <= intent`
		// bound cannot see this, so it is asserted exactly: every unit of the gap is
		// either an entry with no address or a duplicate of an address already counted.
		const config = {
			emails: [],
			decisionMakers: [
				{ name: 'A', email: 'staff@office.gov' },
				{ name: 'B', email: 'staff@office.gov' },
				{ name: 'C', email: 'staff@office.gov' },
				{ name: 'D' },
				{ name: 'E', email: 'chief@office.gov' }
			]
		};
		const intent = recipientIntentCount(config);
		const roster = recipientRosterFromConfig(config);
		const addressless = config.decisionMakers.filter(
			(dm) => !('email' in dm) || !String((dm as { email?: string }).email ?? '').includes('@')
		).length;
		const withAddress = config.decisionMakers.length - addressless;
		const duplicates = withAddress - roster.length;

		expect(intent).toBe(5);
		expect(roster).toEqual(['staff@office.gov', 'chief@office.gov']);
		expect(addressless).toBe(1);
		expect(duplicates).toBe(2);
		// The gap is fully explained — no unaccounted third cause.
		expect(intent - roster.length).toBe(addressless + duplicates);
	});

	it('keeps the address-less decision-maker as one of the two asymmetries', () => {
		// A decision-maker with no address is real authoring intent but is not a
		// deliverable recipient, so intent legitimately exceeds the roster here.
		// Collapsing the two would move the counter that two migration guards use
		// as an upper bound, so this asymmetry stays until those guards move.
		const config = { emails: [], decisionMakers: [{ name: 'X' }] };
		expect(recipientIntentCount(config)).toBe(1);
		expect(recipientRosterFromConfig(config)).toEqual([]);
	});
});

// ============================================================================
// The anonymous-detail carve-out stays narrower
// ============================================================================

describe('publishable roster is narrower than private intent', () => {
	it('counts one publishable recipient when the address is denormalized', () => {
		expect(
			publishableRosterCount({ emails: ['a@x.gov'], decisionMakers: [{ email: 'a@x.gov' }] })
		).toBe(1);
	});

	it('never advertises the unverified custom recipients a private config carries', () => {
		const publishable = { emails: ['a@x.gov'], decisionMakers: [{ email: 'a@x.gov' }] };
		const privateConfig = {
			decisionMakers: [{ email: 'a@x.gov' }],
			customRecipients: [{ email: 'unverified@example.test' }]
		};
		expect(publishableRosterCount(publishable)).toBeLessThanOrEqual(
			recipientIntentCount(privateConfig)
		);
		expect(publishableRosterCount({ emails: [] })).toBe(0);
	});
});

// ============================================================================
// The stored-document counter keeps its object-only door
// ============================================================================

describe('publicRecipientIntentCount refuses shapes it never counted', () => {
	it.each(DIVERGENCE_FIXTURES)('returns 0 for the JSON-string form of %s', (_label, config) => {
		const serialized = JSON.stringify(config);
		// `templates.recipientConfig` is `v.any()`, so a JSON string is storable.
		// The shared counter parses it; this one must not, or both migration
		// guards silently move.
		expect(publicRecipientIntentCount(serialized)).toBe(0);
		expect(recipientIntentCount(serialized)).toBe(recipientIntentCount(config));
	});

	it('returns 0 for an array config', () => {
		expect(publicRecipientIntentCount([{ email: 'a@x.gov' }])).toBe(0);
	});
});

// ============================================================================
// Source-text contract
// ============================================================================

describe('no second recipient-count implementation survives', () => {
	const read = (path: string) => readFileSync(path, 'utf8');
	const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

	it('keeps the shared module free of runtime-specific imports', () => {
		const source = read('convex/lib/recipientRoster.ts');
		expect(source).not.toMatch(/from '(\.\.\/)*src\//);
		expect(source).not.toContain('_generated');
		expect(source).not.toMatch(/from 'convex/);
	});

	it('leaves no duplicate extractor in the Convex template module', () => {
		const source = read('convex/templates.ts');
		expect(occurrences(source, 'extractRecipientEmailsConvex')).toBe(0);
		expect(occurrences(source, 'countRecipientsConvex')).toBe(0);
		expect(source).toContain('publicRecipientIntentCount(template.recipientConfig)');
		expect(source).toContain('publicRecipientIntentCount(stored.recipient_config)');
	});

	it('reduces the public counter to a guard plus a delegation', () => {
		const source = read('convex/lib/publicTemplateDiscoverySource.ts');
		expect(source).toContain('return recipientIntentCount(recipientConfig);');
		expect(occurrences(source, 'publishableRosterCount(recipientConfig)')).toBe(2);
	});

	it('leaves the read side in src as pure delegation', () => {
		const source = read('src/lib/types/template.ts');
		expect(source).toContain("from '$convex/lib/recipientRoster'");
		expect(source).toContain('return parseRecipientConfigObject(value) as RecipientConfig;');
		expect(source).toContain('return recipientRosterFromConfig(value);');
		expect(occurrences(source, 'JSON.parse')).toBe(0);
	});

	it('leaves exactly one dangling decision-maker length read, in the shared module', () => {
		const files = [
			'convex/lib/recipientRoster.ts',
			'convex/lib/publicTemplateDiscoverySource.ts',
			'convex/templates.ts',
			'src/lib/types/template.ts',
			'src/lib/components/template-browser/parts/ActionBar.svelte'
		];
		const counts = files.map(
			(file) => `${file}:${occurrences(read(file), 'decisionMakers?.length ?? 0')}`
		);
		expect(counts).toEqual([
			'convex/lib/recipientRoster.ts:1',
			'convex/lib/publicTemplateDiscoverySource.ts:0',
			'convex/templates.ts:0',
			'src/lib/types/template.ts:0',
			'src/lib/components/template-browser/parts/ActionBar.svelte:0'
		]);
	});

	it('derives the action-bar count from the shared module', () => {
		const source = read('src/lib/components/template-browser/parts/ActionBar.svelte');
		expect(source).toContain("from '$convex/lib/recipientRoster'");
		expect(source).toContain('recipientIntentCount(template?.recipient_config)');
		expect(source).not.toContain('dms || emails');
		expect(source).not.toContain('recipientEmailsFromConfig');
	});

	it('drops the unwired metrics card rather than carrying it', () => {
		expect(existsSync('src/lib/components/template-browser/MessageMetrics.svelte')).toBe(false);
		expect(read('src/lib/components/ui/SkeletonTemplate.svelte')).not.toContain('MessageMetrics');
	});
});
