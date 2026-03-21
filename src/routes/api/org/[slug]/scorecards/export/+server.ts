import { error } from '@sveltejs/kit';
import { loadOrgContext } from '$lib/server/org';
import { FEATURES } from '$lib/config/features';
import { computeScorecards } from '$lib/server/legislation/scorecard/compute';
import type { RequestHandler } from './$types';

/**
 * GET /api/org/[slug]/scorecards/export?format=csv
 *
 * Exports scorecard data as CSV download.
 * Auth: viewer+ role (any org member).
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!FEATURES.LEGISLATION) {
		throw error(404, 'Legislation features not enabled');
	}

	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const { org } = await loadOrgContext(params.slug, locals.user.id);

	const format = url.searchParams.get('format') ?? 'csv';
	if (format !== 'csv') {
		throw error(400, 'Only CSV format is supported');
	}

	const result = await computeScorecards(org.id);

	// Build CSV
	const headers = [
		'Name',
		'Title',
		'District',
		'Reports Received',
		'Reports Opened',
		'Verify Links Clicked',
		'Replies Logged',
		'Relevant Votes',
		'Aligned Votes',
		'Alignment Rate',
		'Avg Response Time (hrs)',
		'Last Contact',
		'Score'
	];

	const rows = result.scorecards.map((s) => [
		csvEscape(s.name),
		csvEscape(s.title),
		csvEscape(s.district),
		s.reportsReceived,
		s.reportsOpened,
		s.verifyLinksClicked,
		s.repliesLogged,
		s.relevantVotes,
		s.alignedVotes,
		s.alignmentRate !== null ? (s.alignmentRate * 100).toFixed(1) + '%' : '',
		s.avgResponseTime !== null ? s.avgResponseTime.toFixed(1) : '',
		s.lastContactDate ?? '',
		s.score
	]);

	const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join(
		'\n'
	);

	return new Response(csv, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${org.slug}-scorecards-${new Date().toISOString().slice(0, 10)}.csv"`
		}
	});
};

function csvEscape(value: string): string {
	let escaped = value;
	// F-R8-04: Prefix formula injection characters (OWASP)
	if (/^[=+\-@\t\r]/.test(escaped)) {
		escaped = "'" + escaped;
	}
	if (escaped.includes(',') || escaped.includes('"') || escaped.includes('\n')) {
		return '"' + escaped.replace(/"/g, '""') + '"';
	}
	return escaped;
}
