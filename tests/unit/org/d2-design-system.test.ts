/**
 * D2 design-system coherence — the shipped, non-design-sign-off-gated parts:
 * (b) spring-constant import discipline and (c) off-axis palette collapse +
 * stray-literal tokenization. The two VISIBLE-UX-change migrations — (a)
 * VerificationPacket→Ratio (in-bar label→legend) and (d) supporters
 * table→EntityCluster — are deferred to design sign-off per RV-D2 and are NOT
 * asserted here.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const OFF_AXIS = /(bg|text|border)-(blue|rose|zinc|yellow|orange|purple|violet|pink|sky|cyan|fuchsia|indigo)-[0-9]+/;

describe('(b) spring-constant import discipline', () => {
	const files = [
		'src/lib/components/org/VerificationPipeline.svelte',
		'src/lib/components/org/DeliveryMetrics.svelte'
	].map((p) => [p, src(p)] as const);

	it('no inline spring literal survives; both import + call SPRINGS.METRIC', () => {
		for (const [path, s] of files) {
			expect(s, `${path} still has a spring literal`).not.toMatch(/stiffness:\s*0\.15/);
			expect(s).toContain("import { SPRINGS } from '$lib/design/motion'");
			expect(s).toContain('SPRINGS.METRIC');
			// guard the plausible wrong-constant swap (COUNT_TICK = 0.2/0.8, different feel)
			expect(s).not.toContain('SPRINGS.COUNT_TICK');
		}
	});
});

describe('(c) off-axis palette collapse', () => {
	const files = [
		'src/lib/components/org/VerificationPipeline.svelte',
		'src/lib/components/org/DeliveryMetrics.svelte',
		'src/routes/org/[slug]/campaigns/[id]/report/+page.svelte',
		'src/routes/org/[slug]/supporters/+page.svelte'
	];

	it('zero off-axis (blue/rose/zinc/yellow/indigo/…) literals remain in the 4 touched files', () => {
		for (const p of files) {
			expect(src(p), `${p} still has an off-axis hue`).not.toMatch(OFF_AXIS);
		}
	});

	it('report dots/confidence keep semantic teal/emerald/amber, inbound signals go neutral', () => {
		const report = src('src/routes/org/[slug]/campaigns/[id]/report/+page.svelte');
		// the off-axis taxonomy hues are gone; the warning axis (amber) is retained
		expect(report).not.toMatch(/bg-(blue|rose|zinc)-400/);
		expect(report).toContain('bg-text-tertiary'); // inbound signals → neutral
		expect(report).toContain('text-amber-500'); // inferred = warning axis, kept
	});
});

describe('(a) VerificationPacket → Ratio', () => {
	const packet = src('src/lib/components/org/VerificationPacket.svelte');
	it('adopts Ratio and drops the hand-rolled stacked bar + its segment CSS', () => {
		expect(packet).toContain("import { Datum, Pulse, Ratio } from '$lib/design'");
		expect(packet).toContain('<Ratio segments={identitySegments}');
		expect(packet).toContain('<Ratio segments={authorshipSegments}');
		expect(packet).not.toContain('vp__stack'); // bespoke bar + its CSS gone
		expect(packet).not.toMatch(/oklch\(0\.38 0\.1 170\)/); // the bespoke segment color
	});
	it('preserves every count in the legend + keeps tiers OUT of Ratio (k-anon -1 trap)', () => {
		// counts still rendered as Datum (now in the legend), guarded > 0
		expect(packet).toMatch(/vp__legend-count[\s\S]*?<Datum value=\{p\.identityBreakdown\.govId\}/);
		// the tier list (the only -1 sentinel carrier) must NOT be fed to Ratio
		expect(packet).not.toMatch(/<Ratio[^>]*engagementTiers/);
		expect(packet).not.toMatch(/<Ratio[^>]*tiers/);
	});
});

describe('(d) supporters → EntityCluster', () => {
	const sup = src('src/routes/org/[slug]/supporters/+page.svelte');
	const cluster = sup.slice(sup.indexOf('<EntityCluster'), sup.indexOf('</EntityCluster>'));
	it('replaces the table with EntityCluster, no table-chrome leak', () => {
		expect(sup).toContain("import { EntityCluster } from '$lib/design'");
		expect(sup).toContain('<EntityCluster as="ul" density="tight"');
		expect(sup).not.toContain('<table');
		expect(sup).not.toContain('overflow-x-auto');
		expect(cluster).not.toContain('border-surface-border overflow-hidden'); // not inside a card
	});
	it('every former column survives in the cluster (no dropped hidden-column data)', () => {
		expect(cluster).toContain('supporter.name');
		expect(cluster).toContain('supporter.email');
		expect(cluster).toContain('supporter.postalCode');
		expect(cluster).toContain('sourceLabel(supporter.source)');
		expect(cluster).toContain('relativeTime(supporter.createdAt)');
		expect(cluster).toContain('#{tag.name}'); // tags
		expect(cluster).toContain('/supporters/{supporter.id}'); // name link survives
	});
	it('de-pills tag + source chips (typographic annotation, no pill chrome)', () => {
		expect(cluster).not.toMatch(/rounded-full px-2/);
		expect(cluster).not.toMatch(/bg-surface-overlay[^"]*rounded/);
	});
	it('email status is conveyed by TEXT+color, never color-alone (a11y)', () => {
		// the dots are reinforced by an adjacent uppercase status word — not the sole signal
		expect(cluster).toMatch(/>unsubscribed</);
		expect(cluster).toMatch(/>bounced</);
		expect(cluster).toMatch(/>complained</);
	});
});

describe('(c) report badge de-pill', () => {
	const report = src('src/routes/org/[slug]/campaigns/[id]/report/+page.svelte');
	it('badges are color-only typographic annotations (no box chrome, semantics intact)', () => {
		expect(report).not.toMatch(/rounded(-md)? border px-2 py-0\.5/); // no pill consumers
		// statusBadgeClass/receiptBadgeClass return text-color only (no bg/border tints)
		const statusFn = report.slice(report.indexOf('function statusBadgeClass'), report.indexOf('function eventDotColor'));
		expect(statusFn).not.toMatch(/bg-\w+-\d+\/\d+/);
		expect(statusFn).not.toMatch(/border-\w+-\d+/);
		expect(statusFn).toContain("'text-red-400'"); // bounce stays error — not recolored
	});
});
