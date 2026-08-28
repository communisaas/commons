import { describe, expect, it } from 'vitest';

import { GET } from '../../../src/routes/api/live/+server';

describe('/api/live', () => {
	it('reports process liveness without dependency I/O', async () => {
		const response = await GET({} as never);

		expect(response.status).toBe(200);
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		await expect(response.json()).resolves.toMatchObject({
			status: 'ok',
			release: { sha: expect.stringMatching(/^[a-f0-9]{40}$/) },
			uptime: expect.any(Number)
		});
	});
});
