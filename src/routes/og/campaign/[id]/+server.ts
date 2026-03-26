import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

/**
 * Dynamic OG image for campaign social sharing.
 * Returns a 1200×630 SVG card with campaign title, org name, and verified count.
 * Cached for 1 hour at the edge.
 */
export const GET: RequestHandler = async ({ params }) => {
	const campaign = await serverQuery(api.campaigns.getPublicAny, {
		campaignId: params.id,
	});

	if (!campaign) {
		throw error(404, 'Campaign not found');
	}

	const title = truncate(campaign.title, 80);
	const orgName = truncate(campaign.orgName ?? '', 40);
	const verified = campaign.verifiedActionCount ?? 0;

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#09090b"/>
      <stop offset="100%" stop-color="#18181b"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <!-- Border accent -->
  <rect x="0" y="0" width="1200" height="4" fill="#0d9488"/>
  <!-- Org name -->
  <text x="80" y="100" font-family="system-ui, -apple-system, sans-serif" font-size="24" fill="#a1a1aa" font-weight="400">${escSvg(orgName)}</text>
  <!-- Campaign title -->
  <text x="80" y="200" font-family="system-ui, -apple-system, sans-serif" font-size="48" fill="#f4f4f5" font-weight="700">
    ${wrapText(title, 44).map((line, i) => `<tspan x="80" dy="${i === 0 ? 0 : 58}">${escSvg(line)}</tspan>`).join('')}
  </text>
  <!-- Verified count -->
  ${verified > 0 ? `
  <text x="80" y="480" font-family="monospace" font-size="64" fill="#34d399" font-weight="700">${verified.toLocaleString()}</text>
  <text x="${80 + String(verified.toLocaleString()).length * 40 + 20}" y="480" font-family="system-ui, -apple-system, sans-serif" font-size="28" fill="#a1a1aa">verified actions</text>
  ` : `
  <text x="80" y="480" font-family="system-ui, -apple-system, sans-serif" font-size="28" fill="#71717a">Take verified action</text>
  `}
  <!-- Commons branding -->
  <text x="80" y="580" font-family="monospace" font-size="18" fill="#52525b">commons.email</text>
  <!-- Verified badge -->
  <circle cx="1100" cy="80" r="24" fill="#0d9488" opacity="0.2"/>
  <circle cx="1100" cy="80" r="10" fill="#0d9488"/>
</svg>`;

	return new Response(svg, {
		headers: {
			'Content-Type': 'image/svg+xml',
			'Cache-Control': 'public, max-age=3600, s-maxage=3600'
		}
	});
};

function escSvg(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(s: string, max: number): string {
	return s.length > max ? s.slice(0, max - 1) + '\u2026' : s;
}

function wrapText(text: string, maxChars: number): string[] {
	const words = text.split(' ');
	const lines: string[] = [];
	let current = '';

	for (const word of words) {
		if (current.length + word.length + 1 > maxChars) {
			lines.push(current);
			current = word;
			if (lines.length >= 3) {
				// Max 3 lines, truncate remainder
				current = current.slice(0, maxChars - 1) + '\u2026';
				break;
			}
		} else {
			current = current ? current + ' ' + word : word;
		}
	}
	if (current) lines.push(current);
	return lines;
}
