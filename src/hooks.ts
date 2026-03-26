/**
 * SvelteKit universal hooks — transport for Convex SSR-to-live upgrade.
 *
 * DUAL-STACK: This transport hook enables convexLoad() in load functions.
 * Data fetched server-side via ConvexHttpClient is serialized across the
 * SSR boundary, then decoded on the client into a live WebSocket subscription.
 *
 * Without this, convexLoad() results would fail to deserialize on the client.
 */
import { encodeConvexLoad, decodeConvexLoad } from 'convex-sveltekit';

export const transport = {
	ConvexLoadResult: {
		encode: (value: unknown) => encodeConvexLoad(value),
		decode: (encoded: { refName: string; args: Record<string, unknown>; data: unknown }) =>
			decodeConvexLoad(encoded)
	}
};
