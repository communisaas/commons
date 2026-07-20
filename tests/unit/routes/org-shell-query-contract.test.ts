import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	serverQuery: vi.fn(),
	getOrgContext: Symbol('getOrgContext'),
	getCongressionalDeliveryReadiness: Symbol('getCongressionalDeliveryReadiness')
}));

vi.mock('convex-sveltekit', () => ({ serverQuery: mocks.serverQuery }));
vi.mock('$lib/convex', () => ({
	api: {
		organizations: { getOrgContext: mocks.getOrgContext },
		submissions: {
			getCongressionalDeliveryReadiness: mocks.getCongressionalDeliveryReadiness
		}
	}
}));
vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$env/dynamic/private', () => ({ env: {} }));

import { load } from '../../../src/routes/org/[slug]/+layout.server';

const slug = 'bounded-org';

function context(workspace: null | Record<string, unknown> = null) {
	return {
		org: {
			_id: 'org-1',
			name: 'Bounded Org',
			slug,
			description: null,
			avatar: null,
			maxSeats: 5,
			maxTemplatesMonth: 10,
			dmCacheTtlDays: 7,
			identityCommitment: null,
			brandingAccent: null,
			logoUrl: null,
			whiteLabel: false,
			isPublic: false,
			_creationTime: 1
		},
		membership: { role: 'owner', joinedAt: 1 },
		navBadges: {
			supporters: 9,
			campaigns: 3,
			members: 2,
			sentEmails: 4,
			activeCampaigns: 1
		},
		badgeReadiness: { campaignCounters: { ready: true, status: 'ready' } },
		supporterSummary: {
			total: 9,
			identityVerified: 4,
			postalResolved: 5,
			sourceCounts: { csv: 9 },
			emailHealth: { subscribed: 8, unsubscribed: 1, bounced: 0, complained: 0 },
			smsHealth: { subscribed: 0, unsubscribed: 0, stopped: 0, none: 9, phonePresent: 0 },
			consentEvidence: { email: 8, emailSubscribed: 8, sms: 0, smsSubscribed: 0 }
		},
		operatingState: { orgKeyConfigured: false, platformApi: null },
		workspace
	};
}

function event(pathname: string) {
	return {
		params: { slug },
		locals: { user: { id: 'user-1' } },
		url: new URL(`https://commons.test${pathname}`)
	};
}

describe('organization shell query contract', () => {
	beforeEach(() => {
		mocks.serverQuery.mockReset();
		mocks.serverQuery.mockImplementation(async (reference: symbol, args: Record<string, unknown>) => {
			if (reference === mocks.getCongressionalDeliveryReadiness) return null;
			if (reference !== mocks.getOrgContext) throw new Error('unexpected query');
			if (args.workspace === 'return') {
				return context({
					kind: 'return',
					campaigns: [],
					receipts: null,
					readModelReady: false
				});
			}
			return context();
		});
	});

	it('loads a deep settings route with exactly one compact context query', async () => {
		const data = (await load(event(`/org/${slug}/settings`) as never)) as Record<string, any>;

		expect(mocks.serverQuery).toHaveBeenCalledTimes(1);
		expect(mocks.serverQuery).toHaveBeenCalledWith(mocks.getOrgContext, { slug });
		// Compact readiness and badges survive even though feature slices are absent.
		expect(data.navBadges).toMatchObject({ supporters: 9, campaigns: 3 });
		expect(data.spaces.operating?.authoring).toBeTruthy();
		expect(data.spaces.base).toBeNull();
		expect(data.spaces.return).toBeNull();
	});

	it('loads Results through the same single query and an explicit bounded discriminator', async () => {
		await load(event(`/org/${slug}/results`) as never);

		expect(mocks.serverQuery).toHaveBeenCalledTimes(1);
		expect(mocks.serverQuery).toHaveBeenCalledWith(mocks.getOrgContext, {
			slug,
			workspace: 'return'
		});
	});

	it('allows Studio one additional configuration-only readiness query', async () => {
		await load(event(`/org/${slug}`) as never);

		expect(mocks.serverQuery).toHaveBeenCalledTimes(2);
		expect(mocks.serverQuery.mock.calls.map(([reference]) => reference)).toEqual(
			expect.arrayContaining([
				mocks.getOrgContext,
				mocks.getCongressionalDeliveryReadiness
			])
		);
	});

	it('cannot restore the former feature-query megafetch by editing the shared layout', () => {
		const source = readFileSync('src/routes/org/[slug]/+layout.server.ts', 'utf8');
		const calls = source.match(/serverQuery\(/g) ?? [];
		expect(calls).toHaveLength(2);
		for (const forbidden of [
			'segments.list',
			'donations.',
			'workflows.',
			'sms.',
			'calls.',
			'networks.',
			'orgWebhooks.',
			'legislation.',
			'computeVerificationPacketCached'
		]) {
			expect(source).not.toContain(forbidden);
		}
	});
});
