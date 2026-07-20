#!/usr/bin/env node

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/**
 * Proves that a Pages artifact can bind its browser to the deployment's
 * runtime realm. The Worker bundle is deliberately excluded: it contains the
 * exact approved server allowlist. Every client-visible artifact remains in
 * scope, including prerendered HTML and service workers.
 *
 * @param {{pagesDirectory: string, forbiddenOrigin: string}} input
 */
export function verifyRuntimeNeutralClientRealm({ pagesDirectory, forbiddenOrigin }) {
	invariant(
		typeof pagesDirectory === 'string' && pagesDirectory.length > 0,
		'Pages directory is required.'
	);
	invariant(
		typeof forbiddenOrigin === 'string' &&
			/^https:\/\/[a-z0-9-]+\.convex\.cloud$/.test(forbiddenOrigin),
		'Forbidden Convex origin must be one exact hosted Convex origin.'
	);

	const root = resolve(pagesDirectory);
	const rootStat = lstatSync(root, { throwIfNoEntry: false });
	invariant(rootStat?.isDirectory(), 'Pages directory does not exist.');

	const pending = [root];
	let scannedFiles = 0;
	let browserJavaScriptFiles = 0;
	const forbiddenBytes = Buffer.from(forbiddenOrigin, 'utf8');

	while (pending.length > 0) {
		const current = pending.pop();
		invariant(typeof current === 'string', 'Artifact traversal failed.');
		for (const name of readdirSync(current)) {
			const absolute = join(current, name);
			const artifactPath = relative(root, absolute).split(sep).join('/');
			const stat = lstatSync(absolute);
			invariant(
				!stat.isSymbolicLink(),
				`Client artifact contains a symbolic link: ${artifactPath}.`
			);

			// `_worker.js` is the only server-private Pages artifact. It may be a
			// single file or an advanced-mode directory.
			if (artifactPath === '_worker.js' || artifactPath.startsWith('_worker.js/')) continue;
			if (stat.isDirectory()) {
				pending.push(absolute);
				continue;
			}
			invariant(stat.isFile(), `Client artifact contains an unsupported entry: ${artifactPath}.`);
			scannedFiles += 1;
			if (/^_app\/immutable\/.*\.js$/i.test(artifactPath)) browserJavaScriptFiles += 1;
			invariant(
				readFileSync(absolute).indexOf(forbiddenBytes) === -1,
				`Client-visible artifact bakes the forbidden production Convex origin: ${artifactPath}.`
			);
		}
	}

	invariant(scannedFiles > 0, 'Pages artifact has no client-visible files.');
	invariant(browserJavaScriptFiles > 0, 'Pages artifact has no browser JavaScript to verify.');
	return { pagesDirectory: root, scannedFiles, browserJavaScriptFiles };
}

/** @param {string[]} argv */
export function parseRuntimeNeutralClientRealmArgs(argv) {
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		invariant(
			['--pages-directory', '--forbidden-origin'].includes(flag) &&
				value !== undefined &&
				!value.startsWith('--') &&
				!values.has(flag),
			'Usage: --pages-directory <path> --forbidden-origin <origin>.'
		);
		values.set(flag, value);
	}
	invariant(values.size === 2, 'Both runtime-neutral client realm arguments are required.');
	return {
		pagesDirectory: values.get('--pages-directory'),
		forbiddenOrigin: values.get('--forbidden-origin')
	};
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
	try {
		console.log(
			JSON.stringify(
				verifyRuntimeNeutralClientRealm(parseRuntimeNeutralClientRealmArgs(process.argv.slice(2)))
			)
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
