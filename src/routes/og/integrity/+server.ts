import type { RequestHandler } from './$types';

/**
 * Static OG card for /about/integrity. Renders the five integrity-score
 * acronyms (GDS, ADS, IDS, TMS, ODS) as a methodology preview. 24h cache.
 */
export const GET: RequestHandler = () => {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#09090b"/>
      <stop offset="100%" stop-color="#18181b"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="1200" height="4" fill="#0d9488"/>
  <text x="80" y="100" font-family="system-ui, -apple-system, sans-serif" font-size="22" fill="#a1a1aa">Methodology</text>
  <text x="80" y="200" font-family="system-ui, -apple-system, sans-serif" font-size="56" fill="#f4f4f5" font-weight="700">Coordination Integrity</text>
  <text x="80" y="260" font-family="system-ui, -apple-system, sans-serif" font-size="56" fill="#f4f4f5" font-weight="700">Scores</text>
  <text x="80" y="360" font-family="monospace" font-size="22" fill="#34d399">GDS · ADS · IDS · TMS · ODS</text>
  <text x="80" y="430" font-family="system-ui, -apple-system, sans-serif" font-size="22" fill="#a1a1aa">Five metrics. Real campaign data. No self-report.</text>
  <text x="80" y="580" font-family="monospace" font-size="18" fill="#52525b">commons.email/about/integrity</text>
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
