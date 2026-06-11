import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { participationDepth } from '$lib/components/org/participation-depth';

const packetSource = readFileSync('src/lib/components/org/VerificationPacket.svelte', 'utf8');
const pipelineSource = readFileSync('src/lib/components/org/VerificationPipeline.svelte', 'utf8');

describe('participation depth wording', () => {
	it('gives each engagement tier a distinct plain-language phrase', () => {
		const phrases = [0, 1, 2, 3, 4].map((tier) => participationDepth(tier));
		expect(new Set(phrases).size).toBe(5);
	});

	it('falls back to a plain phrase for unknown tiers', () => {
		expect(participationDepth(-1)).toBeTruthy();
		expect(participationDepth(9)).toBeTruthy();
	});

	it('never exposes tier indices, numerals, or platform-internal tier names', () => {
		for (const tier of [-1, 0, 1, 2, 3, 4, 9]) {
			const phrase = participationDepth(tier);
			expect(phrase).not.toMatch(/\d/);
			expect(phrase).not.toMatch(/\btier\b/i);
			expect(phrase).not.toMatch(/\b(new|active|established|veteran|pillar)\b/i);
		}
	});
});

describe('packet artifact surface', () => {
	it('keeps engagement-tier machinery off the uncollapsed artifact', () => {
		expect(packetSource).not.toContain('Engagement depth');
		expect(packetSource).not.toContain('tier.label');
		expect(packetSource).not.toMatch(/T\{tier\.tier\}/);
		expect(packetSource).not.toMatch(/sub-K/i);
		expect(packetSource).not.toMatch(/K-anonymity/i);
	});

	it('collapses participation depth and geographic diversity behind a closed-by-default drawer', () => {
		expect(packetSource).toContain('<details');
		expect(packetSource).not.toMatch(/<details[^>]*\bopen\b/);
		const drawer = packetSource.slice(packetSource.indexOf('<details'));
		expect(drawer).toContain('participationDepth(tier.tier)');
		expect(drawer).toContain('cite="computeTierDistribution"');
		expect(drawer).toContain('geographic diversity');
		expect(drawer).toContain('cite="computeGDSFromDistribution"');
	});

	it('reports suppressed groups in plain privacy language', () => {
		expect(packetSource).toContain('fewer than 5');
		expect(packetSource).toMatch(/no individual can be identified/);
	});

	it('keeps the geographic footer in plain spread phrasing without raw scalars', () => {
		expect(packetSource).toContain('Spread across');
		const uncollapsed = packetSource.slice(0, packetSource.indexOf('<details'));
		expect(uncollapsed).not.toMatch(/diversity/i);
		expect(uncollapsed).not.toMatch(/\bgds\b/i);
	});
});

describe('verification pipeline stage copy', () => {
	it('describes each stage in org words', () => {
		expect(pipelineSource).toContain('supporters on your list');
		expect(pipelineSource).toContain('district-verified');
		expect(pipelineSource).toContain('identity-verified');
	});

	it('drops platform-internal stage vocabulary', () => {
		expect(pipelineSource).not.toMatch(/people in ledger/);
		expect(pipelineSource).not.toMatch(/district signal/);
		expect(pipelineSource).not.toMatch(/identity commitment/);
	});
});
