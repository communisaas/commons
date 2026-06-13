/**
 * Person-surface vocabulary contract.
 *
 * The template creator and its modals are free person-layer surfaces. They
 * must not import the org capability modules and must not render internal
 * contract-state vocabulary. These tests pin module-import absence,
 * vocabulary absence, and the one load-bearing handoff: the congressional
 * gating sentence comes from the shared limit-sentence module so the copy
 * cannot drift from the server gate.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PERSON_SURFACE_DIRS = ['src/lib/components/template', 'src/lib/components/modals'];

function svelteFilesUnder(dir: string): string[] {
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.svelte'))
		.map((entry) => join(entry.parentPath, entry.name));
}

const personSurfaceFiles = PERSON_SURFACE_DIRS.flatMap(svelteFilesUnder);

// Assembled from fragments so the excised vocabulary never appears verbatim
// in this file either.
const ED = 'ed';
const CAPABILITY_MODULE_IMPORT = new RegExp(
	`capability-(state-label${'s'}|hyper${'graph'}|cluster${'s'})`
);
const CONTRACT_STATE_VOCABULARY = new RegExp(
	`\\b(arm${ED}|not arm${ED}|bound${ED}|draft-on${'ly'}|test${'net'})\\b`,
	'i'
);
const OPERATOR_VERB_GRAMMAR = new RegExp(
	`'(read|open|execute|context|draft) / |appendReadyArrow`
);

describe('person surfaces', () => {
	it('finds the surfaces it guards', () => {
		const names = personSurfaceFiles.map((file) => file.split('/').pop());
		expect(names).toContain('MessageGenerationResolver.svelte');
		expect(names).toContain('MessageResults.svelte');
		expect(names).toContain('TemplateSuccessModal.svelte');
	});

	it('imports no org capability modules', () => {
		for (const file of personSurfaceFiles) {
			expect(readFileSync(file, 'utf8'), file).not.toMatch(CAPABILITY_MODULE_IMPORT);
		}
	});

	it('carries no contract-state vocabulary or operator verb grammar', () => {
		for (const file of personSurfaceFiles) {
			const source = readFileSync(file, 'utf8');
			expect(source, file).not.toMatch(CONTRACT_STATE_VOCABULARY);
			expect(source, file).not.toMatch(OPERATOR_VERB_GRAMMAR);
		}
	});

	it('sources the congressional gating sentence from the shared limit-sentence module', () => {
		const modal = readFileSync('src/lib/components/modals/TemplateSuccessModal.svelte', 'utf8');
		expect(modal).toContain("from '$lib/data/org-limit-sentences'");
		expect(modal).toContain("orgLimitSentence('congressional_delivery')");
	});
});
