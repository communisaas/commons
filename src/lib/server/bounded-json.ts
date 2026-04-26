import { error } from '@sveltejs/kit';

const decoder = new TextDecoder();

export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
	const contentLength = request.headers.get('content-length');
	if (contentLength) {
		const parsedLength = Number(contentLength);
		if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
			throw error(413, 'Request body too large');
		}
	}

	const text = await readBoundedText(request, maxBytes);
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw error(400, 'Invalid JSON body');
	}
}

async function readBoundedText(request: Request, maxBytes: number): Promise<string> {
	if (!request.body) return '';

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;

			total += value.byteLength;
			if (total > maxBytes) {
				await reader.cancel().catch(() => {});
				throw error(413, 'Request body too large');
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return decoder.decode(bytes);
}
