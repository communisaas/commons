import { describe, expect, it } from 'vitest';

import {
	createPublicTemplateOgReleaseStageEnvelope,
	loadPublicTemplateOgReleaseRecoveryStageChain,
	putPublicTemplateOgReleaseRecoveryStage,
	validatePublicTemplateOgReleaseRecoveryIdentity,
	validatePublicTemplateOgReleaseStageTransition
} from '../../../scripts/public-template-og-release-recovery-store.mjs';

const KIT_DIGEST = 'a'.repeat(64);
const identity = validatePublicTemplateOgReleaseRecoveryIdentity({
	repository: 'communisaas/commons',
	repositoryId: '599295397',
	runId: '123456789',
	runAttempt: '2',
	transactionId: '123456789-2',
	realm: 'preview'
});

class FakeS3Client {
	objects = new Map<string, { bytes: Buffer; metadata: Record<string, string> }>();

	async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
		const key = String(command.input.Key);
		if (command.constructor.name === 'PutObjectCommand') {
			if (this.objects.has(key)) {
				throw Object.assign(new Error('precondition'), {
					name: 'PreconditionFailed',
					$metadata: { httpStatusCode: 412 }
				});
			}
			const body = command.input.Body;
			const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body as Uint8Array);
			this.objects.set(key, {
				bytes,
				metadata: command.input.Metadata as Record<string, string>
			});
			return { $metadata: { httpStatusCode: 200 } };
		}
		const object = this.objects.get(key);
		if (!object) {
			throw Object.assign(new Error('missing'), {
				name: 'NoSuchKey',
				$metadata: { httpStatusCode: 404 }
			});
		}
		if (command.constructor.name === 'HeadObjectCommand') {
			return { ContentLength: object.bytes.byteLength, Metadata: object.metadata };
		}
		if (command.constructor.name === 'GetObjectCommand') {
			return {
				ContentLength: object.bytes.byteLength,
				Metadata: object.metadata,
				Body: (async function* () {
					yield object.bytes;
				})()
			};
		}
		throw new Error(`unexpected command ${command.constructor.name}`);
	}
}

function journal(lastStage: string | null = null, lastStageDigest: string | null = null) {
	return {
		...identity,
		releaseKitDigest: KIT_DIGEST,
		lastStage,
		lastStageDigest
	};
}

describe('private append-only release recovery store', () => {
	it('requires each result and finalization to follow its exact durable intent', () => {
		expect(() => validatePublicTemplateOgReleaseStageTransition('result-pages', 'result-authority-arm')).toThrow(
			/exact intent/i
		);
		expect(() => validatePublicTemplateOgReleaseStageTransition('qualified', 'finalized')).toThrow(
			/exact.*intent/i
		);
		expect(validatePublicTemplateOgReleaseStageTransition('qualified', 'intent-finalize')).toBe(
			'intent-finalize'
		);
	});

	it('serializes one hash-linked stage chain and loads it without LIST authority', async () => {
		const client = new FakeS3Client();
		const baseline = await putPublicTemplateOgReleaseRecoveryStage({
			client: client as never,
			identity,
			envelope: createPublicTemplateOgReleaseStageEnvelope({
				identity,
				stage: 'baseline',
				previousStage: null,
				previousDigest: null,
				releaseKitDigest: KIT_DIGEST,
				journal: journal()
			})
		});
		await putPublicTemplateOgReleaseRecoveryStage({
			client: client as never,
			identity,
			envelope: createPublicTemplateOgReleaseStageEnvelope({
				identity,
				stage: 'intent-gate',
				previousStage: 'baseline',
				previousDigest: baseline.digest,
				releaseKitDigest: KIT_DIGEST,
				journal: journal('baseline', baseline.digest)
			})
		});

		await expect(
			loadPublicTemplateOgReleaseRecoveryStageChain({ client: client as never, identity })
		).resolves.toMatchObject({
			state: 'present',
			latest: { envelope: { stage: 'intent-gate', previousStage: 'baseline' } }
		});
	});

	it('uses predecessor CAS claims to reject a normal/recovery sibling fork', async () => {
		const client = new FakeS3Client();
		const baseline = await putPublicTemplateOgReleaseRecoveryStage({
			client: client as never,
			identity,
			envelope: createPublicTemplateOgReleaseStageEnvelope({
				identity,
				stage: 'baseline',
				previousStage: null,
				previousDigest: null,
				releaseKitDigest: KIT_DIGEST,
				journal: journal()
			})
		});
		const predecessor = journal('baseline', baseline.digest);
		await putPublicTemplateOgReleaseRecoveryStage({
			client: client as never,
			identity,
			envelope: createPublicTemplateOgReleaseStageEnvelope({
				identity,
				stage: 'intent-gate',
				previousStage: 'baseline',
				previousDigest: baseline.digest,
				releaseKitDigest: KIT_DIGEST,
				journal: predecessor
			})
		});

		await expect(
			putPublicTemplateOgReleaseRecoveryStage({
				client: client as never,
				identity,
				envelope: createPublicTemplateOgReleaseStageEnvelope({
					identity,
					stage: 'superseded',
					previousStage: 'baseline',
					previousDigest: baseline.digest,
					releaseKitDigest: KIT_DIGEST,
					journal: predecessor
				})
			})
		).rejects.toThrow(/preoccupied/i);
	});
});
