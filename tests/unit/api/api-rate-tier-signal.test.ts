import { describe, expect, it } from 'vitest';

import {
	getApiV1RateTierSignal,
	recordApiV1RateTierSignal,
	withApiV1RateTierSignal
} from '$lib/server/api-v1/rate-tier-signal';

describe('API v1 rate-tier request signal', () => {
	it('does not exist outside an edge request scope', () => {
		recordApiV1RateTierSignal('coalition');
		expect(getApiV1RateTierSignal()).toBeUndefined();
	});

	it('isolates concurrent request values', async () => {
		let release!: () => void;
		const pause = new Promise<void>((resolve) => {
			release = resolve;
		});
		const first = withApiV1RateTierSignal(async () => {
			recordApiV1RateTierSignal('starter');
			await pause;
			return getApiV1RateTierSignal();
		});
		const second = withApiV1RateTierSignal(async () => {
			recordApiV1RateTierSignal('coalition');
			release();
			return getApiV1RateTierSignal();
		});
		await expect(Promise.all([first, second])).resolves.toEqual(['starter', 'coalition']);
	});
});
