import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const SEGMENTS: Record<string, { headline: string; sub: string }> = {
	'state-legislature': {
		headline: 'For state-level advocacy.',
		sub: 'Verified district reach. Real receipts your committee can verify.'
	},
	'agency-rulemaking': {
		headline: 'For agency rulemaking.',
		sub: 'Verified comment authorship. No bot floods. Standing intact.'
	},
	'local-government': {
		headline: 'For municipal advocacy.',
		sub: 'Verified residents. Ward-level proof your council can trust.'
	}
};

/**
 * Static OG cards for the three /org/for/* segment pages. Each card is keyed
 * by segment slug; unknown slugs 404. 24h edge cache.
 */
export const GET: RequestHandler = ({ params }) => {
	const seg = SEGMENTS[params.segment ?? ''];
	if (!seg) throw error(404, 'Unknown segment');

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#09090b"/>
      <stop offset="100%" stop-color="#18181b"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="1200" height="4" fill="#0d9488"/>
  <text x="80" y="100" font-family="system-ui, -apple-system, sans-serif" font-size="22" fill="#a1a1aa">Commons</text>
  <text x="80" y="240" font-family="system-ui, -apple-system, sans-serif" font-size="52" fill="#f4f4f5" font-weight="700">${escSvg(seg.headline)}</text>
  ${wrapText(seg.sub, 50)
		.map(
			(line, i) =>
				`<text x="80" y="${340 + i * 36}" font-family="system-ui, -apple-system, sans-serif" font-size="26" fill="#a1a1aa">${escSvg(line)}</text>`
		)
		.join('')}
  <text x="80" y="580" font-family="monospace" font-size="18" fill="#52525b">commons.email/org/for/${escSvg(params.segment ?? '')}</text>
  <circle cx="1100" cy="80" r="24" fill="#0d9488" opacity="0.2"/>
  <circle cx="1100" cy="80" r="10" fill="#0d9488"/>
</svg>`;

	return new Response(svg, {
		headers: {
			'Content-Type': 'image/svg+xml',
			'Cache-Control': 'public, max-age=86400, s-maxage=86400'
		}
	});
};

function escSvg(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wrapText(text: string, maxChars: number): string[] {
	const words = text.split(' ');
	const lines: string[] = [];
	let current = '';
	for (const word of words) {
		if (current.length + word.length + 1 > maxChars) {
			lines.push(current);
			current = word;
		} else {
			current = current ? current + ' ' + word : word;
		}
	}
	if (current) lines.push(current);
	return lines.slice(0, 3);
}
