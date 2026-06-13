import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { computeVerificationPacketCached } from '$lib/server/verification-packet';
import { renderReport } from '$lib/server/email/report-template';
import type { Id } from '$convex/_generated/dataModel';
import type { RequestHandler } from './$types';

const baseUrl = env.PUBLIC_BASE_URL?.replace(/\/$/, '') ?? 'https://commons.email';

// Returns the report's rendered HTML as a full standalone page so a staffer
// can browser-print to PDF (`File > Save as PDF`) directly. The HTML is
// identical to the email body delivered to recipients — same canonical
// preimage, same attestation hash, same dimensional evidence.
export const GET: RequestHandler = async ({ params, locals, platform, request }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const ctx = await serverQuery(api.organizations.getOrgContext, { slug: params.slug });
	if (!ctx?.org) {
		throw error(404, 'Organization not found');
	}

	const preview = await serverQuery(api.campaigns.getReportPreview, {
		campaignId: params.id as Id<'campaigns'>,
		orgSlug: params.slug
	});
	if (!preview) {
		throw error(404, 'Campaign not found');
	}

	const packetKV = (
		platform as { env?: Record<string, unknown> } | undefined
	)?.env?.PACKET_CACHE_KV as
		| { get(key: string): Promise<string | null>; put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> }
		| undefined;
	const packet = await computeVerificationPacketCached(
		preview.campaign._id,
		ctx.org._id,
		packetKV
	);

	const rendered = await renderReport({
		campaignId: String(preview.campaign._id),
		campaignTitle: preview.campaign.title,
		orgName: ctx.org.name ?? params.slug,
		packet,
		verificationUrl: `${baseUrl}/v/${preview.campaign._id}`,
		// D-09: same org branding as the email body so the print/PDF matches.
		branding: { accent: ctx.org.brandingAccent ?? null, logoUrl: ctx.org.logoUrl ?? null }
	});

	// `Content-Disposition: inline` so the browser opens the page directly;
	// the staffer uses File → Print → Save as PDF. `?download=1` toggles to
	// `attachment` for direct file download.
	const disposition = new URL(request.url).searchParams.get('download')
		? 'attachment'
		: 'inline';
	const safeFilename = preview.campaign.title
		.replace(/[^A-Za-z0-9._-]/g, '_')
		.slice(0, 80);

	return new Response(rendered.html, {
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Content-Disposition': `${disposition}; filename="report-${safeFilename}.html"`,
			'Cache-Control': 'private, no-store',
			// X-Attestation-Hash exposes the hash a recipient could verify
			// against REPORT-ATTESTATION-SPEC v1 — chain-of-custody for the
			// PDF a staffer files away.
			'X-Attestation-Hash': rendered.attestationHash
		}
	});
};
