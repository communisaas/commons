<script lang="ts">
	import { onDestroy } from 'svelte';
	import { enhance } from '$app/forms';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { env } from '$env/dynamic/public';
	import SegmentBuilder from '$lib/components/segments/SegmentBuilder.svelte';
	import type { SegmentFilter } from '$lib/types/segment';
	import type { PageData, ActionData } from './$types';
	import type { Editor as EditorType } from '@tiptap/core';
	import type { BlastProgress } from '$lib/services/client-blast-sender';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let subject = $state('');
	let bodyHtml = $state('');
	let fromName = $state(data.org.name);
	let fromEmail = $state(`${data.org.slug}@commons.email`);
	let campaignId = $state('');
	let verifiedFilter = $state('any');
	let selectedTagIds = $state<string[]>([]);
	let recipientCount = $state(data.subscribedCount);
	let countLoading = $state(false);
	let sending = $state(false);
	let showPreview = $state(false);

	// Client-direct send state
	const CLIENT_DIRECT_THRESHOLD = 500;
	let showPassphraseDialog = $state(false);
	let passphrase = $state('');
	let passphraseError = $state('');
	let blastProgress = $state<BlastProgress | null>(null);
	let blastResult = $state<{ sent: number; failed: number; errors: Array<{ emailHash: string; error: string }> } | null>(null);
	let pendingBlastData = $state<{ blastId: string; orgId: string; fromEmail: string; fromName: string; subject: string; bodyHtml: string } | null>(null);

	const useClientDirect = $derived(recipientCount < CLIENT_DIRECT_THRESHOLD && recipientCount > 0);
	const hasOrgKey = $derived(!!data.orgKeyVerifier);

	// Segment builder state
	let useSegmentBuilder = $state(false);
	let segmentFilter = $state<SegmentFilter | null>(null);
	let segmentFilterJson = $state('');

	// A/B testing state
	let abEnabled = $state(false);
	let subjectA = $state('');
	let subjectB = $state('');
	let bodyHtmlA = $state('');
	let bodyHtmlB = $state('');
	let activeVariant = $state<'A' | 'B'>('A');
	let splitPct = $state(50);
	let testDuration = $state('4h');
	let winnerMetric = $state('open');
	let testGroupPct = $state(20);

	// Draft auto-save
	interface ComposeDraft {
		subject: string;
		bodyHtml: string;
		fromName: string;
		campaignId: string;
		verifiedFilter: string;
		selectedTagIds: string[];
		savedAt: number;
	}

	let draftRestored = $state(false);
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	const draftKey = $derived(`draft:compose:${data.org.id}`);

	// Restore draft on mount (runs once)
	let hasRestoredDraft = false;
	$effect(() => {
		if (!browser || hasRestoredDraft) return;
		hasRestoredDraft = true;
		try {
			const saved = localStorage.getItem(draftKey);
			if (!saved) return;
			const draft: ComposeDraft = JSON.parse(saved);
			// Discard drafts older than 7 days
			if (Date.now() - draft.savedAt > 7 * 24 * 60 * 60 * 1000) {
				localStorage.removeItem(draftKey);
				return;
			}
			// Only restore if current form is empty
			if (subject || bodyHtml) return;
			subject = draft.subject || '';
			bodyHtml = draft.bodyHtml || '';
			fromName = draft.fromName || data.org.name;
			campaignId = draft.campaignId || '';
			verifiedFilter = draft.verifiedFilter || 'any';
			selectedTagIds = draft.selectedTagIds || [];
			draftRestored = true;
		} catch { /* corrupted data, ignore */ }
	});

	// Auto-save on change (debounced 2s)
	$effect(() => {
		// Track all saveable fields
		const _s = subject; const _b = bodyHtml; const _f = fromName;
		const _c = campaignId; const _v = verifiedFilter; const _t = selectedTagIds;

		if (!browser) return;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			// Don't save empty drafts
			if (!subject && !bodyHtml) return;
			const draft: ComposeDraft = { subject, bodyHtml, fromName, campaignId, verifiedFilter, selectedTagIds, savedAt: Date.now() };
			try { localStorage.setItem(draftKey, JSON.stringify(draft)); } catch { /* quota exceeded, ignore */ }
		}, 2000);
	});

	// Warn before unload if form has content
	$effect(() => {
		if (!browser) return;
		function handleBeforeUnload(e: BeforeUnloadEvent) {
			if (subject.trim() || bodyHtml.trim()) {
				e.preventDefault();
			}
		}
		window.addEventListener('beforeunload', handleBeforeUnload);
		return () => window.removeEventListener('beforeunload', handleBeforeUnload);
	});

	// Tiptap editor
	let editorElement: HTMLElement | undefined = $state();
	let editor: EditorType | undefined = $state();

	$effect(() => {
		if (!browser || !editorElement) return;

		let editorInstance: EditorType;

		(async () => {
			const { Editor } = await import('@tiptap/core');
			const { default: StarterKit } = await import('@tiptap/starter-kit');
			const { default: Link } = await import('@tiptap/extension-link');
			const { default: TextAlign } = await import('@tiptap/extension-text-align');
			const { default: Underline } = await import('@tiptap/extension-underline');

			// Guard: element may have been removed during async import
			if (!editorElement) return;

			editorInstance = new Editor({
				element: editorElement,
				extensions: [
					StarterKit,
					Link.configure({
						openOnClick: false,
						HTMLAttributes: { class: 'text-teal-400 underline' }
					}),
					TextAlign.configure({
						types: ['heading', 'paragraph']
					}),
					Underline
				],
				content: bodyHtml || '',
				editorProps: {
					attributes: {
						class: 'prose prose-invert prose-sm max-w-none px-4 py-3 min-h-[18rem] focus:outline-none text-text-primary leading-relaxed'
					}
				},
				onUpdate: ({ editor: e }) => {
					bodyHtml = e.getHTML();
				}
			});

			editor = editorInstance;
		})();

		return () => {
			if (editorInstance) {
				editorInstance.destroy();
			}
		};
	});

	onDestroy(() => {
		if (editor) {
			editor.destroy();
		}
	});

	const previewHtml = $derived(
		form && 'previewHtml' in form ? (form as { previewHtml: string }).previewHtml : null
	);
	const previewSubject = $derived(
		form && 'previewSubject' in form ? (form as { previewSubject: string }).previewSubject : null
	);
	const errorMsg = $derived(
		form && 'error' in form ? (form as { error: string }).error : null
	);

	function toggleTag(tagId: string) {
		if (selectedTagIds.includes(tagId)) {
			selectedTagIds = selectedTagIds.filter((id) => id !== tagId);
		} else {
			selectedTagIds = [...selectedTagIds, tagId];
		}
	}

	// Debounced auto-recount when filters change
	let isFirstRun = true;
	let countDebounceTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		const _v = verifiedFilter;
		const _t = selectedTagIds;

		if (isFirstRun) {
			isFirstRun = false;
			return;
		}

		if (countDebounceTimer) clearTimeout(countDebounceTimer);
		countDebounceTimer = setTimeout(() => {
			const countForm = document.querySelector('form[action="?/count"]') as HTMLFormElement;
			if (countForm) countForm.requestSubmit();
		}, 500);
	});

	const mergeFieldHints = [
		{ field: '{{firstName}}', desc: 'Recipient\'s first name' },
		{ field: '{{lastName}}', desc: 'Recipient\'s last name' },
		{ field: '{{postalCode}}', desc: 'Recipient\'s postal code' },
		{ field: '{{tierContext}}', desc: 'Verification context, e.g., "You\'re one of 43 Established advocates in District 6"' }
	];

	function insertMergeField(field: string) {
		if (editor) {
			editor.chain().focus().insertContent(field).run();
		}
	}

	// Toolbar helpers
	function setLink() {
		if (!editor) return;
		const previousUrl = editor.getAttributes('link').href || '';
		const url = prompt('Enter URL:', previousUrl);
		if (url === null) return; // cancelled
		if (url === '') {
			editor.chain().focus().extendMarkRange('link').unsetLink().run();
		} else {
			editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
		}
	}

	// Force reactivity for toolbar active states
	let editorRevision = $state(0);
	$effect(() => {
		if (!editor) return;
		const handler = () => { editorRevision++; };
		editor.on('transaction', handler);
		return () => { editor?.off('transaction', handler); };
	});

	function isActive(name: string | Record<string, unknown>, attrs?: Record<string, unknown>): boolean {
		// read editorRevision to trigger reactivity
		void editorRevision;
		if (typeof name === 'object') {
			return editor?.isActive(name) ?? false;
		}
		return editor?.isActive(name, attrs) ?? false;
	}

	// Tiptap outputs <p></p> for empty content, so check for real content
	const hasBody = $derived(bodyHtml.replace(/<[^>]*>/g, '').trim().length > 0);

	async function startClientDirectSend(blastData: typeof pendingBlastData) {
		if (!blastData) return;

		const { getOrPromptOrgKey } = await import('$lib/services/org-key-manager');

		// Try cached org key first
		let orgKey = data.orgKeyVerifier
			? await getOrPromptOrgKey(data.org.id, data.orgKeyVerifier)
			: null;

		if (!orgKey) {
			// Need passphrase — show dialog and wait
			pendingBlastData = blastData;
			showPassphraseDialog = true;
			return;
		}

		await executeClientSend(orgKey, blastData);
	}

	async function onPassphraseSubmit() {
		if (!passphrase.trim() || !pendingBlastData || !data.orgKeyVerifier) return;

		passphraseError = '';

		try {
			const { deriveAndCacheOrgKey } = await import('$lib/services/org-key-manager');
			const orgKey = await deriveAndCacheOrgKey(passphrase, data.org.id, data.orgKeyVerifier);

			if (!orgKey) {
				passphraseError = 'Wrong passphrase. Please try again.';
				return;
			}

			showPassphraseDialog = false;
			passphrase = '';
			await executeClientSend(orgKey, pendingBlastData);
		} catch (err) {
			passphraseError = err instanceof Error ? err.message : 'Key derivation failed';
		}
	}

	async function executeClientSend(orgKey: CryptoKey, blastData: NonNullable<typeof pendingBlastData>) {
		const { sendBlastFromClient } = await import('$lib/services/client-blast-sender');
		const { useConvexClient } = await import('convex-sveltekit');
		const { api } = await import('$lib/convex');

		const convex = useConvexClient();

		sending = true;
		blastProgress = { total: 0, sent: 0, failed: 0, currentBatch: 0, totalBatches: 0, status: 'fetching-credentials' };

		try {
			// Fetch encrypted supporters via Convex client
			const supporters = await convex.query(api.blasts.getEncryptedSupportersForBlast, {
				orgSlug: data.org.slug
			});

			// Update blast to sending
			await convex.mutation(api.blasts.updateClientBlastProgress, {
				orgSlug: data.org.slug,
				blastId: blastData.blastId as any,
				status: 'sending',
				totalSent: 0,
				totalBounced: 0,
				totalRecipients: supporters.length
			});

			const result = await sendBlastFromClient({
				orgSlug: data.org.slug,
				orgId: blastData.orgId,
				blastId: blastData.blastId,
				orgKey,
				subject: blastData.subject,
				bodyHtml: blastData.bodyHtml,
				fromEmail: blastData.fromEmail,
				fromName: blastData.fromName,
				lambdaUrl: env.PUBLIC_SES_PROXY_URL || '',
				encryptedSupporters: supporters,
				onProgress: (p) => { blastProgress = p; }
			});

			// Finalize blast status
			await convex.mutation(api.blasts.updateClientBlastProgress, {
				orgSlug: data.org.slug,
				blastId: blastData.blastId as any,
				status: result.failed === result.total ? 'failed' : 'sent',
				totalSent: result.sent,
				totalBounced: result.failed,
				totalRecipients: result.total
			});

			blastResult = result;

			// Clear draft
			if (browser) { try { localStorage.removeItem(draftKey); } catch {} }
		} catch (err) {
			blastProgress = { ...blastProgress!, status: 'error' };
			blastResult = {
				sent: blastProgress?.sent ?? 0,
				failed: blastProgress?.total ?? 0,
				errors: [{ emailHash: '', error: err instanceof Error ? err.message : 'Send failed' }]
			};
		} finally {
			sending = false;
			pendingBlastData = null;
		}
	}
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex items-center gap-4">
		<a
			href="/org/{data.org.slug}/emails"
			class="text-text-tertiary hover:text-text-secondary transition-colors"
			aria-label="Back to emails"
		>
			<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
				<path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
			</svg>
		</a>
		<div>
			<h1 class="text-xl font-semibold text-text-primary">Compose Invitation</h1>
			<p class="text-sm text-text-tertiary mt-1">Invite supporters to take verified action</p>
		</div>
	</div>

	{#if errorMsg}
		<div class="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
			{errorMsg}
		</div>
	{/if}

	{#if draftRestored}
		<div class="flex items-center justify-between rounded-lg border border-teal-500/20 bg-teal-500/5 px-4 py-2.5">
			<p class="text-sm text-teal-400">Draft restored from your last session</p>
			<button
				type="button"
				class="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
				onclick={() => {
					subject = ''; bodyHtml = ''; fromName = data.org.name;
					campaignId = ''; verifiedFilter = 'any'; selectedTagIds = [];
					if (editor) editor.commands.clearContent();
					draftRestored = false;
					if (browser) { try { localStorage.removeItem(draftKey); } catch {} }
				}}
			>
				Discard
			</button>
		</div>
	{/if}

	<!-- Preview modal -->
	{#if showPreview && previewHtml}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
			<div class="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-md border border-surface-border-strong bg-surface-raised overflow-hidden">
				<div class="flex items-center justify-between px-4 py-3 border-b border-surface-border">
					<div>
						<p class="text-sm font-medium text-text-primary">Email Preview</p>
						{#if previewSubject}
							<p class="text-xs text-text-tertiary mt-0.5">Subject: {previewSubject}</p>
						{/if}
					</div>
					<button
						type="button"
						class="text-text-tertiary hover:text-text-primary transition-colors"
						aria-label="Close preview"
						onclick={() => (showPreview = false)}
					>
						<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
				<div class="flex-1 overflow-auto p-1">
					<iframe
						srcdoc={previewHtml}
						title="Email preview"
						class="w-full h-full min-h-[400px] rounded border-0"
						sandbox=""
					></iframe>
				</div>
			</div>
		</div>
	{/if}

	<!-- Passphrase dialog for client-direct send -->
	{#if showPassphraseDialog}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
			<div class="w-full max-w-sm rounded-md border border-surface-border-strong bg-surface-raised p-6 space-y-4">
				<div>
					<h3 class="text-base font-semibold text-text-primary">Enter organization passphrase</h3>
					<p class="text-sm text-text-tertiary mt-1">
						Your passphrase decrypts supporter emails in this browser. It is never sent to our servers.
					</p>
				</div>

				{#if passphraseError}
					<div class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
						{passphraseError}
					</div>
				{/if}

				<form onsubmit={(e) => { e.preventDefault(); onPassphraseSubmit(); }}>
					<input
						type="password"
						bind:value={passphrase}
						placeholder="Organization passphrase"
						class="w-full rounded-lg border border-surface-border-strong bg-surface-base px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
						autofocus
					/>
					<div class="flex gap-3 mt-4">
						<button
							type="button"
							class="flex-1 rounded-lg border border-surface-border-strong bg-surface-overlay px-4 py-2.5 text-sm font-medium text-text-primary hover:bg-surface-overlay hover:border-text-quaternary transition-colors"
							onclick={() => { showPassphraseDialog = false; passphrase = ''; passphraseError = ''; pendingBlastData = null; }}
						>
							Cancel
						</button>
						<button
							type="submit"
							class="flex-1 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-500 transition-colors disabled:opacity-50"
							disabled={!passphrase.trim()}
						>
							Unlock & Send
						</button>
					</div>
				</form>
			</div>
		</div>
	{/if}

	<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
		<!-- Main form -->
		<div class="lg:col-span-2 space-y-6">
			<!-- From / Subject -->
			<div class="rounded-md border border-surface-border bg-surface-base p-6 space-y-4">
				<div class="grid grid-cols-2 gap-4">
					<div>
						<label for="fromName" class="block text-sm font-medium text-text-secondary mb-1.5">From Name</label>
						<input
							id="fromName"
							type="text"
							bind:value={fromName}
							class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
							placeholder="Organization name"
						/>
					</div>
					<div>
						<label for="fromEmail" class="block text-sm font-medium text-text-secondary mb-1.5">From Email</label>
						<input
							id="fromEmail"
							type="email"
							bind:value={fromEmail}
							class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
							placeholder="noreply@commons.email"
						/>
					</div>
				</div>

				{#if !abEnabled}
					<div>
						<label for="subject" class="block text-sm font-medium text-text-secondary mb-1.5">Subject Line</label>
						<input
							id="subject"
							type="text"
							bind:value={subject}
							class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
							placeholder="Your email subject..."
						/>
					</div>
				{:else}
					<div class="space-y-3">
						<div class="flex items-center gap-2">
							<span class="text-sm font-medium text-text-secondary">Subject Lines</span>
							<span class="rounded-md bg-teal-500/15 border border-teal-500/20 px-2 py-0.5 text-xs font-mono text-teal-400">A/B Test</span>
						</div>
						<div>
							<label for="subjectA" class="block text-xs font-medium text-text-tertiary mb-1">Variant A</label>
							<input
								id="subjectA"
								type="text"
								bind:value={subjectA}
								class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
								placeholder="Subject line A..."
							/>
						</div>
						<div>
							<label for="subjectB" class="block text-xs font-medium text-text-tertiary mb-1">Variant B</label>
							<input
								id="subjectB"
								type="text"
								bind:value={subjectB}
								class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
								placeholder="Subject line B..."
							/>
						</div>
					</div>
				{/if}

				<div>
					<label for="campaignId" class="block text-sm font-medium text-text-secondary mb-1.5">
						Link to Campaign
						<span class="text-text-tertiary font-normal">(optional)</span>
					</label>
					<select
						id="campaignId"
						bind:value={campaignId}
						class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
					>
						<option value="">No campaign</option>
						{#each data.campaigns as campaign}
							<option value={campaign.id}>
								{campaign.title} ({campaign.status})
							</option>
						{/each}
					</select>
				</div>
			</div>

			{#if abEnabled}
				<!-- A/B Variant Tabs for Body -->
				<div class="flex gap-1 rounded-lg border border-surface-border bg-surface-base p-1">
					<button
						type="button"
						class="flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors {activeVariant === 'A' ? 'bg-surface-border-strong/50 text-teal-400' : 'text-text-tertiary hover:text-text-primary'}"
						onclick={() => {
							if (activeVariant === 'A') return;
							bodyHtmlB = bodyHtml;
							activeVariant = 'A';
							bodyHtml = bodyHtmlA;
							if (editor) editor.commands.setContent(bodyHtmlA || '');
						}}
					>
						Variant A Body
					</button>
					<button
						type="button"
						class="flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors {activeVariant === 'B' ? 'bg-surface-border-strong/50 text-teal-400' : 'text-text-tertiary hover:text-text-primary'}"
						onclick={() => {
							if (activeVariant === 'B') return;
							bodyHtmlA = bodyHtml;
							activeVariant = 'B';
							bodyHtml = bodyHtmlB;
							if (editor) editor.commands.setContent(bodyHtmlB || '');
						}}
					>
						Variant B Body
					</button>
				</div>
			{/if}

			<!-- Body editor -->
			<div class="rounded-md border border-surface-border bg-surface-base p-6 space-y-4">
				<div class="flex items-center justify-between">
					<label class="block text-sm font-medium text-text-secondary">Email Body</label>
					<div class="flex items-center gap-1">
						{#each mergeFieldHints as hint}
							<button
								type="button"
								class="rounded px-2 py-1 text-xs font-mono text-text-tertiary hover:text-teal-400 hover:bg-surface-overlay transition-colors"
								title={hint.desc}
								onclick={() => insertMergeField(hint.field)}
							>
								{hint.field}
							</button>
						{/each}
					</div>
				</div>

				<!-- Tiptap editor -->
				<div class="tiptap-wrapper rounded-lg border border-surface-border-strong bg-surface-raised overflow-hidden focus-within:border-teal-500 focus-within:ring-1 focus-within:ring-teal-500 transition-colors">
					<!-- Toolbar -->
					{#if editor}
						<div class="flex flex-wrap items-center gap-0.5 border-b border-surface-border-strong bg-surface-overlay px-2 py-1.5">
							<!-- Bold -->
							<button type="button" title="Bold" class="rounded p-1.5 transition-colors {isActive('bold') ? 'text-teal-400 bg-surface-border-strong/50' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}" onclick={() => editor?.chain().focus().toggleBold().run()}>
								<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z" /><path stroke-linecap="round" stroke-linejoin="round" d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z" /></svg>
							</button>
							<!-- Italic -->
							<button type="button" title="Italic" class="rounded p-1.5 transition-colors {isActive('italic') ? 'text-teal-400 bg-surface-border-strong/50' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}" onclick={() => editor?.chain().focus().toggleItalic().run()}>
								<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10 4h4m-2 0l-4 16m-2 0h4m4-16l-4 16" /></svg>
							</button>
							<!-- Underline -->
							<button type="button" title="Underline" class="rounded p-1.5 transition-colors {isActive('underline') ? 'text-teal-400 bg-surface-border-strong/50' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}" onclick={() => editor?.chain().focus().toggleUnderline().run()}>
								<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 4v7a5 5 0 0010 0V4M5 20h14" /></svg>
							</button>
							<!-- Strikethrough -->
							<button type="button" title="Strikethrough" class="rounded p-1.5 transition-colors {isActive('strike') ? 'text-teal-400 bg-surface-border-strong/50' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}" onclick={() => editor?.chain().focus().toggleStrike().run()}>
								<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16 4c-.5-1.5-2.2-2-4-2-2.2 0-4 1.1-4 3 0 .8.3 1.5.8 2M4 12h16M8 20c.5 1.5 2.2 2 4 2 2.2 0 4-1.1 4-3 0-.8-.3-1.5-.8-2" /></svg>
							</button>

							<span class="w-px h-5 bg-surface-border-strong mx-1"></span>

							<!-- H1 -->
							<button type="button" title="Heading 1" class="rounded px-1.5 py-1 text-xs font-bold transition-colors {isActive('heading', { level: 1 }) ? 'text-teal-400 bg-surface-border-strong/50' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}" onclick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}>
								H1
							</button>
							<!-- H2 -->
							<button type="button" title="Heading 2" class="rounded px-1.5 py-1 text-xs font-bold transition-colors {isActive('heading', { level: 2 }) ? 'text-teal-400 bg-surface-border-strong/50' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}" onclick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>
								H2
							</button>
							<!-- H3 -->
							<button type="button" title="Heading 3" class="rounded px-1.5 py-1 text-xs font-bold transition-colors {isActive('heading', { level: 3 }) ? 'text-teal-400 bg-surface-border-strong/50' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}" onclick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}>
								H3
							</button>

							<span class="w-px h-5 bg-surface-border-strong mx-1"></span>

							<!-- Bullet list -->
							<button type="button" title="Bullet list" class="rounded p-1.5 transition-colors {isActive('bulletList') ? 'text-teal-400 bg-surface-border-strong/50' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}" onclick={() => editor?.chain().focus().toggleBulletList().run()}>
								<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
							</button>
							<!-- Ordered list -->
							<button type="button" title="Ordered list" class="rounded p-1.5 transition-colors {isActive('orderedList') ? 'text-teal-400 bg-surface-border-strong/50' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}" onclick={() => editor?.chain().focus().toggleOrderedList().run()}>
								<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6h11M10 12h11M10 18h11" /><text x="2" y="8" fill="currentColor" font-size="7" font-weight="bold" stroke="none">1</text><text x="2" y="14" fill="currentColor" font-size="7" font-weight="bold" stroke="none">2</text><text x="2" y="20" fill="currentColor" font-size="7" font-weight="bold" stroke="none">3</text></svg>
							</button>

							<span class="w-px h-5 bg-surface-border-strong mx-1"></span>

							<!-- Link -->
							<button type="button" title="Link" class="rounded p-1.5 transition-colors {isActive('link') ? 'text-teal-400 bg-surface-border-strong/50' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}" onclick={() => setLink()}>
								<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
							</button>
							<!-- Blockquote -->
							<button type="button" title="Blockquote" class="rounded p-1.5 transition-colors {isActive('blockquote') ? 'text-teal-400 bg-surface-border-strong/50' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}" onclick={() => editor?.chain().focus().toggleBlockquote().run()}>
								<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10h4a1 1 0 011 1v4a1 1 0 01-1 1H3a1 1 0 01-1-1v-4a1 1 0 011-1zm0 0V7a4 4 0 014-4m7 7h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4a1 1 0 011-1zm0 0V7a4 4 0 014-4" /></svg>
							</button>

							<span class="w-px h-5 bg-surface-border-strong mx-1"></span>

							<!-- Align left -->
							<button type="button" title="Align left" class="rounded p-1.5 transition-colors {isActive({ textAlign: 'left' }) ? 'text-teal-400 bg-surface-border-strong/50' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}" onclick={() => editor?.chain().focus().setTextAlign('left').run()}>
								<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 6h18M3 12h12M3 18h18" /></svg>
							</button>
							<!-- Align center -->
							<button type="button" title="Align center" class="rounded p-1.5 transition-colors {isActive({ textAlign: 'center' }) ? 'text-teal-400 bg-surface-border-strong/50' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}" onclick={() => editor?.chain().focus().setTextAlign('center').run()}>
								<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 6h18M6 12h12M3 18h18" /></svg>
							</button>
							<!-- Align right -->
							<button type="button" title="Align right" class="rounded p-1.5 transition-colors {isActive({ textAlign: 'right' }) ? 'text-teal-400 bg-surface-border-strong/50' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}" onclick={() => editor?.chain().focus().setTextAlign('right').run()}>
								<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 6h18M6 12h18M3 18h18" /></svg>
							</button>

							<span class="w-px h-5 bg-surface-border-strong mx-1"></span>

							<!-- Clear formatting -->
							<button type="button" title="Clear formatting" class="rounded p-1.5 text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30 transition-colors" onclick={() => editor?.chain().focus().clearNodes().unsetAllMarks().run()}>
								<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
							</button>
						</div>
					{/if}

					<!-- Editor content area -->
					<div bind:this={editorElement} class="tiptap-editor"></div>
				</div>

				<!-- Verification context notice -->
				<div class="flex items-start gap-3 rounded-lg border border-surface-border-strong/50 bg-surface-overlay px-4 py-3">
					<svg class="w-4 h-4 text-teal-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
					</svg>
					<div>
						<p class="text-xs font-medium text-text-secondary">Verification proof is built in</p>
						<p class="text-xs text-text-tertiary mt-0.5">
							Every email includes a live verification block showing how many verified constituents have acted.
							Recipients see themselves joining a proven collective — not responding to a blast.
						</p>
					</div>
				</div>
			</div>
		</div>

		<!-- Sidebar: Filters + Actions -->
		<div class="space-y-6">
			<!-- Recipient filters -->
			<div class="rounded-md border border-surface-border bg-surface-base p-6 space-y-4">
				<div class="flex items-center justify-between">
					<h3 class="text-sm font-medium text-text-secondary">Recipients</h3>
					<button
						type="button"
						class="text-xs transition-colors {useSegmentBuilder
							? 'text-teal-400 hover:text-teal-300'
							: 'text-text-tertiary hover:text-text-secondary'}"
						onclick={() => (useSegmentBuilder = !useSegmentBuilder)}
					>
						{useSegmentBuilder ? 'Simple filters' : 'Segment builder'}
					</button>
				</div>

				{#if useSegmentBuilder}
					<SegmentBuilder
						orgSlug={data.org.slug}
						tags={data.tags}
						campaigns={data.campaigns}
						showSaveControls={true}
						onApply={(filter, count) => {
							segmentFilter = filter;
							segmentFilterJson = JSON.stringify(filter);
							recipientCount = count;
						}}
						onFilterChange={(filter) => {
							segmentFilter = filter;
							segmentFilterJson = JSON.stringify(filter);
						}}
					/>
				{:else}
					<!-- Verification filter -->
					<div>
						<label for="verified" class="block text-xs font-medium text-text-tertiary mb-1.5">Verification Status</label>
						<select
							id="verified"
							bind:value={verifiedFilter}
							class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
						>
							<option value="any">Any status</option>
							<option value="verified">Verified only</option>
							<option value="unverified">Unverified only</option>
						</select>
					</div>

					<!-- Tag filter -->
					{#if data.tags.length > 0}
						<div>
							<p class="text-xs font-medium text-text-tertiary mb-1.5">Tags</p>
							<div class="flex flex-wrap gap-2">
								{#each data.tags as tag (tag.id)}
									<button
										type="button"
										class="rounded-md border px-2.5 py-1 text-xs transition-colors {selectedTagIds.includes(tag.id)
											? 'bg-teal-500/20 text-teal-400 border-teal-500/30'
											: 'bg-surface-overlay text-text-tertiary border-surface-border-strong hover:border-text-quaternary'}"
										onclick={() => toggleTag(tag.id)}
									>
										{tag.name}
									</button>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Recipient count -->
					<form
						method="POST"
						action="?/count"
						use:enhance={() => {
							countLoading = true;
							return async ({ result, update }) => {
								countLoading = false;
								if (result.type === 'success' && result.data && 'count' in result.data) {
									recipientCount = result.data.count as number;
								}
								await update({ reset: false });
							};
						}}
					>
						<input type="hidden" name="verified" value={verifiedFilter} />
						{#each selectedTagIds as tagId}
							<input type="hidden" name="tagIds" value={tagId} />
						{/each}
						<button
							type="submit"
							class="w-full rounded-lg border border-surface-border-strong bg-surface-overlay px-3 py-2 text-sm text-text-secondary hover:bg-surface-overlay hover:border-text-quaternary transition-colors"
							disabled={countLoading}
						>
							{#if countLoading}
								Counting...
							{:else}
								Update Count
							{/if}
						</button>
					</form>

					<div class="rounded-lg bg-surface-overlay px-4 py-3 text-center">
						<p class="text-2xl font-mono tabular-nums text-text-primary">{recipientCount.toLocaleString()}</p>
						<p class="text-xs text-text-tertiary mt-0.5">subscribed recipients</p>
					</div>
				{/if}
			</div>

			<!-- A/B Test Toggle -->
			{#if data.abTestingAllowed}
				<div class="rounded-md border border-surface-border bg-surface-base p-6 space-y-4">
					<div class="flex items-center justify-between">
						<div>
							<h3 class="text-sm font-medium text-text-secondary">A/B Test</h3>
							<p class="text-xs text-text-tertiary mt-0.5">Test two variants, send the winner</p>
						</div>
						<button
							type="button"
							class="relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 cursor-pointer {abEnabled ? 'bg-teal-500' : 'bg-text-quaternary'}"
							role="switch"
							aria-checked={abEnabled}
							onclick={() => {
								abEnabled = !abEnabled;
								if (abEnabled) {
									subjectA = subject;
									subjectB = '';
									bodyHtmlA = bodyHtml;
									bodyHtmlB = '';
									activeVariant = 'A';
								} else {
									subject = subjectA || subject;
									bodyHtml = bodyHtmlA || bodyHtml;
								}
							}}
						>
							<span class="pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition duration-200 {abEnabled ? 'translate-x-4' : 'translate-x-0'}"></span>
						</button>
					</div>

					{#if abEnabled}
						<div class="space-y-3 pt-2 border-t border-surface-border">
							<div>
								<label for="testGroupPct" class="block text-xs font-medium text-text-tertiary mb-1">Test group size</label>
								<select id="testGroupPct" bind:value={testGroupPct} class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500">
									<option value={10}>10% test, 90% winner</option>
									<option value={20}>20% test, 80% winner</option>
									<option value={30}>30% test, 70% winner</option>
									<option value={50}>50% test, 50% winner</option>
								</select>
							</div>
							<div>
								<label for="splitPct" class="block text-xs font-medium text-text-tertiary mb-1">Test split (A/B)</label>
								<select id="splitPct" bind:value={splitPct} class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500">
									<option value={50}>50 / 50</option>
									<option value={60}>60 / 40</option>
									<option value={70}>70 / 30</option>
								</select>
							</div>
							<div>
								<label for="testDuration" class="block text-xs font-medium text-text-tertiary mb-1">Wait before picking winner</label>
								<select id="testDuration" bind:value={testDuration} class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500">
									<option value="1h">1 hour</option>
									<option value="4h">4 hours</option>
									<option value="24h">24 hours</option>
								</select>
							</div>
							<div>
								<label for="winnerMetric" class="block text-xs font-medium text-text-tertiary mb-1">Pick winner by</label>
								<select id="winnerMetric" bind:value={winnerMetric} class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500">
									<option value="open">Open rate</option>
									<option value="click">Click rate</option>
									<option value="verified_action">Verified action rate</option>
								</select>
							</div>
							<div class="rounded-lg bg-surface-overlay px-3 py-2.5 text-xs text-text-tertiary">
								{Math.round(recipientCount * testGroupPct / 100)} in test group
								({Math.round(recipientCount * testGroupPct / 100 * splitPct / 100)} A,
								{Math.round(recipientCount * testGroupPct / 100 * (100 - splitPct) / 100)} B).
								Winner sent to ~{Math.round(recipientCount * (100 - testGroupPct) / 100)} remaining.
							</div>
						</div>
					{/if}
				</div>
			{/if}

			<!-- Actions -->
			<div class="rounded-md border border-surface-border bg-surface-base p-6 space-y-3">
				<!-- Preview -->
				<form
					method="POST"
					action="?/preview"
					use:enhance={() => {
						return async ({ update }) => {
							await update({ reset: false });
							showPreview = true;
						};
					}}
				>
					<input type="hidden" name="subject" value={abEnabled ? subjectA : subject} />
					<input type="hidden" name="bodyHtml" value={abEnabled ? (activeVariant === 'A' ? bodyHtml : bodyHtmlA) : bodyHtml} />
					<button
						type="submit"
						class="w-full rounded-lg border border-surface-border-strong bg-surface-overlay px-4 py-2.5 text-sm font-medium text-text-primary hover:bg-surface-overlay hover:border-text-quaternary transition-colors"
						disabled={!hasBody}
					>
						Preview Email{abEnabled ? ` (${activeVariant})` : ''}
					</button>
				</form>

				{#if abEnabled}
					<!-- A/B Send -->
					<form
						method="POST"
						action="?/sendAbTest"
						use:enhance={({ cancel }) => {
							if (activeVariant === 'A') bodyHtmlA = bodyHtml;
							else bodyHtmlB = bodyHtml;
							if (!confirm(`Send invitation to ${recipientCount.toLocaleString()} supporter${recipientCount === 1 ? '' : 's'}? Each email includes your campaign's verification proof.`)) {
								cancel();
								return;
							}
							sending = true;
							if (browser) { try { localStorage.removeItem(draftKey); } catch {} }
							return async ({ update }) => {
								sending = false;
								await update({ reset: false });
							};
						}}
					>
						<input type="hidden" name="subjectA" value={subjectA} />
						<input type="hidden" name="subjectB" value={subjectB} />
						<input type="hidden" name="bodyHtmlA" value={activeVariant === 'A' ? bodyHtml : bodyHtmlA} />
						<input type="hidden" name="bodyHtmlB" value={activeVariant === 'B' ? bodyHtml : bodyHtmlB} />
						<input type="hidden" name="fromName" value={fromName} />
						<input type="hidden" name="fromEmail" value={fromEmail} />
						<input type="hidden" name="campaignId" value={campaignId} />
						<input type="hidden" name="verified" value={verifiedFilter} />
						<input type="hidden" name="splitPct" value={splitPct} />
						<input type="hidden" name="testGroupPct" value={testGroupPct} />
						<input type="hidden" name="testDuration" value={testDuration} />
						<input type="hidden" name="winnerMetric" value={winnerMetric} />
						{#each selectedTagIds as tagId}
							<input type="hidden" name="tagIds" value={tagId} />
						{/each}
						<button
							type="submit"
							class="w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
							disabled={!subjectA.trim() || !subjectB.trim() || recipientCount < 4 || sending}
						>
							{#if sending}
								Sending A/B Test...
							{:else}
								Send A/B Test to {recipientCount.toLocaleString()}
							{/if}
						</button>
					</form>
				{:else if useClientDirect && hasOrgKey}
					<!-- Client-Direct Send (<500 recipients, org key configured) -->
					{#if blastProgress && sending}
						<!-- Progress indicator -->
						<div class="space-y-3">
							<div class="flex items-center justify-between text-sm">
								<span class="text-text-secondary">
									{#if blastProgress.status === 'fetching-credentials'}
										Preparing credentials...
									{:else if blastProgress.status === 'decrypting'}
										Decrypting emails...
									{:else if blastProgress.status === 'sending'}
										Sending batch {blastProgress.currentBatch}/{blastProgress.totalBatches}...
									{:else if blastProgress.status === 'complete'}
										Complete
									{:else}
										Error
									{/if}
								</span>
								<span class="font-mono text-text-tertiary text-xs">
									{blastProgress.sent} sent, {blastProgress.failed} failed / {blastProgress.total}
								</span>
							</div>
							<div class="w-full bg-surface-border-strong rounded-full h-2">
								<div
									class="h-2 rounded-full transition-all duration-300 {blastProgress.failed > 0 ? 'bg-amber-500' : 'bg-teal-500'}"
									style="width: {blastProgress.total > 0 ? Math.round(((blastProgress.sent + blastProgress.failed) / blastProgress.total) * 100) : 0}%"
								></div>
							</div>
						</div>
					{:else if blastResult}
						<!-- Result summary -->
						<div class="space-y-2">
							<div class="rounded-lg border px-4 py-3 {blastResult.failed === 0 ? 'border-teal-500/30 bg-teal-500/10' : 'border-amber-500/30 bg-amber-500/10'}">
								<p class="text-sm font-medium {blastResult.failed === 0 ? 'text-teal-400' : 'text-amber-400'}">
									{blastResult.sent} sent{blastResult.failed > 0 ? `, ${blastResult.failed} failed` : ''}
								</p>
							</div>
							<button
								type="button"
								class="w-full rounded-lg border border-surface-border-strong bg-surface-overlay px-4 py-2.5 text-sm font-medium text-text-primary hover:bg-surface-overlay hover:border-text-quaternary transition-colors"
								onclick={() => goto(`/org/${data.org.slug}/emails`)}
							>
								Back to Emails
							</button>
						</div>
					{:else}
						<form
							method="POST"
							action="?/createClientDraft"
							use:enhance={({ cancel }) => {
								if (!confirm(`Send invitation to ${recipientCount.toLocaleString()} supporter${recipientCount === 1 ? '' : 's'}? Emails will be decrypted and sent from this browser.`)) {
									cancel();
									return;
								}
								sending = true;
								return async ({ result, update }) => {
									if (result.type === 'success' && result.data && 'blastId' in result.data) {
										const blastData = result.data as { blastId: string; orgId: string; fromEmail: string; fromName: string; subject: string; bodyHtml: string };
										sending = false;
										await startClientDirectSend(blastData);
									} else {
										sending = false;
										await update({ reset: false });
									}
								};
							}}
						>
							<input type="hidden" name="subject" value={subject} />
							<input type="hidden" name="bodyHtml" value={bodyHtml} />
							<input type="hidden" name="fromName" value={fromName} />
							<input type="hidden" name="fromEmail" value={fromEmail} />
							<input type="hidden" name="campaignId" value={campaignId} />
							<input type="hidden" name="verified" value={verifiedFilter} />
							{#each selectedTagIds as tagId}
								<input type="hidden" name="tagIds" value={tagId} />
							{/each}
							<button
								type="submit"
								class="w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
								disabled={!subject.trim() || !hasBody || recipientCount === 0 || sending}
							>
								{#if sending}
									Preparing...
								{:else}
									Send invitation to {recipientCount.toLocaleString()} supporter{recipientCount === 1 ? '' : 's'}
								{/if}
							</button>
							<p class="text-xs text-text-quaternary text-center mt-2">
								Emails decrypted in this browser, never on our servers
							</p>
						</form>
					{/if}
				{:else}
					<!-- Server-side Send (500+ recipients or no org key) -->
					<form
						method="POST"
						action="?/send"
						use:enhance={({ cancel }) => {
							if (!confirm(`Send invitation to ${recipientCount.toLocaleString()} supporter${recipientCount === 1 ? '' : 's'}? Each email includes your campaign's verification proof.`)) {
								cancel();
								return;
							}
							sending = true;
							if (browser) { try { localStorage.removeItem(draftKey); } catch {} }
							return async ({ update }) => {
								sending = false;
								await update({ reset: false });
							};
						}}
					>
						<input type="hidden" name="subject" value={subject} />
						<input type="hidden" name="bodyHtml" value={bodyHtml} />
						<input type="hidden" name="fromName" value={fromName} />
						<input type="hidden" name="fromEmail" value={fromEmail} />
						<input type="hidden" name="campaignId" value={campaignId} />
						<input type="hidden" name="verified" value={verifiedFilter} />
						{#each selectedTagIds as tagId}
							<input type="hidden" name="tagIds" value={tagId} />
						{/each}
						<button
							type="submit"
							class="w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
							disabled={!subject.trim() || !hasBody || recipientCount === 0 || sending}
						>
							{#if sending}
								Sending...
							{:else}
								Send invitation to {recipientCount.toLocaleString()} supporter{recipientCount === 1 ? '' : 's'}
							{/if}
						</button>
						{#if recipientCount >= CLIENT_DIRECT_THRESHOLD}
							<p class="text-xs text-text-quaternary text-center mt-2">
								Large blast -- will be processed via secure enclave
							</p>
						{/if}
					</form>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	/* Tiptap ProseMirror editor styles */
	:global(.tiptap-editor .ProseMirror) {
		min-height: 18rem;
		padding: 0.75rem 1rem;
		font-size: 0.875rem;
		line-height: 1.625;
		color: var(--text-primary);
		outline: none;
	}

	:global(.tiptap-editor .ProseMirror p) {
		margin-bottom: 0.5rem;
	}

	:global(.tiptap-editor .ProseMirror h1) {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 0.75rem;
		margin-top: 1rem;
		line-height: 1.25;
	}

	:global(.tiptap-editor .ProseMirror h2) {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 0.5rem;
		margin-top: 0.75rem;
		line-height: 1.3;
	}

	:global(.tiptap-editor .ProseMirror h3) {
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
		margin-top: 0.75rem;
		line-height: 1.4;
	}

	:global(.tiptap-editor .ProseMirror ul) {
		list-style-type: disc;
		padding-left: 1.5rem;
		margin-bottom: 0.5rem;
	}

	:global(.tiptap-editor .ProseMirror ol) {
		list-style-type: decimal;
		padding-left: 1.5rem;
		margin-bottom: 0.5rem;
	}

	:global(.tiptap-editor .ProseMirror li) {
		margin-bottom: 0.25rem;
	}

	:global(.tiptap-editor .ProseMirror blockquote) {
		border-left: 3px solid var(--surface-border-strong);
		padding-left: 1rem;
		color: var(--text-tertiary);
		margin: 0.75rem 0;
		font-style: italic;
	}

	:global(.tiptap-editor .ProseMirror a) {
		color: #2dd4bf; /* teal-400 */
		text-decoration: underline;
	}

	:global(.tiptap-editor .ProseMirror code) {
		background: var(--surface-overlay);
		border-radius: 0.25rem;
		padding: 0.15rem 0.35rem;
		font-size: 0.8em;
		font-family: ui-monospace, monospace;
		color: var(--text-secondary);
	}

	:global(.tiptap-editor .ProseMirror pre) {
		background: var(--surface-raised);
		border: 1px solid var(--surface-border-strong);
		border-radius: 0.5rem;
		padding: 0.75rem 1rem;
		margin: 0.75rem 0;
		overflow-x: auto;
	}

	:global(.tiptap-editor .ProseMirror pre code) {
		background: none;
		padding: 0;
		border-radius: 0;
	}

	:global(.tiptap-editor .ProseMirror hr) {
		border: none;
		border-top: 1px solid var(--surface-border-strong);
		margin: 1rem 0;
	}

	/* Placeholder */
	:global(.tiptap-editor .ProseMirror p.is-editor-empty:first-child::before) {
		content: 'Write your email content here...';
		float: left;
		color: var(--text-quaternary);
		pointer-events: none;
		height: 0;
	}
</style>
