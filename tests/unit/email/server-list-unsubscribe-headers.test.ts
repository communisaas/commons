import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
	return readFileSync(path, 'utf8');
}

function section(text: string, start: string, end: string): string {
	const startIndex = text.indexOf(start);
	expect(startIndex).toBeGreaterThanOrEqual(0);
	const endIndex = text.indexOf(end, startIndex + start.length);
	expect(endIndex).toBeGreaterThan(startIndex);
	return text.slice(startIndex, endIndex);
}

describe('Convex server-side List-Unsubscribe headers', () => {
	it('threads per-recipient HMAC unsubscribe URLs into SES v2 Simple headers', () => {
		const convexEmail = source('convex/email.ts');
		const sendBatch = section(convexEmail, 'export const sendBlastBatch', 'export const incrementBlastCounters');
		const sendViaSes = section(convexEmail, 'export async function sendViaSes', '// =============================================================================');

		expect(convexEmail).toContain('const MIN_UNSUBSCRIBE_SECRET_BYTES = 32');
		expect(convexEmail).toContain('function assertUnsubscribeHeaderConfig');
		expect(convexEmail).toContain("crypto.subtle.importKey(\n\t\t'raw'");
		expect(convexEmail).toContain("emailEncoder.encode(`${supporterId}:${orgId}`)");
		expect(convexEmail).toContain('async function buildConvexUnsubscribeUrl');
		expect(convexEmail).toContain('/unsubscribe/${supporterId}/${orgId}/${token}');

		expect(sendBatch).toContain('assertUnsubscribeHeaderConfig();');
		expect(sendBatch).toContain('const unsubscribeUrl = await buildConvexUnsubscribeUrl(');
		expect(sendBatch).toContain('String(recipient._id)');
		expect(sendBatch).toContain('String(blast.orgId)');
		expect(sendBatch).toContain('unsubscribeUrl');

		expect(sendViaSes).toContain('unsubscribeUrl?: string');
		expect(sendViaSes).toContain('const safeUnsubscribeUrl = unsubscribeUrl ? safeHeaderUrl(unsubscribeUrl) : null;');
		expect(sendViaSes).toContain("{ Name: 'List-Unsubscribe', Value: `<${safeUnsubscribeUrl}>` }");
		expect(sendViaSes).toContain("{ Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' }");
		expect(sendViaSes).toContain('Headers: headers');
		expect(sendViaSes).toContain('Content: {\n\t\t\tSimple: {');
	});
});
