export type PublicTemplatePageCoordinate = Readonly<{
	templateId: string;
	slug: string;
	artifactRevision: number;
}>;

/**
 * Digest the complete, ordered public-template coordinate plan. Both the
 * producer checkpoint and offline release proof use this byte-for-byte
 * contract so neither can reinterpret an otherwise valid checkpoint.
 */
export async function publicTemplatePageCoordinateDigest(
	entries: readonly PublicTemplatePageCoordinate[]
): Promise<string> {
	const encoded = new TextEncoder().encode(
		JSON.stringify(
			entries.map(({ templateId, slug, artifactRevision }) => [
				String(templateId),
				slug,
				artifactRevision
			])
		)
	);
	const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
