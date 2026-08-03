import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemplateFormData } from '$lib/types/template';
import {
	claimGuestDraftForUser,
	createTemplateDraftStore,
	deriveOwnerHash
} from '$lib/stores/templateDraft';

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

function draft(rawInput: string): TemplateFormData {
	return {
		objective: {
			title: '',
			description: '',
			domain: '',
			slug: '',
			topics: [],
			voiceSample: '',
			rawInput,
			aiGenerated: false
		},
		audience: {
			recipientEmails: [],
			decisionMakers: [],
			includesCongress: false,
			customRecipients: []
		},
		content: {
			preview: '',
			variables: [],
			sources: [],
			researchLog: [],
			geographicScope: null,
			aiGenerated: false,
			edited: false
		},
		review: {}
	};
}

describe('template draft OAuth ownership handoff', () => {
	let storage: Storage;

	beforeEach(() => {
		storage = memoryStorage();
		vi.stubGlobal('localStorage', storage);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('claims the exact guest draft before owner-filtered restoration', async () => {
		const store = createTemplateDraftStore();
		store.saveDraft('guest-return', draft('Keep this exact objective'), 'objective');
		store.setOwner(await deriveOwnerHash('new-user'));
		expect(store.getDraft('guest-return')).toBeNull();

		expect(await claimGuestDraftForUser('guest-return', 'new-user', store)).toBe(true);
		expect(store.getDraft('guest-return')?.data.objective.rawInput).toBe(
			'Keep this exact objective'
		);
		const persisted = JSON.parse(storage.getItem('commons_template_drafts') ?? '{}');
		expect(persisted['guest-return'].ownerHash).toBe(await deriveOwnerHash('new-user'));
	});

	it('never reassigns a draft already owned by another account', async () => {
		const store = createTemplateDraftStore();
		const firstOwner = await deriveOwnerHash('first-user');
		store.setOwner(firstOwner);
		store.saveDraft('owned-draft', draft('Private first-user text'), 'objective');

		expect(await claimGuestDraftForUser('owned-draft', 'second-user', store)).toBe(false);
		expect(store.getDraft('owned-draft')).toBeNull();
		const persisted = JSON.parse(storage.getItem('commons_template_drafts') ?? '{}');
		expect(persisted['owned-draft'].ownerHash).toBe(firstOwner);
	});

	it('adopts only the URL-selected draft and leaves sibling guest drafts hidden', async () => {
		const store = createTemplateDraftStore();
		store.saveDraft('selected-draft', draft('Selected'), 'objective');
		store.saveDraft('other-draft', draft('Not selected'), 'objective');

		expect(await claimGuestDraftForUser('selected-draft', 'new-user', store)).toBe(true);
		expect(store.getAllDraftIds()).toEqual(['selected-draft']);
		expect(store.getDraft('other-draft')).toBeNull();
	});

	// A page load constructs a fresh store against the device's existing
	// localStorage, and the session resolves asynchronously afterwards. Every
	// read taken in that window is a read by an operator the store cannot name.
	it('hides an operator draft from a boot-window read and restores it once the owner binds', async () => {
		const operatorA = await deriveOwnerHash('operator-a');
		const boundLoad = createTemplateDraftStore();
		boundLoad.setOwner(operatorA);
		boundLoad.saveDraft('operator-a-draft', draft('Operator A private objective'), 'objective');

		const bootWindow = createTemplateDraftStore();
		expect(bootWindow.getAllDraftIds()).toEqual([]);
		expect(bootWindow.getDraft('operator-a-draft')).toBeNull();
		expect(bootWindow.hasDraft('operator-a-draft')).toBe(false);
		expect(bootWindow.getDraftAge('operator-a-draft')).toBeNull();

		bootWindow.setOwner(operatorA);
		expect(bootWindow.getAllDraftIds()).toEqual(['operator-a-draft']);
		expect(bootWindow.getDraft('operator-a-draft')?.data.objective.rawInput).toBe(
			'Operator A private objective'
		);
	});

	it('leaves an owned draft untouched when a save lands before the owner resolves', async () => {
		const operatorA = await deriveOwnerHash('operator-a');
		const boundLoad = createTemplateDraftStore();
		boundLoad.setOwner(operatorA);
		boundLoad.saveDraft('operator-a-draft', draft('Operator A private objective'), 'objective');

		const bootWindow = createTemplateDraftStore();
		bootWindow.saveDraft('operator-a-draft', draft('Second operator boot text'), 'objective');
		bootWindow.deleteDraft('operator-a-draft');

		const persisted = JSON.parse(storage.getItem('commons_template_drafts') ?? '{}');
		expect(persisted['operator-a-draft'].ownerHash).toBe(operatorA);
		expect(persisted['operator-a-draft'].data.objective.rawInput).toBe(
			'Operator A private objective'
		);

		// The stamp survived, so the second identity has nothing to claim.
		expect(await claimGuestDraftForUser('operator-a-draft', 'operator-b', bootWindow)).toBe(false);
		expect(bootWindow.getDraft('operator-a-draft')).toBeNull();

		bootWindow.setOwner(operatorA);
		expect(bootWindow.getDraft('operator-a-draft')?.data.objective.rawInput).toBe(
			'Operator A private objective'
		);
	});

	it('claims a guest draft written in an earlier page load, once identity resolves', async () => {
		const guestLoad = createTemplateDraftStore();
		guestLoad.saveDraft('guest-oauth-draft', draft('Guest objective before sign-in'), 'objective');

		// Return from OAuth: new page load, identity not yet resolved. The draft
		// carries no owner, so the URL-bound resume can still reach it by id —
		// but an unbound store still refuses to enumerate the device's drafts.
		const afterOAuth = createTemplateDraftStore();
		expect(afterOAuth.getAllDraftIds()).toEqual([]);
		expect(afterOAuth.getDraft('guest-oauth-draft')?.data.objective.rawInput).toBe(
			'Guest objective before sign-in'
		);

		expect(await claimGuestDraftForUser('guest-oauth-draft', 'guest-turned-user', afterOAuth)).toBe(
			true
		);
		expect(afterOAuth.getDraft('guest-oauth-draft')?.data.objective.rawInput).toBe(
			'Guest objective before sign-in'
		);
		const persisted = JSON.parse(storage.getItem('commons_template_drafts') ?? '{}');
		expect(persisted['guest-oauth-draft'].ownerHash).toBe(
			await deriveOwnerHash('guest-turned-user')
		);
	});

	it('lists ownerless drafts only once the session resolves to a guest', () => {
		const guestLoad = createTemplateDraftStore();
		guestLoad.saveDraft('guest-draft', draft('Guest text'), 'objective');

		const reload = createTemplateDraftStore();
		expect(reload.getAllDraftIds()).toEqual([]);

		reload.setOwner(null);
		expect(reload.getAllDraftIds()).toEqual(['guest-draft']);
		expect(reload.getDraft('guest-draft')?.data.objective.rawInput).toBe('Guest text');
	});

	it('does not report a claim when durable browser storage rejects the ownership write', async () => {
		const store = createTemplateDraftStore();
		store.saveDraft('storage-failure', draft('Still ownerless'), 'objective');
		storage.setItem = () => {
			throw new Error('quota exceeded');
		};

		expect(await claimGuestDraftForUser('storage-failure', 'new-user', store)).toBe(false);
		expect(store.getDraft('storage-failure')).toBeNull();
		const persisted = JSON.parse(storage.getItem('commons_template_drafts') ?? '{}');
		expect(persisted['storage-failure'].ownerHash).toBeUndefined();
	});
});
