/**
 * Congressional delivery integration test.
 *
 * Exercises the deliverToCongress internalAction handler end-to-end with a
 * mock Convex ctx and a stubbed CWC/House-proxy/Senate/resolver/atlas boundary
 * (all verifiable WITHOUT live credentials). The handler is reachable under
 * vitest as `deliverToCongress._handler`; ctx.runMutation / ctx.runQuery are
 * routed by `getFunctionName(ref)`, and globalThis.fetch is stubbed per URL.
 *
 * Coverage:
 *   1. Chamber split — House goes to the proxy as a JSON envelope {xml,jobId,
 *      officeCode}; Senate POSTs raw XML to the CWC API. Both delivered →
 *      deliveryStatus 'delivered'.
 *   2. Partial rollup — House ok, Senate fails (HTTP 500) → 'partial', and the
 *      attributed campaignAction still emits (a chamber actually delivered).
 *   3. Full failure — both chambers fail → 'failed', NO attribution emit, NO
 *      verifiedSends increment.
 *   4. Tiered floor — a tier-2 (address-verified) submission DELIVERS exactly
 *      like a tier-4 one; the difference is the trustTier carried into the
 *      attributed action (badging), not a hard gate that blocks tier-2.
 *   5. Fail-closed — a rejected submission and a revoked credential never reach
 *      any CWC fetch.
 *   6. Attribution emit — a successful delivery calls emitCongressionalAction,
 *      which reaches campaigns.createCampaignAction via the shared
 *      counter-maintaining path with channel='congressional' and the
 *      submission's trustTier.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
import { deliverToCongress, emitCongressionalAction } from '../../convex/submissions';

// Registered Convex functions expose their handler at runtime via `_handler`,
// but the public RegisteredAction/RegisteredMutation TS types don't surface it.
// Cast through unknown to invoke the handler directly with a mock ctx.
function handlerOf(fn: unknown): (ctx: any, args: any) => Promise<any> {
	return (fn as { _handler: (ctx: any, args: any) => Promise<any> })._handler;
}
const runDeliver = handlerOf(deliverToCongress);
const runEmit = handlerOf(emitCongressionalAction);

// ─── env wiring: launch flag + chamber transport + resolver/atlas + agent ───
const ENV = {
	CONGRESSIONAL_DELIVERY_LAUNCHED: 'true',
	GCP_PROXY_URL: 'https://house-proxy.test',
	GCP_PROXY_AUTH_TOKEN: 'house-token',
	CWC_API_BASE_URL: 'https://senate-cwc.test',
	CWC_API_KEY: 'senate-key',
	CWC_SENATE_PATH_PREFIX: 'testing-messages',
	TEE_RESOLVER_URL: 'https://resolver.test',
	SHADOW_ATLAS_URL: 'https://atlas.test',
	PSEUDONYMOUS_ID_SALT: 'test-salt',
	// DeliveryAgent contact phone must be non-empty or validateXML rejects.
	CWC_DELIVERY_AGENT_CONTACT_PHONE: '+15555550100'
} as const;

const HOUSE_OFFICIAL = {
	bioguideId: 'H001',
	name: 'Rep House',
	party: 'I',
	state: 'CA',
	district: '11',
	chamber: 'house' as const,
	officeCode: 'HCA11'
};
const SENATE_OFFICIAL = {
	bioguideId: 'S001',
	name: 'Sen Senate',
	party: 'I',
	state: 'CA',
	district: '',
	chamber: 'senate' as const,
	officeCode: 'SCA00'
};

type FetchCall = { url: string; init?: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

/**
 * Build a mock ctx for deliverToCongress. `overrides` tweaks the canned
 * submission/credential; `fetchPlan` decides per-host fetch outcomes.
 */
function makeCtx(opts: {
	submission?: Record<string, unknown>;
	credentialActive?: boolean;
	commitment?: string | null;
	officials?: unknown[];
	fetchPlan?: {
		resolverOk?: boolean;
		houseStatus?: number;
		senateStatus?: number;
	};
}) {
	const mutationCalls: Array<{ name: string; args: any }> = [];
	const queryCalls: Array<{ name: string; args: any }> = [];
	const fetchCalls: FetchCall[] = [];

	const submission = {
		_id: 'sub_1',
		pseudonymousId: 'pseudo_1',
		templateId: 'tmpl_1',
		actionId: 'action_1',
		verificationStatus: 'pending',
		issuingCredentialId: 'cred_1',
		encryptedWitness: 'ct',
		witnessNonce: 'nonce',
		ephemeralPublicKey: 'epk',
		proofHex: '0xabc',
		publicInputs: {},
		trustTier: 4,
		witnessExpiresAt: Date.now() + 60_000,
		...opts.submission
	};

	const template = {
		title: 'Constituent Message',
		description: 'desc',
		messageBody: 'Please support the bill.',
		deliveryMethod: 'cwc',
		status: 'published',
		isPublic: true,
		orgId: 'org_1',
		deliveryConfig: { stance: 'support' },
		recipientConfig: { chambers: ['house', 'senate'] }
	};

	const officials = opts.officials ?? [HOUSE_OFFICIAL, SENATE_OFFICIAL];
	const fp = opts.fetchPlan ?? {};

	const ctx = {
		runMutation: vi.fn(async (ref: any, args: any) => {
			const name = getFunctionName(ref);
			mutationCalls.push({ name, args });
			if (name === 'submissions:claimForDelivery') {
				return { ok: true, attempts: 1 };
			}
			if (name === 'submissions:emitCongressionalAction') {
				// Record the call; assertions inspect args (attribution emit).
				return { attributed: true, alreadySubmitted: false };
			}
			// All other mutations are status/receipt/counter writes — record + ack.
			return undefined;
		}),
		runQuery: vi.fn(async (ref: any, args: any) => {
			const name = getFunctionName(ref);
			queryCalls.push({ name, args });
			if (name === 'submissions:getById') return submission;
			if (name === 'submissions:getTemplateForDelivery') return template;
			if (name === 'submissions:isCredentialActive') {
				return opts.credentialActive === false
					? { active: false, reason: 'revoked' }
					: { active: true };
			}
			if (name === 'submissions:getIssuingCredentialCommitment') {
				return opts.commitment === null ? null : { districtCommitment: opts.commitment ?? 'commit_1' };
			}
			return null;
		}),
		scheduler: { runAfter: vi.fn(async () => undefined) }
	};

	const fetchImpl = vi.fn(async (input: any, init?: RequestInit) => {
		const url = String(input);
		fetchCalls.push({ url, init });
		if (url.includes('resolver.test/resolve')) {
			if (fp.resolverOk === false) return jsonResponse({ success: false, errorCode: 'PROOF_INVALID' });
			return jsonResponse({
				success: true,
				constituent: {
					congressionalDistrict: 'CA-11',
					name: 'Jane Constituent',
					email: 'jane@example.com',
					phone: '+15555550111',
					address: { street: '1 Main St', city: 'Springfield', state: 'CA', zip: '90210' }
				}
			});
		}
		if (url.includes('atlas.test/api/officials/')) {
			return jsonResponse({ officials });
		}
		if (url.includes('house-proxy.test/api/house/submit')) {
			const status = fp.houseStatus ?? 200;
			return jsonResponse({ messageId: 'house-msg-1' }, status);
		}
		if (url.includes('senate-cwc.test/')) {
			const status = fp.senateStatus ?? 200;
			return jsonResponse({ messageId: 'senate-msg-1' }, status);
		}
		return jsonResponse({}, 404);
	});

	return { ctx, mutationCalls, queryCalls, fetchCalls, fetchImpl, submission, template };
}

function lastStatusWrite(mutationCalls: Array<{ name: string; args: any }>) {
	const updates = mutationCalls.filter((c) => c.name === 'submissions:updateDeliveryStatus');
	return updates[updates.length - 1]?.args;
}

describe('deliverToCongress — chamber split, rollup, tiered floor, attribution', () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		for (const [k, val] of Object.entries(ENV)) process.env[k] = val;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		for (const k of Object.keys(ENV)) delete process.env[k];
		vi.restoreAllMocks();
	});

	it('splits chambers: House → proxy JSON envelope, Senate → CWC raw XML; both deliver', async () => {
		const h = makeCtx({});
		globalThis.fetch = h.fetchImpl as unknown as typeof fetch;

		await runDeliver(h.ctx as any, { submissionId: 'sub_1' as any });

		const houseCall = h.fetchCalls.find((c) => c.url.includes('house-proxy.test/api/house/submit'));
		const senateCall = h.fetchCalls.find((c) => c.url.includes('senate-cwc.test/'));
		expect(houseCall).toBeTruthy();
		expect(senateCall).toBeTruthy();

		// House: JSON envelope with xml + jobId + officeCode.
		const houseBody = JSON.parse(String(houseCall!.init!.body));
		expect(houseBody).toHaveProperty('xml');
		expect(houseBody).toHaveProperty('jobId');
		expect(houseBody).toHaveProperty('officeCode');
		expect(houseBody.xml).toContain('<CWC>');
		expect((houseCall!.init!.headers as any)['Content-Type']).toBe('application/json');

		// Senate: raw XML body, XML content-type, API key header, configurable path prefix.
		expect(String(senateCall!.init!.body)).toContain('<CWC>');
		expect((senateCall!.init!.headers as any)['Content-Type']).toBe('application/xml');
		expect((senateCall!.init!.headers as any)['X-API-Key']).toBe('senate-key');
		expect(senateCall!.url).toContain('/testing-messages/');

		// Both delivered → status 'delivered'.
		expect(lastStatusWrite(h.mutationCalls)?.deliveryStatus).toBe('delivered');
	});

	it('partial rollup: House ok + Senate fails → partial, attribution still emits', async () => {
		const h = makeCtx({ fetchPlan: { senateStatus: 500 } });
		globalThis.fetch = h.fetchImpl as unknown as typeof fetch;

		await runDeliver(h.ctx as any, { submissionId: 'sub_1' as any });

		expect(lastStatusWrite(h.mutationCalls)?.deliveryStatus).toBe('partial');

		// A chamber delivered → the attributed campaignAction emits.
		const emit = h.mutationCalls.find((c) => c.name === 'submissions:emitCongressionalAction');
		expect(emit).toBeTruthy();
		expect(emit!.args.submissionId).toBe('sub_1');
		// verifiedSends counter still bumps on partial success.
		expect(h.mutationCalls.some((c) => c.name === 'submissions:incrementTemplateReach')).toBe(true);
	});

	it('full failure: both chambers fail → failed, NO attribution, NO verifiedSends', async () => {
		const h = makeCtx({ fetchPlan: { houseStatus: 500, senateStatus: 500 } });
		globalThis.fetch = h.fetchImpl as unknown as typeof fetch;

		await runDeliver(h.ctx as any, { submissionId: 'sub_1' as any });

		expect(lastStatusWrite(h.mutationCalls)?.deliveryStatus).toBe('failed');
		expect(h.mutationCalls.some((c) => c.name === 'submissions:emitCongressionalAction')).toBe(false);
		expect(h.mutationCalls.some((c) => c.name === 'submissions:incrementTemplateReach')).toBe(false);
		// No verification flip on failure.
		expect(h.mutationCalls.some((c) => c.name === 'submissions:updateVerificationStatus')).toBe(false);
	});

	it('tiered floor: tier-2 address-verified submission DELIVERS (not gated); trustTier carried for badging', async () => {
		const tier2 = makeCtx({ submission: { trustTier: 2 } });
		globalThis.fetch = tier2.fetchImpl as unknown as typeof fetch;
		await runDeliver(tier2.ctx as any, { submissionId: 'sub_1' as any });

		// Tier-2 delivers exactly like tier-4 — both chambers reached.
		expect(tier2.fetchCalls.some((c) => c.url.includes('house-proxy.test'))).toBe(true);
		expect(tier2.fetchCalls.some((c) => c.url.includes('senate-cwc.test'))).toBe(true);
		expect(lastStatusWrite(tier2.mutationCalls)?.deliveryStatus).toBe('delivered');

		// The difference between tiers is the carried assurance level, not delivery.
		const emit2 = tier2.mutationCalls.find((c) => c.name === 'submissions:emitCongressionalAction');
		expect(emit2!.args.trustTier).toBe(2);

		const tier4 = makeCtx({ submission: { trustTier: 4 } });
		globalThis.fetch = tier4.fetchImpl as unknown as typeof fetch;
		await runDeliver(tier4.ctx as any, { submissionId: 'sub_1' as any });
		const emit4 = tier4.mutationCalls.find((c) => c.name === 'submissions:emitCongressionalAction');
		expect(emit4!.args.trustTier).toBe(4);
		expect(lastStatusWrite(tier4.mutationCalls)?.deliveryStatus).toBe('delivered');
	});

	it('fail-closed: a rejected submission never reaches any CWC fetch', async () => {
		const h = makeCtx({ submission: { verificationStatus: 'rejected' } });
		globalThis.fetch = h.fetchImpl as unknown as typeof fetch;

		await runDeliver(h.ctx as any, { submissionId: 'sub_1' as any });

		expect(h.fetchCalls.length).toBe(0);
		expect(lastStatusWrite(h.mutationCalls)?.deliveryError).toBe('verification_rejected');
		expect(h.mutationCalls.some((c) => c.name === 'submissions:emitCongressionalAction')).toBe(false);
	});

	it('fail-closed: a revoked issuing credential blocks delivery before any CWC fetch', async () => {
		const h = makeCtx({ credentialActive: false });
		globalThis.fetch = h.fetchImpl as unknown as typeof fetch;

		await runDeliver(h.ctx as any, { submissionId: 'sub_1' as any });

		expect(h.fetchCalls.length).toBe(0);
		expect(lastStatusWrite(h.mutationCalls)?.deliveryError).toContain('credential_');
		expect(h.mutationCalls.some((c) => c.name === 'submissions:emitCongressionalAction')).toBe(false);
	});

	it('fail-closed: resolver rejection (PROOF_INVALID) blocks delivery and marks verification rejected', async () => {
		const h = makeCtx({ fetchPlan: { resolverOk: false } });
		globalThis.fetch = h.fetchImpl as unknown as typeof fetch;

		await runDeliver(h.ctx as any, { submissionId: 'sub_1' as any });

		// Resolver was called, but no CWC (house/senate) fetch followed.
		expect(h.fetchCalls.some((c) => c.url.includes('resolver.test/resolve'))).toBe(true);
		expect(h.fetchCalls.some((c) => c.url.includes('house-proxy.test'))).toBe(false);
		expect(h.fetchCalls.some((c) => c.url.includes('senate-cwc.test'))).toBe(false);
		expect(
			h.mutationCalls.some(
				(c) =>
					c.name === 'submissions:updateVerificationStatus' &&
					c.args.verificationStatus === 'rejected'
			)
		).toBe(true);
	});

	it('attribution emit: success calls emitCongressionalAction with the submission template + district', async () => {
		const h = makeCtx({});
		globalThis.fetch = h.fetchImpl as unknown as typeof fetch;

		await runDeliver(h.ctx as any, { submissionId: 'sub_1' as any });

		const emit = h.mutationCalls.find((c) => c.name === 'submissions:emitCongressionalAction');
		expect(emit).toBeTruthy();
		expect(emit!.args).toMatchObject({
			submissionId: 'sub_1',
			templateId: 'tmpl_1',
			districtCode: 'CA-11',
			trustTier: 4
		});
	});
});

describe('emitCongressionalAction — reuses the counter-maintaining create path', () => {
	function makeEmitCtx(opts: { campaign?: Record<string, unknown> | null; template?: Record<string, unknown> | null }) {
		const createCalls: any[] = [];
		const template = opts.template === null ? null : { _id: 'tmpl_doc_1', slug: 'tmpl_1', ...(opts.template ?? {}) };
		const campaign =
			opts.campaign === null ? null : { _id: 'camp_1', templateId: 'tmpl_doc_1', ...(opts.campaign ?? {}) };

		const ctx = {
			db: {
				normalizeId: (_table: string, _id: string) => null,
				get: async (_id: string) => null,
				query: (table: string) => ({
					withIndex: (_index: string, _builder: any) => ({
						first: async () => {
							if (table === 'templates') return template;
							if (table === 'campaigns') return campaign;
							return null;
						}
					})
				})
			},
			runMutation: vi.fn(async (ref: any, args: any) => {
				const name = getFunctionName(ref);
				if (name === 'campaigns:createCampaignAction') {
					createCalls.push(args);
					return { alreadySubmitted: false, actionCount: 1, totalCount: 1 };
				}
				return undefined;
			})
		};
		return { ctx, createCalls };
	}

	it('routes a congressional delivery through campaigns.createCampaignAction with channel + trustTier', async () => {
		const { ctx, createCalls } = makeEmitCtx({});
		const result = await runEmit(ctx as any, {
			submissionId: 'sub_1' as any,
			templateId: 'tmpl_1',
			districtCode: 'CA-11',
			trustTier: 4
		});

		expect(result).toEqual({ attributed: true, alreadySubmitted: false });
		expect(createCalls).toHaveLength(1);
		expect(createCalls[0]).toMatchObject({
			campaignId: 'camp_1',
			verified: true,
			channel: 'congressional',
			congressionalSubmissionId: 'sub_1',
			trustTier: 4,
			districtCode: 'CA-11'
		});
		// No supporterId on the congressional path — dedup keys on the submission.
		expect(createCalls[0].supporterId).toBeUndefined();
	});

	it('no-ops (no campaignAction) when the template is owned by no campaign', async () => {
		const { ctx, createCalls } = makeEmitCtx({ campaign: null });
		const result = await runEmit(ctx as any, {
			submissionId: 'sub_1' as any,
			templateId: 'tmpl_1',
			districtCode: 'CA-11',
			trustTier: 4
		});
		expect(result).toEqual({ attributed: false, reason: 'no_campaign' });
		expect(createCalls).toHaveLength(0);
	});
});
