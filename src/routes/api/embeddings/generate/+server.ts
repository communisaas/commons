import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateEmbedding } from '$lib/core/search/gemini-embeddings';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '$lib/server/bounded-json-request';
import { enforceLLMRateLimit, rateLimitResponse } from '$lib/server/llm-cost-protection';

const MAX_EMBEDDING_REQUEST_BYTES = 48 * 1024;
const MAX_EMBEDDING_TEXT_CHARACTERS = 8_000;

/**
 * Generate embedding for a search query.
 *
 * POST { text: string }
 * Returns { embedding: number[] }
 *
 * Rate-limited to prevent Gemini API quota abuse.
 * Each call invokes Google Gemini API using server-side credentials.
 *
 * Uses RETRIEVAL_QUERY task type (asymmetric to RETRIEVAL_DOCUMENT
 * used for template embeddings at creation time).
 */
export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;

	// Auth gate
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	let body: unknown;
	try {
		body = await readBoundedJsonRequest(request, MAX_EMBEDDING_REQUEST_BYTES, {
			maxArrayItems: 0,
			maxDepth: 1,
			maxNodes: 2,
			maxObjectKeys: 1,
			maxStringBytes: 32 * 1024
		});
	} catch (cause) {
		if (cause instanceof BoundedJsonRequestError) {
			throw error(cause.status, cause.message);
		}
		throw cause;
	}

	if (
		body === null ||
		typeof body !== 'object' ||
		Array.isArray(body) ||
		Object.keys(body).length !== 1 ||
		!Object.prototype.hasOwnProperty.call(body, 'text') ||
		typeof (body as Record<string, unknown>).text !== 'string'
	) {
		throw error(400, 'Request body must contain only a text string');
	}

	const text = (body as { text: string }).text.trim();

	if (!text || text.length < 2) {
		throw error(400, 'Text must be at least 2 characters');
	}

	if (text.length > MAX_EMBEDDING_TEXT_CHARACTERS) {
		throw error(400, 'Text too long (max 8000 characters)');
	}

	// Reserve shared provider capacity only after all request work is known-valid.
	const rateLimitCheck = await enforceLLMRateLimit(event, 'embeddings');
	if (!rateLimitCheck.allowed) {
		return rateLimitResponse(rateLimitCheck);
	}

	const embedding = await generateEmbedding(text, {
		taskType: 'RETRIEVAL_QUERY'
	});

	return json({ embedding });
};
