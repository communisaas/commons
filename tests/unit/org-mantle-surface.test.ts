/**
 * Mantle surface contract.
 *
 * The org rail/header frame is navigation plus one authoring command. It must
 * not import the capability vocabulary modules, must not render internal
 * posture machinery, and its authoring command binds to one readiness boolean
 * with the shared plain-language limit sentence as its held-state label —
 * sourced from the same module the server boundary uses, so copy cannot drift.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MANTLE = 'src/lib/components/org/OrgMantle.svelte';
const ORG_LAYOUT = 'src/routes/org/[slug]/+layout.svelte';
const PROCESS_DOCK = 'src/lib/components/org/os/ProcessDock.svelte';

const ORG_SURFACE_DIRS = ['src/lib/components/org', 'src/routes/org'];

function svelteFilesUnder(dir: string): string[] {
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.svelte'))
		.map((entry) => join(entry.parentPath, entry.name));
}

const orgSurfaceFiles = ORG_SURFACE_DIRS.flatMap(svelteFilesUnder);

// Assembled from fragments so the excised vocabulary never appears verbatim
// in this file either.
const URE = 'ure';
const POSTURE_MACHINERY = new RegExp(
	`(mantle-post${URE}|posturePress${URE}|Capability post${URE})`
);
const CAPABILITY_MODULE_IMPORT = new RegExp(
	`\\$lib/data/capability-(state-label${'s'}|hyper${'graph'}|cluster${'s'})`
);

describe('the Mantle frame', () => {
	const mantle = readFileSync(MANTLE, 'utf8');

	it('imports no capability vocabulary modules', () => {
		expect(mantle).not.toMatch(CAPABILITY_MODULE_IMPORT);
	});

	it('renders no posture machinery', () => {
		expect(mantle).not.toMatch(POSTURE_MACHINERY);
	});

	it('keeps no hard-clipped substrate gate rows', () => {
		expect(mantle).not.toContain('mantle-substrate-gate');
		expect(mantle).not.toContain('mantle-substrate-capability');
		expect(mantle).not.toContain('max-width: 6rem');
	});

	it('links no orphaned Studio fragment anchors', () => {
		expect(mantle).not.toContain('studio#capability-');
	});

	it('binds the authoring command to one readiness boolean with the shared limit sentence', () => {
		expect(mantle).toContain('authoringReady');
		expect(mantle).toContain("from '$lib/data/org-limit-sentences'");
		expect(mantle).toContain("orgLimitSentence('authoring_runtime')");
	});

	it('whispers no provenance cites in the rail', () => {
		expect(mantle).not.toContain('cite=');
		expect(readFileSync(PROCESS_DOCK, 'utf8')).not.toContain('cite=');
	});

	it('keeps the real shell: identity, draft-in-flight, watermark, spaces, signals, processes', () => {
		expect(mantle).toContain('templateDraftStore');
		expect(mantle).toContain('MantleWatermark');
		expect(mantle).toContain('WorkspaceSwitcher');
		expect(mantle).toContain('SignalWell');
		expect(mantle).toContain('CommandBar');
		expect(mantle).toContain('ProcessDock');
		expect(mantle).toContain('mantle-substrate-link');
	});
});

describe('the org layout', () => {
	const layout = readFileSync(ORG_LAYOUT, 'utf8');

	it('computes the authoring boolean from the env-probe ground in load data', () => {
		expect(layout).toContain('data.spaces.operating?.authoring?.runtimeReady === true');
		expect(layout).toContain('{authoringReady}');
	});

	it('plumbs no posture props', () => {
		expect(layout).not.toMatch(POSTURE_MACHINERY);
		expect(layout).not.toContain('operatingGroundCapabilities');
	});
});

describe('org surfaces', () => {
	it('carry no posture machinery anywhere', () => {
		for (const file of orgSurfaceFiles) {
			expect(readFileSync(file, 'utf8'), file).not.toMatch(POSTURE_MACHINERY);
		}
	});
});
