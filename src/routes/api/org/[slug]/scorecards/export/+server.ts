import { error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
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

	const format = url.searchParams.get('format') ?? 'csv';
	if (format !== 'csv') {
		throw error(400, 'Only CSV format is supported');
	}

	const result = await serverQuery(api.legislation.exportScorecards, {
		slug: params.slug
	});

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
		'Estimated Response Hours (from response rate)',
		'Last Contact',
		'Score'
	];

	const rows = result.scorecards.map((s: Record<string, unknown>) => [
		csvEscape(s.name as string),
		csvEscape(s.title as string),
		csvEscape(s.district as string),
		csvValue(s.reportsReceived),
		csvValue(s.reportsOpened),
		csvValue(s.verifyLinksClicked),
		csvValue(s.repliesLogged),
		csvValue(s.relevantVotes),
		csvValue(s.alignedVotes),
		typeof s.alignmentRate === 'number' ? (s.alignmentRate * 100).toFixed(1) + '%' : '',
		typeof s.avgResponseTime === 'number' ? s.avgResponseTime.toFixed(1) : '',
		(s.lastContactDate as string) ?? '',
		csvValue(s.score)
	]);

	const csv = [headers.join(','), ...rows.map((r: unknown[]) => r.join(','))].join('\n');

	return new Response(csv, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${params.slug}-scorecards-${new Date().toISOString().slice(0, 10)}.csv"`
		}
	});
};

function csvValue(value: unknown): string | number {
	return value === null || value === undefined ? '' : (value as string | number);
}

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
