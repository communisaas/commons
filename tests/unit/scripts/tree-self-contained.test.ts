import { describe, expect, it } from 'vitest';

import { scanTreeSelfContainment } from '../../../scripts/check-tree-self-contained.mjs';

type Edge = { importer: string; specifier: string; resolved: string };

/**
 * Every fixture is synthetic: the scanner never touches the real working tree,
 * so this file specifies behaviour rather than mirroring whatever the repo
 * happens to contain right now.
 */
function scan(fixture: {
	tracked: string[];
	sources: Record<string, string>;
	untrackedOnDisk?: string[];
}): Edge[] {
	const trackedFiles = new Set(fixture.tracked);
	const onDisk = new Set([...Object.keys(fixture.sources), ...(fixture.untrackedOnDisk ?? [])]);
	return scanTreeSelfContainment({
		root: '/nowhere',
		trackedFiles,
		readFile: (relativePath: string) => fixture.sources[relativePath] ?? '',
		fileExists: (relativePath: string) => onDisk.has(relativePath)
	});
}

describe('tracked-tree self-containment', () => {
	it('reports nothing when a tracked file imports a tracked file', () => {
		expect(
			scan({
				tracked: ['src/lib/harbor/anchor.ts', 'src/lib/harbor/mooring.ts'],
				sources: {
					'src/lib/harbor/anchor.ts': "import { hold } from './mooring';",
					'src/lib/harbor/mooring.ts': 'export const hold = 1;'
				}
			})
		).toEqual([]);
	});

	it('reports a relative specifier that resolves only to an untracked file', () => {
		expect(
			scan({
				tracked: ['src/lib/harbor/anchor.ts'],
				sources: { 'src/lib/harbor/anchor.ts': "import { hold } from './mooring';" },
				untrackedOnDisk: ['src/lib/harbor/mooring.ts']
			})
		).toEqual([
			{
				importer: 'src/lib/harbor/anchor.ts',
				specifier: './mooring',
				resolved: 'src/lib/harbor/mooring.ts'
			}
		]);
	});

	it('reports an aliased specifier that resolves only to an untracked file', () => {
		expect(
			scan({
				tracked: ['src/routes/api/harbor/+server.ts', 'convex/tide.ts'],
				sources: {
					'src/routes/api/harbor/+server.ts': [
						"import { hold } from '$lib/harbor/mooring';",
						"import { ebb } from '$convex/lib/tideTable';"
					].join('\n'),
					'convex/tide.ts': "export { ebb } from './lib/tideTable';"
				},
				untrackedOnDisk: ['src/lib/harbor/mooring.ts', 'convex/lib/tideTable.ts']
			})
		).toEqual([
			{
				importer: 'convex/tide.ts',
				specifier: './lib/tideTable',
				resolved: 'convex/lib/tideTable.ts'
			},
			{
				importer: 'src/routes/api/harbor/+server.ts',
				specifier: '$convex/lib/tideTable',
				resolved: 'convex/lib/tideTable.ts'
			},
			{
				importer: 'src/routes/api/harbor/+server.ts',
				specifier: '$lib/harbor/mooring',
				resolved: 'src/lib/harbor/mooring.ts'
			}
		]);
	});

	it('stays silent when a specifier resolves to nothing at all', () => {
		expect(
			scan({
				tracked: ['src/lib/harbor/anchor.ts'],
				sources: {
					'src/lib/harbor/anchor.ts': [
						"import { hold } from './missing-quay';",
						"import { drift } from 'some-external-package';",
						"import { swell } from '$lib/harbor/absent-swell';"
					].join('\n')
				}
			})
		).toEqual([]);
	});

	it('never reports build-time virtual or generated modules', () => {
		expect(
			scan({
				tracked: ['src/routes/harbor/+page.svelte'],
				sources: {
					'src/routes/harbor/+page.svelte': [
						'<script lang="ts">',
						"import { goto } from '$app/navigation';",
						"import { env } from '$env/dynamic/private';",
						"import { build } from '$service-worker';",
						"import type { PageData } from './$types';",
						"import { doc } from './_generated/dataModel';",
						"import { server } from '../_generated/server';",
						'</script>'
					].join('\n')
				},
				untrackedOnDisk: [
					'src/routes/harbor/$types.ts',
					'src/routes/harbor/_generated/dataModel.ts',
					'src/routes/_generated/server.ts',
					'src/app/navigation.ts',
					'src/env/dynamic/private.ts'
				]
			})
		).toEqual([]);
	});

	it('resolves an emitted .js specifier onto its tracked TypeScript source', () => {
		expect(
			scan({
				tracked: ['src/lib/harbor/anchor.ts', 'src/lib/harbor/mooring.ts'],
				sources: {
					'src/lib/harbor/anchor.ts': "import { hold } from './mooring.js';",
					'src/lib/harbor/mooring.ts': 'export const hold = 1;'
				}
			})
		).toEqual([]);
	});

	it('clears an edge once the target joins the tracked set', () => {
		const sources = { 'src/lib/harbor/anchor.ts': "import { hold } from './mooring';" };
		const untrackedOnDisk = ['src/lib/harbor/mooring.ts'];
		expect(scan({ tracked: ['src/lib/harbor/anchor.ts'], sources, untrackedOnDisk })).toHaveLength(
			1
		);
		expect(
			scan({
				tracked: ['src/lib/harbor/anchor.ts', 'src/lib/harbor/mooring.ts'],
				sources,
				untrackedOnDisk
			})
		).toEqual([]);
	});

	it('covers dynamic, bare and query-suffixed import forms exactly once each', () => {
		expect(
			scan({
				tracked: ['src/lib/harbor/anchor.ts'],
				sources: {
					'src/lib/harbor/anchor.ts': [
						"const late = await import('./mooring');",
						"import './beacon';",
						"import lantern from './lantern.svg?url';",
						"import { hold } from './mooring';"
					].join('\n')
				},
				untrackedOnDisk: [
					'src/lib/harbor/mooring.ts',
					'src/lib/harbor/beacon.ts',
					'src/lib/harbor/lantern.svg'
				]
			})
		).toEqual([
			{
				importer: 'src/lib/harbor/anchor.ts',
				specifier: './beacon',
				resolved: 'src/lib/harbor/beacon.ts'
			},
			{
				importer: 'src/lib/harbor/anchor.ts',
				specifier: './lantern.svg?url',
				resolved: 'src/lib/harbor/lantern.svg'
			},
			{
				importer: 'src/lib/harbor/anchor.ts',
				specifier: './mooring',
				resolved: 'src/lib/harbor/mooring.ts'
			}
		]);
	});

	it('scans only source extensions inside the source roots', () => {
		expect(
			scan({
				tracked: [
					'docs/harbor/notes.md',
					'src/lib/harbor/anchor.json',
					'wrangler/harbor.ts',
					'src/lib/harbor/anchor.ts'
				],
				sources: {
					'docs/harbor/notes.md': "import { hold } from './mooring';",
					'src/lib/harbor/anchor.json': '{}',
					'wrangler/harbor.ts': "import { hold } from '$lib/harbor/mooring';",
					'src/lib/harbor/anchor.ts': 'export const anchored = true;'
				},
				untrackedOnDisk: ['docs/harbor/mooring.ts', 'src/lib/harbor/mooring.ts']
			})
		).toEqual([]);
	});

	it('emits a stable order regardless of tracked-set iteration order', () => {
		const sources = {
			'src/lib/harbor/zephyr.ts': "import { hold } from './mooring';",
			'src/lib/harbor/anchor.ts': "import { hold } from './mooring';"
		};
		const untrackedOnDisk = ['src/lib/harbor/mooring.ts'];
		const forward = scan({
			tracked: ['src/lib/harbor/anchor.ts', 'src/lib/harbor/zephyr.ts'],
			sources,
			untrackedOnDisk
		});
		const reversed = scan({
			tracked: ['src/lib/harbor/zephyr.ts', 'src/lib/harbor/anchor.ts'],
			sources,
			untrackedOnDisk
		});
		expect(forward.map((edge) => edge.importer)).toEqual([
			'src/lib/harbor/anchor.ts',
			'src/lib/harbor/zephyr.ts'
		]);
		expect(reversed).toEqual(forward);
	});
});
