// CONVEX: Keep SvelteKit — Twilio external service integration
/**
 * POST /api/org/[slug]/calls — Initiate patch-through call
 * GET  /api/org/[slug]/calls — List calls
 */

import { json, error } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import { FEATURES } from '$lib/config/features';
import { orgLimitSentence } from '$lib/data/org-limit-sentences';
import { getCallInitiationReadiness } from '$lib/server/calls/call-initiation-readiness';
import { initiatePatchThroughCall } from '$lib/server/sms/twilio';
import type { RequestHandler } from './$types';

function callInitiationEnv() {
	return {
		TWILIO_ACCOUNT_SID: privateEnv.TWILIO_ACCOUNT_SID,
		TWILIO_AUTH_TOKEN: privateEnv.TWILIO_AUTH_TOKEN,
		TWILIO_PHONE_NUMBER: privateEnv.TWILIO_PHONE_NUMBER
	};
}

function callInitiationBoundary(
	readiness: ReturnType<typeof getCallInitiationReadiness>,
	status = 424
) {
	return json(
		{
			error: 'call_initiation_not_armed',
			message: orgLimitSentence('call_initiation_not_armed'),
			blockedVerb: 'patch_through_call',
			preservedArtifact: 'call_record_not_created',
			dependency: readiness.dependency,
			missing: readiness.missing,
			runtimeFlag: readiness.runtimeFlag,
			scope: readiness.scope,
			surfaceMounted: readiness.surfaceMounted,
			proxyImplemented: readiness.proxyImplemented,
			runtimeMessage: readiness.message
		},
		{ status }
	);
}

export const POST: RequestHandler = async ({ params, request, locals, url }) => {
	if (!FEATURES.SMS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const { supporterId, targetPhone, targetName, campaignId, districtHash } = body;

	// Validate required fields
	if (!supporterId || typeof supporterId !== 'string') {
		throw error(400, 'supporterId is required');
	}
	if (!targetPhone || typeof targetPhone !== 'string') {
		throw error(400, 'targetPhone is required');
	}
	if (!/^\+\d{10,15}$/.test(targetPhone)) throw error(400, 'Invalid phone number format');
	if (targetName && (typeof targetName !== 'string' || targetName.length > 200)) {
		throw error(400, 'Invalid target name');
	}

	// Validate campaignId belongs to this org
	if (campaignId) {
		const campaign = await serverQuery(api.calls.validateCampaign, {
			slug: params.slug,
			campaignId: campaignId as Id<'campaigns'>
		});
		if (!campaign) {
			return json({ error: 'Campaign not found in this organization' }, { status: 400 });
		}
	}

	// Look up supporter and verify they belong to this org
	const supporter = await serverQuery(api.calls.validateSupporter, {
		slug: params.slug,
		supporterId: supporterId as Id<'supporters'>
	});
	if (!supporter) throw error(404, 'Supporter not found');
	if (!supporter.encryptedPhone) throw error(400, 'Supporter does not have a phone number on file');

	// Client must decrypt supporter phone with org key and pass it in the body
	const callerPhone = (body as Record<string, unknown>).callerPhone as string | undefined;
	if (!callerPhone) {
		return callInitiationBoundary(
			getCallInitiationReadiness(callInitiationEnv(), {
				featureEnabled: FEATURES.SMS,
				canManageCalls: true,
				scope: 'api_request',
				supporterPhonePresent: Boolean(supporter.encryptedPhone),
				callerPhoneProvided: false
			}),
			400
		);
	}
	// callerPhone format check (parity with targetPhone regex above).
	if (typeof callerPhone !== 'string' || !/^\+\d{10,15}$/.test(callerPhone)) {
		throw error(400, 'Invalid callerPhone format (E.164 required)');
	}
	// districtHash is SHA-256 hex (64 chars) optionally with 0x prefix.
	if (districtHash !== undefined && (typeof districtHash !== 'string' || districtHash.length > 128)) {
		throw error(400, 'Invalid districtHash format');
	}

	const callReadiness = getCallInitiationReadiness(callInitiationEnv(), {
		featureEnabled: FEATURES.SMS,
		canManageCalls: true,
		scope: 'api_request',
		supporterPhonePresent: Boolean(supporter.encryptedPhone),
		callerPhoneProvided: true
	});
	if (!callReadiness.ready) return callInitiationBoundary(callReadiness);

	// Create call record
	const callResult = await serverMutation(api.calls.createCall, {
		slug: params.slug,
		supporterId: supporterId as Id<'supporters'>,
		callerPhone,
		targetPhone,
		targetName: targetName || undefined,
		campaignId: campaignId ? (campaignId as Id<'campaigns'>) : undefined,
		districtHash: districtHash || undefined
	});

	// Initiate the call via Twilio
	const callbackUrl = `${url.origin}/api/sms/call-status`;
	const result = await initiatePatchThroughCall(
		callerPhone,
		targetPhone,
		callbackUrl,
		targetName
	);

	if (result.success) {
		const updated = await serverMutation(api.calls.updateCallSid, {
			slug: params.slug,
			callId: callResult._id,
			twilioCallSid: result.callSid!
		});

		return json(
			{
				id: callResult._id,
				supporterId,
				targetPhone,
				targetName: targetName || null,
				status: 'initiated',
				twilioCallSid: result.callSid,
				createdAt: new Date().toISOString()
			},
			{ status: 201 }
		);
	} else {
		await serverMutation(api.calls.updateCallStatus, {
			slug: params.slug,
			callId: callResult._id,
			status: 'failed'
		});

		throw error(502, `Failed to initiate call: ${result.error}`);
	}
};

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!FEATURES.SMS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 100);
	const statusFilter = url.searchParams.get('status') || undefined;
	const campaignIdFilter = url.searchParams.get('campaignId') || undefined;

	const result = await serverQuery(api.calls.listCallsPaginated, {
		slug: params.slug,
		limit,
		statusFilter,
		campaignIdFilter
	});

	return json({
		data: result.data.map((c) => ({
			id: c._id,
			encryptedTargetPhone: c.encryptedTargetPhone,
			targetName: c.targetName,
			status: c.status,
			duration: c.duration,
			campaignId: c.campaignId,
			supporter: c.supporter
				? { id: c.supporter._id, encryptedName: c.supporter.encryptedName }
				: null,
			createdAt: new Date(c._creationTime).toISOString(),
			updatedAt: new Date(c.updatedAt).toISOString()
		})),
		meta: { hasMore: result.hasMore }
	});
};
