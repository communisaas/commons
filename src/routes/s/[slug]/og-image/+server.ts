import type { RequestHandler } from './$types';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import satori, { type SatoriOptions } from 'satori';
import sharp from 'sharp';

export const GET: RequestHandler = async ({ params }) => {
	try {
		// Fetch template from Convex
		const template = await serverQuery(api.templates.getBySlug, { slug: params.slug });

		if (!template) {
			return new Response('Template not found', { status: 404 });
		}

		const actionCount = template.verified_sends || 0;

		// Domain-aware color selection via keyword matching
		const domainColors: Array<{ keywords: string[]; bg: string; accent: string }> = [
			{ keywords: ['housing', 'zoning', 'affordab'], bg: '#FEF3C7', accent: '#F59E0B' },
			{ keywords: ['climate', 'environment', 'energy', 'park'], bg: '#D1FAE5', accent: '#10B981' },
			{ keywords: ['health', 'medical', 'telehealth'], bg: '#DBEAFE', accent: '#3B82F6' },
			{ keywords: ['labor', 'wage', 'worker', 'retail'], bg: '#FCE7F3', accent: '#EC4899' },
			{ keywords: ['voting', 'election', 'democra'], bg: '#E0E7FF', accent: '#6366F1' },
			{ keywords: ['education', 'school', 'preschool', 'librar'], bg: '#FED7AA', accent: '#EA580C' },
			{ keywords: ['justice', 'criminal', 'police', 'sentenc'], bg: '#E9D5FF', accent: '#A855F7' },
			{ keywords: ['transport', 'parking', 'bike', 'transit', 'highway'], bg: '#FFEDD5', accent: '#EA580C' },
			{ keywords: ['immigra', 'green card', 'visa'], bg: '#E0E7FF', accent: '#6366F1' },
			{ keywords: ['indigenous', 'first nation', 'tribal'], bg: '#FEF3C7', accent: '#B45309' },
		];

		const domainLower = (template.domain || '').toLowerCase();
		const matchedColor = domainColors.find((d) =>
			d.keywords.some((k) => domainLower.includes(k))
		);
		const colors = matchedColor || { bg: '#F1F5F9', accent: '#64748B' };

		// Generate SVG using Satori
		const svg = await satori(
			{
				type: 'div',
				props: {
					style: {
						height: '100%',
						width: '100%',
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'flex-start',
						justifyContent: 'space-between',
						backgroundColor: colors.bg,
						padding: '60px',
						fontFamily: 'sans-serif'
					},
					children: [
						// Category Badge + Social Proof
						{
							type: 'div',
							props: {
								style: { display: 'flex', alignItems: 'center', gap: '12px' },
								children: [
									{
										type: 'div',
										props: {
											style: {
												backgroundColor: colors.accent,
												color: 'white',
												padding: '12px 24px',
												borderRadius: '8px',
												fontSize: '20px',
												fontWeight: 600
											},
											children: template.domain
										}
									},
									...(actionCount > 0
										? [
												{
													type: 'div',
													props: {
														style: {
															backgroundColor: 'white',
															color: '#334155',
															padding: '12px 24px',
															borderRadius: '8px',
															fontSize: '18px',
															display: 'flex',
															alignItems: 'center',
															gap: '8px'
														},
														children: `👥 ${actionCount.toLocaleString()} people took action`
													}
												}
											]
										: [])
								]
							}
						},
						// Template Title + Description
						{
							type: 'div',
							props: {
								style: {
									display: 'flex',
									flexDirection: 'column',
									gap: '20px',
									maxWidth: '900px'
								},
								children: [
									{
										type: 'h1',
										props: {
											style: {
												fontSize: '56px',
												fontWeight: 700,
												lineHeight: '1.2',
												color: '#1E293B',
												margin: 0
											},
											children: template.title
										}
									},
									{
										type: 'p',
										props: {
											style: {
												fontSize: '28px',
												lineHeight: '1.4',
												color: '#475569',
												margin: 0
											},
											children:
												template.description.substring(0, 120) +
												(template.description.length > 120 ? '...' : '')
										}
									}
								]
							}
						},
						// Bottom Bar
						{
							type: 'div',
							props: {
								style: {
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'space-between',
									width: '100%'
								},
								children: [
									// Commons Branding
									{
										type: 'div',
										props: {
											style: { display: 'flex', alignItems: 'center', gap: '12px' },
											children: [
												{
													type: 'div',
													props: {
														style: {
															backgroundColor: '#3B82F6',
															width: '48px',
															height: '48px',
															borderRadius: '12px',
															display: 'flex',
															alignItems: 'center',
															justifyContent: 'center',
															fontSize: '28px'
														},
														children: '📮'
													}
												},
												{
													type: 'div',
													props: {
														style: { fontSize: '32px', fontWeight: 700, color: '#1E293B' },
														children: 'Commons'
													}
												}
											]
										}
									},
									// Social Proof Stats
									...(actionCount > 0
										? [
												{
													type: 'div',
													props: {
														style: {
															display: 'flex',
															alignItems: 'center',
															gap: '8px',
															color: colors.accent,
															fontWeight: 600,
															fontSize: '20px'
														},
														children: '✨ Join the movement'
													}
												}
											]
										: [])
								]
							}
						}
					]
				}
			},
			{
				width: 1200,
				height: 630,
				fonts: []
			} satisfies SatoriOptions
		);

		// Convert SVG to PNG using Sharp
		const png = await sharp(Buffer.from(svg as string)).png().toBuffer();

		return new Response(new Uint8Array(png), {
			headers: {
				'Content-Type': 'image/png',
				'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
			}
		});
	} catch (error) {
		console.error('Error generating OG image:', error);
		return new Response('Error generating image', { status: 500 });
	}
};
