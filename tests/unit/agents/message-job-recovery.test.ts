import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { encryptMessageJobResult } from '$lib/server/message-job-encryption';
import {
	computeMessageInputHash,
	decryptMessageJobResult,
	getOrCreateMessageRecoveryPublicKey
} from '$lib/core/agents/message-job-recovery';

describe('message job recovery', () => {
	it('hashes semantically identical payloads with stable object key ordering', async () => {
		const first = await computeMessageInputHash({
			subject_line: 'Clean water',
			core_message: 'Protect the watershed',
			topics: ['water', 'health'],
			decision_makers: [{ name: 'A', title: 'Mayor', organization: 'City' }]
		});
		const second = await computeMessageInputHash({
			decision_makers: [{ organization: 'City', title: 'Mayor', name: 'A' }],
			topics: ['water', 'health'],
			core_message: 'Protect the watershed',
			subject_line: 'Clean water'
		});

		expect(second).toBe(first);
		expect(first).toMatch(/^[a-f0-9]{64}$/);
	});

	it('round-trips completed jobs only with the same job id and input hash', async () => {
		const jobId = `job-${crypto.randomUUID()}`;
		const payload = {
			subject_line: 'Clean water',
			core_message: 'Protect the watershed',
			topics: ['water']
		};
		const inputHash = await computeMessageInputHash(payload);
		const publicKeyJwk = await getOrCreateMessageRecoveryPublicKey(jobId);
		const result = {
			message: 'Please protect the watershed.',
			sources: [{ num: 1, title: 'Water report', url: 'https://example.test/report' }],
			research_log: ['Verified source']
		};

		const encrypted = await encryptMessageJobResult(result, publicKeyJwk, jobId, inputHash);

		await expect(
			decryptMessageJobResult<typeof result>(jobId, inputHash, encrypted.encryptedResult)
		).resolves.toEqual(result);
		await expect(
			decryptMessageJobResult<typeof result>(jobId, `${inputHash}x`, encrypted.encryptedResult)
		).rejects.toThrow();
	});
});
