import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const email = source('convex/email.ts');
const blasts = source('convex/blasts.ts');
const sms = source('convex/sms.ts');
const dispatchGate = source('convex/lib/audienceDispatchGate.ts');
const features = source('src/lib/config/features.ts');
const compose = source('src/routes/org/[slug]/emails/compose/+page.svelte');
const sesToken = source('src/routes/api/org/[slug]/ses-token/+server.ts');
const dispatchClaim = source('src/routes/api/blast/[blastId]/dispatch-claim/+server.ts');
const smsRoute = source('src/routes/api/org/[slug]/sms/[id]/+server.ts');
const emailRecipients = source('convex/_emailRecipientFilter.ts');
const supporterBrowse = source('convex/lib/supporterBrowse.ts');
const clientSender = source('src/lib/services/client-blast-sender.ts');

function exportedSection(moduleSource: string, name: string): string {
	const start = moduleSource.indexOf(`export const ${name}`);
	expect(start, `${name} export`).toBeGreaterThanOrEqual(0);
	const next = moduleSource.indexOf('\nexport const ', start + 20);
	return moduleSource.slice(start, next === -1 ? undefined : next);
}

function privateSection(moduleSource: string, marker: string, nextMarker: string): string {
	const start = moduleSource.indexOf(marker);
	expect(start, marker).toBeGreaterThanOrEqual(0);
	const end = moduleSource.indexOf(nextMarker, start + marker.length);
	expect(end, nextMarker).toBeGreaterThan(start);
	return moduleSource.slice(start, end);
}

function expectGateBefore(moduleSource: string, name: string, firstRead: string): void {
	const body = exportedSection(moduleSource, name);
	const gate = body.indexOf('requireAudienceDispatchJobsReady()');
	const read = body.indexOf(firstRead);
	expect(gate, `${name} gate`).toBeGreaterThanOrEqual(0);
	expect(read, `${name} first protected read`).toBeGreaterThan(gate);
}

describe('bulk audience dispatch launch authority', () => {
	it('uses one immutable-job gate whose launch state is fail-closed', () => {
		expect(dispatchGate).toMatch(/AUDIENCE_DISPATCH_JOBS_READY\s*=\s*false/);
		expect(dispatchGate).toContain("throw new Error('AUDIENCE_DISPATCH_JOBS_NOT_READY')");
	});

	it('gates every email server, browser, scheduled, and enclave entry before a cohort read', () => {
		for (const [name, firstRead] of [
			['getBlastForEditor', 'ctx.db.get'],
			['enqueueServerDispatch', 'ctx.db.get'],
			['enqueueAbTestDispatch', 'ctx.db.get'],
			['enqueueAbRemainderDispatch', 'materializeAbRemainderDraft'],
			['getBlastRecipients', 'pageFilteredRecipients'],
			['sendBlast', 'ctx.runQuery'],
			['sendBlastBatch', 'ctx.runQuery']
		] as const) {
			expectGateBefore(email, name, firstRead);
		}
		const exactQueue = privateSection(
			email,
			'async function queueExactServerDispatch',
			'// ============================================================================='
		);
		expect(exactQueue.indexOf('requireAudienceDispatchJobsReady()')).toBeGreaterThanOrEqual(0);
		expect(exactQueue.indexOf('ctx.db.get')).toBeGreaterThan(
			exactQueue.indexOf('requireAudienceDispatchJobsReady()')
		);

		for (const [name, firstRead] of [
			['sealAndScheduleBlast', 'ctx.db.get'],
			['dispatchScheduledBlast', 'ctx.runMutation'],
			['triggerEnclaveSend', 'ctx.runQuery'],
			['claimForBlastDispatch', 'ctx.db.get'],
			['processScheduledBlasts', 'ctx.runQuery'],
			['getEncryptedSupporters', 'ctx.db.get'],
			['getEncryptedSupportersForBlast', 'ctx.db.get'],
			['updateClientBlastProgress', 'ctx.db.get']
		] as const) {
			expectGateBefore(blasts, name, firstRead);
		}
	});

	it('gates every SMS cohort/counter advance before a supporter or blast read', () => {
		for (const name of [
			'getEncryptedRecipientsForBlast',
			'recordDispatchBatch',
			'advanceEmptyDispatchPage'
		] as const) {
			expectGateBefore(sms, name, 'ctx.db.get');
		}
	});

	it('keeps both frontend delivery flags false and browser-direct email behind the email flag', () => {
		expect(features).toMatch(/EMAIL_SERVER_DISPATCH:\s*false/);
		expect(features).toMatch(/SMS_DISPATCH:\s*false/);
		const browserReady = privateSection(
			compose,
			'const browserDirectReady',
			'const browserDirectExecutable'
		);
		expect(browserReady).toContain('FEATURES.EMAIL_SERVER_DISPATCH');
	});

	it('gates every external credential/carrier chokepoint before mint, cohort read, or send', () => {
		const stsHandler = sesToken.slice(sesToken.indexOf('export const POST'));
		const stsTombstone = stsHandler.indexOf('if (!FEATURES.EMAIL_SERVER_DISPATCH)');
		const sharedGate = stsHandler.indexOf('requireAudienceDispatchJobsReady()');
		expect(stsTombstone).toBeGreaterThanOrEqual(0);
		expect(sharedGate).toBeGreaterThan(stsTombstone);
		expect(sharedGate).toBeGreaterThanOrEqual(0);
		expect(stsHandler.indexOf('api.organizations.getOrgContext')).toBeGreaterThan(sharedGate);
		expect(stsHandler.indexOf('new AssumeRoleCommand')).toBeGreaterThan(sharedGate);

		const claimHandler = dispatchClaim.slice(dispatchClaim.indexOf('export const GET'));
		const claimTombstone = claimHandler.indexOf('if (!FEATURES.EMAIL_SERVER_DISPATCH)');
		const claimCohort = claimHandler.indexOf('api.blasts.getEncryptedSupportersForBlast');
		const claimMint = claimHandler.indexOf('= signDispatchClaim(');
		expect(claimTombstone).toBeGreaterThanOrEqual(0);
		expect(claimCohort).toBeGreaterThan(claimTombstone);
		expect(claimCohort).toBeGreaterThanOrEqual(0);
		expect(claimMint).toBeGreaterThan(claimCohort);

		const browserHandler = clientSender.slice(clientSender.indexOf('export async function sendBlastFromClient'));
		const browserTombstone = browserHandler.indexOf('if (!FEATURES.EMAIL_SERVER_DISPATCH)');
		expect(browserTombstone).toBeGreaterThanOrEqual(0);
		expect(browserHandler.indexOf('await fetch(')).toBeGreaterThan(browserTombstone);
		expect(browserHandler.indexOf('await decryptOrgPii(')).toBeGreaterThan(browserTombstone);

		const smsFeature = smsRoute.indexOf('featureEnabled: FEATURES.SMS_DISPATCH');
		const smsCohort = smsRoute.indexOf('api.sms.getEncryptedRecipientsForBlast');
		const carrierSend = smsRoute.indexOf('await sendSms(');
		expect(smsFeature).toBeGreaterThanOrEqual(0);
		expect(smsCohort).toBeGreaterThan(smsFeature);
		expect(carrierSend).toBeGreaterThan(smsCohort);
	});
});

describe('audience and People read cost envelopes', () => {
	it('caps each email and SMS audience transaction at exactly 512 KiB and fails split pages closed', () => {
		expect(emailRecipients).toMatch(/RECIPIENT_MAX_BYTES_PER_PAGE\s*=\s*512\s*\*\s*1024/);
		expect(emailRecipients).toContain("throw new Error('EMAIL_AUDIENCE_PAGE_SPLIT_REQUIRED')");
		expect(sms).toMatch(/SMS_RECIPIENT_MAX_BYTES_PER_PAGE\s*=\s*512\s*\*\s*1024/);
		expect(sms).toContain("throw new Error('SMS_AUDIENCE_PAGE_SPLIT_REQUIRED')");
	});

	it('caps People/API pages at 512 KiB and closes the unbounded tag-link point-read fanout', () => {
		expect(supporterBrowse).toMatch(/MAX_SUPPORTER_BROWSE_PAGE_BYTES\s*=\s*512\s*\*\s*1024/);
		expect(supporterBrowse).toContain('maximumBytesRead: MAX_SUPPORTER_BROWSE_PAGE_BYTES');
		const tagBranch = privateSection(
			supporterBrowse,
			'if (args.filters?.tagId)',
			'\n\tconst result ='
		);
		expect(tagBranch).toContain('SUPPORTER_TAG_BROWSE_PROJECTION_NOT_READY');
		expect(tagBranch).not.toContain('ctx.db.get');
		expect(tagBranch).not.toContain('Promise.all');
	});
});
