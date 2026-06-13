/**
 * Merge-field grammar parity.
 *
 * The merge-field grammar is implemented at four sites: the server email
 * compiler, the shared core module (the browser client-direct send path),
 * the hand-duplicated Convex batch-send mirror, and the compose page's
 * detection pattern. The Convex mirror cannot import $lib modules, and the
 * compose page keeps a local regex for token counting — this suite is the
 * guard that holds the supported-token set and fallback semantics identical
 * everywhere, so a token an author types behaves the same on every send path.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	buildTierContext,
	compileMergeFields,
	type MergeContext
} from '$lib/server/email/compiler';
import {
	applyEmailMergeFields,
	buildEmailTierContext,
	countEmailMergeFields,
	hasEmailMergeFields,
	MERGE_FIELD_NAMES,
	type EmailMergeContext,
	type VerificationStatus
} from '$lib/core/email/merge-fields';
import {
	applyEmailMergeFields as convexApplyEmailMergeFields,
	buildEmailTierContext as convexBuildEmailTierContext
} from '../../../convex/_emailMergeFields';

// Canonical token set lives in the core module; every other site mirrors it.
const TOKEN_NAMES = MERGE_FIELD_NAMES;

// Extract the literal MERGE_FIELD_NAMES array from a sibling implementation's
// source so a token added to one site but not another is caught at the set
// level (not just behaviorally). Returns the names in declaration order.
function readMergeFieldNames(relPath: string): string[] {
	const source = readFileSync(resolve(process.cwd(), relPath), 'utf8');
	const block = source.match(/MERGE_FIELD_NAMES\s*=\s*\[([\s\S]*?)\]/);
	if (!block) throw new Error(`MERGE_FIELD_NAMES not found in ${relPath}`);
	return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const fullCtx: MergeContext & EmailMergeContext = {
	firstName: 'Maria',
	lastName: 'Reyes',
	email: 'maria@example.org',
	postalCode: '94110',
	verificationStatus: 'verified',
	tierLabel: 'Established',
	tierContext: buildEmailTierContext('verified')
};

const blankCtx: MergeContext & EmailMergeContext = {
	firstName: '',
	lastName: '',
	email: 'maria@example.org',
	postalCode: null,
	verificationStatus: 'imported',
	tierLabel: null,
	tierContext: buildEmailTierContext('imported')
};

// All HTML-mode resolvers, by site. compileMergeFields delegates to the core
// module; the Convex entry is an independent hand-written mirror.
const htmlResolvers: Array<[string, (t: string, ctx: typeof fullCtx) => string]> = [
	['server compiler', (t, ctx) => compileMergeFields(t, ctx)],
	['core module', (t, ctx) => applyEmailMergeFields(t, ctx)],
	['convex mirror', (t, ctx) => convexApplyEmailMergeFields(t, ctx)]
];

function loadComposePagePattern(): RegExp {
	const source = readFileSync(
		resolve(process.cwd(), 'src/routes/org/[slug]/emails/compose/+page.svelte'),
		'utf8'
	);
	const match = source.match(/mergeFieldPattern\s*=\s*\/((?:[^/\\\n]|\\.)+)\/([a-z]*)/);
	if (!match) throw new Error('compose page mergeFieldPattern not found');
	return new RegExp(match[1], match[2]);
}

describe('supported-token set equality (every resolution site)', () => {
	it('convex mirror declares exactly the canonical token set', () => {
		const convexNames = readMergeFieldNames('convex/_emailMergeFields.ts');
		expect(new Set(convexNames)).toEqual(new Set(TOKEN_NAMES));
		// Order matters too — the alternation regex is built from this list.
		expect(convexNames).toEqual([...TOKEN_NAMES]);
	});

	it('compose page detection pattern matches exactly the canonical token set', () => {
		const pattern = loadComposePagePattern();
		// Every canonical token is detected, and an off-list token is not.
		for (const name of TOKEN_NAMES) {
			expect(`{{${name}}}`.match(pattern)?.length ?? 0, `token: ${name}`).toBe(1);
		}
		expect('{{notARealToken}}'.match(pattern)?.length ?? 0).toBe(0);
	});

	it('server compiler + core + convex resolve exactly the canonical tokens (and nothing more)', () => {
		// A canonical token resolves to its value; an off-list token is left
		// verbatim. Run on every HTML resolver so a token supported at one site
		// but missing at another diverges here.
		for (const [, run] of htmlResolvers) {
			for (const name of TOKEN_NAMES) {
				expect(run(`<<{{${name}}}>>`, fullCtx), `token: ${name}`).not.toBe(`<<{{${name}}}>>`);
			}
			expect(run('<<{{notARealToken}}>>', fullCtx)).toBe('<<{{notARealToken}}>>');
		}
	});
});

describe('merge-field fallback semantics (every resolution site)', () => {
	it.each(htmlResolvers)('%s renders the fallback when the value is blank', (_site, run) => {
		expect(run('Dear {{firstName|Friend}},', blankCtx)).toBe('Dear Friend,');
	});

	it.each(htmlResolvers)('%s prefers the recipient value over the fallback', (_site, run) => {
		expect(run('Dear {{firstName|Friend}},', fullCtx)).toBe('Dear Maria,');
	});

	it.each(htmlResolvers)('%s treats whitespace-only values as blank', (_site, run) => {
		expect(run('Dear {{firstName|Friend}},', { ...blankCtx, firstName: '   ' })).toBe(
			'Dear Friend,'
		);
	});

	it.each(htmlResolvers)(
		'%s collapses a blank token without fallback — no orphaned punctuation',
		(_site, run) => {
			const out = run('Dear {{firstName}},', blankCtx);
			expect(out).toBe('Dear,');
			expect(out).not.toContain(' ,');
		}
	);

	it.each(htmlResolvers)('%s collapses adjacent blank tokens cleanly', (_site, run) => {
		expect(run('Hi {{firstName}} {{lastName}}!', blankCtx)).toBe('Hi!');
	});

	it.each(htmlResolvers)('%s applies fallbacks to nullable fields', (_site, run) => {
		expect(run('{{postalCode|unknown}} / {{tierLabel|supporter}}', blankCtx)).toBe(
			'unknown / supporter'
		);
	});

	it.each(htmlResolvers)('%s HTML-escapes recipient values and fallbacks', (_site, run) => {
		expect(run('Hello {{firstName}}', { ...fullCtx, firstName: 'Ana <Admin>' })).toBe(
			'Hello Ana &lt;Admin&gt;'
		);
		expect(run('Hello {{firstName|<b>Friend</b>}}', blankCtx)).toBe(
			'Hello &lt;b&gt;Friend&lt;/b&gt;'
		);
	});

	it.each(htmlResolvers)('%s leaves unknown tokens and bad grammar untouched', (_site, run) => {
		expect(run('{{unknownField}} {{firstName|a|b}}', fullCtx)).toBe(
			'{{unknownField}} {{firstName|a|b}}'
		);
	});

	it.each(htmlResolvers)('%s passes token-free templates through unchanged', (_site, run) => {
		const template = '<p>Plain newsletter body, same for every recipient.</p>';
		expect(run(template, fullCtx)).toBe(template);
	});
});

describe('cross-site output parity', () => {
	const probes = [
		...TOKEN_NAMES.map((name) => `x {{${name}}} y`),
		...TOKEN_NAMES.map((name) => `x {{${name}|fallback}} y`),
		'Dear {{firstName|Friend}}, your code is {{postalCode}}.',
		'{{tierContext}} {{verificationStatus}}',
		'no tokens at all'
	];

	it('all resolution sites produce identical HTML output for every probe', () => {
		for (const probe of probes) {
			for (const ctx of [fullCtx, blankCtx]) {
				const outputs = htmlResolvers.map(([, run]) => run(probe, ctx));
				expect(new Set(outputs).size, `probe: ${probe}`).toBe(1);
			}
		}
	});

	it('core and convex header-mode outputs match and skip HTML entities', () => {
		for (const probe of probes) {
			for (const ctx of [fullCtx, blankCtx]) {
				expect(applyEmailMergeFields(probe, ctx, 'header')).toBe(
					convexApplyEmailMergeFields(probe, ctx, 'header')
				);
			}
		}
		expect(applyEmailMergeFields('{{firstName|Friend & co}}', blankCtx, 'header')).toBe(
			'Friend & co'
		);
	});

	it('strips CR/LF from a subject merge value on BOTH send paths (header injection)', () => {
		// The subject resolves in header mode on the browser-direct path
		// (client-blast-sender) and the Convex batch path (email.ts). A merge
		// value with embedded CR/LF must not survive into the subject header on
		// either, or it becomes an email-header-injection vector.
		const injected: EmailMergeContext = {
			...fullCtx,
			firstName: 'Jane\r\nBcc: evil@example.com'
		};
		const core = applyEmailMergeFields('Hi {{firstName}}', injected, 'header');
		const convex = convexApplyEmailMergeFields('Hi {{firstName}}', injected, 'header');
		expect(core).toBe(convex);
		for (const out of [core, convex]) {
			expect(out).not.toContain('\r');
			expect(out).not.toContain('\n');
			expect(out).toBe('Hi JaneBcc: evil@example.com');
		}
	});

	it('tier-context builders agree across server, core, and convex', () => {
		const statuses: VerificationStatus[] = ['verified', 'postal-resolved', 'imported'];
		for (const status of statuses) {
			expect(buildTierContext(status)).toBe(buildEmailTierContext(status));
			expect(convexBuildEmailTierContext(status)).toBe(buildEmailTierContext(status));
		}
	});
});

describe('detection parity (compose page pattern vs core helpers)', () => {
	const composePattern = loadComposePagePattern();

	const detectionProbes: Array<[string, number]> = [
		['{{firstName}}', 1],
		['{{firstName|Friend}}', 1],
		['{{firstName|}}', 1],
		['Hi {{firstName|Friend}} {{lastName}}', 2],
		...TOKEN_NAMES.map((name): [string, number] => [`{{${name}}}`, 1]),
		['{{unknownField}}', 0],
		['{{firstName|a|b}}', 0],
		['no tokens', 0]
	];

	it.each(detectionProbes)('counts agree for %j', (probe, expected) => {
		expect(probe.match(composePattern)?.length ?? 0).toBe(expected);
		expect(countEmailMergeFields(probe)).toBe(expected);
		expect(hasEmailMergeFields(probe)).toBe(expected > 0);
	});

	it('fallback tokens trigger the personalization predicate', () => {
		// client-blast-sender switches to per-recipient sends off this check;
		// a fallback-only template must not slip through as non-personalized.
		expect(hasEmailMergeFields('Dear {{firstName|Friend}},')).toBe(true);
	});
});
