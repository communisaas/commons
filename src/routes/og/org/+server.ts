import type { RequestHandler } from './$types';

/**
 * Static OG card for the /org landing page. 1200×630 SVG, cached at the edge
 * for 24h (s-maxage=86400) — content is brand-only, no per-org data.
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
  <text x="80" y="100" font-family="system-ui, -apple-system, sans-serif" font-size="24" fill="#a1a1aa">Commons for Organizations</text>
  <text x="80" y="220" font-family="system-ui, -apple-system, sans-serif" font-size="56" fill="#f4f4f5" font-weight="700">Verified civic action.</text>
  <text x="80" y="290" font-family="system-ui, -apple-system, sans-serif" font-size="56" fill="#f4f4f5" font-weight="700">Receipts that hold up.</text>
  <text x="80" y="430" font-family="system-ui, -apple-system, sans-serif" font-size="22" fill="#a1a1aa">Any cause. Any country. Any level of government.</text>
  <text x="80" y="580" font-family="monospace" font-size="18" fill="#52525b">commons.email/org</text>
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
