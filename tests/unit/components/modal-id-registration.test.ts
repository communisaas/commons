/**
 * Modal id registration contract.
 *
 * `modalActions.openModal(id, type, data)` records state under `id`, but only
 * `ModalRegistry.svelte` renders anything — a call site naming an id the
 * registry does not declare opens a modal that never paints. The two id sets
 * come from different places on purpose: call sites are read out of the whole
 * `src/` tree, registrations only out of the registry. Every call-site id must
 * be registered.
 *
 * The reverse containment is deliberately not asserted: a registered modal with
 * no call site renders nothing and breaks nothing.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = 'src';
const REGISTRY = 'src/lib/components/modals/ModalRegistry.svelte';

const CALL_SITE_PATTERN = /modalActions\.openModal\(\s*'([^']+)'/g;
// The leading word boundary keeps `data-testid="..."` out of the id set.
const REGISTRATION_PATTERN = /\bid="([^"]+)"/g;

function sourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...sourceFiles(full));
		} else if (entry.name.endsWith('.svelte') || entry.name.endsWith('.ts')) {
			files.push(full);
		}
	}
	return files;
}

function matchAll(source: string, pattern: RegExp): string[] {
	return [...source.matchAll(new RegExp(pattern.source, pattern.flags))].map((m) => m[1]);
}

const callSites = sourceFiles(SRC_ROOT).flatMap((file) =>
	matchAll(readFileSync(file, 'utf8'), CALL_SITE_PATTERN).map((id) => ({ id, file }))
);
const callSiteIds = new Set(callSites.map((site) => site.id));
const registeredIds = new Set(matchAll(readFileSync(REGISTRY, 'utf8'), REGISTRATION_PATTERN));

describe('modal id registration', () => {
	it('opens only modals the registry declares', () => {
		// Non-vacuity: a pattern that silently stopped matching must fail here
		// rather than pass an empty subset check.
		expect(registeredIds.size).toBeGreaterThan(0);
		expect(callSiteIds.size).toBeGreaterThan(0);
		expect([...registeredIds]).toContain('template-modal');
		expect([...callSiteIds]).toContain('template-modal');

		const unregistered = callSites
			.filter((site) => !registeredIds.has(site.id))
			.map((site) => `${site.id} (${site.file})`);

		expect(unregistered).toEqual([]);
	});

	it('carries no modal type without a rendered modal', () => {
		const store = readFileSync('src/lib/stores/modalSystem.svelte.ts', 'utf8');

		expect(store).not.toContain('mobile_preview');
	});
});
