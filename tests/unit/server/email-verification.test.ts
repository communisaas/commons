import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('$lib/core/db', () => {
	const suppressedEmail = {
		findUnique: vi.fn(),
		findMany: vi.fn(),
		delete: vi.fn(),
		deleteMany: vi.fn(),
		upsert: vi.fn()
	};
	const bounceReport = {
		create: vi.fn(),
		findFirst: vi.fn(),
		findMany: vi.fn(),
		updateMany: vi.fn()
	};
	return {
		prisma: { suppressedEmail, bounceReport },
		db: { suppressedEmail, bounceReport }
	};
});

vi.mock('$lib/server/reacher-client', () => ({
	checkEmail: vi.fn(),
	checkEmailBatch: vi.fn()
}));

import { verifyEmail, verifyEmailBatch, reportBounce, processPendingBounceReports } from '$lib/server/email-verification';
import { prisma } from '$lib/core/db';
import { checkEmail, checkEmailBatch } from '$lib/server/reacher-client';
import type { ReacherResult } from '$lib/server/reacher-client';

const mockSuppressed = prisma.suppressedEmail as unknown as {
	findUnique: ReturnType<typeof vi.fn>;
	findMany: ReturnType<typeof vi.fn>;
	delete: ReturnType<typeof vi.fn>;
	deleteMany: ReturnType<typeof vi.fn>;
	upsert: ReturnType<typeof vi.fn>;
};

const mockBounce = prisma.bounceReport as unknown as {
	create: ReturnType<typeof vi.fn>;
	findFirst: ReturnType<typeof vi.fn>;
	findMany: ReturnType<typeof vi.fn>;
	updateMany: ReturnType<typeof vi.fn>;
};

const mockCheckEmail = checkEmail as ReturnType<typeof vi.fn>;
const mockCheckEmailBatch = checkEmailBatch as ReturnType<typeof vi.fn>;

function makeReacherResult(
	email: string,
	verdict: ReacherResult['is_reachable'] = 'safe',
	overrides?: Partial<ReacherResult['smtp']> & { accepts_mail?: boolean }
): ReacherResult {
	const domain = email.split('@')[1];
	const { accepts_mail, ...smtpOverrides } = overrides ?? {};
	return {
		input: email,
		is_reachable: verdict,
		misc: { is_disposable: false, is_role_account: false },
		mx: { accepts_mail: accepts_mail ?? true, records: [`mx.${domain}`] },
		smtp: {
			can_connect_smtp: true,
			has_full_inbox: false,
			is_catch_all: verdict === 'risky',
			is_deliverable: verdict === 'safe',
			is_disabled: false,
			...smtpOverrides
		},
		syntax: { address: email, domain, is_valid_syntax: true, username: email.split('@')[0] }
	};
}

describe('email-verification', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSuppressed.findUnique.mockResolvedValue(null);
		mockSuppressed.findMany.mockResolvedValue([]);
		mockSuppressed.delete.mockResolvedValue({});
		mockSuppressed.deleteMany.mockResolvedValue({ count: 0 });
		mockSuppressed.upsert.mockResolvedValue({});
		mockBounce.create.mockResolvedValue({});
		mockBounce.findFirst.mockResolvedValue(null);
		mockBounce.findMany.mockResolvedValue([]);
		mockBounce.updateMany.mockResolvedValue({ count: 0 });
	});

	describe('verifyEmail', () => {
		it('short-circuits on suppressed email', async () => {
			mockSuppressed.findUnique.mockResolvedValueOnce({
				email: 'bad@example.com',
				reason: 'smtp_invalid',
				expiresAt: new Date(Date.now() + 86400000)
			});

			const result = await verifyEmail('bad@example.com');

			expect(result.verdict).toBe('undeliverable');
			expect(result.source).toBe('suppression_list');
			expect(mockCheckEmail).not.toHaveBeenCalled();
		});

		it('re-verifies expired suppression', async () => {
			mockSuppressed.findUnique.mockResolvedValueOnce({
				email: 'expired@example.com',
				reason: 'smtp_invalid',
				expiresAt: new Date(Date.now() - 86400000)
			});
			mockCheckEmail.mockResolvedValueOnce(makeReacherResult('expired@example.com', 'safe'));

			const result = await verifyEmail('expired@example.com');

			expect(result.verdict).toBe('deliverable');
			expect(result.source).toBe('smtp_probe');
			expect(mockSuppressed.delete).toHaveBeenCalled();
		});

		it('returns unknown when Reacher is unavailable', async () => {
			mockCheckEmail.mockResolvedValueOnce(null);

			const result = await verifyEmail('test@example.com');

			expect(result.verdict).toBe('unknown');
			expect(result.source).toBe('degraded');
		});

		it('falls through to probe when suppression lookup fails', async () => {
			mockSuppressed.findUnique.mockRejectedValueOnce(new Error('DB down'));
			mockCheckEmail.mockResolvedValueOnce(makeReacherResult('db-fail@example.com', 'safe'));

			const result = await verifyEmail('db-fail@example.com');

			expect(result.verdict).toBe('deliverable');
			expect(result.source).toBe('smtp_probe');
		});

		it('maps safe verdict to deliverable', async () => {
			mockCheckEmail.mockResolvedValueOnce(makeReacherResult('good@example.com', 'safe'));

			const result = await verifyEmail('good@example.com');

			expect(result.verdict).toBe('deliverable');
			expect(result.reason).toBe('smtp_deliverable');
		});

		it('maps invalid verdict to undeliverable and suppresses with correct payload', async () => {
			mockCheckEmail.mockResolvedValueOnce(makeReacherResult('dead@example.com', 'invalid'));

			const result = await verifyEmail('dead@example.com');

			expect(result.verdict).toBe('undeliverable');
			expect(mockSuppressed.upsert).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { email: 'dead@example.com' },
					create: expect.objectContaining({
						email: 'dead@example.com',
						domain: 'example.com',
						reason: 'smtp_invalid',
						source: 'verification'
					})
				})
			);
		});

		it('maps smtp_disabled to undeliverable', async () => {
			mockCheckEmail.mockResolvedValueOnce(
				makeReacherResult('disabled@example.com', 'invalid', { is_disabled: true })
			);

			const result = await verifyEmail('disabled@example.com');

			expect(result.verdict).toBe('undeliverable');
			expect(result.reason).toBe('smtp_disabled');
		});

		it('maps full_inbox to risky (temporary condition)', async () => {
			mockCheckEmail.mockResolvedValueOnce(
				makeReacherResult('full@example.com', 'invalid', { has_full_inbox: true })
			);

			const result = await verifyEmail('full@example.com');

			expect(result.verdict).toBe('risky');
			expect(result.reason).toBe('full_inbox');
			// Should NOT suppress — temporary condition
			expect(mockSuppressed.upsert).not.toHaveBeenCalled();
		});

		it('maps dns_no_mx to undeliverable', async () => {
			mockCheckEmail.mockResolvedValueOnce(
				makeReacherResult('nomx@example.com', 'invalid', { accepts_mail: false })
			);

			const result = await verifyEmail('nomx@example.com');

			expect(result.verdict).toBe('undeliverable');
			expect(result.reason).toBe('dns_no_mx');
		});

		it('maps risky catch-all correctly', async () => {
			mockCheckEmail.mockResolvedValueOnce(makeReacherResult('catchall@example.com', 'risky'));

			const result = await verifyEmail('catchall@example.com');

			expect(result.verdict).toBe('risky');
			expect(result.reason).toBe('catch_all');
		});

		it('maps risky non-catch-all correctly', async () => {
			mockCheckEmail.mockResolvedValueOnce(
				makeReacherResult('risky@example.com', 'risky', { is_catch_all: false })
			);

			const result = await verifyEmail('risky@example.com');

			expect(result.verdict).toBe('risky');
			expect(result.reason).toBe('risky_other');
		});

		it('maps unknown verdict correctly', async () => {
			mockCheckEmail.mockResolvedValueOnce(makeReacherResult('mystery@example.com', 'unknown'));

			const result = await verifyEmail('mystery@example.com');

			expect(result.verdict).toBe('unknown');
			expect(result.reason).toBe('smtp_inconclusive');
		});

		it('still returns result when suppression write fails', async () => {
			mockCheckEmail.mockResolvedValueOnce(makeReacherResult('bad@example.com', 'invalid'));
			mockSuppressed.upsert.mockRejectedValueOnce(new Error('DB write failed'));

			const result = await verifyEmail('bad@example.com');

			expect(result.verdict).toBe('undeliverable');
			// Default invalid (accepts_mail: true, not disabled, not full) → smtp_invalid
			expect(result.reason).toBe('smtp_invalid');
		});
	});

	describe('verifyEmailBatch', () => {
		it('skips suppressed emails in batch probe', async () => {
			mockSuppressed.findMany.mockResolvedValueOnce([
				{
					id: '1',
					email: 'suppressed@example.com',
					reason: 'bounce_report',
					expiresAt: new Date(Date.now() + 86400000)
				}
			]);

			mockCheckEmailBatch.mockResolvedValueOnce(
				new Map([['good@example.com', makeReacherResult('good@example.com', 'safe')]])
			);

			const results = await verifyEmailBatch(['suppressed@example.com', 'good@example.com']);

			expect(results.get('suppressed@example.com')?.verdict).toBe('undeliverable');
			expect(results.get('good@example.com')?.verdict).toBe('deliverable');
			expect(mockCheckEmailBatch).toHaveBeenCalledWith(['good@example.com']);
		});

		it('cleans expired suppressions and re-probes', async () => {
			mockSuppressed.findMany.mockResolvedValueOnce([
				{
					id: 'exp-1',
					email: 'old@example.com',
					reason: 'smtp_invalid',
					expiresAt: new Date(Date.now() - 86400000)
				}
			]);

			mockCheckEmailBatch.mockResolvedValueOnce(
				new Map([['old@example.com', makeReacherResult('old@example.com', 'safe')]])
			);

			const results = await verifyEmailBatch(['old@example.com']);

			expect(results.get('old@example.com')?.verdict).toBe('deliverable');
			expect(mockSuppressed.deleteMany).toHaveBeenCalledWith({
				where: { id: { in: ['exp-1'] } }
			});
		});

		it('falls through to probe when bulk suppression check fails', async () => {
			mockSuppressed.findMany.mockRejectedValueOnce(new Error('DB down'));
			mockCheckEmailBatch.mockResolvedValueOnce(
				new Map([['test@example.com', makeReacherResult('test@example.com', 'safe')]])
			);

			const results = await verifyEmailBatch(['test@example.com']);

			expect(results.get('test@example.com')?.verdict).toBe('deliverable');
		});

		it('returns empty map for empty input', async () => {
			const results = await verifyEmailBatch([]);
			expect(results.size).toBe(0);
		});

		it('handles Reacher unavailable in batch gracefully', async () => {
			mockCheckEmailBatch.mockResolvedValueOnce(
				new Map([['down@example.com', null]])
			);

			const results = await verifyEmailBatch(['down@example.com']);

			expect(results.get('down@example.com')?.verdict).toBe('unknown');
			expect(results.get('down@example.com')?.source).toBe('degraded');
		});
	});

	describe('reportBounce (triage architecture)', () => {
		it('stores report in BounceReport table without immediate suppression', async () => {
			// Single reporter — should NOT suppress
			mockBounce.findMany.mockResolvedValueOnce([{ reportedBy: 'user-1' }]);

			const result = await reportBounce('test@example.com', 'user-1');

			expect(mockBounce.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					email: 'test@example.com',
					domain: 'example.com',
					reportedBy: 'user-1'
				})
			});
			expect(result.suppressed).toBe(false);
			expect(result.reportCount).toBe(1);
			// Should NOT touch suppression table
			expect(mockSuppressed.upsert).not.toHaveBeenCalled();
		});

		it('returns protectedDomain=true for .gov emails', async () => {
			mockBounce.findMany.mockResolvedValueOnce([{ reportedBy: 'user-1' }]);

			const result = await reportBounce('official@senate.gov', 'user-1');

			expect(result.protectedDomain).toBe(true);
			expect(result.suppressed).toBe(false);
			expect(mockSuppressed.upsert).not.toHaveBeenCalled();
		});

		it('returns protectedDomain=true for .gov.uk subdomains', async () => {
			mockBounce.findMany.mockResolvedValueOnce([{ reportedBy: 'user-1' }]);

			const result = await reportBounce('mp@parliament.gov.uk', 'user-1');

			expect(result.protectedDomain).toBe(true);
		});

		it('does NOT flag fakegov.com as protected (suffix matching)', async () => {
			mockBounce.findMany.mockResolvedValueOnce([{ reportedBy: 'user-1' }]);

			const result = await reportBounce('phish@fakegov.com', 'user-1');

			expect(result.protectedDomain).toBe(false);
		});

		it('never auto-suppresses protected domains even with 3+ reporters + probe', async () => {
			// 3 distinct reporters
			mockBounce.findMany.mockResolvedValueOnce([
				{ reportedBy: 'user-1' },
				{ reportedBy: 'user-2' },
				{ reportedBy: 'user-3' }
			]);
			// Prior probe confirmed undeliverable
			mockBounce.findFirst.mockResolvedValueOnce({ probeResult: 'undeliverable' });

			const result = await reportBounce('senator@senate.gov', 'user-3');

			expect(result.protectedDomain).toBe(true);
			expect(result.suppressed).toBe(false);
			// Protected domain check short-circuits before threshold logic
			expect(mockBounce.findFirst).not.toHaveBeenCalled();
		});

		it('does NOT suppress with 3 reporters but no probe corroboration', async () => {
			mockBounce.findMany.mockResolvedValueOnce([
				{ reportedBy: 'user-1' },
				{ reportedBy: 'user-2' },
				{ reportedBy: 'user-3' }
			]);
			// No prior probe result
			mockBounce.findFirst.mockResolvedValueOnce(null);

			const result = await reportBounce('disputed@example.com', 'user-3');

			expect(result.suppressed).toBe(false);
			expect(result.reportCount).toBe(3);
			expect(mockSuppressed.upsert).not.toHaveBeenCalled();
		});

		it('does NOT suppress when probe corroboration is stale (>90 days)', async () => {
			mockBounce.findMany.mockResolvedValueOnce([
				{ reportedBy: 'user-1' },
				{ reportedBy: 'user-2' },
				{ reportedBy: 'user-3' }
			]);
			// findFirst with recency filter returns null (no recent probe)
			mockBounce.findFirst.mockResolvedValueOnce(null);

			const result = await reportBounce('stale-probe@example.com', 'user-3');

			expect(result.suppressed).toBe(false);
			// Verify the query includes a createdAt filter
			expect(mockBounce.findFirst).toHaveBeenCalledWith({
				where: expect.objectContaining({
					email: 'stale-probe@example.com',
					probeResult: 'undeliverable',
					createdAt: expect.objectContaining({ gte: expect.any(Date) })
				})
			});
		});

		it('suppresses when 3+ reporters AND probe corroboration exists', async () => {
			mockBounce.findMany.mockResolvedValueOnce([
				{ reportedBy: 'user-1' },
				{ reportedBy: 'user-2' },
				{ reportedBy: 'user-3' }
			]);
			mockBounce.findFirst.mockResolvedValueOnce({ probeResult: 'undeliverable' });

			const result = await reportBounce('dead@example.com', 'user-3');

			expect(result.suppressed).toBe(true);
			expect(result.protectedDomain).toBe(false);
			expect(mockSuppressed.upsert).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { email: 'dead@example.com' },
					create: expect.objectContaining({
						source: 'user_report',
						reason: 'bounce_report',
						reportedBy: 'user-3'
					})
				})
			);
			// Should resolve all reports for this email
			expect(mockBounce.updateMany).toHaveBeenCalledWith({
				where: { email: 'dead@example.com', resolved: false },
				data: { resolved: true }
			});
		});

		it('does NOT suppress with only 2 reporters even with probe', async () => {
			mockBounce.findMany.mockResolvedValueOnce([
				{ reportedBy: 'user-1' },
				{ reportedBy: 'user-2' }
			]);

			const result = await reportBounce('maybe@example.com', 'user-2');

			expect(result.suppressed).toBe(false);
			expect(result.reportCount).toBe(2);
			// Threshold not met — should not even check probe corroboration
			expect(mockBounce.findFirst).not.toHaveBeenCalled();
		});

		it('propagates DB errors to caller', async () => {
			mockBounce.create.mockRejectedValueOnce(new Error('DB down'));

			await expect(reportBounce('fail@example.com', 'user-1')).rejects.toThrow('DB down');
		});

		it('protects parliament.scot and senedd.wales', async () => {
			mockBounce.findMany.mockResolvedValueOnce([{ reportedBy: 'u1' }]);
			const r1 = await reportBounce('msp@parliament.scot', 'u1');
			expect(r1.protectedDomain).toBe(true);

			mockBounce.findMany.mockResolvedValueOnce([{ reportedBy: 'u1' }]);
			const r2 = await reportBounce('ms@senedd.wales', 'u1');
			expect(r2.protectedDomain).toBe(true);
		});

		it('protects gc.ca and govt.nz', async () => {
			mockBounce.findMany.mockResolvedValueOnce([{ reportedBy: 'u1' }]);
			const r1 = await reportBounce('mp@parl.gc.ca', 'u1');
			expect(r1.protectedDomain).toBe(true);

			mockBounce.findMany.mockResolvedValueOnce([{ reportedBy: 'u1' }]);
			const r2 = await reportBounce('minister@dept.govt.nz', 'u1');
			expect(r2.protectedDomain).toBe(true);
		});
	});

	describe('processPendingBounceReports', () => {
		it('auto-resolves stale reports (>30 days)', async () => {
			mockBounce.updateMany
				.mockResolvedValueOnce({ count: 5 }) // stale resolve
				;
			mockBounce.findMany.mockResolvedValueOnce([]); // no pending

			const result = await processPendingBounceReports();

			expect(result.staleResolved).toBe(5);
			expect(result.processed).toBe(0);
			expect(result.suppressed).toBe(0);
		});

		it('probes pending reports and annotates with verdict', async () => {
			mockBounce.updateMany.mockResolvedValue({ count: 0 });
			mockBounce.findMany.mockResolvedValueOnce([
				{ email: 'probe-me@example.com', domain: 'example.com', reportedBy: 'user-1' }
			]);
			mockCheckEmailBatch.mockResolvedValueOnce(
				new Map([['probe-me@example.com', makeReacherResult('probe-me@example.com', 'safe')]])
			);

			const result = await processPendingBounceReports();

			expect(result.processed).toBe(1);
			// Deliverable → auto-resolve (dismiss)
			expect(mockBounce.updateMany).toHaveBeenCalledWith({
				where: { email: 'probe-me@example.com', resolved: false },
				data: { probeResult: 'deliverable' }
			});
			// Deliverable reports get resolved
			expect(mockBounce.updateMany).toHaveBeenCalledWith({
				where: { email: 'probe-me@example.com', resolved: false },
				data: { resolved: true }
			});
		});

		it('suppresses undeliverable non-protected domain', async () => {
			mockBounce.updateMany.mockResolvedValue({ count: 0 });
			mockBounce.findMany.mockResolvedValueOnce([
				{ email: 'dead@example.com', domain: 'example.com', reportedBy: 'user-1' }
			]);
			mockCheckEmailBatch.mockResolvedValueOnce(
				new Map([['dead@example.com', makeReacherResult('dead@example.com', 'invalid')]])
			);

			const result = await processPendingBounceReports();

			expect(result.suppressed).toBe(1);
			expect(mockSuppressed.upsert).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { email: 'dead@example.com' }
				})
			);
		});

		it('does NOT suppress undeliverable protected domain', async () => {
			mockBounce.updateMany.mockResolvedValue({ count: 0 });
			mockBounce.findMany.mockResolvedValueOnce([
				{ email: 'rep@house.gov', domain: 'house.gov', reportedBy: 'user-1' }
			]);
			mockCheckEmailBatch.mockResolvedValueOnce(
				new Map([['rep@house.gov', makeReacherResult('rep@house.gov', 'invalid')]])
			);

			const result = await processPendingBounceReports();

			expect(result.processed).toBe(1);
			expect(result.suppressed).toBe(0);
			expect(mockSuppressed.upsert).not.toHaveBeenCalled();
		});

		it('leaves unknown/risky reports unresolved for retry', async () => {
			mockBounce.updateMany.mockResolvedValue({ count: 0 });
			mockBounce.findMany.mockResolvedValueOnce([
				{ email: 'maybe@example.com', domain: 'example.com', reportedBy: 'user-1' }
			]);
			mockCheckEmailBatch.mockResolvedValueOnce(
				new Map([['maybe@example.com', makeReacherResult('maybe@example.com', 'unknown')]])
			);

			const result = await processPendingBounceReports();

			expect(result.processed).toBe(1);
			expect(result.suppressed).toBe(0);
			// Annotated with 'unknown' but NOT resolved
			expect(mockBounce.updateMany).toHaveBeenCalledWith({
				where: { email: 'maybe@example.com', resolved: false },
				data: { probeResult: 'unknown' }
			});
		});

		it('handles Reacher unavailable gracefully (unknown verdict)', async () => {
			mockBounce.updateMany.mockResolvedValue({ count: 0 });
			mockBounce.findMany.mockResolvedValueOnce([
				{ email: 'down@example.com', domain: 'example.com', reportedBy: 'user-1' }
			]);
			mockCheckEmailBatch.mockResolvedValueOnce(
				new Map([['down@example.com', null]])
			);

			const result = await processPendingBounceReports();

			expect(result.processed).toBe(1);
			expect(result.suppressed).toBe(0);
			// Annotated with 'unknown' (null probe → unknown)
			expect(mockBounce.updateMany).toHaveBeenCalledWith({
				where: { email: 'down@example.com', resolved: false },
				data: { probeResult: 'unknown' }
			});
		});

		it('returns early when no pending reports', async () => {
			mockBounce.updateMany.mockResolvedValueOnce({ count: 0 });
			mockBounce.findMany.mockResolvedValueOnce([]);

			const result = await processPendingBounceReports();

			expect(result.processed).toBe(0);
			expect(mockCheckEmailBatch).not.toHaveBeenCalled();
		});
	});
});
