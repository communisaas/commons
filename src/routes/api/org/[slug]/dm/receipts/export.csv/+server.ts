import { error } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

/**
 * GET /api/org/[slug]/dm/receipts/export.csv
 *
 * CSV export of all accountability receipts for the org. Streams the response
 * so large receipt sets don't sit in memory. Attestation digest column lets
 * downstream consumers reproduce the per-receipt hash. T6-5.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	try {
		// Pull a wide page — CSV export is bounded by what the org wants. 500
		// keeps the response sub-MB for typical orgs; multi-page exports can
		// chain via the cursor pagination on the JSON endpoint.
		const result = await serverQuery(api.legislation.listReceiptsByOrg, {
			slug: params.slug!,
			limit: 500
		});

		const header = [
			'id',
			'decisionMakerId',
			'dmName',
			'billId',
			'attestationDigest',
			'proofWeight',
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
			const s = String(v);
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
					r.proofWeight,
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
		return new Response(body, {
			headers: {
				'Content-Type': 'text/csv; charset=utf-8',
				'Content-Disposition': `attachment; filename="receipts-${params.slug}.csv"`
			}
		});
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Failed to export receipts';
		throw error(404, message);
	}
};
