import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const authority = source('convex/lib/contactAuthority.ts');
const webhooks = source('convex/webhooks.ts');
const email = source('convex/email.ts');
const supporters = source('convex/supporters.ts');
const http = source('convex/http.ts');
const schema = source('convex/schema.ts');
const observability = source('convex/observability.ts');

function exportedSection(moduleSource: string, name: string): string {
	const start = moduleSource.indexOf(`export const ${name}`);
	expect(start, `${name} export`).toBeGreaterThanOrEqual(0);
	const next = moduleSource.indexOf('\nexport const ', start + 20);
	return moduleSource.slice(start, next === -1 ? undefined : next);
}

describe('contact authority static launch contract', () => {
	it('commits bounded idempotent ingress and never globally re-enables an unscoped START', () => {
		const inbound = exportedSection(webhooks, 'handleInboundSms');
		expect(inbound).toContain('messageSid: v.string()');
		expect(inbound).toContain(".withIndex('by_phoneNumber'");
		expect(inbound).toContain('.take(2)');
		expect(inbound).toContain("kind === 'sms_start' ? 'SMS_START' : 'SMS_REPLY'");
		expect(inbound).toContain('`${prefix}_ROUTE_MISSING`');
		expect(inbound).toContain('`${prefix}_ROUTE_UNREGISTERED`');
		expect(inbound).toContain('`${prefix}_ROUTE_AMBIGUOUS`');
		expect(inbound).toContain('!result.failed && kind !== \'sms_reply\'');
		expect(inbound).not.toContain('.collect(');
		expect(authority).toContain('CONTACT_FANOUT_INPUT_MAX = 50');
		expect(authority).toContain('CONTACT_FANOUT_PAGE_SIZE = 32');
		expect(authority).toContain('CONTACT_FANOUT_PAGE_MAX_BYTES = 256 * 1024');
	});

	it('uses exact authority indexes and bumps one OCC-serialized epoch in every authority write', () => {
		expect(schema).toContain(
			".index('by_channel_contactHash_scopeOrgId', ['channel', 'contactHash', 'scopeOrgId'])"
		);
		expect(schema).toContain("contactAuthorityEpochs: defineTable");
		expect(schema).toContain("key: v.literal('global')");
		const writerStart = authority.indexOf('async function writeContactAuthority');
		const writerEnd = authority.indexOf('\nexport async function applyEmailAuthorityEvent', writerStart);
		const writer = authority.slice(writerStart, writerEnd);
		expect(writer).toContain('await bumpContactAuthorityEpoch(ctx, effectiveUpdatedAt)');
		expect(authority).toContain('export async function assertEmailSupporterSendAuthorized');
		expect(authority).toContain('export async function seedContactAuthorityFromSupporter');
	});

	it('invalidates materialized cohorts on local unsubscribe and SMS consent transitions', () => {
		const blastUnsubscribe = exportedSection(email, 'applyUnsubscribeByBlastEmail');
		const supporterUnsubscribe = exportedSection(supporters, 'unsubscribe');
		const smsStatus = exportedSection(supporters, 'updateSmsStatus');
		for (const section of [blastUnsubscribe, supporterUnsubscribe, smsStatus]) {
			expect(section).toContain('bumpContactAuthorityEpoch(ctx, now)');
		}
		expect(supporters).toContain(
			'if (contactEligibilityChanged) await bumpContactAuthorityEpoch(ctx, Date.now())'
		);
	});

	it('turns manual bounce consensus into a bounded job instead of a global supporter collection', () => {
		const suppression = exportedSection(email, 'suppressReportedBounce');
		expect(email).toContain('USER_BOUNCE_REPORT_WRITE_CAP = 100');
		expect(suppression).toContain(".withIndex('by_emailHash_expiresAt'");
		expect(suppression).toContain('enqueueContactFanoutJob(ctx');
		expect(suppression).toContain('applyManualEmailSuppressionAuthority(ctx');
		expect(suppression).not.toContain('.collect(');
	});

	it('acknowledges providers only after durable processing and keeps recovery evidence', () => {
		const sesCatch = http.slice(http.indexOf('[webhooks/ses] Processing failed'));
		expect(sesCatch).toContain('status: 503');
		const twilioCatch = http.slice(http.indexOf('[webhooks/twilio/inbound] Processing failed'));
		expect(twilioCatch).toContain('status: 503');
		expect(schema).toContain('contactFanoutJobEvents: defineTable');
		const retry = exportedSection(webhooks, 'retryContactFanoutJob');
		expect(retry).toContain("type: 'operator_retry'");
		expect(retry).toContain("status: 'pending'");
		expect(retry).toContain('attempts: 0');
		expect(retry).toContain('completedAt: undefined');
	});

	it('fails launch readiness on migration, pending work, or terminal fanout evidence', () => {
		expect(observability).toContain('contactAuthority: launchPlane(');
		expect(observability).toContain('failedContactFanoutJob === null');
		expect(observability).toContain('pendingContactFanoutJob === null');
		const readiness = exportedSection(webhooks, 'contactFanoutReadiness');
		expect(readiness).toContain('CONTACT_FANOUT_OVERDUE_MS');
		expect(readiness).toContain("q.eq('status', 'failed')");
		expect(readiness).toContain("q.eq('status', 'pending')");
	});
});
