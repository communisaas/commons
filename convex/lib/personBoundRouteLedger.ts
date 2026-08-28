/**
 * Cross-organization admission ledger for institution-designated person-bound
 * email routes. Officeholder, statutory-record, and office-inbox routes bypass
 * this module and write no rows. When a route cannot stay person-bound and no
 * office fallback exists, refusals preserve the policy reason that triggered
 * the degradation so callers can distinguish binding pressure from sender
 * pressure.
 */

import type { MutationCtx } from '../_generated/server';
import { computeGlobalEmailHash } from '../_orgHash';

export const PERSON_BOUND_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const PERSON_BOUND_BINDING_MS = 30 * 24 * 60 * 60 * 1000;

// No subscription plan may raise this ceiling: the recipient is not a party
// to the sender's subscription.
export const PERSON_BOUND_DISTINCT_SENDER_CEILING = 100;

export type PersonBoundTargetClass =
	| 'person_bound'
	| 'officeholder'
	| 'statutory_record'
	| 'office_inbox';

export function isPersonBoundTargetClass(value: unknown): value is 'person_bound' {
	return value === 'person_bound';
}

export type PersonBoundDegradeReason =
	| 'bound_to_other_campaign'
	| 'distinct_sender_ceiling'
	| 'no_office_fallback';

export type PersonBoundRouteDecision =
	| { decision: 'send'; email: string }
	| { decision: 'degraded'; email: string; reason: PersonBoundDegradeReason }
	| { decision: 'refused'; reason: PersonBoundDegradeReason };

export type PersonBoundRouteInput = {
	personEmail: string;
	officeFallbackEmail?: string;
	campaignKey: string;
	senderScope: string;
	now: number;
};

export type PersonBoundRouteRecordInput = PersonBoundRouteInput & {
	decidedEmail: string;
};

export async function personBoundSenderToken(
	targetHash: string,
	senderScope: string
): Promise<string> {
	const bytes = new TextEncoder().encode(`${targetHash}:${senderScope}`);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

function degradedDecision(
	input: PersonBoundRouteInput,
	reason: Exclude<PersonBoundDegradeReason, 'no_office_fallback'>
): PersonBoundRouteDecision {
	const officeEmail = input.officeFallbackEmail?.trim();
	if (officeEmail && officeEmail.toLowerCase() !== input.personEmail.trim().toLowerCase()) {
		return { decision: 'degraded', email: officeEmail, reason };
	}
	return { decision: 'refused', reason };
}

export async function admitPersonBoundRoute(
	ctx: MutationCtx,
	input: PersonBoundRouteInput
): Promise<PersonBoundRouteDecision> {
	const targetHash = await computeGlobalEmailHash(input.personEmail);
	const bindings = await ctx.db
		.query('personBoundRouteBindings')
		.withIndex('by_targetHash', (q) => q.eq('targetHash', targetHash))
		.take(2);
	if (bindings.length > 1) throw new Error('PERSON_BOUND_LEDGER_MULTIPLICITY');

	const binding = bindings[0];
	if (binding && input.now < binding.boundUntil && binding.boundCampaignKey !== input.campaignKey) {
		return degradedDecision(input, 'bound_to_other_campaign');
	}

	const senderToken = await personBoundSenderToken(targetHash, input.senderScope);
	const senderRows = await ctx.db
		.query('personBoundRouteSends')
		.withIndex('by_targetHash_senderToken', (q) =>
			q.eq('targetHash', targetHash).eq('senderToken', senderToken)
		)
		.take(1);
	if (senderRows[0] && input.now < senderRows[0].expiresAt) {
		return { decision: 'send', email: input.personEmail };
	}

	const activeSenders = await ctx.db
		.query('personBoundRouteSends')
		.withIndex('by_targetHash_expiresAt', (q) =>
			q.eq('targetHash', targetHash).gt('expiresAt', input.now)
		)
		.take(PERSON_BOUND_DISTINCT_SENDER_CEILING + 1);
	if (activeSenders.length >= PERSON_BOUND_DISTINCT_SENDER_CEILING) {
		return degradedDecision(input, 'distinct_sender_ceiling');
	}

	return { decision: 'send', email: input.personEmail };
}

export async function recordPersonBoundRoute(
	ctx: MutationCtx,
	input: PersonBoundRouteRecordInput
): Promise<void> {
	const targetHash = await computeGlobalEmailHash(input.personEmail);
	const decidedHash = await computeGlobalEmailHash(input.decidedEmail);
	if (decidedHash !== targetHash) return;

	const bindings = await ctx.db
		.query('personBoundRouteBindings')
		.withIndex('by_targetHash', (q) => q.eq('targetHash', targetHash))
		.take(2);
	if (bindings.length > 1) throw new Error('PERSON_BOUND_LEDGER_MULTIPLICITY');

	const binding = bindings[0];
	const bindingPatch = {
		boundCampaignKey: input.campaignKey,
		boundAt: input.now,
		boundUntil: input.now + PERSON_BOUND_BINDING_MS,
		updatedAt: input.now
	};
	if (!binding) {
		await ctx.db.insert('personBoundRouteBindings', {
			targetHash,
			...bindingPatch
		});
	} else if (binding.boundCampaignKey === input.campaignKey || input.now >= binding.boundUntil) {
		await ctx.db.patch(binding._id, bindingPatch);
	} else {
		return;
	}

	const expiredRows = await ctx.db
		.query('personBoundRouteSends')
		.withIndex('by_targetHash_expiresAt', (q) =>
			q.eq('targetHash', targetHash).lte('expiresAt', input.now)
		)
		.take(PERSON_BOUND_DISTINCT_SENDER_CEILING + 1);
	for (const expired of expiredRows) await ctx.db.delete(expired._id);

	const senderToken = await personBoundSenderToken(targetHash, input.senderScope);
	const senderRows = await ctx.db
		.query('personBoundRouteSends')
		.withIndex('by_targetHash_senderToken', (q) =>
			q.eq('targetHash', targetHash).eq('senderToken', senderToken)
		)
		.take(1);
	const senderPatch = {
		campaignKey: input.campaignKey,
		firstSeenAt: input.now,
		expiresAt: input.now + PERSON_BOUND_WINDOW_MS
	};
	if (senderRows[0]) {
		await ctx.db.patch(senderRows[0]._id, senderPatch);
	} else {
		await ctx.db.insert('personBoundRouteSends', {
			targetHash,
			senderToken,
			...senderPatch
		});
	}
}
