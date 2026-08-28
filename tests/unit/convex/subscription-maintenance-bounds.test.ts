import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'convex/subscriptions.ts'), 'utf8');

function exportedBlock(name: string, next: string): string {
	const start = source.indexOf(`export const ${name}`);
	const end = source.indexOf(`export const ${next}`, start + 1);
	expect(start, `${name} missing`).toBeGreaterThanOrEqual(0);
	expect(end, `${next} missing`).toBeGreaterThan(start);
	return source.slice(start, end);
}

describe('subscription maintenance read bounds', () => {
	it.each([
		['backfillOrgLimits', 'backfillCampaignActionOrgIds', 25, 26, 512],
		['backfillCampaignActionOrgIds', 'getByStripeId', 100, 101, 1024]
	] as const)(
		'%s self-pages with hard row and byte envelopes',
		(name, next, pageSize, maxRows, maxKiB) => {
			const block = exportedBlock(name, next);
			expect(block).not.toContain('.collect(');
			expect(block).toContain('.paginate({');
			expect(block).toContain(`numItems: ${pageSize}`);
			expect(block).toContain(`maximumRowsRead: ${maxRows}`);
			expect(block).toContain(`maximumBytesRead: ${maxKiB} * 1024`);
			expect(block).toContain('ctx.scheduler.runAfter(0');
		}
	);
});
