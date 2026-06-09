import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function source(rel: string): string {
	return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

describe('donation confirmation outcome register', () => {
	it('stores baseline donor-confirmation outcomes on donation rows', () => {
		const schema = source('convex/schema.ts');

		expect(schema).toContain('confirmationEmailStatus: v.optional');
		expect(schema).toContain("v.literal('sending')");
		expect(schema).toContain("v.literal('sent')");
		expect(schema).toContain("v.literal('skipped')");
		expect(schema).toContain("v.literal('failed')");
		expect(schema).toContain('confirmationEmailAttemptedAt: v.optional(v.number())');
		expect(schema).toContain('confirmationEmailSentAt: v.optional(v.number())');
		expect(schema).toContain('confirmationEmailFailureReason: v.optional(v.string())');
		expect(schema).toContain('confirmationEmailProvider: v.optional(v.string())');
		expect(schema).toContain('confirmationEmailProviderMessageId: v.optional(v.string())');
	});

	it('stores fundraiser-level receipt policy context without claiming tax proof', () => {
		const schema = source('convex/schema.ts');
		const donations = source('convex/donations.ts');

		expect(schema).toContain('donationReceiptPolicy: v.optional');
		expect(schema).toContain("v.literal('confirmation_only')");
		expect(schema).toContain("v.literal('tax_acknowledgment_policy')");
		expect(schema).toContain('legalName: v.optional(v.string())');
		expect(schema).toContain('acknowledgmentText: v.optional(v.string())');
		expect(schema).toContain('configuredAt: v.number()');
		expect(donations).toContain('DONATION_RECEIPT_POLICY_INPUT_VALIDATOR');
		expect(donations).toContain('function cleanReceiptPolicy');
		expect(donations).toContain('Receipt legal name must be 200 characters or fewer');
		expect(donations).toContain('Receipt acknowledgment text must be 1,000 characters or fewer');
		expect(donations).toContain('donationReceiptPolicy: c.donationReceiptPolicy ?? null');
		expect(donations).toContain('donationReceiptPolicy: updated!.donationReceiptPolicy ?? null');
	});

	it('claims and records confirmation send outcomes instead of only scheduling work', () => {
		const donations = source('convex/donations.ts');

		expect(donations).toContain('export const claimConfirmationEmailSend');
		expect(donations).toContain('export const recordConfirmationEmailResult');
		expect(donations).toContain("confirmationEmailStatus: 'sending'");
		expect(donations).toContain("return await finish('skipped', 'not_configured')");
		expect(donations).toContain("return await finish('failed', 'decrypt_failed')");
		expect(donations).toContain('sendViaSesWithResult');
		expect(donations).toContain("sendResult.ok ? 'provider_accepted'");
		expect(donations).toContain('patch.confirmationEmailProviderMessageId = args.providerMessageId');
		expect(donations).toContain('providerAccepted');
	});

	it('renders saved receipt policy text inside the baseline confirmation artifact', () => {
		const donations = source('convex/donations.ts');

		expect(donations).toContain('donationReceiptPolicy: campaign.donationReceiptPolicy ?? null');
		expect(donations).toContain('function renderDonationReceiptPolicySection');
		expect(donations).toContain('ctxData.campaign?.donationReceiptPolicy ?? null');
		expect(donations).toContain('Organization legal name');
		expect(donations).toContain('Commons records and delivers it as fundraiser policy context');
		expect(donations).toContain('Commons has not verified tax status, legal sufficiency');
		expect(donations).toContain('anchored receipt proof');
	});

	it('surfaces the register in fundraising pages and donor rows', () => {
		const indexServer = source('src/routes/org/[slug]/fundraising/+page.server.ts');
		const detailServer = source('src/routes/org/[slug]/fundraising/[id]/+page.server.ts');
		const indexPage = source('src/routes/org/[slug]/fundraising/+page.svelte');
		const detailPage = source('src/routes/org/[slug]/fundraising/[id]/+page.svelte');
		const donorTable = source('src/lib/components/fundraising/DonorTable.svelte');
		const hypergraph = source('src/lib/data/capability-hypergraph.ts');

		expect(indexServer).toContain('api.donations.getConfirmationSummary');
		expect(detailServer).toContain('api.donations.getConfirmationSummary');
		expect(indexPage).toContain('fundraisingRows.map((row) => ({');
		expect(detailPage).toContain('fundraisingRows.map((row) => ({');
		expect(hypergraph).toContain("label: 'confirmations sent'");
		expect(hypergraph).toContain("cite: 'donations.getConfirmationSummary'");
		expect(hypergraph).toContain("label: 'Provider send evidence'");
		expect(indexPage).toContain('provider accepted');
		expect(detailPage).toContain('provider accepted');
		expect(hypergraph).toContain("cite: 'donations.confirmationEmailProviderMessageId'");
		expect(donorTable).toContain('confirmationEmailStatus');
		expect(donorTable).toContain('confirmationEmailProviderMessageId');
		expect(donorTable).toContain('providerReference');
		expect(donorTable).toContain('not recorded');
	});

	it('surfaces receipt policy as a separate capability row and detail action', () => {
		const indexServer = source('src/routes/org/[slug]/fundraising/+page.server.ts');
		const detailServer = source('src/routes/org/[slug]/fundraising/[id]/+page.server.ts');
		const indexPage = source('src/routes/org/[slug]/fundraising/+page.svelte');
		const detailPage = source('src/routes/org/[slug]/fundraising/[id]/+page.svelte');
		const hypergraph = source('src/lib/data/capability-hypergraph.ts');

		expect(indexServer).toContain('receiptPolicyConfigured: Boolean(c.donationReceiptPolicy)');
		expect(detailServer).toContain('saveReceiptPolicy');
		expect(detailServer).toContain('receipt_policy_mode');
		expect(detailServer).toContain('donationReceiptPolicy: policy');
		expect(indexPage).toContain('fundraisingRows.map((row) => ({');
		expect(detailPage).toContain('Receipt policy register');
		expect(detailPage).toContain('Receipt policy register saved.');
		expect(detailPage).toContain('This text can render in baseline donor confirmations');
		expect(hypergraph).toContain("id: 'receipt-policy-register'");
		expect(hypergraph).toContain("id: 'provider-send-evidence'");
		expect(hypergraph).toContain("label: 'Provider send evidence'");
		expect(hypergraph).toContain('Provider message identifiers are send-provider acceptance evidence only');
		expect(hypergraph).toContain("cite: 'campaigns.donationReceiptPolicy'");
		expect(hypergraph).toContain('Receipt policy custody can feed baseline confirmation content');
	});
});
