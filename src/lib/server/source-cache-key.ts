const SOURCE_CACHE_KEY_VERSION = 2;

export type SourceCacheResearchInput = {
	subjectLine: string;
	coreMessage: string;
	topics: string[];
	geographicScope?: {
		type: 'international' | 'nationwide' | 'subnational';
		country?: string;
		subdivision?: string;
		locality?: string;
	};
	decisionMakers: Array<{ name: string; title: string; organization: string }>;
};

function bytesToHex(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * Bind template source ground to every input that affects discovery/ranking.
 *
 * The object is assembled in a fixed field order and contains no caller-supplied
 * hash. Voice/personalization are intentionally excluded: they affect prose,
 * not which evidence is relevant, so those edits can still reuse source work.
 */
export async function computeSourceCacheInputHash(
	input: SourceCacheResearchInput
): Promise<string> {
	const canonical = JSON.stringify({
		version: SOURCE_CACHE_KEY_VERSION,
		subjectLine: input.subjectLine,
		coreMessage: input.coreMessage,
		topics: input.topics,
		geographicScope: input.geographicScope
			? {
					type: input.geographicScope.type,
					country: input.geographicScope.country ?? null,
					subdivision: input.geographicScope.subdivision ?? null,
					locality: input.geographicScope.locality ?? null
				}
			: null,
		decisionMakers: input.decisionMakers.map((decisionMaker) => ({
			name: decisionMaker.name,
			title: decisionMaker.title,
			organization: decisionMaker.organization
		}))
	});
	const digest = await globalThis.crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(canonical)
	);
	return bytesToHex(digest);
}
