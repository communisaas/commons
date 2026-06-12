import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Convex's V8 isolate rejects dynamic `await import(...)` at runtime
 * ("dynamic module import unsupported") while the Node-based test harness
 * accepts it — so a dynamic import in a query/mutation path is a latent
 * production 500 that no suite can catch. Only modules that opt into the
 * Node runtime via a "use node" directive may use dynamic imports.
 */
const CONVEX_DIR = join(__dirname, '../../../convex');

function convexSourceFiles(): string[] {
	return readdirSync(CONVEX_DIR)
		.filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'))
		.map((name) => join(CONVEX_DIR, name));
}

describe('convex isolate runtime constraints', () => {
	it('has no dynamic imports outside "use node" modules', () => {
		const offenders: string[] = [];
		for (const file of convexSourceFiles()) {
			const source = readFileSync(file, 'utf8');
			const firstLine = source.slice(0, source.indexOf('\n'));
			if (firstLine.includes('use node')) continue;
			for (const [index, line] of source.split('\n').entries()) {
				if (line.includes('await import(')) {
					offenders.push(`${file}:${index + 1}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});
