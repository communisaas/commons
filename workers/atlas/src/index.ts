/**
 * Atlas Worker — Stateless R2-to-CDN bridge for Shadow Atlas data.
 *
 * Serves two surfaces from the shadow-atlas R2 bucket via atlas.commons.email:
 *   1. Chunked output  — `v{YYYYMMDD}/<COUNTRY>/...json`
 *      What browsers consume during ZK proof generation.
 *   2. Source artifacts — `source/manifest.json` + `source/v{YYYYMMDD}/<file>.db|.sha256`
 *      What CI consumes during the quarterly republish (and what the
 *      `publish-source.ts` script writes after a local build).
 *
 * Privacy invariant: this Worker has NO access to the main Commons app's
 * session state, KV stores, D1 databases, or identity context. It is a
 * static data plane — architecturally equivalent to an IPFS gateway.
 * The Commons application server never sees which cells a user fetches.
 *
 * Cache strategy:
 *   - Versioned files (output and source/v.../*) are content-immutable;
 *     served with `max-age=30d, immutable`. CF edge cache absorbs repeats.
 *   - `source/manifest.json` is the moving pointer to the current version;
 *     served with `max-age=300, must-revalidate` so CI picks up new
 *     versions within ~5 min of publish.
 *   - Disallowed paths and 405 responses are explicitly `no-store` so a
 *     future zone-level cache rule cannot accidentally cache negatives.
 *
 * Range support: `.db` source files are multi-GB. We honor `Range:` so CI
 * curl can resume on flaky links and so a malicious caller can't trivially
 * amplify R2 Class B reads by repeatedly cache-busting full-body fetches.
 */

interface Env {
	BUCKET: R2Bucket;
}

/**
 * Output paths — what browsers fetch during proof generation.
 *
 * Shape: `/v{YYYYMMDD}/<COUNTRY>/<...rest>.json`
 *   - `<COUNTRY>` is exactly two upper-case letters
 *   - `<...rest>` may include nested directories but every segment must
 *     start with `[A-Za-z0-9_]` (no leading dots / hyphens) so accidental
 *     dotfiles or `-foo` sentinels in the publishing pipeline don't reach
 *     the public surface.
 */
const OUTPUT_PATTERN =
	/^\/v\d{8}\/[A-Z]{2}(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)+\.json$/;

/**
 * Source paths — what CI fetches during quarterly republish AND what
 * browsers fetch for district bundle visualization.
 *
 * Shape:
 *   `/source/manifest.json`                              (moving index)
 *   `/source/manifest.json.sig`                          (Ed25519 signature)
 *   `/source/v{YYYYMMDD}/<filename>.{db|sha256}`         (top-level CI artifacts)
 *   `/source/v{YYYYMMDD}/<country>/<layer>/index.json`   (per-layer district index)
 *   `/source/v{YYYYMMDD}/<country>/<layer>/<id>.geojson` (per-district feature)
 *
 *   <country> — lowercase 2-3 letter (us, ca, gb, au)
 *   <layer>   — lowercase alphanumeric + hyphen (cd, sldu, sldl, county, can-fed)
 *   <id>      — must start with a lowercase letter and contain only alphanum +
 *               hyphen (matches shadow-atlas id convention: cd-0611, sldu-06035, …)
 *
 * Why per-district files over a single per-layer bundle: per-layer aggregates
 * run 150 MB (cd) to 450 MB (sldl) uncompressed — too large for browser fetches
 * every page render. Per-district files are 50 KB to ~1.5 MB each; the browser
 * fetches just what it needs plus a small per-layer index.
 */
const SOURCE_PATTERN =
	/^\/source\/(?:manifest\.json(?:\.sig)?|v\d{8}\/(?:[a-z][A-Za-z0-9._-]*\.(?:db|sha256)|[a-z]{2,3}\/[a-z][a-z0-9-]*\/(?:index\.json|[a-z][a-z0-9-]*\.geojson)))$/;

function isAllowedPath(path: string): boolean {
	// Defense-in-depth: even though CF normalizes URLs before they reach
	// the Worker, reject any literal `..` segment or empty segment that
	// slipped through. R2 object keys don't permit traversal anyway, but
	// we'd rather a 404 than rely on the storage layer to enforce safety.
	if (path.includes('..') || path.includes('//')) return false;
	return OUTPUT_PATTERN.test(path) || SOURCE_PATTERN.test(path);
}

function contentTypeFor(path: string): string {
	if (path.endsWith('.geojson')) return 'application/geo+json';
	if (path.endsWith('.json')) return 'application/json';
	if (path.endsWith('.db')) return 'application/vnd.sqlite3';
	if (path.endsWith('.sha256')) return 'text/plain; charset=utf-8';
	return 'application/octet-stream';
}

function cacheControlFor(path: string): string {
	// The manifest is the only mutable surface — it's the pointer that
	// changes when a new version is published. All versioned objects are
	// content-immutable.
	if (path === '/source/manifest.json') {
		return 'public, max-age=300, must-revalidate';
	}
	return 'public, max-age=2592000, immutable';
}

/**
 * Parse a Range header into the R2-binding's `R2Range` shape, or null
 * if the header is absent or malformed. We only support the
 * `bytes=START-END` and `bytes=START-` forms — multipart ranges and the
 * suffix form (`bytes=-N`) are rejected (416) so the implementation
 * stays small and predictable.
 */
function parseRange(
	header: string | null,
	totalSize: number,
): R2Range | { error: 'invalid' | 'unsatisfiable' } | null {
	if (!header) return null;
	const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
	if (!match) return { error: 'invalid' };
	const start = Number(match[1]);
	const end = match[2] === '' ? totalSize - 1 : Number(match[2]);
	if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
		return { error: 'invalid' };
	}
	if (start >= totalSize) return { error: 'unsatisfiable' };
	const length = Math.min(end, totalSize - 1) - start + 1;
	return { offset: start, length };
}

function noStoreResponse(status: number, body: string): Response {
	return new Response(body, {
		status,
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Cache-Control': 'no-store',
		},
	});
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			return noStoreResponse(405, 'Method Not Allowed');
		}

		const url = new URL(request.url);
		const path = url.pathname;

		if (!isAllowedPath(path)) {
			return noStoreResponse(404, 'Not Found');
		}

		// Strip leading slash — R2 object keys don't start with /.
		// Note: we deliberately ignore url.search, so any query string is
		// neither forwarded to R2 nor reflected in the response. This
		// removes the cache-key amplification vector where `?_=1`, `?_=2`,
		// … would each create a distinct edge cache slot for the same
		// underlying object.
		const key = path.slice(1);

		// HEAD: respond from R2 metadata only.
		if (request.method === 'HEAD') {
			const head = await env.BUCKET.head(key);
			if (!head) return noStoreResponse(404, 'Not Found');
			const headHeaders = new Headers();
			headHeaders.set('Content-Type', contentTypeFor(path));
			headHeaders.set('Content-Length', String(head.size));
			headHeaders.set('Access-Control-Allow-Origin', '*');
			headHeaders.set('Cache-Control', cacheControlFor(path));
			headHeaders.set('Accept-Ranges', 'bytes');
			headHeaders.set('ETag', head.httpEtag);
			return new Response(null, { status: 200, headers: headHeaders });
		}

		// GET: optionally honor a Range header so multi-GB `.db` downloads
		// can resume after a connection drop.
		const rangeHeader = request.headers.get('Range');
		let object: R2ObjectBody | null;
		let totalSize: number;

		if (rangeHeader) {
			const head = await env.BUCKET.head(key);
			if (!head) return noStoreResponse(404, 'Not Found');
			totalSize = head.size;
			const parsed = parseRange(rangeHeader, totalSize);
			if (parsed && 'error' in parsed) {
				if (parsed.error === 'unsatisfiable') {
					return new Response('Range Not Satisfiable', {
						status: 416,
						headers: {
							'Content-Type': 'text/plain; charset=utf-8',
							'Content-Range': `bytes */${totalSize}`,
							'Cache-Control': 'no-store',
						},
					});
				}
				return noStoreResponse(400, 'Bad Range');
			}
			if (parsed) {
				object = await env.BUCKET.get(key, { range: parsed });
			} else {
				object = await env.BUCKET.get(key);
			}
		} else {
			object = await env.BUCKET.get(key);
			totalSize = object?.size ?? 0;
		}

		if (!object) return noStoreResponse(404, 'Not Found');

		const headers = new Headers();
		headers.set('Content-Type', contentTypeFor(path));
		headers.set('Access-Control-Allow-Origin', '*');
		headers.set('Cache-Control', cacheControlFor(path));
		headers.set('Accept-Ranges', 'bytes');
		headers.set('ETag', object.httpEtag);

		// If we served a partial body, advertise the range.
		if (rangeHeader && object.range) {
			const start = object.range.offset ?? 0;
			const length = object.range.length ?? totalSize - start;
			const end = start + length - 1;
			headers.set('Content-Length', String(length));
			headers.set('Content-Range', `bytes ${start}-${end}/${totalSize}`);
			return new Response(object.body, { status: 206, headers });
		}

		headers.set('Content-Length', String(object.size));
		return new Response(object.body, { status: 200, headers });
	},
};
