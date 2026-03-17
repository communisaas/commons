/**
 * Workflow action processors.
 * Each function handles a specific step type.
 */

import { db } from '$lib/core/db';
import { sendEmail } from '$lib/server/email/ses';
import { getOrgUsage, isOverLimit } from '$lib/server/billing/usage';
import { dispatchTrigger } from './trigger';
import { env } from '$env/dynamic/private';
import type { EmailStep, TagStep, ConditionStep } from './types';

/**
 * Send an email to the supporter.
 * Checks billing usage limits before sending.
 */
export async function processEmailAction(
	supporterId: string | null,
	step: EmailStep
): Promise<{ success: boolean; messageId?: string; error?: string }> {
	if (!supporterId) return { success: false, error: 'No supporter for email action' };

	const supporter = await db.supporter.findUnique({
		where: { id: supporterId },
		select: { email: true, name: true, emailStatus: true, orgId: true }
	});

	if (!supporter) return { success: false, error: 'Supporter not found' };
	if (supporter.emailStatus !== 'subscribed') {
		return { success: false, error: `Supporter email status: ${supporter.emailStatus}` };
	}

	// Billing usage check
	const usage = await getOrgUsage(supporter.orgId);
	if (isOverLimit(usage).emails) {
		return { success: false, error: 'Email send limit reached for billing period' };
	}

	const fromEmail = env.EMAIL_FROM || 'noreply@commons.app';
	const fromName = env.EMAIL_FROM_NAME || 'Commons';

	const result = await sendEmail(
		supporter.email,
		fromEmail,
		fromName,
		step.emailSubject,
		step.emailBody
	);

	return result;
}

/**
 * Add or remove a tag from the supporter.
 * @param fromAutomation — if true, suppresses tag_added trigger dispatch to prevent infinite recursion
 */
export async function processTagAction(
	supporterId: string | null,
	step: TagStep,
	fromAutomation?: boolean
): Promise<{ success: boolean; error?: string }> {
	if (!supporterId) return { success: false, error: 'No supporter for tag action' };

	const supporter = await db.supporter.findUnique({
		where: { id: supporterId },
		select: { id: true, orgId: true }
	});

	if (!supporter) return { success: false, error: 'Supporter not found' };

	// Verify tag exists and belongs to same org
	const tag = await db.tag.findUnique({ where: { id: step.tagId } });
	if (!tag || tag.orgId !== supporter.orgId) {
		return { success: false, error: 'Tag not found or wrong org' };
	}

	if (step.type === 'add_tag') {
		await db.supporterTag.upsert({
			where: {
				supporterId_tagId: { supporterId: supporter.id, tagId: step.tagId }
			},
			create: { supporterId: supporter.id, tagId: step.tagId },
			update: {}
		});

		// Fire-and-forget: dispatch tag_added trigger (only from non-automation callers)
		if (!fromAutomation) {
			void dispatchTrigger(supporter.orgId, 'tag_added', {
				entityId: step.tagId,
				supporterId: supporter.id,
				metadata: { tagId: step.tagId }
			});
		}
	} else {
		await db.supporterTag.deleteMany({
			where: { supporterId: supporter.id, tagId: step.tagId }
		});
	}

	return { success: true };
}

/**
 * Evaluate a condition and return the next step index.
 */
export async function processConditionAction(
	supporterId: string | null,
	step: ConditionStep
): Promise<{ success: boolean; nextStep: number; conditionResult?: boolean; error?: string }> {
	if (!supporterId) {
		return { success: true, nextStep: step.elseStepIndex, conditionResult: false };
	}

	const supporter = await db.supporter.findUnique({
		where: { id: supporterId },
		include: { tags: { include: { tag: true } } }
	});

	if (!supporter) {
		return { success: true, nextStep: step.elseStepIndex, conditionResult: false };
	}

	let conditionMet = false;

	switch (step.field) {
		case 'verified':
			conditionMet = evaluateCondition(supporter.verified, step.operator, step.value);
			break;
		case 'engagementTier': {
			const latestAction = await db.campaignAction.findFirst({
				where: { supporterId },
				orderBy: { createdAt: 'desc' },
				select: { engagementTier: true }
			});
			const tier = latestAction?.engagementTier ?? 0;
			conditionMet = evaluateCondition(tier, step.operator, step.value);
			break;
		}
		case 'hasTag': {
			const hasTag = supporter.tags.some((t) => t.tagId === String(step.value));
			conditionMet = step.operator === 'exists' ? hasTag : !hasTag;
			break;
		}
	}

	return {
		success: true,
		nextStep: conditionMet ? step.thenStepIndex : step.elseStepIndex,
		conditionResult: conditionMet
	};
}

function evaluateCondition(actual: unknown, operator: string, expected: unknown): boolean {
	switch (operator) {
		case 'eq':
			return actual === expected;
		case 'gte':
			return Number(actual) >= Number(expected);
		case 'lte':
			return Number(actual) <= Number(expected);
		case 'exists':
			return actual != null && actual !== false && actual !== '';
		default:
			return false;
	}
}
