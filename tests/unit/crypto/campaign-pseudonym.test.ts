/**
 * Campaign Pseudonym Tests
 *
 * Validates HMAC-SHA256 pseudonymous identifiers for template_campaign records (C-1).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { computeCampaignPseudonym } from '$lib/core/crypto/campaign-pseudonym';

const TEST_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

describe('Campaign Pseudonym', () => {
	let originalKey: string | undefined;
	let originalNodeEnv: string | undefined;

	beforeEach(() => {
		originalKey = process.env.CAMPAIGN_PSEUDONYM_KEY;
		originalNodeEnv = process.env.NODE_ENV;
		process.env.CAMPAIGN_PSEUDONYM_KEY = TEST_KEY;
	});

	afterEach(() => {
		if (originalKey === undefined) {
			delete process.env.CAMPAIGN_PSEUDONYM_KEY;
		} else {
			process.env.CAMPAIGN_PSEUDONYM_KEY = originalKey;
		}
		if (originalNodeEnv === undefined) {
			delete process.env.NODE_ENV;
		} else {
			process.env.NODE_ENV = originalNodeEnv;
		}
	});

	it('should produce a deterministic pseudonym for the same userId', () => {
		const userId = 'cluser123abc';
		const first = computeCampaignPseudonym(userId);
		const second = computeCampaignPseudonym(userId);
		expect(first).toBe(second);
	});

	it('should produce different pseudonyms for different userIds', () => {
		const a = computeCampaignPseudonym('user-alpha');
		const b = computeCampaignPseudonym('user-beta');
		expect(a).not.toBe(b);
	});

	it('should return a 64-character hex string', () => {
		const pseudonym = computeCampaignPseudonym('cluser123abc');
		expect(pseudonym).toMatch(/^[0-9a-f]{64}$/);
	});

	it('should not contain the original userId', () => {
		const userId = 'cluser123abc';
		const pseudonym = computeCampaignPseudonym(userId);
		expect(pseudonym).not.toContain(userId);
	});

	it('should use dev fallback when CAMPAIGN_PSEUDONYM_KEY is not set', () => {
		delete process.env.CAMPAIGN_PSEUDONYM_KEY;
		process.env.NODE_ENV = 'test';

		const pseudonym = computeCampaignPseudonym('cluser123abc');
		expect(pseudonym).toMatch(/^[0-9a-f]{64}$/);
	});

	it('should produce different results with different keys', () => {
		const userId = 'cluser123abc';
		const withKey1 = computeCampaignPseudonym(userId);

		process.env.CAMPAIGN_PSEUDONYM_KEY = 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b200';
		const withKey2 = computeCampaignPseudonym(userId);

		expect(withKey1).not.toBe(withKey2);
	});

	it('should throw in production when key is missing', () => {
		delete process.env.CAMPAIGN_PSEUDONYM_KEY;
		process.env.NODE_ENV = 'production';

		expect(() => computeCampaignPseudonym('cluser123abc')).toThrow(
			'CAMPAIGN_PSEUDONYM_KEY environment variable not configured'
		);
	});
});
