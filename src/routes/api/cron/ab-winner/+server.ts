/**
 * Cron endpoint: check pending A/B tests and pick winners.
 * Configured to run every 15 minutes via wrangler.toml cron trigger.
 * Protected by CRON_SECRET header.
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { db } from '$lib/core/db';
import { pickAbWinner, sendWinnerBlast, type AbTestConfig } from '$lib/server/email/ab-winner';

export const GET: RequestHandler = async ({ request }) => {
	// Fail-closed: require CRON_SECRET to be configured
	const secret = env.CRON_SECRET;
	if (!secret) {
		return json({ error: 'CRON_SECRET not configured' }, { status: 500 });
	}
	if (request.headers.get('x-cron-secret') !== secret) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	// Find A/B tests where both variants have been sent but no winner picked yet
	const pendingTests = await db.emailBlast.findMany({
		where: {
			isAbTest: true,
			abVariant: 'A',
			abWinnerPickedAt: null,
			status: 'sent',
			sentAt: { not: null }
		},
		select: {
			id: true,
			abParentId: true,
			abTestConfig: true,
			sentAt: true
		}
	});

	let picked = 0;

	for (const blast of pendingTests) {
		if (!blast.abParentId || !blast.sentAt) continue;

		const config = blast.abTestConfig as unknown as AbTestConfig;
		if (!config?.testDurationMs) continue;

		const elapsed = Date.now() - blast.sentAt.getTime();
		if (elapsed < config.testDurationMs) continue;

		// Verify variant B is also sent
		const variantB = await db.emailBlast.findFirst({
			where: {
				abParentId: blast.abParentId,
				abVariant: 'B',
				status: 'sent'
			}
		});
		if (!variantB) continue;

		try {
			const winner = await pickAbWinner(blast.abParentId);
			await sendWinnerBlast(blast.abParentId, winner);
			picked++;
			console.log(`[ab-winner] Picked winner ${winner} for test ${blast.abParentId}`);
		} catch (err) {
			console.error(`[ab-winner] Failed to pick winner for ${blast.abParentId}:`, err);
		}
	}

	return json({ ok: true, checked: pendingTests.length, picked });
};
