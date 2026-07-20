const DEFAULT_MAXIMUM_RESPONSE_BYTES = 1024 * 1024;
const MAXIMUM_CONFIGURABLE_RESPONSE_BYTES = 16 * 1024 * 1024;

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {ReadableStream<Uint8Array> | null} body */
async function cancelBody(body) {
	if (body === null) return;
	try {
		await body.cancel();
	} catch {
		// The size violation remains authoritative even if the peer already closed.
	}
}

/**
 * Read an HTTP response without ever materializing more than the configured
 * number of bytes. The limit applies even when Content-Length is absent or
 * dishonest.
 *
 * @param {Response} response
 * @param {string} label
 * @param {number} [maximumBytes]
 */
async function readBoundedResponseBytes(
	response,
	label,
	maximumBytes = DEFAULT_MAXIMUM_RESPONSE_BYTES
) {
	invariant(response instanceof Response, `${label} is not an HTTP response.`);
	invariant(
		Number.isSafeInteger(maximumBytes) &&
			maximumBytes > 0 &&
			maximumBytes <= MAXIMUM_CONFIGURABLE_RESPONSE_BYTES,
		`${label} byte limit is invalid.`
	);
	const declared = response.headers.get('content-length');
	if (declared !== null) {
		const declaredBytes = /^(?:0|[1-9][0-9]*)$/u.test(declared) ? Number(declared) : Number.NaN;
		if (!Number.isSafeInteger(declaredBytes)) {
			await cancelBody(response.body);
			throw new Error(`${label} content-length is invalid.`);
		}
		if (declaredBytes > maximumBytes) {
			await cancelBody(response.body);
			throw new Error(`${label} exceeds ${maximumBytes} bytes.`);
		}
	}
	if (response.body === null) return new Uint8Array();

	const reader = response.body.getReader();
	/** @type {Uint8Array[]} */
	const chunks = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maximumBytes) {
				try {
					await reader.cancel();
				} catch {
					// The bounded-reader violation remains authoritative.
				}
				throw new Error(`${label} exceeds ${maximumBytes} bytes.`);
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
	return bytes;
}

/**
 * @param {Response} response
 * @param {string} label
 * @param {number} [maximumBytes]
 */
export async function readBoundedResponseText(
	response,
	label,
	maximumBytes = DEFAULT_MAXIMUM_RESPONSE_BYTES
) {
	const bytes = await readBoundedResponseBytes(response, label, maximumBytes);
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		throw new Error(`${label} is not valid UTF-8.`);
	}
}

/**
 * @param {Response} response
 * @param {string} label
 * @param {number} [maximumBytes]
 */
export async function readBoundedResponseJson(
	response,
	label,
	maximumBytes = DEFAULT_MAXIMUM_RESPONSE_BYTES
) {
	const text = await readBoundedResponseText(response, label, maximumBytes);
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`${label} is not valid JSON.`);
	}
}
