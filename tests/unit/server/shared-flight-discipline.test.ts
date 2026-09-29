import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * A module-level promise map outlives the request that filled it. On the
 * Workers runtime a cancelled owner leaves its promise unsettled forever, and
 * every later request in the isolate that joins it stalls with it. Isolate-wide
 * coalescing of request I/O goes through `SharedFlights`, which bounds every
 * joiner by its own timer.
 */
const ROOTS = ['src', 'workers'] as const;

// CPU-only memos: no request-bound I/O, so no owner can be cancelled mid-flight.
const ALLOWED = new Set(['src/lib/server/dc-api-openid4vp-request.ts:importedKeys']);

const MODULE_PROMISE_MAP =
	/^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*new\s+(?:Map|WeakMap)<(.*?)>\(\)/gmsu;

function sources(directory: string): string[] {
	return readdirSync(directory, { recursive: true, withFileTypes: true })
		.filter(
			(entry) =>
				entry.isFile() &&
				/\.(?:ts|js|mjs|svelte)$/u.test(entry.name) &&
				!/\.(?:test|spec)\./u.test(entry.name)
		)
		.map((entry) => join(entry.parentPath, entry.name));
}

describe('isolate-wide promise coalescing', () => {
	it('keeps request I/O out of module-level promise maps', () => {
		const offenders: string[] = [];
		for (const root of ROOTS) {
			for (const filePath of sources(root)) {
				const source = readFileSync(filePath, 'utf8');
				for (const match of source.matchAll(MODULE_PROMISE_MAP)) {
					const site = `${filePath}:${match[1]}`;
					if (match[2].includes('Promise<') && !ALLOWED.has(site)) offenders.push(site);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});
