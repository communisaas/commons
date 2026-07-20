import {
	query,
	mutation,
	internalMutation,
	internalQuery,
	internalAction
} from './_generated/server';
import { internal } from './_generated/api';
import { makeFunctionReference, type FunctionReference } from 'convex/server';
import { v } from 'convex/values';
import { requireOrgRole } from './_authHelpers';
import type { Id } from './_generated/dataModel';
import {
	pageFilteredRecipients,
	RECIPIENT_COHORT_CAP,
	RECIPIENT_SCAN_CAP,
	RECIPIENT_SCAN_PAGE,
	type EmailRecipientFilter as SharedEmailRecipientFilter
} from './_emailRecipientFilter';
import { normalizeEmailAudienceFilter } from './_audienceFilters';
import {
	AUDIENCE_DISPATCH_JOBS_READY,
	requireAudienceDispatchJobsReady
} from './lib/audienceDispatchGate';
import {
	assertEmailReservationPartition,
	blockEmailReservation,
	EMAIL_RESERVATION_LEASE_MS,
	reconcileEmailReservation,
	renewEmailReservationLease,
	reserveEmailUsage
} from './lib/planUsageReservations';
import { readContactAuthorityEpoch } from './lib/contactAuthority';
import { syncEmailAbWinnerCandidate } from './lib/emailAbWinnerCandidate';

const enqueuePlanUsageRepairRef = makeFunctionReference<'mutation'>(
	'planUsage:enqueueForOrg'
) as unknown as FunctionReference<'mutation', 'internal', { orgId: Id<'organizations'> }, unknown>;

declare const process: { env: Record<string, string | undefined> };
type EncryptedSupporterForBlast = {
	_id: Id<'supporters'>;
	encryptedEmail: string;
	emailHash: string;
	encryptedName?: string;
	postalCode?: string;
	verified?: boolean;
};

const BLAST_RECOVERY_BATCH = 25;

function recoveryBatchLimit(value: number | undefined): number {
	const requested = value ?? BLAST_RECOVERY_BATCH;
	if (!Number.isSafeInteger(requested) || requested < 1) {
		throw new Error('BLAST_RECOVERY_LIMIT_INVALID');
	}
	return Math.min(requested, BLAST_RECOVERY_BATCH);
}

type EmailRecipientFilter = SharedEmailRecipientFilter;

function readSafeEmailRecipientFilter(raw: unknown): EmailRecipientFilter {
	return normalizeEmailAudienceFilter(raw);
}

// =============================================================================
// TEE-SEALED BLAST ORCHESTRATION
//
// For large (500+) or scheduled email blasts where the admin won't be online
// at send time. The admin seals the org decryption key to the TEE's KMS
// public key; the Nitro Enclave unseals it, decrypts supporter emails,
// sends via SES, and purges the key.
// =============================================================================

/**
 * Seal and schedule a blast for TEE-mediated send.
 * Called by the admin's browser after encrypting the org key to the TEE's KMS public key.
 */
export const sealAndScheduleBlast = mutation({
	args: {
		blastId: v.id('emailBlasts'),
		orgSlug: v.string(),
		sealedOrgKey: v.string(),
		scheduledAt: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');
		requireAudienceDispatchJobsReady();

		const blast = await ctx.db.get(args.blastId);
		if (!blast || blast.orgId !== org._id) {
			throw new Error('Blast not found');
		}

		if (blast.status !== 'draft') {
			throw new Error('Can only schedule draft blasts');
		}

		await ctx.db.patch(args.blastId, {
			sealedOrgKey: args.sealedOrgKey,
			scheduledAt: args.scheduledAt ?? Date.now(),
			sendMode: 'tee-sealed',
			status: 'scheduled',
			updatedAt: Date.now()
		});

		// If no scheduledAt (immediate send), trigger the enclave now.
		//
		// Claim BEFORE scheduling so the cron path can't race us. Without
		// this, cron's `getReadyBlasts` would also see this row
		// (status=scheduled, scheduledAt<=now), win its own
		// `claimForBlastDispatch`, fire its own triggerEnclaveSend, and
		// both POSTs would reach the enclave → double SES blast. Atomic
		// claim here transitions status=scheduled→sending so the cron's
		// filter (only "scheduled" rows) excludes this row. The
		// `triggerEnclaveSend` gate also requires status === "sending" —
		// belt-and-suspenders.
		if (!args.scheduledAt) {
			const claim: { ok: boolean; reason?: string } = await ctx.runMutation(
				internal.blasts.claimForBlastDispatch,
				{ blastId: args.blastId }
			);
			if (!claim.ok) {
				if (claim.reason) throw new Error(claim.reason);
				// Defensive: another cron tick won the race (extremely unlikely
				// within the same mutation transaction, but covers the edge
				// where claim was already taken before this branch ran).
				return;
			}
			await ctx.scheduler.runAfter(0, internal.blasts.triggerEnclaveSend, {
				blastId: args.blastId
			});
		} else {
			// Future-scheduled: fire EXACTLY at the due time via Convex's native
			// scheduler instead of relying on a minute-cadence poll. `runAt`
			// persists across this mutation's commit, so once the transaction
			// succeeds the dispatch is durably enqueued for `scheduledAt`.
			//
			// `dispatchScheduledBlast` claims via `claimForBlastDispatch`
			// (CAS scheduled→sending) before triggering the enclave, so this
			// native firing and the wide-cadence `process-scheduled-blasts`
			// safety-net sweep can never double-dispatch — whichever wins the
			// claim sends; the loser is an idempotent no-op. The safety net
			// only matters for the rare scheduler-restart orphan (a `runAt`
			// job lost to a Convex-scheduler restart), mirroring the
			// reschedule-stuck-revocations pattern.
			//
			// If the operator later cancels the blast, the `runAt` job still
			// fires but `claimForBlastDispatch` requires status==='scheduled',
			// so a cancelled/sent/draft blast is a no-op — no cleanup of the
			// scheduled job is needed.
			await ctx.scheduler.runAt(args.scheduledAt, internal.blasts.dispatchScheduledBlast, {
				blastId: args.blastId
			});
		}
	}
});

/**
 * Native due-time entry point for a future-scheduled TEE-sealed blast.
 *
 * Enqueued by `sealAndScheduleBlast` via `ctx.scheduler.runAt(scheduledAt, …)`
 * so the blast fires the instant it's due rather than waiting for the next
 * wide-cadence sweep. Idempotent: `claimForBlastDispatch` is an atomic CAS
 * (scheduled→sending); if the safety-net sweep already claimed this blast
 * (scheduler-restart orphan recovery), the claim returns `{ ok: false }` and
 * this action is a no-op. No double-send is possible.
 */
export const dispatchScheduledBlast = internalAction({
	args: { blastId: v.id('emailBlasts') },
	handler: async (ctx, { blastId }) => {
		requireAudienceDispatchJobsReady();
		const claim: { ok: boolean } = await ctx.runMutation(internal.blasts.claimForBlastDispatch, {
			blastId
		});
		if (!claim.ok) {
			// Already dispatched/cancelled/completed (or claimed by the
			// safety-net sweep) — idempotent no-op.
			return;
		}
		await ctx.runAction(internal.blasts.triggerEnclaveSend, { blastId });
	}
});

/**
 * Internal query: find blasts ready to send.
 * Called by the cron job every minute.
 */
export const getReadyBlasts = internalQuery({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const now = Date.now();
		const limit = recoveryBatchLimit(args.limit);

		const scheduled = await ctx.db
			.query('emailBlasts')
			.withIndex('by_status_sendMode_scheduledAt', (q) =>
				q
					.eq('status', 'scheduled')
					.eq('sendMode', 'tee-sealed')
					.gt('scheduledAt', 0)
					.lte('scheduledAt', now)
			)
			.order('asc')
			.take(limit + 1);

		return {
			blasts: scheduled.slice(0, limit),
			hasMore: scheduled.length > limit
		};
	}
});

/**
 * Action: trigger the enclave for a specific blast.
 * Called by the cron or by sealAndScheduleBlast for immediate sends.
 */
export const triggerEnclaveSend = internalAction({
	args: {
		blastId: v.id('emailBlasts')
	},
	handler: async (ctx, args) => {
		requireAudienceDispatchJobsReady();
		// 1. Fetch blast record
		const blast = await ctx.runQuery(internal.blasts.getBlastForEnclave, {
			blastId: args.blastId
		});
		if (!blast) {
			console.error(`[triggerEnclaveSend] Blast not found: ${args.blastId}`);
			return;
		}
		// Require `status === "sending"`. Both entry paths (direct from
		// `sealAndScheduleBlast` for immediate sends, and the cron path)
		// call `claimForBlastDispatch` (atomic CAS scheduled→sending)
		// BEFORE scheduling triggerEnclaveSend, so by the time we reach
		// this gate the status is always "sending". Accepting "scheduled"
		// here would leave a race window where both the direct and cron
		// paths could enter the enclave POST concurrently. Anything other
		// than "sending" means the blast was already completed/failed/
		// cancelled.
		if (blast.status !== 'sending') {
			console.warn(
				`[triggerEnclaveSend] Blast ${args.blastId} status is ${blast.status}, skipping`
			);
			return;
		}
		if (!blast.sealedOrgKey) {
			console.error(`[triggerEnclaveSend] Blast ${args.blastId} missing sealedOrgKey`);
			await ctx.runMutation(internal.blasts.updateBlastStatus, {
				blastId: args.blastId,
				status: 'failed',
				totalSent: 0,
				totalFailed: 0,
				clearSealedKey: true
			});
			return;
		}

		// Status is always "sending" by the time we reach here — both the
		// direct path and the cron path claim via `claimForBlastDispatch`
		// before scheduling triggerEnclaveSend. The transition happens in
		// the claim, not in this action.

		// Snapshot the global contact-authority epoch before materialization. Every
		// STOP/complaint/suppression OCC-bumps this singleton transactionally.
		const contactAuthorityEpoch: number = await ctx.runQuery(
			internal.blasts.getContactAuthorityEpochForDispatch,
			{}
		);

		// 2. Fetch the cohort through one bounded query transaction per cursor
		// page. The action is only an orchestrator; no query transaction loops over
		// multiple database pages and the total scan/recipient envelopes are hard.
		const supporters: EncryptedSupporterForBlast[] = [];
		let cursor: string | null = null;
		let scanned = 0;
		do {
			const page: {
				recipients: EncryptedSupporterForBlast[];
				continueCursor: string | null;
				isDone: boolean;
				scannedCount: number;
			} = await ctx.runQuery(internal.blasts.getEncryptedSupporters, {
				orgId: blast.orgId,
				blastId: args.blastId,
				cursor
			});
			scanned += page.scannedCount;
			if (scanned > RECIPIENT_SCAN_CAP) throw new Error('EMAIL_AUDIENCE_SCAN_LIMIT_EXCEEDED');
			supporters.push(...page.recipients);
			if (supporters.length > RECIPIENT_COHORT_CAP) {
				throw new Error('EMAIL_AUDIENCE_COHORT_TOO_LARGE');
			}
			cursor = page.continueCursor;
			if (page.isDone) break;
		} while (cursor !== null);

		// Last serializable boundary before the enclave/SES POST. The mutable
		// filter may have grown or shrunk since compose/schedule; never exercise
		// carrier authority unless the fully materialized in-memory cohort exactly
		// matches the durable reservation requested count.
		const parity: { ok: boolean; reason?: string } = await ctx.runMutation(
			internal.blasts.verifyBlastCarrierBoundary,
			{
				blastId: args.blastId,
				observedRecipientCount: supporters.length,
				expectedContactAuthorityEpoch: contactAuthorityEpoch
			}
		);
		if (!parity.ok) {
			console.error(
				`[triggerEnclaveSend] Carrier boundary refused for ${args.blastId}: ${parity.reason}`
			);
			return;
		}

		// 3. Call the enclave endpoint via the parent instance API
		const enclaveHost = process.env.ENCLAVE_PARENT_HOST;
		if (!enclaveHost) {
			console.error('[triggerEnclaveSend] ENCLAVE_PARENT_HOST not set');
			// Emit a Sentry alert. Without this, the only signal is a Convex
			// function-log line that nobody monitors — every queued blast gets
			// marked permanently `failed` while operators are blind. Sentry
			// dedupes alerts with the same code so blast-storm misconfig
			// collapses into one issue, not N. Best-effort: a missing alert
			// env on top of the missing enclave env still falls back to logs.
			const baseUrl = process.env.CONVEX_SITE_URL ?? '';
			const internalSecret = process.env.INTERNAL_API_SECRET ?? '';
			if (baseUrl && internalSecret) {
				try {
					await fetch(`${baseUrl}/api/internal/alert`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'x-internal-secret': internalSecret
						},
						body: JSON.stringify({
							code: 'ENCLAVE_PARENT_HOST_MISSING',
							message:
								'ENCLAVE_PARENT_HOST not configured — every queued blast will be marked failed until operator sets it',
							severity: 'error',
							context: { blastId: String(args.blastId) }
						}),
						signal: AbortSignal.timeout(10_000)
					});
				} catch (err) {
					console.error(
						'[triggerEnclaveSend] alert-emit failed:',
						err instanceof Error ? err.message : String(err)
					);
				}
			}
			await ctx.runMutation(internal.blasts.updateBlastStatus, {
				blastId: args.blastId,
				status: 'failed',
				totalSent: 0,
				totalFailed: 0,
				clearSealedKey: false
			});
			return;
		}

		try {
			// Bound the enclave call so a stuck instance (NAT GW, network ACL drift,
			// Nitro vsock starvation) doesn't burn the full 10-min Convex action
			// budget and queue every other cron behind it. 60s is generous for a
			// batch SES send; longer hangs indicate hard failure, not slow work.
			const response = await fetch(`https://${enclaveHost}/enclave/blast`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				signal: AbortSignal.timeout(60_000),
				body: JSON.stringify({
					sealedOrgKey: blast.sealedOrgKey,
					supporters: supporters.map((s: EncryptedSupporterForBlast) => ({
						_id: String(s._id),
						encryptedEmail: s.encryptedEmail,
						emailHash: s.emailHash
					})),
					blast: {
						subject: blast.subject,
						bodyHtml: blast.bodyHtml,
						fromEmail: blast.fromEmail,
						fromName: blast.fromName,
						blastId: String(args.blastId)
					}
				})
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error(`[triggerEnclaveSend] Enclave returned ${response.status}: ${errorText}`);
				await ctx.runMutation(internal.blasts.blockBlastAfterAmbiguousCarrierError, {
					blastId: args.blastId,
					failureCode: 'TEE_OUTCOME_AMBIGUOUS'
				});
				return;
			}

			const result: { totalSent: number; totalFailed: number } = await response.json();
			if (
				!Number.isSafeInteger(result.totalSent) ||
				result.totalSent < 0 ||
				!Number.isSafeInteger(result.totalFailed) ||
				result.totalFailed < 0 ||
				result.totalSent + result.totalFailed !== blast.totalRecipients
			) {
				await ctx.runMutation(internal.blasts.blockBlastAfterAmbiguousCarrierError, {
					blastId: args.blastId,
					failureCode: 'TEE_RESULT_INCOMPLETE_OR_INVALID'
				});
				return;
			}

			// 4. Update blast status and clear the sealed key
			await ctx.runMutation(internal.blasts.updateBlastStatus, {
				blastId: args.blastId,
				status: 'sent',
				totalSent: result.totalSent,
				totalFailed: result.totalFailed,
				clearSealedKey: true
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error';
			console.error(`[triggerEnclaveSend] Failed for blast ${args.blastId}:`, message);
			await ctx.runMutation(internal.blasts.blockBlastAfterAmbiguousCarrierError, {
				blastId: args.blastId,
				failureCode: 'TEE_OUTCOME_AMBIGUOUS'
			});
		}
	}
});

/**
 * Atomic CAS: claim a `scheduled` blast for dispatch, transitioning it to
 * `sending` in a single Convex mutation. Returns `{ ok: false }` if the
 * blast is missing or already in any non-scheduled state — handles the
 * race where two cron firings (Convex retry, double-tick at deploy
 * boundary, manual + scheduled cron overlap) both observe status=scheduled.
 * Only one mutation wins; the other gets `{ ok: false }` and skips.
 *
 * Convex mutations are serializable, so this CAS is race-free. Mirrors
 * `submissions.claimForDelivery`.
 */
export const claimForBlastDispatch = internalMutation({
	args: { blastId: v.id('emailBlasts') },
	handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
		requireAudienceDispatchJobsReady();
		const blast = await ctx.db.get(args.blastId);
		if (!blast) return { ok: false };
		if (blast.status !== 'scheduled') return { ok: false };
		// Time guard: a stale `runAt` job for a blast that was later rescheduled
		// must not dispatch early. Only claim once the blast's CURRENT scheduledAt
		// is actually due. (No reschedule path exists today — sealAndScheduleBlast
		// requires status='draft' — so this is defensive against a future one.)
		if (blast.scheduledAt !== undefined && Date.now() < blast.scheduledAt) {
			return { ok: false };
		}
		try {
			readReceiptCountAuthority(blast);
		} catch (error) {
			const reason =
				error instanceof Error ? error.message : 'EMAIL_RECEIPT_COUNT_PROJECTION_NOT_READY';
			await ctx.db.patch(args.blastId, {
				status: 'failed',
				sealedOrgKey: undefined,
				updatedAt: Date.now()
			});
			return { ok: false, reason };
		}

		// This mutation is the last serializable boundary before external SES
		// authority is exercised. Read only the O(1) projection; stale/malformed
		// usage never falls back to source history in a dispatch transaction.
		const limits = await ctx.runQuery(internal.subscriptions.checkPlanLimitsByOrgId, {
			orgId: blast.orgId
		});
		if (!limits?.usageReady) {
			if (limits?.usageRepairRequired) {
				await ctx.runMutation(enqueuePlanUsageRepairRef, { orgId: blast.orgId });
			}
			return {
				ok: false,
				reason: limits?.usageFailureCode ?? 'PLAN_USAGE_NOT_READY'
			};
		}
		const remaining =
			limits.limits.maxEmails - limits.current.emailsSent - limits.current.emailsReserved;
		if (remaining <= 0 || blast.totalRecipients > remaining) {
			// A due scheduled send that cannot fit the current exact remaining quota
			// is terminal. Clearing
			// the sealed key prevents a later cron from unexpectedly sending it after
			// a period rollover; the editor can create a fresh blast deliberately.
			await ctx.db.patch(args.blastId, {
				status: 'failed',
				sealedOrgKey: undefined,
				updatedAt: Date.now()
			});
			return { ok: false, reason: 'EMAIL_QUOTA_EXCEEDED' };
		}
		let reservation: Awaited<ReturnType<typeof reserveEmailUsage>>;
		try {
			reservation = await reserveEmailUsage(ctx, {
				orgId: blast.orgId,
				sourceType: 'emailBlast',
				sourceId: String(blast._id),
				requestedCount: blast.totalRecipients,
				admission: {
					periodStart: limits.periodStart,
					currentEmailsSent: limits.current.emailsSent,
					maxEmails: limits.limits.maxEmails
				},
				leaseExpiresAt: Date.now() + EMAIL_RESERVATION_LEASE_MS
			});
		} catch (error) {
			if (error instanceof Error && error.message === 'EMAIL_QUOTA_EXCEEDED') {
				await ctx.db.patch(args.blastId, {
					status: 'failed',
					sealedOrgKey: undefined,
					updatedAt: Date.now()
				});
				return { ok: false, reason: 'EMAIL_QUOTA_EXCEEDED' };
			}
			throw error;
		}
		await ctx.db.patch(args.blastId, {
			status: 'sending',
			planUsageReservationId: reservation._id,
			updatedAt: Date.now()
		});
		return { ok: true };
	}
});

export const verifyBlastCarrierBoundary = internalMutation({
	args: {
		blastId: v.id('emailBlasts'),
		observedRecipientCount: v.number(),
		expectedContactAuthorityEpoch: v.number()
	},
	handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
		if (!Number.isSafeInteger(args.observedRecipientCount) || args.observedRecipientCount < 0) {
			throw new Error('EMAIL_AUDIENCE_OBSERVED_COUNT_INVALID');
		}
		const blast = await ctx.db.get(args.blastId);
		if (!blast || blast.status !== 'sending' || !blast.planUsageReservationId) {
			return { ok: false, reason: 'BLAST_CARRIER_AUTHORITY_NOT_ACTIVE' };
		}
		// This is a one-shot grant, not a repeatable predicate. A duplicate action
		// must leave the first action's live reservation untouched while refusing a
		// second enclave/SES POST.
		if (blast.carrierAuthorityIssuedAt !== undefined) {
			return { ok: false, reason: 'BLAST_CARRIER_AUTHORITY_ALREADY_ISSUED' };
		}
		const reservation = await ctx.db.get(blast.planUsageReservationId);
		if (!reservation) return { ok: false, reason: 'EMAIL_BLAST_RESERVATION_MISSING' };
		assertEmailReservationPartition(reservation);
		const currentContactAuthorityEpoch = await readContactAuthorityEpoch(ctx);
		const exact =
			Number.isSafeInteger(args.expectedContactAuthorityEpoch) &&
			args.expectedContactAuthorityEpoch >= 0 &&
			currentContactAuthorityEpoch === args.expectedContactAuthorityEpoch &&
			reservation.status === 'active' &&
			reservation.orgId === blast.orgId &&
			reservation.sourceType === 'emailBlast' &&
			reservation.sourceId === String(blast._id) &&
			reservation.requestedCount === blast.totalRecipients &&
			reservation.remainingCount === reservation.requestedCount &&
			reservation.sentCount === 0 &&
			reservation.releasedCount === 0 &&
			args.observedRecipientCount === reservation.requestedCount;
		if (!exact) {
			if (reservation.status === 'active') {
				await reconcileEmailReservation(ctx, {
					reservationId: reservation._id,
					absoluteSentCount: 0,
					terminal: true,
					terminalReason: 'EMAIL_BLAST_COHORT_RESERVATION_PARITY_REFUSED'
				});
			}
			await ctx.db.patch(blast._id, {
				status: 'failed',
				sealedOrgKey: undefined,
				updatedAt: Date.now()
			});
			return { ok: false, reason: 'EMAIL_BLAST_COHORT_RESERVATION_PARITY_MISMATCH' };
		}
		await renewEmailReservationLease(ctx, reservation._id);
		await ctx.db.patch(blast._id, {
			carrierAuthorityIssuedAt: Date.now(),
			carrierAuthorityEpoch: currentContactAuthorityEpoch,
			carrierAuthorityRecipientCount: args.observedRecipientCount,
			updatedAt: Date.now()
		});
		return { ok: true };
	}
});

export const getContactAuthorityEpochForDispatch = internalQuery({
	args: {},
	handler: async (ctx) => await readContactAuthorityEpoch(ctx)
});

/**
 * Wide-cadence (15-min) blast-dispatch recovery sweep. Two jobs:
 *
 * (a) ORPHANED SCHEDULED blasts — the PRIMARY firing path is
 *     `ctx.scheduler.runAt(scheduledAt, …)` → `dispatchScheduledBlast`, enqueued
 *     at the `sealAndScheduleBlast` write-site. This re-scans for `scheduled`
 *     rows whose due `runAt` job was lost to a Convex-scheduler restart and
 *     dispatches them via `claimForBlastDispatch` (so it can never double-
 *     dispatch one the native path already claimed). Mirrors
 *     `reschedule-stuck-revocations`.
 *
 * (b) ORPHANED SENDING blasts — every `triggerEnclaveSend` code path terminates
 *     in `sent`/`failed`, so a row left in `sending` past the threshold means
 *     the dispatch action was evicted mid-flight. We mark it `failed` so it
 *     stops reading as perpetually in-flight and becomes operator-visible. We do
 *     NOT auto-resend: the enclave POST IS the send and carries no Convex-visible
 *     dedup, so a retry could double-send (the enclave may have sent before the
 *     action died). At-most-once with a visible terminal state is the correct
 *     posture for a non-idempotent send — re-send is a deliberate operator act.
 */
export const processScheduledBlasts = internalAction({
	handler: async (ctx) => {
		// The essential cron remains registered during launch. Disabled delivery
		// must be a zero-I/O no-op, not a recurrent exception/log-cost loop.
		if (!AUDIENCE_DISPATCH_JOBS_READY) {
			return { disabled: true, processed: 0 };
		}
		requireAudienceDispatchJobsReady();
		const now = Date.now();

		// (a) Recover orphaned SCHEDULED blasts.
		const ready: {
			blasts: Array<{ _id: Id<'emailBlasts'> }>;
			hasMore: boolean;
		} = await ctx.runQuery(internal.blasts.getReadyBlasts, {
			limit: BLAST_RECOVERY_BATCH
		});
		for (const blast of ready.blasts) {
			const claim = await ctx.runMutation(internal.blasts.claimForBlastDispatch, {
				blastId: blast._id
			});
			if (!claim.ok) {
				// Another cron firing already claimed this blast; skip.
				continue;
			}
			await ctx.scheduler.runAfter(0, internal.blasts.triggerEnclaveSend, {
				blastId: blast._id
			});
		}

		// (b) Recover orphaned SENDING blasts (dispatch action evicted mid-flight).
		// Threshold exceeds the 60s enclave fetch timeout + any reasonable action
		// time, so a live send is never misclassified as stuck.
		const STUCK_SENDING_MS = 15 * 60 * 1000;
		const stuck: {
			blasts: Array<{ _id: Id<'emailBlasts'> }>;
			hasMore: boolean;
		} = await ctx.runQuery(internal.blasts.getStuckSendingBlasts, {
			stuckBeforeMs: now - STUCK_SENDING_MS,
			limit: BLAST_RECOVERY_BATCH
		});
		for (const blast of stuck.blasts) {
			const r = await ctx.runMutation(internal.blasts.failStuckSendingBlast, {
				blastId: blast._id,
				stuckBeforeMs: now - STUCK_SENDING_MS
			});
			if (r.failed) {
				console.error(
					`[processScheduledBlasts] Blast ${blast._id} was stuck in 'sending' ` +
						`>15m (dispatch action evicted) — marked 'failed'. Verify against the ` +
						`enclave/SES whether it actually sent before re-sending.`
				);
			}
		}

		if (ready.hasMore || stuck.hasMore) {
			await ctx.scheduler.runAfter(0, internal.blasts.processScheduledBlasts, {});
		}
	}
});

/**
 * Internal query: blasts stuck in `sending` since before `stuckBeforeMs`.
 * Used by `processScheduledBlasts` to recover dispatch-action-evicted orphans.
 */
export const getStuckSendingBlasts = internalQuery({
	args: { stuckBeforeMs: v.number(), limit: v.optional(v.number()) },
	handler: async (ctx, { stuckBeforeMs, limit: requestedLimit }) => {
		if (!Number.isFinite(stuckBeforeMs)) {
			throw new Error('BLAST_RECOVERY_CUTOFF_INVALID');
		}
		const limit = recoveryBatchLimit(requestedLimit);
		const stuck = await ctx.db
			.query('emailBlasts')
			.withIndex('by_status_updatedAt', (q) =>
				q.eq('status', 'sending').lt('updatedAt', stuckBeforeMs)
			)
			.order('asc')
			.take(limit + 1);
		return {
			blasts: stuck.slice(0, limit),
			hasMore: stuck.length > limit
		};
	}
});

/**
 * Internal mutation: mark a blast `failed` IFF it is still stuck in `sending`.
 * Re-checks under the serializable transaction so a blast that completed between
 * the sweep's query and this call is left untouched. Clears the sealed org key.
 * Never resends (the enclave send is non-idempotent — see processScheduledBlasts).
 */
export const failStuckSendingBlast = internalMutation({
	args: { blastId: v.id('emailBlasts'), stuckBeforeMs: v.number() },
	handler: async (ctx, { blastId, stuckBeforeMs }) => {
		const blast = await ctx.db.get(blastId);
		if (!blast || blast.status !== 'sending') return { failed: false };
		if ((blast.updatedAt ?? 0) >= stuckBeforeMs) return { failed: false };
		if (!blast.planUsageReservationId) {
			await ctx.db.patch(blast.orgId, {
				emailReservationState: 'blocked',
				emailReservationFailureCode: 'TEE_LEGACY_OUTCOME_AMBIGUOUS',
				updatedAt: Date.now()
			});
		} else {
			await blockEmailReservation(
				ctx,
				blast.planUsageReservationId,
				'TEE_OUTCOME_AMBIGUOUS_STALE_ACTION'
			);
		}
		await ctx.db.patch(blastId, {
			status: 'outcome_unknown',
			sealedOrgKey: undefined,
			updatedAt: Date.now()
		});
		return { failed: true };
	}
});

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Internal query: get blast by ID for enclave processing.
 */
export const getBlastForEnclave = internalQuery({
	args: { blastId: v.id('emailBlasts') },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.blastId);
	}
});

/**
 * Internal query: get encrypted supporters for an org (subscribed only).
 */
export const getEncryptedSupporters = internalQuery({
	args: {
		orgId: v.id('organizations'),
		blastId: v.id('emailBlasts'),
		cursor: v.union(v.string(), v.null())
	},
	handler: async (ctx, args) => {
		requireAudienceDispatchJobsReady();
		const blast = await ctx.db.get(args.blastId);
		if (!blast || blast.orgId !== args.orgId) throw new Error('Blast not found');
		const page = await pageFilteredRecipients(
			ctx,
			args.orgId,
			readSafeEmailRecipientFilter(blast.recipientFilter),
			args.cursor,
			RECIPIENT_SCAN_PAGE
		);

		return {
			recipients: page.recipients.map((s) => ({
				_id: s._id,
				encryptedEmail: s.encryptedEmail,
				emailHash: s.emailHash
			})),
			continueCursor: page.continueCursor,
			isDone: page.isDone,
			scannedCount: page.scannedCount
		};
	}
});

/**
 * Internal mutation: update blast status after enclave send.
 */
export const updateBlastStatus = internalMutation({
	args: {
		blastId: v.id('emailBlasts'),
		status: v.string(),
		totalSent: v.number(),
		totalFailed: v.number(),
		clearSealedKey: v.boolean()
	},
	handler: async (ctx, args) => {
		const blast = await ctx.db.get(args.blastId);
		if (!blast) return;
		if (!Number.isSafeInteger(args.totalSent) || args.totalSent < 0) {
			throw new Error('TOTAL_SENT_INVALID');
		}
		if (!Number.isSafeInteger(args.totalFailed) || args.totalFailed < 0) {
			throw new Error('TOTAL_FAILED_INVALID');
		}
		if (
			(args.status === 'sent' || args.status === 'failed') &&
			args.totalSent + args.totalFailed !== blast.totalRecipients
		) {
			throw new Error('BLAST_RESULT_DOES_NOT_PARTITION_RESERVED_COHORT');
		}
		if ((args.status === 'sent' || args.status === 'failed') && blast.status !== args.status) {
			if (!blast.planUsageReservationId) {
				throw new Error('EMAIL_BLAST_RESERVATION_MISSING');
			}
			await reconcileEmailReservation(ctx, {
				reservationId: blast.planUsageReservationId,
				absoluteSentCount: args.totalSent,
				terminal: true,
				terminalReason: args.status === 'sent' ? 'TEE_RESULT_RECORDED' : 'TEE_TERMINAL_FAILURE'
			});
		}

		const patch: Record<string, unknown> = {
			status: args.status,
			totalSent: args.totalSent,
			totalBounced: args.totalFailed,
			updatedAt: Date.now()
		};
		if (args.status === 'sent') {
			patch.sentAt = Date.now();
		}
		if (args.clearSealedKey) {
			patch.sealedOrgKey = undefined;
		}

		await ctx.db.patch(args.blastId, patch);
		await syncEmailAbWinnerCandidate(ctx, {
			blastId: blast._id,
			orgId: blast.orgId,
			status: args.status,
			isAbTest: blast.isAbTest,
			abParentId: blast.abParentId,
			abVariant: blast.abVariant,
			abWinnerPickedAt: blast.abWinnerPickedAt,
			abTestConfig: blast.abTestConfig,
			totalSent: args.totalSent,
			totalOpened: blast.totalOpened,
			totalClicked: blast.totalClicked,
			sentAt: args.status === 'sent' ? (patch.sentAt as number) : blast.sentAt
		});
	}
});

export const blockBlastAfterAmbiguousCarrierError = internalMutation({
	args: { blastId: v.id('emailBlasts'), failureCode: v.string() },
	handler: async (ctx, args) => {
		const blast = await ctx.db.get(args.blastId);
		if (!blast || blast.status !== 'sending' || !blast.planUsageReservationId) return;
		await blockEmailReservation(ctx, blast.planUsageReservationId, args.failureCode);
		await ctx.db.patch(blast._id, {
			status: 'outcome_unknown',
			updatedAt: Date.now()
		});
	}
});

// =============================================================================
// CLIENT-DIRECT BLAST SUPPORT
//
// Public query + mutation for browser-side blast sends (<500 recipients).
// The admin's browser decrypts supporter emails with the org key,
// sends via Lambda proxy, and reports progress back here.
// =============================================================================

/**
 * Public query: get encrypted supporters for a client-direct blast.
 * Returns only subscribed supporters' encrypted email blobs + email hashes.
 * Requires editor+ role on the org.
 */
export const getEncryptedSupportersForBlast = query({
	args: {
		orgSlug: v.string(),
		blastId: v.optional(v.id('emailBlasts')),
		cursor: v.optional(v.union(v.string(), v.null()))
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');
		requireAudienceDispatchJobsReady();

		// Resolve the persisted recipientFilter from the blast row. Without
		// blastId (legacy callers) the entire subscribed cohort returns — which
		// is the previous behavior. Per cure: when a blastId is supplied
		// the filter that was saved at compose time IS enforced here, not just
		// at the count step.
		//
		// `recipientFilter` is schema-validated on new writes, but older rows
		// may still carry stale shapes. An unchecked `as typeof filter` cast at
		// read time would let a single malformed write (e.g., saved
		// `{tagIds: ['not-a-real-id'], verified: 'maybe'}`) poison every
		// future dispatch — `ctx.db.get(tagId)` would throw on the bad id,
		// breaking `getEncryptedSupportersForBlast` which is exactly the
		// dispatch-claim issuer's dependency. Validate shape at read:
		// tagIds/segmentIds must be arrays of strings; verified must be one
		// of the three literals; anything else is silently ignored (treat as
		// no-filter rather than throw, so a stale-shape blast is
		// recoverable by a re-save instead of a hard error).
		let filter: EmailRecipientFilter = {};
		if (args.blastId) {
			const blast = await ctx.db.get(args.blastId);
			if (!blast || blast.orgId !== org._id) {
				throw new Error('Blast not found in this organization');
			}
			filter = readSafeEmailRecipientFilter(blast.recipientFilter);
		}
		const page = await pageFilteredRecipients(
			ctx,
			org._id,
			filter,
			args.cursor ?? null,
			RECIPIENT_SCAN_PAGE
		);

		return {
			recipients: page.recipients.map((s) => ({
				_id: s._id,
				encryptedEmail: s.encryptedEmail,
				emailHash: s.emailHash,
				encryptedName: s.encryptedName,
				postalCode: s.postalCode,
				verified: s.verified
			})),
			continueCursor: page.continueCursor,
			isDone: page.isDone,
			scannedCount: page.scannedCount,
			maxRecipients: RECIPIENT_COHORT_CAP,
			maxScanned: RECIPIENT_SCAN_CAP
		};
	}
});

/**
 * Public mutation: update blast progress from a client-direct send.
 * Called by the browser as batches complete. Only allows updating
 * blasts owned by the caller's org and in 'sending' or 'draft' status.
 */
export const updateClientBlastProgress = mutation({
	args: {
		orgSlug: v.string(),
		blastId: v.id('emailBlasts'),
		// Pin status to documented enum. Free-form `v.string()` would
		// let a caller write 'pwned' and break downstream invariants
		// (the status guard below would then refuse future legit updates).
		status: v.union(
			v.literal('draft'),
			v.literal('sending'),
			v.literal('sent'),
			v.literal('failed')
		),
		totalSent: v.number(),
		totalBounced: v.number(),
		totalRecipients: v.optional(v.number()),
		batches: v.optional(v.any())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');
		requireAudienceDispatchJobsReady();

		const blast = await ctx.db.get(args.blastId);
		if (!blast || blast.orgId !== org._id) {
			throw new Error('Blast not found');
		}
		// Pre-carrier tombstone for legacy blasts: the UI calls this with
		// status='sending' before its first SES request. A missing/corrupt exact
		// receipt count therefore blocks the send, rather than failing only when
		// the browser later tries to persist forensic receipts.
		readReceiptCountAuthority(blast);
		const previousStatus = blast.status;

		// Only allow updates from client-direct sends in valid states
		if (blast.sendMode !== 'client-direct' && args.status !== 'sending') {
			throw new Error('Blast is not a client-direct send');
		}
		if (blast.status !== 'draft' && blast.status !== 'sending') {
			throw new Error('Blast already finalized');
		}

		// Bound `totalSent` / `totalBounced` to the cohort size declared
		// at blast-creation. Without this, unbounded `totalSent: v.number()`
		// would let an editor call with `totalSent: 1_000_000_000` and
		// permanently inflate the org's `sentEmailCount` (irreversible
		// without manual DB surgery — there's no decrement path). The
		// cohort size is the natural upper bound: you can't send more
		// emails than recipients. `totalRecipients` is set at blast
		// creation from the recipientFilter snapshot and the cohort is
		// locked.
		if (args.totalSent < 0) throw new Error('TOTAL_SENT_NEGATIVE');
		if (args.totalBounced < 0) throw new Error('TOTAL_BOUNCED_NEGATIVE');
		if (args.totalSent > blast.totalRecipients) {
			throw new Error('TOTAL_SENT_EXCEEDS_COHORT');
		}
		if (args.totalBounced > blast.totalRecipients) {
			throw new Error('TOTAL_BOUNCED_EXCEEDS_COHORT');
		}

		const patch: Record<string, unknown> = {
			status: args.status,
			totalSent: args.totalSent,
			totalBounced: args.totalBounced,
			updatedAt: Date.now()
		};

		if (args.totalRecipients !== undefined) {
			patch.totalRecipients = args.totalRecipients;
		}
		if (args.batches !== undefined) {
			patch.batches = args.batches;
		}
		if (args.status === 'sent') {
			patch.sentAt = Date.now();
		}

		await ctx.db.patch(args.blastId, patch);
		await syncEmailAbWinnerCandidate(ctx, {
			blastId: blast._id,
			orgId: blast.orgId,
			status: args.status,
			isAbTest: blast.isAbTest,
			abParentId: blast.abParentId,
			abVariant: blast.abVariant,
			abWinnerPickedAt: blast.abWinnerPickedAt,
			abTestConfig: blast.abTestConfig,
			totalSent: args.totalSent,
			totalOpened: blast.totalOpened,
			totalClicked: blast.totalClicked,
			sentAt: args.status === 'sent' ? (patch.sentAt as number) : blast.sentAt
		});

		// Increment org-level email counter on transition to "sent". The
		// delta is bounded by the cohort-size check above, so no inflation
		// attack is possible. If `totalSent` is somehow > blast.totalRecipients
		// we'd have thrown; the counter can grow by at most that bound.
		if (args.status === 'sent' && previousStatus !== 'sent') {
			// Fail-closed recheck: an org can go inactive mid-blast (STS creds are
			// minted for 15 min and unrevocable). Refuse to RECORD sends for an org
			// at the inactive floor. Gate on maxEmails===0 (NOT >=) — emailsSent is
			// period-scoped from already-'sent' blasts, so a >= recheck would
			// false-reject an active org's final legitimate batch.
			const planLimits = await ctx.runQuery(internal.subscriptions.checkPlanLimitsByOrgId, {
				orgId: org._id
			});
			if (planLimits?.limits.maxEmails === 0) {
				throw new Error('EMAIL_QUOTA_INACTIVE');
			}
			const orgDoc = await ctx.db.get(org._id);
			if (orgDoc) {
				const currentCount = orgDoc.sentEmailCount ?? 0;
				await ctx.db.patch(org._id, {
					sentEmailCount: currentCount + args.totalSent,
					updatedAt: Date.now()
				});
			}
		}
	}
});

/**
 * Internal-only mutation: persist per-recipient send receipts when the
 * caller has already been authenticated by the surrounding harness (Convex
 * http action verifying a shared secret from the Lambda forwarder). Same
 * upsert logic as `recordBlastReceipts` but skips the orgSlug membership
 * check — the caller is the platform Lambda, not a browser editor.
 * Deeper cure: closes the browser-disconnect-mid-blast gap by giving
 * the Lambda a durable receipt write path independent of the browser.
 */
// Send modes that produce per-recipient receipts. Positive allowlists (NOT a
// `!==` denylist) so an unset/unknown sendMode still throws — sendMode is
// optional in the schema, so a denylist would silently admit undefined/garbage.
//
// Split by trust surface: the INTERNAL writer (called only by the platform
// Lambda/server path) admits 'server'; the PUBLIC, editor-callable writer must
// NOT — server-dispatch receipts are server-authoritative, so admitting 'server'
// publicly would let an editor forge/overwrite backend SES receipt rows.
const INTERNAL_RECEIPT_SENDMODES = new Set(['client-direct', 'tee-sealed', 'server']);
const PUBLIC_RECEIPT_SENDMODES = new Set(['client-direct', 'tee-sealed']);
const BLAST_RECEIPT_BATCH_MAX = 200;
const BLAST_RECEIPT_BASELINE_CAP = 2_000;
export const BLAST_RECEIPT_HARD_CAP = RECIPIENT_COHORT_CAP * 2;

function readReceiptCountAuthority(blast: { totalRecipients: number; receiptCount?: number }): {
	receiptCount: number;
	ceiling: number;
} {
	if (
		!Number.isSafeInteger(blast.totalRecipients) ||
		blast.totalRecipients < 0 ||
		blast.totalRecipients > RECIPIENT_COHORT_CAP
	) {
		throw new Error('EMAIL_BLAST_RECIPIENT_COUNT_REPAIR_REQUIRED');
	}
	const ceiling = Math.max(BLAST_RECEIPT_BASELINE_CAP, blast.totalRecipients * 2);
	if (ceiling > BLAST_RECEIPT_HARD_CAP) {
		throw new Error('EMAIL_BLAST_RECEIPT_CAP_INVALID');
	}
	if (
		!Number.isSafeInteger(blast.receiptCount) ||
		blast.receiptCount! < 0 ||
		blast.receiptCount! > ceiling
	) {
		throw new Error('EMAIL_RECEIPT_COUNT_PROJECTION_NOT_READY');
	}
	return { receiptCount: blast.receiptCount!, ceiling };
}

export const recordBlastReceiptsInternal = internalMutation({
	args: {
		blastId: v.id('emailBlasts'),
		receipts: v.array(
			v.object({
				recipientEmailHash: v.string(),
				sesMessageId: v.optional(v.string()),
				status: v.union(v.literal('sent'), v.literal('failed')),
				sentAt: v.number(),
				error: v.optional(v.string())
			})
		)
	},
	handler: async (ctx, args) => {
		const blast = await ctx.db.get(args.blastId);
		if (!blast) {
			throw new Error('Blast not found');
		}
		if (!INTERNAL_RECEIPT_SENDMODES.has(blast.sendMode ?? '')) {
			throw new Error(`Receipts not supported for sendMode '${blast.sendMode ?? '(unset)'}'`);
		}
		if (blast.status !== 'sending' && blast.status !== 'sent') {
			throw new Error(`Cannot record receipts for blast in status '${blast.status}'`);
		}
		if (args.receipts.length === 0) return { written: 0, updated: 0 };
		if (args.receipts.length > BLAST_RECEIPT_BATCH_MAX) {
			throw new Error(`Too many receipts in a single batch (max ${BLAST_RECEIPT_BATCH_MAX})`);
		}

		// Exact O(1) count projection. Every new insert and the count patch
		// commit in this same serializable mutation, so retries/upserts cannot
		// inflate it. Legacy/malformed rows fail closed instead of rebuilding a
		// cohort-sized count in the request path.
		const { receiptCount: existingCount, ceiling } = readReceiptCountAuthority(blast);

		let written = 0;
		let updated = 0;
		let skippedDowngrade = 0;
		for (const r of args.receipts) {
			const sesMessageId = r.status === 'sent' ? r.sesMessageId : undefined;
			const existing = await ctx.db
				.query('emailDeliveryReceipts')
				.withIndex('by_blastId_recipientEmailHash', (q) =>
					q.eq('blastId', args.blastId).eq('recipientEmailHash', r.recipientEmailHash)
				)
				.first();
			if (existing) {
				// never downgrade a 'sent' to 'failed'. Browser's
				// network-error catch writes 'failed' when fetch() throws before
				// Lambda's response is received; Lambda's direct receipt-forward
				// (durable receipt forward) writes 'sent' from the same dispatch. Both
				// target the same (blastId, emailHash) row, and Convex `patch`
				// overwrites unconditionally — so an out-of-order arrival could
				// replace an authoritative 'sent' with a stale 'failed'. 'Sent'
				// is final-good (the Lambda confirmed SES delivery); 'failed' is
				// browser-side optimism that the Lambda might or might not have
				// also produced. Skip the patch in that case.
				if (existing.status === 'sent' && r.status === 'failed') {
					skippedDowngrade++;
					continue;
				}
				await ctx.db.patch(existing._id, {
					sesMessageId,
					status: r.status,
					sentAt: r.sentAt,
					error: r.error
				});
				updated++;
			} else {
				if (existingCount + written >= ceiling) {
					throw new Error(
						`Receipt cohort cap exceeded for blast (${ceiling}); refusing further inserts`
					);
				}
				await ctx.db.insert('emailDeliveryReceipts', {
					blastId: args.blastId,
					recipientEmailHash: r.recipientEmailHash,
					sesMessageId,
					status: r.status,
					sentAt: r.sentAt,
					error: r.error
				});
				written++;
			}
		}
		if (written > 0) {
			await ctx.db.patch(args.blastId, { receiptCount: existingCount + written });
		}
		return { written, updated, skippedDowngrade };
	}
});

/**
 * Persist per-recipient send receipts emitted by `sendBlastFromClient` after
 * each Lambda batch. Upserts on (blastId, recipientEmailHash) via the
 * `by_blastId_recipientEmailHash` index — retries on the same recipient
 * patch the existing row instead of double-writing. Closes (cure shipped).
 *
 * Batch cap is 200: each receipt is one indexed read + one write = up to 400
 * ops. Convex transactions cap around 4096 ops; 200 keeps an order of
 * magnitude of headroom for index-fanout / read amplification. Don't raise
 * without re-measuring under OCC retry pressure.
 *
 * `sendMode` accepts both `client-direct` (today's bulk path) and
 * `tee-sealed` (the Nitro Enclave path; see
 * `convex/blasts.ts:sealAndScheduleBlast` and the NitroEnclaveResolver
 * stub). When TEE-sealed lands the enclave will write receipts the same way.
 */
export const recordBlastReceipts = mutation({
	args: {
		orgSlug: v.string(),
		blastId: v.id('emailBlasts'),
		receipts: v.array(
			v.object({
				recipientEmailHash: v.string(),
				sesMessageId: v.optional(v.string()),
				status: v.union(v.literal('sent'), v.literal('failed')),
				sentAt: v.number(),
				error: v.optional(v.string())
			})
		)
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');

		const blast = await ctx.db.get(args.blastId);
		if (!blast || blast.orgId !== org._id) {
			throw new Error('Blast not found in this organization');
		}
		if (!PUBLIC_RECEIPT_SENDMODES.has(blast.sendMode ?? '')) {
			throw new Error(`Receipts not supported for sendMode '${blast.sendMode ?? '(unset)'}'`);
		}
		if (blast.status !== 'sending' && blast.status !== 'sent') {
			throw new Error(`Cannot record receipts for blast in status '${blast.status}'`);
		}
		if (args.receipts.length === 0) return { written: 0, updated: 0 };
		if (args.receipts.length > BLAST_RECEIPT_BATCH_MAX) {
			throw new Error(`Too many receipts in a single batch (max ${BLAST_RECEIPT_BATCH_MAX})`);
		}

		const { receiptCount: existingCount, ceiling } = readReceiptCountAuthority(blast);

		let written = 0;
		let updated = 0;
		let skippedDowngrade = 0;
		for (const r of args.receipts) {
			// Defensive: failed receipts must not carry a sesMessageId (which would
			// pollute the by_sesMessageId index). The convex validator above
			// already enforces status ∈ {sent, failed}; this guard catches a
			// failed-with-messageId mismatch from a misbehaving caller.
			const sesMessageId = r.status === 'sent' ? r.sesMessageId : undefined;
			const existing = await ctx.db
				.query('emailDeliveryReceipts')
				.withIndex('by_blastId_recipientEmailHash', (q) =>
					q.eq('blastId', args.blastId).eq('recipientEmailHash', r.recipientEmailHash)
				)
				.first();
			if (existing) {
				// never downgrade 'sent' → 'failed'. See
				// `recordBlastReceiptsInternal` for full rationale; both writers
				// share the same upsert semantics, so both apply the rule.
				if (existing.status === 'sent' && r.status === 'failed') {
					skippedDowngrade++;
					continue;
				}
				await ctx.db.patch(existing._id, {
					sesMessageId,
					status: r.status,
					sentAt: r.sentAt,
					error: r.error
				});
				updated++;
			} else {
				if (existingCount + written >= ceiling) {
					throw new Error(
						`Receipt cohort cap exceeded for blast (${ceiling}); refusing further inserts`
					);
				}
				await ctx.db.insert('emailDeliveryReceipts', {
					blastId: args.blastId,
					recipientEmailHash: r.recipientEmailHash,
					sesMessageId,
					status: r.status,
					sentAt: r.sentAt,
					error: r.error
				});
				written++;
			}
		}
		if (written > 0) {
			await ctx.db.patch(args.blastId, { receiptCount: existingCount + written });
		}
		return { written, updated, skippedDowngrade };
	}
});
