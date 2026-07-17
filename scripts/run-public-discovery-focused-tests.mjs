#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const manifest = process.argv[2] || '.github/workflows/public-discovery-focused-tests.txt';

function fail(message, line) {
	const location = line === undefined ? `file=${manifest}` : `file=${manifest},line=${line}`;
	console.error(`::error ${location}::${message}`);
	process.exit(1);
}

try {
	if (!statSync(manifest).isFile()) fail('Focused-test manifest is not a file.');
} catch {
	fail('Focused-test manifest is missing or is not a file.');
}

const focusedTests = [];
const lines = readFileSync(manifest, 'utf8').split(/\r?\n/);
for (const [index, rawLine] of lines.entries()) {
	const testFile = rawLine.trim();
	if (!testFile || testFile.startsWith('#')) continue;
	if (testFile.startsWith('-')) {
		fail(`Focused-test entry cannot begin with a dash: ${testFile}`, index + 1);
	}

	const resolved = path.resolve(process.cwd(), testFile);
	try {
		if (!statSync(resolved).isFile()) {
			fail(`Focused-test entry is not a file: ${testFile}`, index + 1);
		}
	} catch {
		fail(`Focused-test entry is missing or is not a file: ${testFile}`, index + 1);
	}
	focusedTests.push(testFile);
}

if (focusedTests.length === 0) {
	fail('Focused-test manifest contains no test files.');
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(npx, ['vitest', '--run', ...focusedTests, '--config=vitest.config.ts'], {
	stdio: 'inherit',
	shell: false
});
if (result.error) {
	console.error(`Unable to start focused Vitest verification: ${result.error.message}`);
	process.exit(1);
}
process.exit(result.status ?? 1);
