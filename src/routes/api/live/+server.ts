import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const startTime = Date.now();
const BUILD_RELEASE_SHA = import.meta.env.VITE_RELEASE_SHA as string | undefined;

function exactReleaseSha(value: unknown): string | null {
	return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) ? value : null;
}

function exactReleaseTransaction(value: unknown): string | null {
	return typeof value === 'string' && /^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/.test(value)
		? value
		: null;
}

/**
 * Process liveness only. Dependency and public-discovery release readiness
 * intentionally remain on /api/health so a producer incident cannot make the
 * edge process itself look dead.
 */
export const GET: RequestHandler = async ({ platform }) =>
	json(
		{
			status: 'ok',
			release: {
				sha: exactReleaseSha(BUILD_RELEASE_SHA),
				transactionId: exactReleaseTransaction(platform?.env?.PUBLIC_RELEASE_TRANSACTION_ID)
			},
			uptime: Math.floor((Date.now() - startTime) / 1000)
		},
		{
			status: 200,
			headers: { 'Cache-Control': 'no-store' }
		}
	);
