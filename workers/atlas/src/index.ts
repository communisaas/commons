/**
 * Atlas Worker — Stateless R2-to-CDN bridge for Shadow Atlas data.
 *
 * Serves cell chunks, district indices, officials, and Merkle snapshots
 * from the shadow-atlas R2 bucket via atlas.commons.email.
 *
 * Privacy invariant: this Worker has NO access to the main Commons app's
 * session state, KV stores, D1 databases, or identity context. It is a
 * static data plane — architecturally equivalent to an IPFS gateway.
 * The Commons application server never sees which cells a user fetches.
 *
 * Cache strategy: immutable quarterly data with long TTL. CF edge cache
 * absorbs repeat requests — subsequent fetches from the same PoP never
 * hit this Worker or R2.
 */

interface Env {
	BUCKET: R2Bucket;
}

/** Allowed path pattern: versioned prefix + country + data type + file. */
const PATH_PATTERN = /^\/v\d{8}\/[A-Z]{2}\/.+\.json$/;

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			return new Response('Method Not Allowed', { status: 405 });
		}

		const url = new URL(request.url);
		const path = url.pathname;

		// Reject malformed or traversal-attempt paths.
		if (!PATH_PATTERN.test(path) || path.includes('..')) {
			return new Response('Not Found', { status: 404 });
		}

		// Strip leading slash — R2 object keys don't start with /.
		const key = path.slice(1);

		const object = await env.BUCKET.get(key);
		if (!object) {
			return new Response('Not Found', { status: 404 });
		}

		const headers = new Headers();
		headers.set('Content-Type', 'application/json');
		headers.set('Access-Control-Allow-Origin', '*');
		headers.set('Cache-Control', 'public, max-age=2592000, immutable');
		headers.set('ETag', object.httpEtag);

		if (request.method === 'HEAD') {
			return new Response(null, { status: 200, headers });
		}

		return new Response(object.body, { status: 200, headers });
	},
};
