import { error } from '@sveltejs/kit';
import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

/**
 * GET /api/org/[slug]/dm/receipts/export.csv
 *
 * CSV export of one explicit accountability-receipt page. A continuation
 * cursor is returned in X-Next-Cursor; no request walks all history.
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	try {
		const cursor = url.searchParams.get('cursor') ?? undefined;
		const requestedLimit = Number.parseInt(url.searchParams.get('limit') ?? '100', 10);
		const limit = Number.isSafeInteger(requestedLimit)
			? Math.min(Math.max(requestedLimit, 1), 100)
			: 100;
		const result = await serverQuery(api.legislation.exportReceiptsByOrg, {
			slug: params.slug!,
			cursor,
			limit
		});

		const header = [
			'id',
			'decisionMakerId',
			'dmName',
			'billId',
			'attestationDigest',
			'verifiedCount',
			'totalCount',
			'districtCount',
			'alignment',
			'causalityClass',
			'proofDeliveredAt',
			'proofVerifiedAt',
			'anchorCid',
			'anchorRoot'
		];

		const escape = (v: unknown): string => {
			if (v === null || v === undefined) return '';
			let s = String(v);
			if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
			if (s.includes(',') || s.includes('"') || s.includes('\n')) {
				return `"${s.replace(/"/g, '""')}"`;
			}
			return s;
		};

		const lines: string[] = [header.join(',')];
		for (const r of result.items) {
			lines.push(
				[
					r.id,
					r.decisionMakerId,
					r.dmName,
					r.billId,
					r.attestationDigest,
					r.verifiedCount,
					r.totalCount,
					r.districtCount,
					r.alignment,
					r.causalityClass,
					r.proofDeliveredAt,
					r.proofVerifiedAt,
					r.anchorCid,
					r.anchorRoot
				]
					.map(escape)
					.join(',')
			);
		}

		const body = lines.join('\n');
		const headers: Record<string, string> = {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="receipts-${params.slug}-part.csv"`,
			'X-Export-Complete': result.nextCursor ? 'false' : 'true'
		};
		if (result.nextCursor) {
			headers['X-Next-Cursor'] = result.nextCursor;
			const nextUrl = new URL(url);
			nextUrl.searchParams.set('cursor', result.nextCursor);
			headers.Link = `<${nextUrl.pathname}${nextUrl.search}>; rel="next"`;
		}
		return new Response(body, {
			headers
		});
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Failed to export receipts';
		if (message.includes('ACCOUNTABILITY_READ_MODEL_NOT_READY')) throw error(503, message);
		throw error(404, message);
	}
};
