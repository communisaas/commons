// CONVEX: Keep SvelteKit — blockchain ZK proof submission (handleSubmission),
// billing plan gate (getUserOrgPlan), nullifier uniqueness, CWC delivery pipeline.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	handleSubmission,
	type SubmissionRequest
} from '$lib/core/legislative/submission';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

/**
 * Legislative Submit Endpoint
 *
 * Accepts ZK proofs from browser and submits them to the blockchain for verification.
 * After verification succeeds, delivers the message to CWC (wired in submission handler).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!FEATURES.CONGRESSIONAL) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const session = locals.session;
	if (!session?.userId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const body = (await request.json()) as SubmissionRequest & {
			encryptedWitness?: string;
			witnessNonce?: string;
			ephemeralPublicKey?: string;
			teeKeyId?: string;
		};

		// Validate request structure
		if (!body.proof || !body.publicInputs || !body.templateId) {
			return json({ error: 'Missing required fields' }, { status: 400 });
		}

		if (!Array.isArray(body.publicInputs) || body.publicInputs.length !== 31) {
			return json(
				{ error: 'publicInputs must be array of 31 elements (three-tree circuit public outputs)' },
				{ status: 400 }
			);
		}

		if (!body.verifierDepth || ![18, 20, 22, 24].includes(body.verifierDepth)) {
			return json(
				{ error: 'verifierDepth must be 18, 20, 22, or 24' },
				{ status: 400 }
			);
		}

		if (!body.districtId || !/^[A-Z]{2}(-\d{1,2})?$/.test(body.districtId)) {
			return json(
				{ error: 'districtId must be a valid district (e.g., "CA-12" or "CA")' },
				{ status: 400 }
			);
		}

		// Billing gate: requires Starter plan or above
		const orgPlan = await serverQuery(api.organizations.getUserOrgPlan, {});

		if (!orgPlan) {
			return json(
				{ error: 'Legislative delivery requires an organization membership.' },
				{ status: 403 }
			);
		}

		if (orgPlan.plan === 'free') {
			return json(
				{ error: 'Legislative delivery requires a Starter plan or above.' },
				{ status: 403 }
			);
		}

		const result = await handleSubmission(session.userId, body);

		return json({
			success: true,
			data: {
				submissionId: result.submissionId,
				status: result.status,
				nullifier: result.nullifier
			}
		});
	} catch (error) {
		if (error instanceof Error && error.message === 'NULLIFIER_ALREADY_USED') {
			return json({ error: 'This proof has already been submitted' }, { status: 409 });
		}
		console.error('[LegislativeSubmit] Submission error:', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
