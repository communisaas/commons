import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const convexSource = readFileSync('convex/messageJobs.ts', 'utf8');
const routeSource = readFileSync('src/routes/api/agents/message-jobs/[jobId]/+server.ts', 'utf8');

describe('message-job query clock boundary', () => {
	it('keeps the Convex reader deterministic and evaluates display expiry at the server boundary', () => {
		const start = convexSource.indexOf('export const getForUser = query');
		const end = convexSource.indexOf('export const markRunning = mutation', start);
		expect(start).toBeGreaterThanOrEqual(0);
		expect(end).toBeGreaterThan(start);
		const queryBlock = convexSource.slice(start, end);
		expect(queryBlock).toContain('storedPublicJob(job)');
		expect(queryBlock).not.toContain('publicJob(job)');
		expect(queryBlock).not.toContain('Date.now');
		expect(routeSource).toContain('job.expiresAt <= Date.now()');
		expect(routeSource).toContain("status: 'expired' as const");
	});
});
