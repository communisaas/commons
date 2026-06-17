import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import type { CongressionalDeliveryGroundData } from '$lib/components/org/os/spaces';
import { congressionalDeliveryAvailable } from '$lib/congressional-readiness';

function requireRole(role: string, required: string): void {
	const hierarchy = ['viewer', 'member', 'editor', 'owner'];
	if (hierarchy.indexOf(role) < hierarchy.indexOf(required)) {
		throw new Error(`Role '${required}' required, got '${role}'`);
	}
}

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function buildCongressionalDeliveryGround(
	result: unknown
): CongressionalDeliveryGroundData | null {
	if (!result || typeof result !== 'object') return null;
	const runtime = result as Record<string, unknown>;
	return {
		runtimeReady: runtime.ready === true,
		runtimeMissing: Array.isArray(runtime.missing)
			? runtime.missing.filter((item): item is string => typeof item === 'string')
			: [],
		runtimeDependency: asString(
			runtime.dependency,
			'congressional launch flag + House CWC proxy env + Senate CWC API env + per-submission proof/template checks'
		),
		runtimeMessage: asString(
			runtime.message,
			'Congressional delivery runtime posture is unread.'
		),
		launched: runtime.launched === true,
		houseTransportConfigured: runtime.houseTransportConfigured === true,
		senateTransportConfigured: runtime.senateTransportConfigured === true
	};
}

export const load: PageServerLoad = async ({ parent, url, params }) => {
	const { membership } = await parent();
	requireRole(membership.role, 'editor');

	const fromAlertId = url.searchParams.get('fromAlert');
	const requestedType = url.searchParams.get('type');

	const [templates, alertPrefill, congressionalDeliveryResult] = await Promise.all([
		serverQuery(api.templates.listByOrg, { slug: params.slug }),
		fromAlertId
			? serverQuery(api.legislation.getAlertWithBill, {
				slug: params.slug,
				alertId: fromAlertId as Id<'legislativeAlerts'>
			}).catch(() => null)
			: Promise.resolve(null),
		serverQuery(api.submissions.getCongressionalDeliveryReadiness, {}).catch(() => null)
	]);

	// Whether to OFFER the congressional type — runtime-readiness driven (one SSOT,
	// shared with Studio), not the compile-time flag. B1 arming delivery flips this.
	const congressionalAuthoringEnabled = congressionalDeliveryAvailable(
		congressionalDeliveryResult as { launched?: boolean; ready?: boolean } | null
	);
	// Type preselection from a handoff (e.g. Studio "Send to Congress"); only
	// honored when congressional is actually offered, else falls back to default.
	const initialType =
		requestedType === 'CONGRESSIONAL' && congressionalAuthoringEnabled ? 'CONGRESSIONAL' : 'LETTER';

	return {
		templates: templates.map((t: { _id: string; title: string }) => ({
			id: t._id,
			title: t.title
		})),
		alertPrefill,
		congressionalDelivery: buildCongressionalDeliveryGround(congressionalDeliveryResult),
		congressionalAuthoringEnabled,
		initialType
	};
};

export const actions: Actions = {
	default: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/campaigns/new`);
		}
		const ctx = await serverQuery(api.organizations.getOrgContext, { slug: params.slug });
		requireRole(ctx.membership.role, 'editor');

		const formData = await request.formData();
		const title = formData.get('title')?.toString().trim();
		const type = formData.get('type')?.toString();
		const body = formData.get('body')?.toString().trim() || null;
		const templateId = formData.get('templateId')?.toString() || null;
		const debateEnabled = formData.get('debateEnabled') === 'on';
		const debateThresholdRaw = formData.get('debateThreshold')?.toString();
		const debateThreshold = debateThresholdRaw ? parseInt(debateThresholdRaw, 10) : 50;
		const targetCountry = formData.get('targetCountry')?.toString()?.toUpperCase() || 'US';
		const targetJurisdiction = formData.get('targetJurisdiction')?.toString() || null;
		const billId = formData.get('billId')?.toString() || null;
		const position = formData.get('position')?.toString() || null;
		const fromAlertId = formData.get('fromAlertId')?.toString() || null;

		if (!title) {
			return fail(400, { error: 'Title is required', title, type, body, targetCountry, targetJurisdiction });
		}

		// CONGRESSIONAL is accepted only when delivery readiness offers it — the
		// same runtime-readiness SSOT the reveal uses (not a static flag), so a
		// hand-crafted POST can't author a congressional campaign the UI doesn't
		// offer. The CWC delivery gate is enforced independently at send time.
		const readiness = await serverQuery(api.submissions.getCongressionalDeliveryReadiness, {}).catch(
			() => null
		);
		const allowedTypes = congressionalDeliveryAvailable(
			readiness as { launched?: boolean; ready?: boolean } | null
		)
			? ['LETTER', 'EVENT', 'FORM', 'CONGRESSIONAL']
			: ['LETTER', 'EVENT', 'FORM'];
		if (!type || !allowedTypes.includes(type)) {
			return fail(400, { error: 'Invalid campaign type', title, type, body, targetCountry, targetJurisdiction });
		}

		// Parity with /api/org/[slug]/campaigns POST — bound the same caller-supplied
		// fields at this form-action boundary so `campaigns.create` never sees
		// outsized writes from either path.
		if (title.length > 200) {
			return fail(400, { error: 'Title must be 200 characters or fewer', title, type, body, targetCountry, targetJurisdiction });
		}
		if (body && body.length > 10_000) {
			return fail(400, { error: 'Body must be 10,000 characters or fewer', title, type, body, targetCountry, targetJurisdiction });
		}
		if (templateId && templateId.length > 64) {
			return fail(400, { error: 'Invalid templateId', title, type, body, targetCountry, targetJurisdiction });
		}
		if (targetJurisdiction && targetJurisdiction.length > 64) {
			return fail(400, { error: 'targetJurisdiction must be 64 characters or fewer', title, type, body, targetCountry, targetJurisdiction });
		}
		if (targetCountry.length > 8) {
			return fail(400, { error: 'targetCountry must be 8 characters or fewer', title, type, body, targetCountry, targetJurisdiction });
		}

		if (debateEnabled && (isNaN(debateThreshold) || debateThreshold < 1 || debateThreshold > 1_000_000)) {
			return fail(400, { error: 'Debate threshold must be 1 to 1,000,000', title, type, body, targetCountry, targetJurisdiction });
		}

		if (billId && !position) {
			return fail(400, { error: 'Position (support/oppose) is required when linking to a bill', title, type, body, targetCountry, targetJurisdiction });
		}
		if (position && !['support', 'oppose'].includes(position)) {
			return fail(400, { error: 'Position must be "support" or "oppose"', title, type, body, targetCountry, targetJurisdiction });
		}

		const campaignId = await serverMutation(api.campaigns.create, {
			slug: params.slug,
			title,
			// type was validated above against the flag-scoped allowlist; cast at
			// the boundary to match the Convex args union.
			type: type as 'LETTER' | 'EVENT' | 'FORM' | 'FUNDRAISER' | 'CONGRESSIONAL',
			body: body ?? undefined,
			// Form-data string cast at API boundary; Convex args validator
			// (now v.id('templates')) rejects malformed Ids.
			templateId: templateId ? (templateId as Id<'templates'>) : undefined,
			debateEnabled,
			debateThreshold,
			targetCountry,
			targetJurisdiction: targetJurisdiction ?? undefined,
			billId: (billId ?? undefined) as Id<'bills'> | undefined,
			position: position ?? undefined
		});

		// Mark alert as acted upon if applicable
		if (fromAlertId) {
			await serverMutation(api.legislation.dismissAlert, {
				slug: params.slug,
				alertId: fromAlertId as Id<'legislativeAlerts'>
			}).catch(() => {});
		}

		throw redirect(303, `/org/${params.slug}/campaigns/${campaignId}`);
	}
};
