#!/usr/bin/env node
/**
 * Derive `src/lib/utils/domain-anchors-slim.json` from `domain-anchors.json`.
 *
 * The full file carries a 768-float `embedding` per anchor that ONLY the
 * server-side projection (`domain-hue-projection.ts`) reads. The client hue
 * resolver (`domain-hue.ts`) needs only `{label, hue}` — so shipping the full
 * file to the landing bundle wastes ~163KB. This generator is the single source
 * of record for the slim file; a parity test asserts re-running it is a no-op,
 * so the client spine and the server projection can never disagree on a hue.
 *
 * Usage: node scripts/gen-domain-anchors-slim.mjs        (writes the file)
 *        node scripts/gen-domain-anchors-slim.mjs --check (exit 1 if stale)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const FULL = join(here, '../src/lib/utils/domain-anchors.json');
const SLIM = join(here, '../src/lib/utils/domain-anchors-slim.json');

const full = JSON.parse(readFileSync(FULL, 'utf8'));
const slim = full.map(({ label, hue }) => ({ label, hue }));
const out = JSON.stringify(slim, null, '\t') + '\n';

if (process.argv.includes('--check')) {
	const current = readFileSync(SLIM, 'utf8');
	if (current !== out) {
		console.error('domain-anchors-slim.json is stale — run: node scripts/gen-domain-anchors-slim.mjs');
		process.exit(1);
	}
	console.log('domain-anchors-slim.json is up to date.');
} else {
	writeFileSync(SLIM, out);
	console.log(`Wrote ${slim.length} anchors to domain-anchors-slim.json`);
}
