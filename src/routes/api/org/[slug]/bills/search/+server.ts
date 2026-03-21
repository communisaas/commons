import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext } from '$lib/server/org';
import { FEATURES } from '$lib/config/features';
import type { RequestHandler } from './$types';

/**
 * GET /api/org/[slug]/bills/search
 *
 * Full-text search over bills using PostgreSQL tsvector.
 * Requires the `fts` generated column + GIN index on the bill table.
 *
 * Query params:
 *   ?q=<search text>         (required)
 *   ?jurisdiction=<string>   (optional filter)
 *   ?status=<string>         (optional filter)
 *   ?limit=<number>          (default 20, max 50)
 *   ?offset=<number>         (default 0)
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!FEATURES.LEGISLATION) {
		throw error(404, 'Legislation features not enabled');
	}

	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	await loadOrgContext(params.slug, locals.user.id);

	const q = url.searchParams.get('q')?.trim();
	if (!q) {
		throw error(400, 'Query parameter "q" is required');
	}
	if (q.length > 200) {
		throw error(400, 'Search query must be 200 characters or fewer');
	}

	const jurisdiction = url.searchParams.get('jurisdiction');
	const status = url.searchParams.get('status');
	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 50);
	const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

	const validStatuses = ['introduced', 'committee', 'floor', 'passed', 'failed', 'signed', 'vetoed'];
	if (status && !validStatuses.includes(status)) {
		throw error(400, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
	}

	// Build tsquery: split on whitespace, prefix-match each term, AND them together
	const tsQuery = q
		.split(/\s+/)
		.filter((w) => w.length > 0)
		.map((w) => w.replace(/[^a-zA-Z0-9]/g, '')) // strip special chars to prevent tsquery syntax errors
		.filter((w) => w.length > 0)
		.slice(0, 10) // Cap terms to prevent expensive tsquery
		.map((w) => `${w}:*`)
		.join(' & ');

	if (!tsQuery) {
		return json({ bills: [], total: 0, limit, offset });
	}

	// Build WHERE clauses dynamically
	// All values are passed as parameters to prevent SQL injection
	type BillRow = {
		id: string;
		external_id: string;
		title: string;
		summary: string | null;
		status: string;
		status_date: Date;
		jurisdiction: string;
		jurisdiction_level: string;
		chamber: string | null;
		source_url: string;
		rank: number;
	};

	let bills: BillRow[];
	let countResult: [{ count: bigint }];

	if (jurisdiction && status) {
		bills = await db.$queryRaw<BillRow[]>`
			SELECT b.id, b.external_id, b.title, b.summary, b.status,
				b.status_date, b.jurisdiction, b.jurisdiction_level, b.chamber,
				b.source_url,
				ts_rank(b.fts, to_tsquery('english', ${tsQuery})) AS rank
			FROM bill b
			WHERE b.fts @@ to_tsquery('english', ${tsQuery})
				AND b.jurisdiction = ${jurisdiction}
				AND b.status = ${status}
			ORDER BY rank DESC, b.status_date DESC
			LIMIT ${limit} OFFSET ${offset}
		`;
		countResult = await db.$queryRaw<[{ count: bigint }]>`
			SELECT count(*)::bigint AS count FROM bill b
			WHERE b.fts @@ to_tsquery('english', ${tsQuery})
				AND b.jurisdiction = ${jurisdiction}
				AND b.status = ${status}
		`;
	} else if (jurisdiction) {
		bills = await db.$queryRaw<BillRow[]>`
			SELECT b.id, b.external_id, b.title, b.summary, b.status,
				b.status_date, b.jurisdiction, b.jurisdiction_level, b.chamber,
				b.source_url,
				ts_rank(b.fts, to_tsquery('english', ${tsQuery})) AS rank
			FROM bill b
			WHERE b.fts @@ to_tsquery('english', ${tsQuery})
				AND b.jurisdiction = ${jurisdiction}
			ORDER BY rank DESC, b.status_date DESC
			LIMIT ${limit} OFFSET ${offset}
		`;
		countResult = await db.$queryRaw<[{ count: bigint }]>`
			SELECT count(*)::bigint AS count FROM bill b
			WHERE b.fts @@ to_tsquery('english', ${tsQuery})
				AND b.jurisdiction = ${jurisdiction}
		`;
	} else if (status) {
		bills = await db.$queryRaw<BillRow[]>`
			SELECT b.id, b.external_id, b.title, b.summary, b.status,
				b.status_date, b.jurisdiction, b.jurisdiction_level, b.chamber,
				b.source_url,
				ts_rank(b.fts, to_tsquery('english', ${tsQuery})) AS rank
			FROM bill b
			WHERE b.fts @@ to_tsquery('english', ${tsQuery})
				AND b.status = ${status}
			ORDER BY rank DESC, b.status_date DESC
			LIMIT ${limit} OFFSET ${offset}
		`;
		countResult = await db.$queryRaw<[{ count: bigint }]>`
			SELECT count(*)::bigint AS count FROM bill b
			WHERE b.fts @@ to_tsquery('english', ${tsQuery})
				AND b.status = ${status}
		`;
	} else {
		bills = await db.$queryRaw<BillRow[]>`
			SELECT b.id, b.external_id, b.title, b.summary, b.status,
				b.status_date, b.jurisdiction, b.jurisdiction_level, b.chamber,
				b.source_url,
				ts_rank(b.fts, to_tsquery('english', ${tsQuery})) AS rank
			FROM bill b
			WHERE b.fts @@ to_tsquery('english', ${tsQuery})
			ORDER BY rank DESC, b.status_date DESC
			LIMIT ${limit} OFFSET ${offset}
		`;
		countResult = await db.$queryRaw<[{ count: bigint }]>`
			SELECT count(*)::bigint AS count FROM bill b
			WHERE b.fts @@ to_tsquery('english', ${tsQuery})
		`;
	}

	const total = Number(countResult[0]?.count ?? 0);

	return json({
		bills: bills.map((b) => ({
			id: b.id,
			externalId: b.external_id,
			title: b.title,
			summary: b.summary,
			status: b.status,
			statusDate: b.status_date instanceof Date ? b.status_date.toISOString() : b.status_date,
			jurisdiction: b.jurisdiction,
			jurisdictionLevel: b.jurisdiction_level,
			chamber: b.chamber,
			sourceUrl: b.source_url
		})),
		total,
		limit,
		offset
	});
};
