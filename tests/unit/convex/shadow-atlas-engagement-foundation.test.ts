import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Shadow Atlas engagement replay foundation', () => {
	it('has no duplicate submission scheduler/action owner', () => {
		const submissions = readFileSync('convex/submissions.ts', 'utf8');
		expect(submissions).not.toContain('internal.submissions.registerEngagement');
		expect(submissions).not.toMatch(/export const registerEngagement = internalAction/);
		expect(submissions).not.toContain('/api/engagement/register');
	});

	it('retires the superseded public identity lookup but keeps Tree-1 registration separate', () => {
		const users = readFileSync('convex/users.ts', 'utf8');
		const registerRoute = readFileSync('src/routes/api/shadow-atlas/register/+server.ts', 'utf8');
		expect(users).not.toContain('export const getIdentityForEngagement');
		expect(users).not.toContain('export const createShadowAtlasRegistration');
		expect(users).not.toContain('export const updateShadowAtlasRegistration');
		expect(users).not.toContain('export const upsertRegistration');
		expect(users).toContain('export const reserveShadowAtlasRegistrationOperation = mutation');
		expect(users).toContain('export const beginShadowAtlasRegistrationDispatch = mutation');
		expect(users).toContain('export const commitShadowAtlasRegistrationOperation = mutation');
		expect(users).toContain('export const reconcileShadowAtlasRegistrationOperation = mutation');
		expect(users).toContain('export const markShadowAtlasRegistrationOperationAmbiguous = mutation');
		expect(registerRoute).toContain('api.users.reserveShadowAtlasRegistrationOperation');
		expect(registerRoute).toContain('api.users.beginShadowAtlasRegistrationDispatch');
		expect(registerRoute).toContain('api.users.commitShadowAtlasRegistrationOperation');
		expect(registerRoute).toContain('api.users.markShadowAtlasRegistrationOperationAmbiguous');
	});

	it('uses indexed primary-key state without collection reads', () => {
		const users = readFileSync('convex/users.ts', 'utf8');
		const start = users.indexOf('export const claimShadowAtlasEngagement');
		const end = users.indexOf('export const reserveShadowAtlasRegistrationOperation', start);
		const stateMachine = users.slice(start, end);
		expect(start).toBeGreaterThan(0);
		expect(stateMachine).toContain('ctx.db.get(args.userId)');
		expect(stateMachine).not.toContain('.collect(');
		expect(stateMachine).not.toContain('.paginate(');
		expect(stateMachine.match(/requireInternalSecret\(args\._secret\);/g)).toHaveLength(5);
		expect(stateMachine.match(/requireAuth\(ctx\)/g)).toHaveLength(5);
	});

	it('keeps ambiguous-write repair on an internal delayed exact-CAS control plane', () => {
		const users = readFileSync('convex/users.ts', 'utf8');
		const start = users.indexOf('export const repairShadowAtlasEngagementReservation');
		const end = users.indexOf('export const getShadowAtlasRegistration', start);
		const repair = users.slice(start, end);
		expect(repair).toContain('internalMutation({');
		expect(repair).toContain('expectedReservationTimestamp');
		expect(repair).toContain('expectedGeneration');
		expect(repair).toContain('SHADOW_ATLAS_ENGAGEMENT_REPAIR_OBSERVATION_MS');
		expect(repair).not.toContain('fetch(');
		expect(repair).not.toContain('scheduler');
	});

	it('pins burst-only freshness and bounded external response/time envelopes', () => {
		const state = readFileSync('convex/lib/shadowAtlasEngagement.ts', 'utf8');
		const client = readFileSync('src/lib/core/shadow-atlas/client.ts', 'utf8');
		expect(state).toContain('SHADOW_ATLAS_ENGAGEMENT_CACHE_TTL_MS = 60_000');
		expect(state).toContain('EngagementRootRegistry accepts registered roots for at most 180 days');
		expect(state).toContain("v.literal('write_reserved')");
		expect(client).toContain('ENGAGEMENT_HTTP_TIMEOUT_MS = 8_000');
		expect(client).toContain('ENGAGEMENT_RESPONSE_MAX_BYTES = 32 * 1024');
		expect(client).toContain('ENGAGEMENT_IDENTITY = /^(?:0x)?[0-9a-fA-F]{64}$/u');
		expect(client).toContain('ENGAGEMENT_SIGNER = /^0x[0-9a-fA-F]{40}$/u');
		expect(client).toContain('readBoundedResponseJson');
	});
});
