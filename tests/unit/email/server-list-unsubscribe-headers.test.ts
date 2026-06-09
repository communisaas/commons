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

	it('keeps the capability surface honest about remaining production gates', () => {
		const scopeDoc = source('docs/design/ORG-CAPABILITY-SCOPE.md');
		const canonicalDoc = source('docs/design/ORG-OS-AUTHORING-FIRST.md');
			const hypergraph = source('src/lib/data/capability-hypergraph.ts');
			const layout = source('src/routes/org/[slug]/+layout.svelte');
			const peopleSpace = source('src/lib/components/org/os/BaseSpace.svelte');
			const supporters = source('src/routes/org/[slug]/supporters/+page.svelte');
			const landscape = source('src/lib/components/org/os/CapabilityLandscape.svelte');
			const tasks = JSON.parse(
				source('docs/strategy/implementation-hypergraph/nodes/tasks.json')
			) as { tasks: Array<{ id: string; status: string; description: string; files_create: string[] }> };

			const dependency = 'SES v2 Simple.Headers + per-recipient HMAC URL on the Convex path';
			const providerDependency =
				'Production Gmail/Yahoo seed sends confirming one-click affordance rendering';
			expect(layout).toContain(dependency);
			expect(peopleSpace).toContain(dependency);
			expect(supporters).toContain(dependency);
			expect(landscape).toContain(dependency);
			expect(layout).toContain(providerDependency);
			expect(peopleSpace).toContain(providerDependency);
			expect(supporters).toContain(providerDependency);
			expect(landscape).toContain(providerDependency);

			expect(hypergraph).toContain('Convex header substrate is wired');
			expect(hypergraph).toContain('production send/provider confirmation stays gated');
			expect(hypergraph).toContain("label: 'Mailbox unsubscribe rendering'");
			expect(hypergraph).toContain("cite: 'T2-4b list-unsubscribe-provider-verification'");
			expect(scopeDoc).toContain('T2-4b provider rendering still needs production dispatch verification');
			expect(scopeDoc).toContain('T2-4b provider rendering still need production verification');
			expect(canonicalDoc).toContain('Convex one-click header substrate exists');
			expect(canonicalDoc).toContain('T2-4b production provider/mailbox rendering remains a dependency boundary');

			const t24 = tasks.tasks.find((task) => task.id === 'T2-4');
			const t24b = tasks.tasks.find((task) => task.id === 'T2-4b');
			expect(t24?.status).toBe('completed');
			expect(t24?.description).toContain('SES v2 Simple.Headers');
			expect(t24?.files_create).toEqual([]);
			expect(t24b?.status).toBe('deferred');
			expect(t24b?.description).toContain('Gmail/Yahoo expose the mailbox-visible');

			const staleClaims = [
				'Raw MIME + per-recipient one-click headers',
			'unclear whether SES sends with List-Unsubscribe headers on Convex server-side path',
			'there are still no List-Unsubscribe headers on this path',
			'Convex server-side path does not',
			'No List-Unsubscribe on Convex server-side path'
		];
		for (const stale of staleClaims) {
			expect(scopeDoc).not.toContain(stale);
			expect(canonicalDoc).not.toContain(stale);
			expect(hypergraph).not.toContain(stale);
		}
	});
});
