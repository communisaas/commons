/**
 * SSE Stream - Server-side helpers
 *
 * createSSEStream and SSE_HEADERS for server endpoints.
 * Uses TransformStream for Cloudflare Pages compatibility.
 */

/**
 * Create SSE response helper for server endpoints.
 * Uses TransformStream (required by Cloudflare Pages Workers runtime).
 * Provides typed event emitter for consistent SSE formatting.
 */
export function createSSEStream(traceConfig?: {
	traceId: string;
	endpoint: string;
	userId?: string | null;
	/** When provided, abort() is called on client disconnect so server-side work can stop. */
	abortController?: AbortController;
}) {
	const encoder = new TextEncoder();
	const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
	const writer = writable.getWriter();
	let closed = false;

	function handleDisconnect() {
		if (closed) return;
		closed = true;
		traceConfig?.abortController?.abort();
	}

	const emitter = {
		/**
		 * Send a typed event to the stream
		 */
		send<T>(type: string, data: T) {
			if (closed) return;
			try {
				const event = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
				writer.write(encoder.encode(event)).catch(() => {
					// Client disconnected or the stream was cancelled after the write was queued.
					handleDisconnect();
				});
			} catch {
				// Stream already closed by client disconnect or timeout
				handleDisconnect();
				return;
			}
		},

		/**
		 * Send a thought event (convenience method)
		 */
		thought(content: string) {
			this.send('thought', { content });
		},

		/**
		 * Send a progress event (convenience method)
		 */
		progress(current: number, total: number, phase?: string) {
			this.send('progress', { current, total, phase });
		},

		/**
		 * Send completion event with final data
		 */
		complete<T>(data: T) {
			this.send('complete', data);
		},

		/**
		 * Send error event
		 */
		error(message: string, code?: string) {
			this.send('error', { message, code });
		},

		/**
		 * Close the stream
		 */
		close() {
			if (closed) return;
			closed = true;
			try {
				writer.close();
			} catch {
				// Already closed
			}
		}
	};

	return { stream: readable, emitter };
}

/**
 * SSE Response headers
 * Includes anti-buffering headers for Cloudflare Pages and reverse proxies.
 */
export const SSE_HEADERS = {
	'Content-Type': 'text/event-stream',
	'Cache-Control': 'no-cache',
	Connection: 'keep-alive',
	'X-Accel-Buffering': 'no',
	'cf-no-buffer': '1'
} as const;
