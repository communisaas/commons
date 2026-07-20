import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
	return readdirSync(directory).flatMap((entry) => {
		const path = join(directory, entry);
		if (entry === '_generated' || entry.includes('.test.')) return [];
		return statSync(path).isDirectory()
			? sourceFiles(path)
			: entry.endsWith('.ts')
				? [path]
				: [];
	});
}

function executableSource(path: string): string {
	return readFileSync(path, 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\/\/.*$/gm, '');
}

describe('global Convex query read bounds', () => {
	it('contains no unbounded collect or post-index query-filter call', () => {
		const failures: string[] = [];
		for (const path of sourceFiles('convex')) {
			const source = executableSource(path);
			if (/\.collect\s*\(/.test(source)) failures.push(`${relative('.', path)}:collect`);
			if (/\.filter\s*\(\s*\(?\s*q\s*\)?\s*=>\s*q\.(?:and|or|eq|lt|lte|gt|gte|field)\b/.test(source)) {
				failures.push(`${relative('.', path)}:query-filter`);
			}
		}
		expect(failures).toEqual([]);
	});

	it('uses exact compound indexes for recurring and webhook hot paths', () => {
		const schema = readFileSync('convex/schema.ts', 'utf8');
		for (const index of [
			'by_submissionId_recipientKey',
			'by_deliveryStatus_updatedAt',
			'by_anchorStatus_updatedAt',
			'by_anchorStatus_anchorResultKind_updatedAt',
			'by_credentialHash_expiresAt',
			'by_nonce_expiresAt',
			'by_revocationStatus_revocationLastAttemptAt',
			'by_blastId_recipientEmailHash_eventType',
			'by_blastId_recipientEmailHash_eventType_linkUrl'
		]) {
			expect(schema).toContain(`'${index}'`);
		}
	});
});
