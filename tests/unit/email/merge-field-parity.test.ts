/**
 * Merge-field grammar parity.
 *
 * One module implements the grammar for every send path. Three things outside
 * it still have to agree with it, and this suite is the guard on each: the
 * compose page's local detection regex, the server compiler's tier-context
 * strings, and the workflow send path's source text — which once carried a
 * hand-written twin of the substitution and must never grow one back. A token
 * an author types has to behave the same wherever the message is dispatched.
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
} from '$convex/lib/emailMergeFields';

// Canonical token set lives in the shared module; every other site mirrors it.
const TOKEN_NAMES = MERGE_FIELD_NAMES;

function readSource(relPath: string): string {
	return readFileSync(resolve(process.cwd(), relPath), 'utf8');
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

// All HTML-mode entry points, by site. compileMergeFields delegates to the
// shared module; running both keeps the delegation itself under test.
const htmlResolvers: Array<[string, (t: string, ctx: typeof fullCtx) => string]> = [
	['server compiler', (t, ctx) => compileMergeFields(t, ctx)],
	['shared module', (t, ctx) => applyEmailMergeFields(t, ctx)]
];

function loadComposePagePattern(): RegExp {
	const source = readSource('src/routes/org/[slug]/emails/compose/+page.svelte');
	const match = source.match(/mergeFieldPattern\s*=\s*\/((?:[^/\\\n]|\\.)+)\/([a-z]*)/);
	if (!match) throw new Error('compose page mergeFieldPattern not found');
	return new RegExp(match[1], match[2]);
}

describe('supported-token set equality (every resolution site)', () => {
	it('compose page detection pattern matches exactly the canonical token set', () => {
		const pattern = loadComposePagePattern();
		// Every canonical token is detected, and an off-list token is not.
		for (const name of TOKEN_NAMES) {
			expect(`{{${name}}}`.match(pattern)?.length ?? 0, `token: ${name}`).toBe(1);
		}
		expect('{{notARealToken}}'.match(pattern)?.length ?? 0).toBe(0);
	});

	it('resolution resolves exactly the canonical tokens (and nothing more)', () => {
		// A canonical token resolves to its value; an off-list token is left
		// verbatim. Run on every HTML entry point so a token supported at one
		// site but missing at another diverges here.
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

	it('header-mode output skips HTML entities on every probe', () => {
		// Header mode is what every send path uses for the subject. It must never
		// entity-escape, or a subject reads "Friend &amp; co" in the inbox.
		for (const probe of probes) {
			for (const ctx of [fullCtx, blankCtx]) {
				expect(applyEmailMergeFields(probe, ctx, 'header')).not.toContain('&amp;');
			}
		}
		expect(applyEmailMergeFields('{{firstName|Friend & co}}', blankCtx, 'header')).toBe(
			'Friend & co'
		);
	});

	it('strips CR/LF from a subject merge value (header injection)', () => {
		// The subject resolves in header mode on the browser-direct path
		// (client-blast-sender), the Convex batch path (email.ts), and the
		// workflow path (workflows.ts). A merge value with embedded CR/LF must
		// not survive into the subject header, or it becomes an
		// email-header-injection vector.
		const injected: EmailMergeContext = {
			...fullCtx,
			firstName: 'Jane\r\nBcc: evil@example.com'
		};
		const out = applyEmailMergeFields('Hi {{firstName}}', injected, 'header');
		expect(out).not.toContain('\r');
		expect(out).not.toContain('\n');
		expect(out).toBe('Hi JaneBcc: evil@example.com');
	});

	it('tier-context builders agree between the server compiler and the shared module', () => {
		const statuses: VerificationStatus[] = ['verified', 'postal-resolved', 'imported'];
		for (const status of statuses) {
			expect(buildTierContext(status)).toBe(buildEmailTierContext(status));
		}
	});
});

describe('detection parity (compose page pattern vs shared helpers)', () => {
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

describe('workflow send path', () => {
	// The workflow sender once carried its own substitution chain, which
	// silently supported a narrower token set and no fallbacks. Assert on the
	// source so a reintroduced twin fails here rather than in an inbox.
	const workflows = readSource('convex/workflows.ts');

	it('imports the shared grammar', () => {
		expect(workflows).toContain("from './lib/emailMergeFields'");
	});

	it('resolves the subject in header mode and derives tier context from the shared builder', () => {
		expect(workflows).toContain(
			"applyEmailMergeFields(step.emailSubject ?? '', mergeContext, 'header')"
		);
		expect(workflows).toContain('buildEmailTierContext(verificationStatus)');
	});

	it('carries no local merge-field twin', () => {
		expect(workflows).not.toMatch(/\.replace\(\/\\\{\\\{/);
		expect(workflows).not.toContain('applyWorkflowMergeFields');
		expect(workflows).not.toContain(
			'Your identity is verified. You appear as a verified contact'
		);
	});
});
