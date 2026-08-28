/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';

import credentialSelectorSource from '../../../convex/_credentialSelect.ts?raw';
import credentialHistorySource from '../../../convex/lib/credentialHistory.ts?raw';
import groundSource from '../../../convex/ground.ts?raw';
import schemaSource from '../../../convex/schema.ts?raw';
import templatePageSource from '../../../convex/templatePage.ts?raw';
import usersSource from '../../../convex/users.ts?raw';
import baselineSource from '../../../scripts/convex-query-efficiency-baseline.json?raw';
import groundServiceSource from '../../../src/lib/server/ground/ground-service.ts?raw';
import submissionsRouteSource from '../../../src/routes/api/submissions/create/+server.ts?raw';
import profileRouteSource from '../../../src/routes/profile/+page.server.ts?raw';
import recipientRouteSource from '../../../src/routes/s/[slug]/+page.server.ts?raw';
import verificationRouteSource from '../../../src/routes/v/[hash]/+page.server.ts?raw';

function exportedBlock(source: string, symbol: string, nextMarker?: string): string {
	const start = source.indexOf(`export const ${symbol}`);
	const end = nextMarker ? source.indexOf(nextMarker, start) : source.length;
	if (start < 0 || end < 0) throw new Error(`Could not isolate ${symbol}`);
	return source.slice(start, end);
}

describe('profile and credential storage contracts', () => {
	it('defines the exact indexes that make lifecycle and active-relation reads bounded', () => {
		expect(schemaSource).toContain(
			".index('by_userId_revokedAt_issuedAt', ['userId', 'revokedAt', 'issuedAt'])"
		);
		expect(schemaSource).toContain(".index('by_userId_issuedAt', ['userId', 'issuedAt'])");
		expect(schemaSource).toContain(
			".index('by_userId_districtCommitment', ['userId', 'districtCommitment'])"
		);
		expect(schemaSource).toContain(".index('by_userId_isActive_decisionMakerId', [");
	});

	it('selects one newest unrevoked credential and fails closed on canonical expiry', () => {
		expect(credentialSelectorSource).toContain('by_userId_revokedAt_issuedAt');
		expect(credentialSelectorSource).toContain(".eq('revokedAt', undefined)");
		expect(credentialSelectorSource).toContain(".order('desc')");
		expect(credentialSelectorSource).toContain('.first()');
		expect(credentialSelectorSource).toContain('credential.expiresAt <= asOf');
		expect(credentialSelectorSource).not.toContain('.collect(');
		expect(credentialSelectorSource).not.toContain('Date.now');
	});

	it('shares exact 180-day, cap, lifetime commitment, and email sibling reads', () => {
		expect(credentialHistorySource).toContain('by_userId_issuedAt');
		expect(credentialHistorySource).toContain(".gt('issuedAt', now - ONE_EIGHTY_DAYS_MS)");
		expect(credentialHistorySource).toContain('.take(MAX_REVERIFICATIONS_PER_180D)');
		expect(credentialHistorySource).toContain('by_userId_districtCommitment');
		expect(credentialHistorySource).toContain(".gt('districtCommitment', '')");
		expect(credentialHistorySource).toContain(".gt('_creationTime', now - ONE_EIGHTY_DAYS_MS)");
		expect(credentialHistorySource).toContain('.take(MAX_USERIDS_PER_EMAIL_HASH_180D + 1)');
		expect(credentialHistorySource).not.toContain('.collect(');
	});

	it('keeps verifyAddress bounded and checks the official envelope before DB authority work', () => {
		const block = exportedBlock(usersSource, 'verifyAddress', '/**\n * Get user\'s did_key');
		const officialGate = block.indexOf('ADDRESS_VERIFICATION_OFFICIALS_LIMIT_EXCEEDED');
		const authRead = block.indexOf('requireAuth(ctx)');
		expect(officialGate).toBeGreaterThan(0);
		expect(officialGate).toBeLessThan(authRead);
		expect(block).toContain('hasEverHeldDistrictCommitment(ctx, args.userId)');
		expect(block).toContain('readCredentialToReplace(ctx, args.userId)');
		expect(block).toContain('readReverificationWindow(ctx, args.userId, now)');
		expect(block).toContain('readRecentEmailHashUsers(ctx, user.emailHash, now)');
		expect(block).toContain('by_userId_isActive_decisionMakerId');
		expect(block).toContain('.take(MAX_VERIFICATION_OFFICIALS + 1)');
		expect(block).not.toContain('.collect(');
	});

	it('bounds the live profile relation join and returns only compact display fields', () => {
		const block = exportedBlock(usersSource, 'getMyRepresentatives', '/**\n * Update user profile');
		expect(block).toContain('by_userId_isActive_decisionMakerId');
		expect(block).toContain(".eq('isActive', true)");
		expect(block).toContain('.take(MAX_VERIFICATION_OFFICIALS)');
		expect(block).toContain('PROFILE_REPRESENTATIVE_MAX_BYTES');
		expect(block).toContain('PROFILE_REPRESENTATIVE_NAME_MAX_CHARS');
		expect(block).not.toContain('.collect(');
	});

	it('enforces one readable vault and one active wrapper with constant-cardinality reads', () => {
		const state = exportedBlock(groundSource, 'getMyGroundState', '/**\n * Return the active district');
		expect(groundSource).toContain('GROUND_VAULT_MULTIPLICITY');
		expect(groundSource).toContain('GROUND_WRAPPER_MULTIPLICITY');
		expect(state).toContain('.take(2)');
		expect(state).not.toContain('.collect(');
		for (const block of [
			exportedBlock(groundSource, 'persistGroundBundle', '/**\n * Re-encrypt the active'),
			exportedBlock(groundSource, 'addPasskeyWrapperToActiveVault', 'export const getMyGroundState'),
			exportedBlock(usersSource, 'storePasskey', '/**\n * Clear all passkey'),
			exportedBlock(usersSource, 'clearPasskey', '// =============================================================================\n// MDL')
		]) {
			expect(block).toContain('.take(2)');
			expect(block).not.toContain('.collect(');
		}
	});

	it('uses the exact active relation index in both template recipient selectors', () => {
		const direct = exportedBlock(templatePageSource, 'getUserDmRelation', '/**\n * Resolve the viewer');
		const viewer = exportedBlock(templatePageSource, 'getViewerAuthorRelation');
		for (const block of [direct, viewer]) {
			expect(block).toContain('by_userId_isActive_decisionMakerId');
			expect(block).toContain(".eq('isActive', true)");
			expect(block).not.toContain('.collect(');
			expect(block).not.toContain('.filter(');
		}
	});

	it('takes trusted server time for every cache-sensitive public credential read', () => {
		const blocks = [
			exportedBlock(usersSource, 'getReverificationBudget', '/**\n * Return the active'),
			exportedBlock(usersSource, 'getActiveCredentialDistrictCommitment', '/**\n * Return the caller'),
			exportedBlock(usersSource, 'getActiveCredentialHash', '/**\n * Get user\'s identity'),
			exportedBlock(usersSource, 'resolveCredentialHash', '// ============================================================================='),
			exportedBlock(groundSource, 'getMyGroundRestoreState')
		];
		for (const block of blocks) {
			expect(block).toContain('_secret: v.string()');
			expect(block).toContain('asOf: v.number()');
			expect(block).toContain('requireInternalSecret');
			expect(block).not.toContain('Date.now');
		}

		for (const caller of [
			profileRouteSource,
			recipientRouteSource,
			verificationRouteSource,
			submissionsRouteSource,
			groundServiceSource
		]) {
			expect(caller).toContain('asOf:');
			expect(caller).toContain('getInternalSecret()');
		}
	});

	it('keeps every eliminated FND-45 hazard out of the approved baseline', () => {
		const entries = Object.keys(
			(JSON.parse(baselineSource) as { entries: Record<string, unknown> }).entries
		);
		for (const symbol of [
			'convex/ground.ts::getMyGroundRestoreState',
			'convex/ground.ts::getMyGroundState',
			'convex/templatePage.ts::getUserDmRelation',
			'convex/templatePage.ts::getViewerAuthorRelation',
			'convex/users.ts::getActiveCredentialDistrictCommitment',
			'convex/users.ts::getActiveCredentialHash',
			'convex/users.ts::getMyRepresentatives',
			'convex/users.ts::getReverificationBudget',
			'convex/users.ts::resolveCredentialHash'
		]) {
			expect(entries).not.toContain(symbol);
		}
	});
});
