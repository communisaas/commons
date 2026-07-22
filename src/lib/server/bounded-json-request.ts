const JSON_CONTENT_TYPE = /^(?:application\/json|[^;]+\+json)(?:\s*;|$)/iu;

export class BoundedJsonRequestError extends Error {
	readonly status: 400 | 413;

	constructor(message: string, status: 400 | 413 = 400) {
		super(message);
		this.name = 'BoundedJsonRequestError';
		this.status = status;
	}
}

type JsonShapeBudget = Readonly<{
	maxArrayItems: number;
	maxDepth: number;
	maxNodes: number;
	maxObjectKeys: number;
	maxStringBytes: number;
}>;

const DEFAULT_SHAPE_BUDGET: JsonShapeBudget = Object.freeze({
	maxArrayItems: 32,
	maxDepth: 6,
	maxNodes: 512,
	maxObjectKeys: 32,
	maxStringBytes: 16_000
});

function parseContentLength(request: Pick<Request, 'headers'>, maxBytes: number): void {
	const raw = request.headers?.get?.('content-length');
	if (raw === null || raw === undefined) return;
	if (!/^(?:0|[1-9][0-9]*)$/u.test(raw)) {
		throw new BoundedJsonRequestError('Invalid Content-Length header');
	}
	const contentLength = Number(raw);
	if (!Number.isSafeInteger(contentLength)) {
		throw new BoundedJsonRequestError('Invalid Content-Length header');
	}
	if (contentLength > maxBytes) {
		throw new BoundedJsonRequestError('Request body exceeds maximum size', 413);
	}
}

async function readBodyText(request: Request, maxBytes: number): Promise<string> {
	parseContentLength(request, maxBytes);
	const contentType = request.headers?.get?.('content-type');
	if (contentType && !JSON_CONTENT_TYPE.test(contentType)) {
		throw new BoundedJsonRequestError('Request body must be JSON');
	}

	if (request.body && typeof request.body.getReader === 'function') {
		const reader = request.body.getReader();
		const decoder = new TextDecoder('utf-8', { fatal: true });
		let bytes = 0;
		let text = '';
		try {
			while (true) {
				const next = await reader.read();
				if (next.done) break;
				bytes += next.value.byteLength;
				if (bytes > maxBytes) {
					await reader.cancel('bounded request body exceeded');
					throw new BoundedJsonRequestError('Request body exceeds maximum size', 413);
				}
				text += decoder.decode(next.value, { stream: true });
			}
			text += decoder.decode();
			return text;
		} catch (error) {
			if (error instanceof BoundedJsonRequestError) throw error;
			throw new BoundedJsonRequestError('Invalid UTF-8 request body');
		} finally {
			reader.releaseLock();
		}
	}

	if (typeof request.text === 'function') {
		const text = await request.text();
		if (new TextEncoder().encode(text).byteLength > maxBytes) {
			throw new BoundedJsonRequestError('Request body exceeds maximum size', 413);
		}
		return text;
	}

	throw new BoundedJsonRequestError('Invalid request body');
}

/**
 * Reject pathological JSON independent of a route schema. This budget prevents
 * a small-but-deep document, huge key fan-out, or nested arrays from turning
 * runtime validation itself into an unbounded operation.
 */
export function assertBoundedJsonShape(
	value: unknown,
	budget: Partial<JsonShapeBudget> = {}
): void {
	const limits = { ...DEFAULT_SHAPE_BUDGET, ...budget };
	let nodes = 0;
	const encoder = new TextEncoder();

	function visit(candidate: unknown, depth: number): void {
		nodes += 1;
		if (nodes > limits.maxNodes) {
			throw new BoundedJsonRequestError('Request body has too many values');
		}
		if (depth > limits.maxDepth) {
			throw new BoundedJsonRequestError('Request body is nested too deeply');
		}
		if (
			candidate === null ||
			typeof candidate === 'boolean' ||
			(typeof candidate === 'number' && Number.isFinite(candidate))
		) {
			return;
		}
		if (typeof candidate === 'string') {
			if (encoder.encode(candidate).byteLength > limits.maxStringBytes) {
				throw new BoundedJsonRequestError('Request body contains an oversized string');
			}
			return;
		}
		if (Array.isArray(candidate)) {
			if (candidate.length > limits.maxArrayItems) {
				throw new BoundedJsonRequestError('Request body contains too many array items');
			}
			for (const item of candidate) visit(item, depth + 1);
			return;
		}
		if (typeof candidate === 'object') {
			const object = candidate as Record<string, unknown>;
			const keys = Object.keys(object);
			if (keys.length > limits.maxObjectKeys) {
				throw new BoundedJsonRequestError('Request body contains too many object fields');
			}
			for (const key of keys) {
				if (encoder.encode(key).byteLength > 128) {
					throw new BoundedJsonRequestError('Request body contains an oversized field name');
				}
				visit(object[key], depth + 1);
			}
			return;
		}
		throw new BoundedJsonRequestError('Request body contains a non-JSON value');
	}

	visit(value, 0);
}

/** Read JSON without ever buffering more than the reviewed aggregate byte cap. */
export async function readBoundedJsonRequest(
	request: Request,
	maxBytes: number,
	shapeBudget: Partial<JsonShapeBudget> = {}
): Promise<unknown> {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 2 || maxBytes > 1024 * 1024) {
		throw new Error('BOUNDED_JSON_CONFIGURATION_INVALID');
	}

	// Unit tests historically use a minimal Request-like object exposing only
	// json(). Production Fetch Requests always take the streaming branch above.
	if (
		!request.body &&
		typeof request.text !== 'function' &&
		typeof (request as Request & { json?: () => Promise<unknown> }).json === 'function'
	) {
		let value: unknown;
		try {
			value = await (request as Request & { json: () => Promise<unknown> }).json();
		} catch {
			throw new BoundedJsonRequestError('Invalid JSON in request body');
		}
		let encoded: Uint8Array;
		try {
			encoded = new TextEncoder().encode(JSON.stringify(value));
		} catch {
			throw new BoundedJsonRequestError('Invalid request body');
		}
		if (encoded.byteLength > maxBytes) {
			throw new BoundedJsonRequestError('Request body exceeds maximum size', 413);
		}
		assertBoundedJsonShape(value, shapeBudget);
		return value;
	}

	let text: string;
	try {
		text = await readBodyText(request, maxBytes);
	} catch (error) {
		if (error instanceof BoundedJsonRequestError) throw error;
		throw new BoundedJsonRequestError('Invalid request body');
	}

	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new BoundedJsonRequestError('Invalid JSON in request body');
	}
	assertBoundedJsonShape(value, shapeBudget);
	return value;
}
