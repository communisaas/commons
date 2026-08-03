/**
 * Owner isolation for the org Studio handoff drafts.
 *
 * Org delivery surfaces are always authenticated, so the localStorage parking
 * lot between Studio and campaigns/new / emails/compose FAILS CLOSED: every
 * read requires the reading operator's own identity, a mismatched read is
 * non-destructive, and a matching read is one-shot. These tests pin the
 * concrete shared-browser attack — operator A writes, operator B (the next
 * account active on the same browser) must read nothing — plus the removal of
 * the unscoped twin stores this implementation replaced.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import {
	orgCampaignDrafts,
	orgComposeAutosaveKey,
	orgEmailComposeDrafts,
	type OrgCampaignDraft,
	type OrgDraftStore,
	type OrgEmailComposeDraft
} from '$lib/stores/orgDraftStore';
import { deriveOwnerHash } from '$lib/stores/templateDraft';
import {
	saveStudioProcessAsCampaignDraft,
	saveStudioProcessAsOrgEmailDraft
} from '$lib/components/org/studio/studio-draft-bridge';
import type { OrgProcess } from '$lib/components/org/os/orgOS.svelte';

function memoryStorage(): Storage {
	const entries = new Map<string, string>();
	return {
		get length() {
			return entries.size;
		},
		clear: () => entries.clear(),
		getItem: (key) => entries.get(key) ?? null,
		key: (index) => [...entries.keys()][index] ?? null,
		removeItem: (key) => entries.delete(key),
		setItem: (key, value) => entries.set(key, String(value))
	};
}

let storage: Storage;

beforeEach(() => {
	storage = memoryStorage();
	vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function campaignDraft(): OrgCampaignDraft {
	return {
		source: 'studio',
		title: 'Protect the watershed',
		body: 'Enforce the existing discharge limits on the river.',
		type: 'CONGRESSIONAL',
		targetCountry: 'US',
		createdAt: Date.now(),
		metadata: {
			processId: 'proc-1',
			title: 'Watershed enforcement',
			decisionMakerCount: 2,
			sourceCount: 1
		}
	};
}

function emailDraft(): OrgEmailComposeDraft {
	return {
		source: 'studio',
		subject: 'Protect the watershed',
		bodyHtml: '<p>Enforce the existing discharge limits on the river.</p>',
		createdAt: Date.now(),
		metadata: {
			processId: 'proc-1',
			title: 'Watershed enforcement',
			decisionMakerCount: 2,
			sourceCount: 1
		}
	};
}

function isolationSuite<T extends { createdAt: number }>(
	kind: string,
	store: OrgDraftStore<T>,
	make: () => T,
	storageKey: string
): void {
	describe(`${kind} drafts`, () => {
		it('cross-operator read gets null, is non-destructive, and the handoff is one-shot', async () => {
			const draft = make();
			const idA = await store.save(draft, 'operator-a');
			expect(idA).not.toBeNull();

			// Attack vector: the next account active on the same browser must
			// read nothing.
			expect(await store.consume(idA!, 'operator-b')).toBeNull();

			// The failed read must not destroy the owner's draft.
			expect(await store.consume(idA!, 'operator-a')).toEqual(draft);

			// A matching consume deletes the entry: the handoff is one-shot.
			expect(await store.consume(idA!, 'operator-a')).toBeNull();
		});

		it('a signed-out reader (empty ownerId) gets null and leaves the draft intact', async () => {
			const draft = make();
			const idA = await store.save(draft, 'operator-a');
			expect(await store.consume(idA!, '')).toBeNull();
			expect(await store.consume(idA!, 'operator-a')).toEqual(draft);
		});

		it('an empty-owner save returns null and writes nothing', async () => {
			expect(await store.save(make(), '')).toBeNull();
			expect(storage.getItem(storageKey)).toBeNull();
		});

		it('persists no plaintext operator identifier, only the owner hash', async () => {
			await store.save(make(), 'operator-a');
			const blob = storage.getItem(storageKey);
			expect(blob).not.toBeNull();
			expect(blob).not.toContain('operator-a');
			expect(blob).toContain(await deriveOwnerHash('operator-a'));
		});
	});
}

isolationSuite('campaign', orgCampaignDrafts, campaignDraft, 'commons_org_campaign_drafts');
isolationSuite('org email compose', orgEmailComposeDrafts, emailDraft, 'commons_org_email_compose_drafts');

function mockProc(): OrgProcess {
	return {
		id: 'proc-1',
		title: 'Watershed enforcement',
		intent: {
			subjectLine: 'Protect the watershed',
			coreMessage: 'Enforce the existing discharge limits on the river.',
			audienceGuidance: ''
		},
		composedMessage: 'Enforce the existing discharge limits on the river.',
		decisionMakers: [],
		sources: [],
		geographicScope: { type: 'nationwide', country: 'US' },
		geographicScopeLabel: 'United States',
		sourceEvidenceObserved: false,
		sourceEvidenceEvaluatedCount: 0,
		sourceEvidenceSearchOnlyCount: 0,
		activeMessageJob: null
	} as unknown as OrgProcess;
}

describe('studio bridge writers', () => {
	it('drafts written through the real writers are unreadable by another operator', async () => {
		const campaignId = await saveStudioProcessAsCampaignDraft(mockProc(), 'operator-a');
		expect(campaignId).not.toBeNull();
		expect(await orgCampaignDrafts.consume(campaignId!, 'operator-b')).toBeNull();

		const emailId = await saveStudioProcessAsOrgEmailDraft(mockProc(), 'operator-a');
		expect(emailId).not.toBeNull();
		expect(await orgEmailComposeDrafts.consume(emailId!, 'operator-b')).toBeNull();
	});
});

describe('orgComposeAutosaveKey', () => {
	it('fails closed while the owner hash is unresolved or malformed', () => {
		expect(orgComposeAutosaveKey(null, 'org-1')).toBeNull();
		expect(orgComposeAutosaveKey('not-a-hash', 'org-1')).toBeNull();
	});

	it('produces a sweep-covered, per-operator key for a shape-valid hash', async () => {
		const keyA = orgComposeAutosaveKey(await deriveOwnerHash('operator-a'), 'org-1');
		const keyB = orgComposeAutosaveKey(await deriveOwnerHash('operator-b'), 'org-1');
		expect(keyA).not.toBeNull();
		expect(keyB).not.toBeNull();
		// The logout sweep clears localStorage by key prefix; the autosave key
		// must sit inside that contract.
		expect(keyA!.startsWith('commons')).toBe(true);
		// Distinct operators must never share an autosave slot.
		expect(keyA).not.toBe(keyB);
	});
});

describe('unscoped twin removal', () => {
	const repoRoot = process.cwd();
	const selfPath = join(repoRoot, 'tests', 'unit', 'org-draft-isolation.test.ts');
	const textExtensions = new Set([
		'.ts',
		'.js',
		'.mjs',
		'.cjs',
		'.svelte',
		'.json',
		'.md',
		'.txt',
		'.html',
		'.css'
	]);

	function* walk(dir: string): Generator<string> {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) yield* walk(full);
			else yield full;
		}
	}

	function scan(dirs: string[], patterns: RegExp[]): string[] {
		const offenders: string[] = [];
		for (const dir of dirs) {
			for (const file of walk(join(repoRoot, dir))) {
				if (file === selfPath || !textExtensions.has(extname(file))) continue;
				const content = readFileSync(file, 'utf8');
				for (const pattern of patterns) {
					if (pattern.test(content)) offenders.push(`${file} :: ${pattern.source}`);
				}
			}
		}
		return offenders;
	}

	it('the unscoped twin store files no longer exist', () => {
		expect(existsSync(join(repoRoot, 'src', 'lib', 'stores', 'orgCampaignDraft.ts'))).toBe(false);
		expect(existsSync(join(repoRoot, 'src', 'lib', 'stores', 'orgEmailComposeDraft.ts'))).toBe(
			false
		);
	});

	it('no reference to a removed twin symbol survives in src/ or tests/', () => {
		// Word-bounded so the owner-scoped replacements (orgCampaignDrafts,
		// OrgCampaignDraft, ...) do not match.
		const removedSymbols = [
			/\borgCampaignDraft\b/,
			/\borgEmailComposeDraft\b/,
			/\bgetOrgCampaignDraft\b/,
			/\bgetOrgEmailComposeDraft\b/,
			/\bsaveOrgCampaignDraft\b/,
			/\bsaveOrgEmailComposeDraft\b/,
			/\bdeleteOrgCampaignDraft\b/,
			/\bdeleteOrgEmailComposeDraft\b/,
			/\bgenerateOrgCampaignDraftId\b/,
			/\bgenerateOrgEmailComposeDraftId\b/
		];
		expect(scan(['src', 'tests'], removedSymbols)).toEqual([]);
	});

	it('no unscoped compose-autosave key literal survives in src/', () => {
		// The inline compose autosave is keyed per operator + org; the old
		// org-only literal would let one account restore another's unsent draft.
		expect(scan(['src'], [/draft:compose:/])).toEqual([]);
	});
});
