/**
 * Post-build: bundle _worker.js into a self-contained file.
 *
 * adapter-cloudflare produces _worker.js with relative imports to
 * ../output/server/ and ../cloudflare-tmp/. When CF Pages' git build
 * processes the output directory, it can't resolve these imports
 * (they're outside the output dir). This script pre-bundles everything
 * into a single _worker.js so CF Pages can deploy it as a Pages Function.
 */

import { build } from 'esbuild';
import { readFileSync } from 'fs';

const outdir = '.svelte-kit/cloudflare';
const entry = `${outdir}/_worker.js`;

// Verify the entry exists
try {
	readFileSync(entry);
} catch {
	console.error(`[bundle-worker] ${entry} not found — skipping`);
	process.exit(0);
}

console.log('[bundle-worker] Bundling _worker.js...');

await build({
	entryPoints: [entry],
	bundle: true,
	outfile: `${outdir}/_worker.js`,
	allowOverwrite: true,
	format: 'esm',
	target: 'es2022',
	platform: 'browser', // CF Workers runtime
	conditions: ['workerd', 'worker', 'browser'],
	external: [
		'cloudflare:workers',
		'node:*',
		// Node builtins — provided by CF Workers nodejs_compat
		'crypto', 'fs', 'path', 'os', 'util', 'stream', 'buffer', 'events',
		'http', 'https', 'net', 'tls', 'url', 'zlib', 'child_process',
		'async_hooks', 'string_decoder', 'querystring', 'assert', 'worker_threads',
		'diagnostics_channel', 'perf_hooks', 'tty',
	],
	logLevel: 'warning',
	minify: false, // keep readable for debugging
});

console.log('[bundle-worker] Done — _worker.js is self-contained');
