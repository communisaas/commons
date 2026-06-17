/**
 * Slim/full domain-anchor parity (D3a).
 *
 * The client hue resolver imports the slim {label,hue} file; the server
 * projection imports the full file (with embeddings). They MUST agree on every
 * anchor's hue, or the spectrum spine (client) clashes with the projection
 * (server). This pins that, and that the generator output is not stale.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import slim from '../../../src/lib/utils/domain-anchors-slim.json';
import full from '../../../src/lib/utils/domain-anchors.json';

describe('domain-anchors slim/full parity', () => {
	it('slim is {label,hue} per full anchor, same order, identical hues, no embedding', () => {
		expect(slim.length).toBe(full.length);
		slim.forEach((s, i) => {
			expect(s.label).toBe(full[i].label);
			expect(s.hue).toBe(full[i].hue);
			expect(Object.keys(s).sort()).toEqual(['hue', 'label']);
		});
	});

	it('the committed slim file is not stale (generator is a no-op diff)', () => {
		const fullData = JSON.parse(
			readFileSync(join(process.cwd(), 'src/lib/utils/domain-anchors.json'), 'utf8')
		);
		const regen =
			JSON.stringify(
				fullData.map((a: { label: string; hue: number }) => ({ label: a.label, hue: a.hue })),
				null,
				'\t'
			) + '\n';
		const current = readFileSync(
			join(process.cwd(), 'src/lib/utils/domain-anchors-slim.json'),
			'utf8'
		);
		expect(current).toBe(regen);
	});
});
