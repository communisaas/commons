// CONVEX: Keep SvelteKit — server-only OG image generation (satori+sharp), template DB lookup
import type { RequestHandler } from './$types';
import { prisma } from '$lib/core/db';
import satori, { type SatoriOptions } from 'satori';
import sharp from 'sharp';

export const GET: RequestHandler = async ({ params }) => {
	try {
		// Fetch template with metrics
		const template = await prisma.template.findFirst({
			where: { slug: params.slug, is_public: true },
			select: {
				title: true,
				description: true,
				category: true,
				verified_sends: true,
				metrics: true
			}
		});

		if (!template) {
			return new Response('Template not found', { status: 404 });
		}

		// Extract metrics from JSON field
		const metrics = typeof template.metrics === 'object' && template.metrics !== null
			? (template.metrics as Record<string, unknown>)
			: {};
		const actionCount = template.verified_sends || (metrics.sent as number) || 0;

		// Category-specific colors
		const categoryColors: Record<string, { bg: string; accent: string }> = {
			Housing: { bg: '#FEF3C7', accent: '#F59E0B' },
			Climate: { bg: '#D1FAE5', accent: '#10B981' },
			Healthcare: { bg: '#DBEAFE', accent: '#3B82F6' },
			Labor: { bg: '#FCE7F3', accent: '#EC4899' },
			Voting: { bg: '#E0E7FF', accent: '#6366F1' },
			Education: { bg: '#FED7AA', accent: '#EA580C' },
			Justice: { bg: '#E9D5FF', accent: '#A855F7' }
		};

		const colors = categoryColors[template.category] || {
			bg: '#F1F5F9',
			accent: '#64748B'
		};

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
											children: template.category
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
