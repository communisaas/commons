/**
 * Email Verification Service
 *
 * Orchestrates suppression-list checks and Reacher SMTP probes.
 * Flow per email: suppression check -> SMTP probe -> verdict mapping -> suppress if invalid.
 * Graceful degradation: if Reacher is unavailable, all emails pass as "unknown".
 */

import { prisma } from '$lib/core/db';
import { checkEmail, checkEmailBatch, type ReacherResult } from '$lib/server/reacher-client';
import { computeEmailHash, encryptPii } from '$lib/core/crypto/user-pii-encryption';

export type EmailVerdict = 'deliverable' | 'undeliverable' | 'risky' | 'unknown';

export interface VerificationResult {
	email: string;
	verdict: EmailVerdict;
	reason: string;
	source: 'suppression_list' | 'dns' | 'smtp_probe' | 'degraded';
	reacherData?: ReacherResult;
}

const SUPPRESSION_TTL_VERIFICATION_DAYS = 180; // 6 months
const SUPPRESSION_TTL_USER_REPORT_DAYS = 365; // 1 year
const MAX_BATCH_SIZE = 50;

function mapVerdict(reacher: ReacherResult): { verdict: EmailVerdict; reason: string } {
	switch (reacher.is_reachable) {
		case 'safe':
			return { verdict: 'deliverable', reason: 'smtp_deliverable' };
		case 'invalid':
			if (reacher.smtp.is_disabled) return { verdict: 'undeliverable', reason: 'smtp_disabled' };
			if (reacher.smtp.has_full_inbox) return { verdict: 'risky', reason: 'full_inbox' };
			if (!reacher.mx.accepts_mail) return { verdict: 'undeliverable', reason: 'dns_no_mx' };
			return { verdict: 'undeliverable', reason: 'smtp_invalid' };
		case 'risky':
			return { verdict: 'risky', reason: reacher.smtp.is_catch_all ? 'catch_all' : 'risky_other' };
		case 'unknown':
			return { verdict: 'unknown', reason: 'smtp_inconclusive' };
		default:
			return { verdict: 'unknown', reason: 'unrecognized_verdict' };
	}
}

function suppressionExpiry(source: 'verification' | 'user_report'): Date {
	const days = source === 'user_report' ? SUPPRESSION_TTL_USER_REPORT_DAYS : SUPPRESSION_TTL_VERIFICATION_DAYS;
	const d = new Date();
	d.setDate(d.getDate() + days);
	return d;
}

function maskEmail(email: string): string {
	const at = email.indexOf('@');
	if (at < 1) return '***';
	return `${email[0]}***@${email.slice(at + 1)}`;
}

async function suppressEmail(email: string, reason: string, source: 'verification' | 'user_report', reacherData?: ReacherResult, reportedBy?: string): Promise<void> {
	const at = email.indexOf('@');
	const domain = at > 0 ? email.slice(at + 1).toLowerCase() : '';
	const emailHash = await computeEmailHash(email).catch(() => null);
	try {
		await prisma.suppressedEmail.upsert({
			where: { email },
			create: {
				email,
				email_hash: emailHash,
				domain,
				reason,
				source,
				reportedBy: reportedBy ?? null,
				reacherData: reacherData ? (JSON.parse(JSON.stringify(reacherData)) as object) : undefined,
				expiresAt: suppressionExpiry(source)
			},
			update: {
				reason,
				source,
				email_hash: emailHash,
				reportedBy: reportedBy ?? null,
				reacherData: reacherData ? (JSON.parse(JSON.stringify(reacherData)) as object) : undefined,
				expiresAt: suppressionExpiry(source)
			}
		});
	} catch (err) {
		console.warn(`[email-verification] Failed to suppress ${maskEmail(email)}:`, err);
	}
}

/**
 * Verify a single email address.
 */
export async function verifyEmail(email: string): Promise<VerificationResult> {
	// 1. Suppression check (prefer email_hash, fall back to plaintext during transition)
	try {
		const emailHash = await computeEmailHash(email).catch(() => null);
		const suppressed = emailHash
			? await prisma.suppressedEmail.findUnique({ where: { email_hash: emailHash } })
				?? await prisma.suppressedEmail.findUnique({ where: { email } }) // fallback for pre-backfill rows
			: await prisma.suppressedEmail.findUnique({ where: { email } });
		if (suppressed) {
			if (suppressed.expiresAt > new Date()) {
				return { email, verdict: 'undeliverable', reason: suppressed.reason, source: 'suppression_list' };
			}
			// Expired — clean up and re-verify
			await prisma.suppressedEmail.delete({ where: { id: suppressed.id } }).catch(() => {});
		}
	} catch (err) {
		console.warn(`[email-verification] Suppression lookup failed for ${maskEmail(email)}:`, err);
	}

	// 2. SMTP probe
	const result = await checkEmail(email);
	if (!result) {
		return { email, verdict: 'unknown', reason: 'reacher_unavailable', source: 'degraded' };
	}

	// 3. Map verdict
	const { verdict, reason } = mapVerdict(result);

	// 4. Suppress if undeliverable — awaited to stay within ALS scope on Workers
	if (verdict === 'undeliverable') {
		await suppressEmail(email, reason, 'verification', result);
	}

	return { email, verdict, reason, source: 'smtp_probe', reacherData: result };
}

/**
 * Verify a batch of emails. Bulk suppression check first, then only probe unsuppressed.
 * Capped at MAX_BATCH_SIZE to prevent Worker timeout.
 */
export async function verifyEmailBatch(emails: string[]): Promise<Map<string, VerificationResult>> {
	const results = new Map<string, VerificationResult>();
	if (emails.length === 0) return results;

	const unique = [...new Set(emails)].slice(0, MAX_BATCH_SIZE);
	const toProbe: string[] = [];

	// 1. Bulk suppression check
	try {
		const suppressed = await prisma.suppressedEmail.findMany({
			where: { email: { in: unique } }
		});

		const now = new Date();
		const expiredIds: string[] = [];

		for (const s of suppressed) {
			if (s.expiresAt > now) {
				results.set(s.email, { email: s.email, verdict: 'undeliverable', reason: s.reason, source: 'suppression_list' });
			} else {
				expiredIds.push(s.id);
			}
		}

		// Clean expired entries — awaited to stay within ALS scope
		if (expiredIds.length > 0) {
			await prisma.suppressedEmail.deleteMany({ where: { id: { in: expiredIds } } }).catch(() => {});
		}
	} catch (err) {
		console.warn('[email-verification] Bulk suppression check failed:', err);
	}

	// Collect unsuppressed emails for probing
	for (const email of unique) {
		if (!results.has(email)) toProbe.push(email);
	}

	// 2. SMTP probe unsuppressed emails
	if (toProbe.length > 0) {
		const probeResults = await checkEmailBatch(toProbe);

		for (const email of toProbe) {
			const reacher = probeResults.get(email);
			if (!reacher) {
				results.set(email, { email, verdict: 'unknown', reason: 'reacher_unavailable', source: 'degraded' });
				continue;
			}

			const { verdict, reason } = mapVerdict(reacher);

			// Awaited to stay within ALS scope on Workers
			if (verdict === 'undeliverable') {
				await suppressEmail(email, reason, 'verification', reacher);
			}

			results.set(email, { email, verdict, reason, source: 'smtp_probe', reacherData: reacher });
		}
	}

	return results;
}

/**
 * Threshold for independent user reports before auto-suppression.
 * Count-only suppression also requires at least one probe confirming
 * "undeliverable" across any prior report for this email.
 */
const REPORT_THRESHOLD = 3;

/**
 * Protected government domains — never auto-suppressed by user reports alone.
 * These require admin review regardless of report count or probe result.
 */
const PROTECTED_DOMAINS = new Set([
	// Broad government TLDs — catches all subdomains (e.g., state.gov, ca.gov, ny.gov)
	'gov', 'mil',
	// UK government (gov.uk covers parliament.uk subdomains too)
	'gov.uk', 'parliament.uk', 'parliament.scot', 'senedd.wales',
	// Canada
	'gc.ca', 'parl.gc.ca',
	// Australia
	'gov.au',
	// New Zealand
	'govt.nz',
	// EU (future-proofing)
	'europa.eu',
]);

/** Check if an email domain is a protected government domain */
function isProtectedDomain(domain: string): boolean {
	const lower = domain.toLowerCase();
	for (const pd of PROTECTED_DOMAINS) {
		if (lower === pd || lower.endsWith('.' + pd)) return true;
	}
	return false;
}

export interface BounceReportResult {
	/** Whether the email was suppressed as a result of this report */
	suppressed: boolean;
	/** Whether the email is on a protected domain (requires admin review) */
	protectedDomain: boolean;
	/** How many independent users have reported this email */
	reportCount: number;
}

/**
 * Report a bounce from a user. Does NOT immediately suppress.
 *
 * Flow:
 * 1. Record the report in BounceReport (triage table), return immediately.
 * 2. SMTP probe is NOT run in the request path — it is deferred to
 *    `processPendingBounceReports()` which runs on a scheduled worker.
 * 3. Protected government domains (.gov, .parliament.uk, etc.) are NEVER
 *    auto-suppressed — they require admin review.
 *
 * Throws on DB failure so the endpoint can return 500.
 */
export async function reportBounce(email: string, reportedBy: string): Promise<BounceReportResult> {
	const at = email.indexOf('@');
	const domain = at > 0 ? email.slice(at + 1).toLowerCase() : '';
	const protectedDomain = isProtectedDomain(domain);

	// Compute email_hash + encrypted_email for at-rest protection
	const reportId = crypto.randomUUID();
	const [emailHash, encEmailRaw] = await Promise.all([
		computeEmailHash(email).catch(() => null),
		encryptPii(email, `bounce-report:${reportId}`)
	]);

	// Store the report (dual-write: plaintext + hash + encrypted)
	await prisma.bounceReport.create({
		data: {
			id: reportId,
			email,
			email_hash: emailHash,
			encrypted_email: encEmailRaw ? JSON.stringify(encEmailRaw) : null,
			domain,
			reportedBy
		}
	});

	// Count independent reporters (distinct users, unresolved)
	const distinctReporters = await prisma.bounceReport.findMany({
		where: { email, resolved: false },
		distinct: ['reportedBy'],
		select: { reportedBy: true }
	});
	const reportCount = distinctReporters.length;

	// Protected domains: never auto-suppress, always require admin review
	if (protectedDomain) {
		return { suppressed: false, protectedDomain: true, reportCount };
	}

	// Non-protected domains: suppress only if threshold met AND a recent probe confirmed undeliverable
	if (reportCount >= REPORT_THRESHOLD) {
		// Check for a recent undeliverable probe (within 90 days — stale probes are not reliable evidence)
		const probeMaxAge = new Date();
		probeMaxAge.setDate(probeMaxAge.getDate() - 90);
		const probeCorroboration = await prisma.bounceReport.findFirst({
			where: { email, probeResult: 'undeliverable', createdAt: { gte: probeMaxAge } }
		});

		if (probeCorroboration) {
			await suppressEmail(email, 'bounce_report', 'user_report', undefined, reportedBy);
			await prisma.bounceReport.updateMany({
				where: { email, resolved: false },
				data: { resolved: true }
			}).catch(() => {});
			return { suppressed: true, protectedDomain: false, reportCount };
		}
	}

	// Not enough evidence — report stored, probe will run asynchronously
	return { suppressed: false, protectedDomain: false, reportCount };
}

/** Max age before unresolved reports are auto-resolved (prevents permanent cap exhaustion) */
const STALE_REPORT_DAYS = 30;

/**
 * Process pending bounce reports — runs off the request path (scheduled worker/cron).
 * Probes unresolved reports, annotates with result, and suppresses if confirmed.
 *
 * Retries reports where probe returned 'unknown' (transient Reacher failure).
 * Uses batch probing with concurrency for throughput.
 *
 * @param batchSize Max unique emails to probe per invocation (default 6 —
 *   constrained by CF Workers: 6 emails / concurrency 3 = 2 rounds * 15s timeout = 30s worst case)
 */
export async function processPendingBounceReports(batchSize = 6): Promise<{ processed: number; suppressed: number; staleResolved: number }> {
	// 1. Auto-resolve stale reports (prevents permanent cap exhaustion)
	const staleThreshold = new Date();
	staleThreshold.setDate(staleThreshold.getDate() - STALE_REPORT_DAYS);

	const { count: staleResolved } = await prisma.bounceReport.updateMany({
		where: { resolved: false, createdAt: { lt: staleThreshold } },
		data: { resolved: true, probeResult: 'expired' }
	});

	// 2. Find unresolved reports that need probing (null OR prior 'unknown' for retry)
	const pending = await prisma.bounceReport.findMany({
		where: {
			resolved: false,
			OR: [
				{ probeResult: null },
				{ probeResult: 'unknown' },
			],
		},
		orderBy: { createdAt: 'asc' },
		take: batchSize * 3, // Over-fetch to get enough distinct emails
		distinct: ['email'],
	});

	const uniqueEmails = pending.slice(0, batchSize);
	if (uniqueEmails.length === 0) {
		return { processed: 0, suppressed: 0, staleResolved };
	}

	// 3. Batch probe with concurrency (uses existing checkEmailBatch)
	const emailList = uniqueEmails.map(r => r.email);
	const probeResults = await checkEmailBatch(emailList);

	let processed = 0;
	let suppressed = 0;

	for (const report of uniqueEmails) {
		processed++;
		const probeResult = probeResults.get(report.email);
		const verdict = probeResult ? mapVerdict(probeResult).verdict : 'unknown';

		// Annotate ALL unresolved reports for this email with the probe result
		await prisma.bounceReport.updateMany({
			where: { email: report.email, resolved: false },
			data: { probeResult: verdict }
		});

		// If probe confirms undeliverable AND domain is not protected → suppress
		if (verdict === 'undeliverable' && !isProtectedDomain(report.domain)) {
			await suppressEmail(
				report.email,
				probeResult ? mapVerdict(probeResult).reason : 'bounce_report',
				'user_report',
				probeResult ?? undefined,
				report.reportedBy
			);
			await prisma.bounceReport.updateMany({
				where: { email: report.email, resolved: false },
				data: { resolved: true }
			});
			suppressed++;
		}

		// If probe confirms deliverable → auto-resolve (dismiss reports)
		if (verdict === 'deliverable') {
			await prisma.bounceReport.updateMany({
				where: { email: report.email, resolved: false },
				data: { resolved: true }
			});
		}

		// 'unknown' and 'risky' stay unresolved for retry on next worker run
		// (but will be auto-resolved by stale TTL after STALE_REPORT_DAYS)
	}

	return { processed, suppressed, staleResolved };
}
