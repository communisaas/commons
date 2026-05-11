/**
 * ProofGenerator design contracts.
 *
 * Source-text pin for the neutral-slate desaturation. ProofGenerator
 * uses solid `bg-slate-700` fills for CTAs + progress, not
 * `from-blue-600 to-indigo-600` gradient stacks — celebratory
 * feature-palette clashes with the receipt page's registry voice.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PROOF_GENERATOR = path.resolve(
	process.cwd(),
	'src/lib/components/template/ProofGenerator.svelte'
);

describe('ProofGenerator design contracts', () => {
	it('CTA buttons and progress bars use neutral slate fill, not blue/indigo gradients', () => {
		const svelte = fs.readFileSync(PROOF_GENERATOR, 'utf8');

		// No indigo or from-blue-X gradient stack — registry voice, not
		// celebratory feature palette.
		expect(svelte).not.toContain('from-blue-600 to-indigo-600');
		expect(svelte).not.toContain('hover:from-blue-700 hover:to-indigo-700');

		// Neutral slate fill on CTA + progress matches the receipt-page
		// Proof Weight bar's canonical replacement.
		expect(svelte).toContain('bg-slate-700');
		expect(svelte).toContain('hover:bg-slate-800');
	});
});
