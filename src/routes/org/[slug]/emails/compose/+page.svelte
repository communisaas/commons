<script lang="ts">
	import { onDestroy } from 'svelte';
	import { enhance } from '$app/forms';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { env } from '$env/dynamic/public';
	import { Datum } from '$lib/design';
	import { FEATURES } from '$lib/config/features';
	import BoundedNotice from '$lib/components/org/BoundedNotice.svelte';
	import {
		CLIENT_DIRECT_EMAIL_THRESHOLD,
		buildOrgLimitNotice,
		emailDeliveryLimitNotice,
		isClientDirectEmailCount
	} from '$lib/data/org-limit-sentences';
	import {
		deleteOrgEmailComposeDraft,
		getOrgEmailComposeDraft,
		type OrgEmailComposeDraft
	} from '$lib/stores/orgEmailComposeDraft';
	import {
		PLATFORM_EXPORT_PROFILES,
		formatPeopleSourceLabel
	} from '$lib/data/platform-export-profiles';
	import type { PageData, ActionData } from './$types';
	import type { Editor as EditorType } from '@tiptap/core';
	import type { BlastProgress } from '$lib/services/client-blast-sender';
	import type { Id } from '$convex/_generated/dataModel';

	type RecipientSourceRow = {
		source: string;
		label: string;
		count: number;
	};
	let { data, form }: { data: PageData; form: ActionData } = $props();

	let subject = $state('');
	let bodyHtml = $state('');
	let fromName = $state(data.org.name);
	let fromEmail = $state(`${data.org.slug}@commons.email`);
	let campaignId = $state('');
	let verifiedFilter = $state('any');
	let selectedTagIds = $state<string[]>([]);
	let selectedSegmentIds = $state<string[]>([]);
	let recipientCount = $state(data.subscribedCount);
	// svelte-ignore state_referenced_locally
	let recipientSourceCounts = $state<Record<string, number>>(
		coerceRecipientSourceCounts(data.recipientSourceCounts)
	);
	let countLoading = $state(false);
	let sending = $state(false);
	let showPreview = $state(false);

	// Client-direct send state
	let showPassphraseDialog = $state(false);
	let passphrase = $state('');
	let passphraseError = $state('');
	let blastProgress = $state<BlastProgress | null>(null);
	let blastResult = $state<{
		sent: number;
		failed: number;
		errors: Array<{ emailHash: string; error: string }>;
	} | null>(null);
	let pendingBlastData = $state<{
		blastId: string;
		orgId: string;
		fromEmail: string;
		fromName: string;
		subject: string;
		bodyHtml: string;
	} | null>(null);
	// Surfaces preflight failures (e.g., dispatch-claim 503) before the blast
	// reaches Lambda — operator-actionable error message instead of a confusing
	// 403 mid-blast.
	let blastError = $state<string | null>(null);

	const hasOrgKey = $derived(!!data.orgKeyVerifier);
	const canPublish = $derived(
		data.membership.role === 'owner' || data.membership.role === 'editor'
	);
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
	const mergeFieldPattern =
		/\{\{(?:firstName|lastName|email|postalCode|verificationStatus|tierLabel|tierContext)\}\}/g;
	const platformSourceIds = new Set<string>(
		PLATFORM_EXPORT_PROFILES.map((profile) => profile.source)
	);

	function coerceRecipientSourceCounts(value: unknown): Record<string, number> {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
		const counts: Record<string, number> = {};
		for (const [source, count] of Object.entries(value)) {
			if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
				counts[source] = count;
			}
		}
		return counts;
	}

	function recipientSourceLabel(source: string): string {
		if (source === 'unknown') return 'Unknown source';
		return formatPeopleSourceLabel(source, { style: 'record', fallback: 'Other source' });
	}

	function countMergeFields(value: string): number {
		return value.match(mergeFieldPattern)?.length ?? 0;
	}

	const recipientSourceRows = $derived<RecipientSourceRow[]>(
		Object.entries(recipientSourceCounts)
			.map(([source, count]) => ({
				source,
				count,
				label: recipientSourceLabel(source)
			}))
			.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
	);
	const platformRecipientSourceCount = $derived(
		recipientSourceRows.reduce(
			(total, row) => total + (platformSourceIds.has(row.source) ? row.count : 0),
			0
		)
	);
	const mergeFieldCount = $derived(
		countMergeFields(subject) +
			countMergeFields(bodyHtml) +
			countMergeFields(subjectA) +
			countMergeFields(subjectB) +
			countMergeFields(bodyHtmlA) +
			countMergeFields(bodyHtmlB)
	);
	const hasMergeFields = $derived(mergeFieldCount > 0);
	const mergeFieldsBlockClientSend = $derived(
		hasMergeFields && !FEATURES.EMAIL_CLIENT_DIRECT_MERGE
	);
	const clientDirectConfigured = $derived(Boolean(env.PUBLIC_SES_PROXY_URL));
	const serverDispatchRuntimeArmed = $derived(
		FEATURES.EMAIL_SERVER_DISPATCH && data.serverDispatchRuntimeReady
	);
	const browserDirectReady = $derived(
		canPublish && isClientDirectEmailCount(recipientCount) && hasOrgKey && clientDirectConfigured
	);
	const browserDirectExecutable = $derived(browserDirectReady && !mergeFieldsBlockClientSend);
	const emailLimitNotice = $derived(
		serverDispatchRuntimeArmed
			? null
			: emailDeliveryLimitNotice({
					serverDispatchRuntimeMissing: data.serverDispatchRuntimeMissing,
					serverDispatchRuntimeDependency: data.serverDispatchRuntimeDependency,
					serverDispatchRuntimeMessage: data.serverDispatchRuntimeMessage
				})
	);

	// Draft auto-save
	interface ComposeDraft {
		subject: string;
		bodyHtml: string;
		fromName: string;
		campaignId: string;
		verifiedFilter: string;
		selectedTagIds: string[];
		selectedSegmentIds: string[];
		savedAt: number;
	}

	let draftRestored = $state(false);
	let studioDraftRestored = $state<OrgEmailComposeDraft | null>(null);
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	const draftKey = $derived(`draft:compose:${data.org.id}`);
	const studioDraftId = $derived($page.url.searchParams.get('studioDraft') ?? '');

	// Restore a STUDIO handoff before the generic composer draft restore. This is
	// a one-time import: STUDIO has already saved the generated subject/body; the
	// org email composer now owns audience selection, preview, and send.
	let hasAppliedStudioDraft = false;
	$effect(() => {
		const draftId = studioDraftId;
		if (!browser || hasAppliedStudioDraft || !draftId) return;
		hasAppliedStudioDraft = true;

		const draft = getOrgEmailComposeDraft(draftId);
		if (!draft) return;

		subject = draft.subject;
		bodyHtml = draft.bodyHtml;
		studioDraftRestored = draft;
		draftRestored = false;
		if (editor) editor.commands.setContent(bodyHtml);
		deleteOrgEmailComposeDraft(draftId);

		try {
			const url = new URL(window.location.href);
			url.searchParams.delete('studioDraft');
			window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
		} catch {
			// URL cleanup is non-critical; the one-time guard prevents re-import loops.
		}
	});

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
			selectedSegmentIds = draft.selectedSegmentIds || [];
			draftRestored = true;
		} catch {
			/* corrupted data, ignore */
		}
	});

	// Auto-save on change (debounced 2s)
	$effect(() => {
		// Track all saveable fields
		const _s = subject;
		const _b = bodyHtml;
		const _f = fromName;
		const _c = campaignId;
		const _v = verifiedFilter;
		const _t = selectedTagIds;
		const _seg = selectedSegmentIds;

		if (!browser) return;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			// Don't save empty drafts
			if (!subject && !bodyHtml) return;
			const draft: ComposeDraft = {
				subject,
				bodyHtml,
				fromName,
				campaignId,
				verifiedFilter,
				selectedTagIds,
				selectedSegmentIds,
				savedAt: Date.now()
			};
			try {
				localStorage.setItem(draftKey, JSON.stringify(draft));
			} catch {
				/* quota exceeded, ignore */
			}
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
						class:
							'prose prose-invert prose-sm max-w-none px-4 py-3 min-h-[18rem] focus:outline-none text-text-primary leading-relaxed'
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
	const errorMsg = $derived(form && 'error' in form ? (form as { error: string }).error : null);
	const errorCode = $derived(
		form && 'errorCode' in form ? (form as { errorCode: string }).errorCode : null
	);
	const errorDraftHref = $derived(
		form && 'draftHref' in form ? (form as { draftHref: string }).draftHref : null
	);
	const errorLimitNotice = $derived(
		errorCode === 'email_server_dispatch_dependency_missing'
			? buildOrgLimitNotice('email_server_dispatch_dependency_missing', {
					missing: form && 'missing' in form ? (form as { missing: string[] }).missing : null,
					dependency:
						form && 'dependency' in form ? (form as { dependency: string }).dependency : null,
					message:
						form && 'runtimeMessage' in form
							? (form as { runtimeMessage: string }).runtimeMessage
							: null
				})
			: null
	);

	function toggleTag(tagId: string) {
		if (selectedTagIds.includes(tagId)) {
			selectedTagIds = selectedTagIds.filter((id) => id !== tagId);
		} else {
			selectedTagIds = [...selectedTagIds, tagId];
		}
	}

	function toggleSegment(segmentId: string) {
		if (selectedSegmentIds.includes(segmentId)) {
			selectedSegmentIds = selectedSegmentIds.filter((id) => id !== segmentId);
		} else {
			selectedSegmentIds = [...selectedSegmentIds, segmentId];
		}
	}

	// Debounced auto-recount when filters change
	let isFirstRun = true;
	let countDebounceTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		const _v = verifiedFilter;
		const _t = selectedTagIds;
		const _seg = selectedSegmentIds;

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
		{ field: '{{firstName}}', desc: "Recipient's first name" },
		{ field: '{{lastName}}', desc: "Recipient's last name" },
		{ field: '{{postalCode}}', desc: "Recipient's postal code" },
		{
			field: '{{tierContext}}',
			desc: 'Verification context, e.g., "You\'re one of 43 Established advocates in District 6"'
		}
	];

	function insertMergeField(field: string) {
		if (editor) {
			editor.chain().focus().insertContent(field).run();
		}
	}

	function clearComposerDraft(): void {
		subject = '';
		bodyHtml = '';
		fromName = data.org.name;
		campaignId = '';
		verifiedFilter = 'any';
		selectedTagIds = [];
		selectedSegmentIds = [];
		studioDraftRestored = null;
		draftRestored = false;
		if (editor) editor.commands.clearContent();
		if (browser) {
			try {
				localStorage.removeItem(draftKey);
			} catch {
				/* ignore */
			}
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
		const handler = () => {
			editorRevision++;
		};
		editor.on('transaction', handler);
		return () => {
			editor?.off('transaction', handler);
		};
	});

	function isActive(
		name: string | Record<string, unknown>,
		attrs?: Record<string, unknown>
	): boolean {
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

	async function executeClientSend(
		orgKey: CryptoKey,
		blastData: NonNullable<typeof pendingBlastData>
	) {
		const { sendBlastFromClient } = await import('$lib/services/client-blast-sender');
		const { useConvexClient } = await import('convex-sveltekit');
		const { api } = await import('$lib/convex');

		const convex = useConvexClient();

		sending = true;
		blastError = null; // clear any stale preflight error from a previous attempt
		blastProgress = {
			total: 0,
			sent: 0,
			failed: 0,
			currentBatch: 0,
			totalBatches: 0,
			status: 'fetching-credentials'
		};

		try {
			// Fetch encrypted supporters via Convex client — pass blastId so the
			// recipientFilter persisted at compose time is enforced at load
			// (F-119 closure: filter is no longer just a count-time UI hint).
			const supporters = await convex.query(api.blasts.getEncryptedSupportersForBlast, {
				orgSlug: data.org.slug,
				blastId: blastData.blastId as Id<'emailBlasts'>
			});

			// Fetch dispatch claim once per blast (caller-cohort
			// validation). Claim is server-signed and binds (orgId, blastId,
			// allowedHashes[]); Lambda enforces per-recipient before SES
			// dispatch. Failure here means we cannot guarantee cohort
			// validation; surface as a hard error so the operator knows.
			// Dispatch claim is REQUIRED — Lambda will reject any send without
			// it. Surface every failure mode (including 503 from a misconfigured
			// BLAST_DISPATCH_SECRET) as a hard error so operators see the root
			// cause instead of a confusing 403 from Lambda mid-blast.
			let dispatchClaim: string;
			try {
				const claimResp = await fetch(
					`/api/blast/${blastData.blastId}/dispatch-claim?orgSlug=${encodeURIComponent(data.org.slug)}`
				);
				if (!claimResp.ok) {
					if (claimResp.status === 503) {
						throw new Error(
							'Bulk-send dispatch is not configured (operator: set BLAST_DISPATCH_SECRET on both SvelteKit and Lambda env)'
						);
					}
					throw new Error(`Dispatch claim fetch failed: ${claimResp.status}`);
				}
				const parsed = await claimResp.json();
				if (typeof parsed.claim !== 'string' || parsed.claim.length === 0) {
					throw new Error('Dispatch claim response missing `claim` field');
				}
				dispatchClaim = parsed.claim;
			} catch (err) {
				console.error('[blast] failed to fetch dispatch claim', err);
				blastError = err instanceof Error ? err.message : 'Failed to authorize blast send';
				sending = false;
				blastProgress = null;
				return;
			}

			// Update blast to sending
			await convex.mutation(api.blasts.updateClientBlastProgress, {
				orgSlug: data.org.slug,
				blastId: blastData.blastId as Id<'emailBlasts'>,
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
				dispatchClaim,
				onProgress: (p) => {
					blastProgress = p;
				},
				onBatchReceipts: async (receipts) => {
					try {
						await convex.mutation(api.blasts.recordBlastReceipts, {
							orgSlug: data.org.slug,
							blastId: blastData.blastId as Id<'emailBlasts'>,
							receipts
						});
					} catch (err) {
						// Receipt persistence is best-effort — a transient Convex
						// failure must not block the in-flight send. Surface in the
						// error log; the next batch will still attempt to write.
						console.error('[blast] failed to persist receipts batch', err);
					}
				},
				resolveUnsubscribeUrls: async (supporterIds) => {
					// Vend per-recipient unsubscribe URLs from the SvelteKit endpoint
					// so the HMAC secret stays server-side. The endpoint pulls the
					// authoritative orgId from the blast row (not from the caller),
					// which prevents cross-org token vending. Failure here surfaces
					// in the sender as "no List-Unsubscribe header for this batch" —
					// the bulk send still proceeds (Lambda falls back to SendEmail).
					const resp = await fetch(
						`/api/blast/${blastData.blastId}/unsubscribe-tokens?orgSlug=${encodeURIComponent(data.org.slug)}`,
						{
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({
								supporters: supporterIds.map((supporterId) => ({ supporterId }))
							})
						}
					);
					if (!resp.ok) {
						throw new Error(`Token endpoint ${resp.status}`);
					}
					const { urls } = (await resp.json()) as { urls: string[] };
					return urls;
				}
			});

			// Finalize blast status
			await convex.mutation(api.blasts.updateClientBlastProgress, {
				orgSlug: data.org.slug,
				blastId: blastData.blastId as Id<'emailBlasts'>,
				status: result.failed === result.total ? 'failed' : 'sent',
				totalSent: result.sent,
				totalBounced: result.failed,
				totalRecipients: result.total
			});

			blastResult = result;

			// Clear draft
			if (browser) {
				try {
					localStorage.removeItem(draftKey);
				} catch {}
			}
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

<div id="email-compose" class="scroll-mt-24 space-y-6">
	<!-- Header -->
	<div class="flex items-center gap-4">
		<a
			href="/org/{data.org.slug}/emails"
			class="text-text-tertiary hover:text-text-secondary transition-colors"
			aria-label="Back to email delivery"
		>
			<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
				/>
			</svg>
		</a>
		<div>
			<h1 class="text-text-primary text-xl font-semibold">Compose email</h1>
			<p class="text-text-tertiary mt-1 text-sm">
				Write your email, choose recipients, preview, and send.
			</p>
		</div>
	</div>

	{#if errorLimitNotice}
		<div class="border-surface-border bg-surface-base rounded-md border px-4 py-3">
			<BoundedNotice notice={errorLimitNotice} />
			{#if errorDraftHref}
				<a
					href={errorDraftHref}
					class="text-text-secondary hover:text-text-primary mt-2 inline-flex text-sm font-medium underline underline-offset-4"
				>
					Open saved draft
				</a>
			{/if}
		</div>
	{:else if errorMsg}
		<div class="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
			<p>{errorMsg}</p>
		</div>
	{/if}

	{#if studioDraftRestored}
		<div
			class="flex items-center justify-between rounded-md border border-teal-500/20 bg-teal-500/5 px-4 py-2.5"
		>
			<p class="text-sm text-teal-400">
				Draft from Studio — subject and body are filled in. Choose recipients, preview, then send.
			</p>
			<button
				type="button"
				class="text-text-tertiary hover:text-text-secondary text-xs transition-colors"
				onclick={clearComposerDraft}
			>
				Discard
			</button>
		</div>
	{/if}

	{#if draftRestored}
		<div
			class="flex items-center justify-between rounded-md border border-teal-500/20 bg-teal-500/5 px-4 py-2.5"
		>
			<p class="text-sm text-teal-400">Draft restored from your last session</p>
			<button
				type="button"
				class="text-text-tertiary hover:text-text-secondary text-xs transition-colors"
				onclick={clearComposerDraft}
			>
				Discard
			</button>
		</div>
	{/if}

	<!-- Preview modal -->
	{#if showPreview && previewHtml}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
			<div
				class="border-surface-border-strong bg-surface-raised flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-md border"
			>
				<div class="border-surface-border flex items-center justify-between border-b px-4 py-3">
					<div>
						<p class="text-text-primary text-sm font-medium">Email Preview</p>
						{#if previewSubject}
							<p class="text-text-tertiary mt-0.5 text-xs">Subject: {previewSubject}</p>
						{/if}
					</div>
					<button
						type="button"
						class="text-text-tertiary hover:text-text-primary transition-colors"
						aria-label="Close preview"
						onclick={() => (showPreview = false)}
					>
						<svg
							class="h-5 w-5"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							stroke-width="1.5"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
				<div class="flex-1 overflow-auto p-1">
					<iframe
						srcdoc={previewHtml}
						title="Email preview"
						class="h-full min-h-[400px] w-full rounded border-0"
						sandbox=""
					></iframe>
				</div>
			</div>
		</div>
	{/if}

	<!-- Passphrase dialog for client-direct send -->
	{#if showPassphraseDialog}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
			<div
				class="border-surface-border-strong bg-surface-raised w-full max-w-sm space-y-4 rounded-md border p-6"
			>
				<div>
					<h3 class="text-text-primary text-base font-semibold">Enter organization passphrase</h3>
					<p class="text-text-tertiary mt-1 text-sm">
						Your passphrase decrypts recipient emails in this browser. It is never sent to our
						servers.
					</p>
				</div>

				{#if passphraseError}
					<div
						class="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400"
					>
						{passphraseError}
					</div>
				{/if}

				<form
					onsubmit={(e) => {
						e.preventDefault();
						onPassphraseSubmit();
					}}
				>
					<input
						type="password"
						bind:value={passphrase}
						placeholder="Organization passphrase"
						class="border-surface-border-strong bg-surface-base text-text-primary placeholder-text-quaternary w-full rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
						autofocus
					/>
					<div class="mt-4 flex gap-3">
						<button
							type="button"
							class="border-surface-border-strong bg-surface-overlay text-text-primary hover:bg-surface-overlay hover:border-text-quaternary flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors"
							onclick={() => {
								showPassphraseDialog = false;
								passphrase = '';
								passphraseError = '';
								pendingBlastData = null;
							}}
						>
							Cancel
						</button>
						<button
							type="submit"
							class="flex-1 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-500 disabled:opacity-50"
							disabled={!passphrase.trim()}
						>
							Unlock & Send
						</button>
					</div>
				</form>
			</div>
		</div>
	{/if}

	<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
		<!-- Main form -->
		<div class="space-y-6 lg:col-span-2">
			<!-- From / Subject -->
			<div
				id="email-compose-fields"
				class="border-surface-border bg-surface-base scroll-mt-24 space-y-4 rounded-md border p-6"
			>
				<div class="grid grid-cols-2 gap-4">
					<div>
						<label for="fromName" class="text-text-secondary mb-1.5 block text-sm font-medium"
							>From Name</label
						>
						<input
							id="fromName"
							type="text"
							bind:value={fromName}
							class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
							placeholder="Organization name"
						/>
					</div>
					<div>
						<label for="fromEmail" class="text-text-secondary mb-1.5 block text-sm font-medium"
							>From Email</label
						>
						<input
							id="fromEmail"
							type="email"
							bind:value={fromEmail}
							class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
							placeholder="noreply@commons.email"
						/>
					</div>
				</div>

				{#if !abEnabled}
					<div>
						<label for="subject" class="text-text-secondary mb-1.5 block text-sm font-medium"
							>Subject Line</label
						>
						<input
							id="subject"
							type="text"
							bind:value={subject}
							class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
							placeholder="Your email subject..."
						/>
					</div>
				{:else}
					<div class="space-y-3">
						<div class="flex items-center gap-2">
							<span class="text-text-secondary text-sm font-medium">Subject Lines</span>
							<span
								class="rounded-md border border-teal-500/20 bg-teal-500/15 px-2 py-0.5 font-mono text-xs text-teal-400"
								>A/B Test</span
							>
						</div>
						<div>
							<label for="subjectA" class="text-text-tertiary mb-1 block text-xs font-medium"
								>Variant A</label
							>
							<input
								id="subjectA"
								type="text"
								bind:value={subjectA}
								class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
								placeholder="Subject line A..."
							/>
						</div>
						<div>
							<label for="subjectB" class="text-text-tertiary mb-1 block text-xs font-medium"
								>Variant B</label
							>
							<input
								id="subjectB"
								type="text"
								bind:value={subjectB}
								class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
								placeholder="Subject line B..."
							/>
						</div>
					</div>
				{/if}

				<div>
					<label for="campaignId" class="text-text-secondary mb-1.5 block text-sm font-medium">
						Link to action record
						<span class="text-text-tertiary font-normal">(optional)</span>
					</label>
					<select
						id="campaignId"
						bind:value={campaignId}
						class="border-surface-border-strong bg-surface-raised text-text-primary w-full rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
					>
						<option value="">No action record</option>
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
				<div class="border-surface-border bg-surface-base flex gap-1 rounded-lg border p-1">
					<button
						type="button"
						class="flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors {activeVariant ===
						'A'
							? 'bg-surface-border-strong/50 text-teal-400'
							: 'text-text-tertiary hover:text-text-primary'}"
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
						class="flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors {activeVariant ===
						'B'
							? 'bg-surface-border-strong/50 text-teal-400'
							: 'text-text-tertiary hover:text-text-primary'}"
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
			<div
				id="email-compose-body"
				class="border-surface-border bg-surface-base scroll-mt-24 space-y-4 rounded-md border p-6"
			>
				<div class="flex items-center justify-between">
					<label class="text-text-secondary block text-sm font-medium">Email Body</label>
					<div class="flex items-center gap-1">
						{#each mergeFieldHints as hint}
							<button
								type="button"
								class="text-text-tertiary hover:bg-surface-overlay rounded px-2 py-1 font-mono text-xs transition-colors hover:text-teal-400"
								title={hint.desc}
								onclick={() => insertMergeField(hint.field)}
							>
								{hint.field}
							</button>
						{/each}
					</div>
				</div>

				<!-- Tiptap editor -->
				<div
					class="tiptap-wrapper border-surface-border-strong bg-surface-raised overflow-hidden rounded-lg border transition-colors focus-within:border-teal-500 focus-within:ring-1 focus-within:ring-teal-500"
				>
					<!-- Toolbar -->
					{#if editor}
						<div
							class="border-surface-border-strong bg-surface-overlay flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5"
						>
							<!-- Bold -->
							<button
								type="button"
								title="Bold"
								class="rounded p-1.5 transition-colors {isActive('bold')
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => editor?.chain().focus().toggleBold().run()}
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2.5"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z"
									/><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z"
									/></svg
								>
							</button>
							<!-- Italic -->
							<button
								type="button"
								title="Italic"
								class="rounded p-1.5 transition-colors {isActive('italic')
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => editor?.chain().focus().toggleItalic().run()}
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M10 4h4m-2 0l-4 16m-2 0h4m4-16l-4 16"
									/></svg
								>
							</button>
							<!-- Underline -->
							<button
								type="button"
								title="Underline"
								class="rounded p-1.5 transition-colors {isActive('underline')
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => editor?.chain().focus().toggleUnderline().run()}
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M7 4v7a5 5 0 0010 0V4M5 20h14"
									/></svg
								>
							</button>
							<!-- Strikethrough -->
							<button
								type="button"
								title="Strikethrough"
								class="rounded p-1.5 transition-colors {isActive('strike')
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => editor?.chain().focus().toggleStrike().run()}
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M16 4c-.5-1.5-2.2-2-4-2-2.2 0-4 1.1-4 3 0 .8.3 1.5.8 2M4 12h16M8 20c.5 1.5 2.2 2 4 2 2.2 0 4-1.1 4-3 0-.8-.3-1.5-.8-2"
									/></svg
								>
							</button>

							<span class="bg-surface-border-strong mx-1 h-5 w-px"></span>

							<!-- H1 -->
							<button
								type="button"
								title="Heading 1"
								class="rounded px-1.5 py-1 text-xs font-bold transition-colors {isActive(
									'heading',
									{ level: 1 }
								)
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
							>
								H1
							</button>
							<!-- H2 -->
							<button
								type="button"
								title="Heading 2"
								class="rounded px-1.5 py-1 text-xs font-bold transition-colors {isActive(
									'heading',
									{ level: 2 }
								)
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
							>
								H2
							</button>
							<!-- H3 -->
							<button
								type="button"
								title="Heading 3"
								class="rounded px-1.5 py-1 text-xs font-bold transition-colors {isActive(
									'heading',
									{ level: 3 }
								)
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
							>
								H3
							</button>

							<span class="bg-surface-border-strong mx-1 h-5 w-px"></span>

							<!-- Bullet list -->
							<button
								type="button"
								title="Bullet list"
								class="rounded p-1.5 transition-colors {isActive('bulletList')
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => editor?.chain().focus().toggleBulletList().run()}
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"
									/></svg
								>
							</button>
							<!-- Ordered list -->
							<button
								type="button"
								title="Ordered list"
								class="rounded p-1.5 transition-colors {isActive('orderedList')
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => editor?.chain().focus().toggleOrderedList().run()}
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M10 6h11M10 12h11M10 18h11"
									/><text
										x="2"
										y="8"
										fill="currentColor"
										font-size="7"
										font-weight="bold"
										stroke="none">1</text
									><text
										x="2"
										y="14"
										fill="currentColor"
										font-size="7"
										font-weight="bold"
										stroke="none">2</text
									><text
										x="2"
										y="20"
										fill="currentColor"
										font-size="7"
										font-weight="bold"
										stroke="none">3</text
									></svg
								>
							</button>

							<span class="bg-surface-border-strong mx-1 h-5 w-px"></span>

							<!-- Link -->
							<button
								type="button"
								title="Link"
								class="rounded p-1.5 transition-colors {isActive('link')
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => setLink()}
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
									/></svg
								>
							</button>
							<!-- Blockquote -->
							<button
								type="button"
								title="Blockquote"
								class="rounded p-1.5 transition-colors {isActive('blockquote')
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => editor?.chain().focus().toggleBlockquote().run()}
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M3 10h4a1 1 0 011 1v4a1 1 0 01-1 1H3a1 1 0 01-1-1v-4a1 1 0 011-1zm0 0V7a4 4 0 014-4m7 7h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4a1 1 0 011-1zm0 0V7a4 4 0 014-4"
									/></svg
								>
							</button>

							<span class="bg-surface-border-strong mx-1 h-5 w-px"></span>

							<!-- Align left -->
							<button
								type="button"
								title="Align left"
								class="rounded p-1.5 transition-colors {isActive({ textAlign: 'left' })
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => editor?.chain().focus().setTextAlign('left').run()}
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M3 6h18M3 12h12M3 18h18"
									/></svg
								>
							</button>
							<!-- Align center -->
							<button
								type="button"
								title="Align center"
								class="rounded p-1.5 transition-colors {isActive({ textAlign: 'center' })
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => editor?.chain().focus().setTextAlign('center').run()}
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M3 6h18M6 12h12M3 18h18"
									/></svg
								>
							</button>
							<!-- Align right -->
							<button
								type="button"
								title="Align right"
								class="rounded p-1.5 transition-colors {isActive({ textAlign: 'right' })
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => editor?.chain().focus().setTextAlign('right').run()}
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M3 6h18M6 12h18M3 18h18"
									/></svg
								>
							</button>

							<span class="bg-surface-border-strong mx-1 h-5 w-px"></span>

							<!-- Clear formatting -->
							<button
								type="button"
								title="Clear formatting"
								class="text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30 rounded p-1.5 transition-colors"
								onclick={() => editor?.chain().focus().clearNodes().unsetAllMarks().run()}
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
									/></svg
								>
							</button>
						</div>
					{/if}

					<!-- Editor content area -->
					<div bind:this={editorElement} class="tiptap-editor"></div>
				</div>

				<!-- Verification context notice -->
				<div
					class="border-surface-border-strong/50 bg-surface-overlay flex items-start gap-3 rounded-lg border px-4 py-3"
				>
					<svg
						class="mt-0.5 h-4 w-4 flex-shrink-0 text-teal-400"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="1.5"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
						/>
					</svg>
					<div>
						<p class="text-text-secondary text-xs font-medium">
							Verification context is cohort-bound
						</p>
						<p class="text-text-tertiary mt-0.5 text-xs">
							{#if verifiedFilter === 'verified'}
								This send can include an exact verified-cohort block because the recipient filter is
								constrained to verified people.
							{:else if verifiedFilter === 'unverified'}
								This send can include an exact unverified-cohort block. It will not imply proof
								weight the cohort does not carry.
							{:else}
								Mixed verification cohorts omit aggregate proof rather than approximate a number.
								Filter to verified people before claiming cohort-level proof.
							{/if}
						</p>
					</div>
				</div>

				{#if hasMergeFields && !FEATURES.EMAIL_CLIENT_DIRECT_MERGE}
					<div class="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3">
						<p class="text-xs font-medium text-amber-300">
							Personalized fields can't be sent from the browser yet
						</p>
						<p class="text-text-tertiary mt-1 text-xs">
							Preview fills the fields with sample values. Remove the merge fields to send from
							the browser, or save this as a draft.
						</p>
					</div>
				{:else if hasMergeFields}
					<div class="rounded-md border border-teal-500/30 bg-teal-500/10 px-4 py-3">
						<p class="text-xs font-medium text-teal-300">
							Merge fields will personalize at send time
						</p>
						<p class="text-text-tertiary mt-1 text-xs">
							Each recipient's message is personalized in your browser and sent individually.
						</p>
					</div>
				{/if}
			</div>
		</div>

		<!-- Sidebar: Filters + Actions -->
		<div class="space-y-6">
			<!-- Recipient filters -->
			<div
				id="email-recipients"
				class="border-surface-border bg-surface-base scroll-mt-24 space-y-4 rounded-md border p-6"
			>
				<div class="flex items-center justify-between">
					<h3 class="text-text-secondary text-sm font-medium">Recipients</h3>
				</div>

				<!-- Verification filter -->
				<div>
					<label for="verified" class="text-text-tertiary mb-1.5 block text-xs font-medium"
						>Verification Status</label
					>
					<select
						id="verified"
						bind:value={verifiedFilter}
						class="border-surface-border-strong bg-surface-raised text-text-primary w-full rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
					>
						<option value="any">Any status</option>
						<option value="verified">Verified only</option>
						<option value="unverified">Unverified only</option>
					</select>
				</div>

				<!-- Saved segment filter -->
				{#if data.segments.length > 0}
					<div>
						<p class="text-text-tertiary mb-1.5 text-xs font-medium">People segments</p>
						<div class="flex flex-wrap gap-2">
							{#each data.segments as segment (segment.id)}
								<button
									type="button"
									class="rounded-md border px-2.5 py-1 text-xs transition-colors {selectedSegmentIds.includes(
										segment.id
									)
										? 'border-teal-500/30 bg-teal-500/20 text-teal-400'
										: 'bg-surface-overlay text-text-tertiary border-surface-border-strong hover:border-text-quaternary'}"
									onclick={() => toggleSegment(segment.id)}
								>
									{segment.name}
								</button>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Tag filter -->
				{#if data.tags.length > 0}
					<div>
						<p class="text-text-tertiary mb-1.5 text-xs font-medium">Tags</p>
						<div class="flex flex-wrap gap-2">
							{#each data.tags as tag (tag.id)}
								<button
									type="button"
									class="rounded-md border px-2.5 py-1 text-xs transition-colors {selectedTagIds.includes(
										tag.id
									)
										? 'border-teal-500/30 bg-teal-500/20 text-teal-400'
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
								if ('sourceCounts' in result.data) {
									recipientSourceCounts = coerceRecipientSourceCounts(result.data.sourceCounts);
								}
							}
							await update({ reset: false });
						};
					}}
				>
					<input type="hidden" name="verified" value={verifiedFilter} />
					{#each selectedSegmentIds as segmentId}
						<input type="hidden" name="segmentIds" value={segmentId} />
					{/each}
					{#each selectedTagIds as tagId}
						<input type="hidden" name="tagIds" value={tagId} />
					{/each}
					<button
						type="submit"
						class="border-surface-border-strong bg-surface-overlay text-text-secondary hover:bg-surface-overlay hover:border-text-quaternary w-full rounded-lg border px-3 py-2 text-sm transition-colors"
						disabled={countLoading}
					>
						{#if countLoading}
							Counting...
						{:else}
							Update Count
						{/if}
					</button>
				</form>

				<div class="bg-surface-overlay rounded-lg px-4 py-3 text-center">
					<p class="text-text-primary font-mono text-2xl tabular-nums">
						{recipientCount.toLocaleString()}
					</p>
					<p class="text-text-tertiary mt-0.5 text-xs">subscribed recipients</p>
				</div>

				<div
					class="border-surface-border-strong/60 bg-surface-overlay rounded-lg border px-3 py-3"
					aria-label="Selected cohort source basis"
				>
					<div class="flex items-start justify-between gap-3">
						<div>
							<p class="text-text-secondary text-xs font-semibold">Where these people came from</p>
						</div>
						<span class="text-text-tertiary font-mono text-[11px]">
							<Datum value={platformRecipientSourceCount} />
							from platforms
						</span>
					</div>
					{#if recipientSourceRows.length > 0}
						<div class="mt-3 grid gap-2">
							{#each recipientSourceRows.slice(0, 4) as row (row.source)}
								<div class="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 text-xs">
									<span class="text-text-tertiary truncate">{row.label}</span>
									<span class="text-text-primary font-mono tabular-nums">
										<Datum value={row.count} />
									</span>
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-text-tertiary mt-3 text-xs">
							No source information for the selected recipients yet.
						</p>
					{/if}
				</div>
			</div>

			<!-- A/B Test Toggle -->
			{#if data.abTestingAllowed}
				<div
					id="email-ab-test"
					class="border-surface-border bg-surface-base scroll-mt-24 space-y-4 rounded-md border p-6"
				>
					<div class="flex items-center justify-between">
						<div>
							<h3 class="text-text-secondary text-sm font-medium">A/B Test</h3>
							<p class="text-text-tertiary mt-0.5 text-xs">
								Try two versions with part of your list; the winner goes to the rest
							</p>
						</div>
						<button
							type="button"
							class="relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 {abEnabled
								? 'bg-teal-500'
								: 'bg-text-quaternary'}"
							role="switch"
							aria-checked={abEnabled}
							aria-label="Toggle A/B draft variants"
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
							<span
								class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 {abEnabled
									? 'translate-x-4'
									: 'translate-x-0'}"
							></span>
						</button>
					</div>

					{#if abEnabled}
						<div class="border-surface-border space-y-3 border-t pt-2">
							<div>
								<label for="testGroupPct" class="text-text-tertiary mb-1 block text-xs font-medium"
									>Test group size</label
								>
								<select
									id="testGroupPct"
									bind:value={testGroupPct}
									class="border-surface-border-strong bg-surface-raised text-text-primary w-full rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
								>
									<option value={10}>10% test, 90% follow-up</option>
									<option value={20}>20% test, 80% follow-up</option>
									<option value={30}>30% test, 70% follow-up</option>
									<option value={50}>50% test, 50% follow-up</option>
								</select>
							</div>
							<div>
								<label for="splitPct" class="text-text-tertiary mb-1 block text-xs font-medium"
									>Test split (A/B)</label
								>
								<select
									id="splitPct"
									bind:value={splitPct}
									class="border-surface-border-strong bg-surface-raised text-text-primary w-full rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
								>
									<option value={50}>50 / 50</option>
									<option value={60}>60 / 40</option>
									<option value={70}>70 / 30</option>
								</select>
							</div>
							<div>
								<label for="testDuration" class="text-text-tertiary mb-1 block text-xs font-medium"
									>Winner check window</label
								>
								<select
									id="testDuration"
									bind:value={testDuration}
									class="border-surface-border-strong bg-surface-raised text-text-primary w-full rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
								>
									<option value="1h">1 hour</option>
									<option value="4h">4 hours</option>
									<option value="24h">24 hours</option>
								</select>
							</div>
							<div>
								<label for="winnerMetric" class="text-text-tertiary mb-1 block text-xs font-medium"
									>Pick winner by</label
								>
								<select
									id="winnerMetric"
									bind:value={winnerMetric}
									class="border-surface-border-strong bg-surface-raised text-text-primary w-full rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
								>
									<option value="open">Open rate</option>
									<option value="click">Click rate</option>
								</select>
							</div>
							<div class="bg-surface-overlay text-text-tertiary rounded-lg px-3 py-2.5 text-xs">
								{Math.round((recipientCount * testGroupPct) / 100)} in the test group ({Math.round(
									(((recipientCount * testGroupPct) / 100) * splitPct) / 100
								)} A,
								{Math.round((((recipientCount * testGroupPct) / 100) * (100 - splitPct)) / 100)} B). The
								remaining {Math.round((recipientCount * (100 - testGroupPct)) / 100)} get the winning
								version afterward.
							</div>
						</div>
					{/if}
				</div>
			{/if}

			<!-- Actions -->
			<div
				id="email-delivery"
				class="border-surface-border bg-surface-base scroll-mt-24 space-y-3 rounded-md border p-6"
			>
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
					<input
						type="hidden"
						name="bodyHtml"
						value={abEnabled ? (activeVariant === 'A' ? bodyHtml : bodyHtmlA) : bodyHtml}
					/>
					<button
						type="submit"
						class="border-surface-border-strong bg-surface-overlay text-text-primary hover:bg-surface-overlay hover:border-text-quaternary w-full rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors"
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
							if (
								!confirm(
									`Create A/B draft variants for ${recipientCount.toLocaleString()} recipient${recipientCount === 1 ? '' : 's'}? The test groups are saved exactly as selected; sending is controlled from the A/B detail page.`
								)
							) {
								cancel();
								return;
							}
							sending = true;
							if (browser) {
								try {
									localStorage.removeItem(draftKey);
								} catch {}
							}
							return async ({ update }) => {
								sending = false;
								await update({ reset: false });
							};
						}}
					>
						<input type="hidden" name="subjectA" value={subjectA} />
						<input type="hidden" name="subjectB" value={subjectB} />
						<input
							type="hidden"
							name="bodyHtmlA"
							value={activeVariant === 'A' ? bodyHtml : bodyHtmlA}
						/>
						<input
							type="hidden"
							name="bodyHtmlB"
							value={activeVariant === 'B' ? bodyHtml : bodyHtmlB}
						/>
						<input type="hidden" name="fromName" value={fromName} />
						<input type="hidden" name="fromEmail" value={fromEmail} />
						<input type="hidden" name="campaignId" value={campaignId} />
						<input type="hidden" name="verified" value={verifiedFilter} />
						<input type="hidden" name="splitPct" value={splitPct} />
						<input type="hidden" name="testGroupPct" value={testGroupPct} />
						<input type="hidden" name="testDuration" value={testDuration} />
						<input type="hidden" name="winnerMetric" value={winnerMetric} />
						{#each selectedSegmentIds as segmentId}
							<input type="hidden" name="segmentIds" value={segmentId} />
						{/each}
						{#each selectedTagIds as tagId}
							<input type="hidden" name="tagIds" value={tagId} />
						{/each}
						<button
							type="submit"
							class="w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
							disabled={!canPublish ||
								!subjectA.trim() ||
								!subjectB.trim() ||
								recipientCount < 4 ||
								sending}
						>
							{#if sending}
								Creating A/B drafts...
							{:else if !canPublish}
								Editor role required
							{:else}
								Create A/B drafts
							{/if}
						</button>
						<p class="text-text-quaternary mt-2 text-center text-xs">
							This saves both variants as drafts with their exact recipient groups. Sending and
							winner follow-up happen from the A/B detail page.
						</p>
					</form>
				{:else if browserDirectExecutable}
					<!-- Client-Direct Send (at or under the client-direct threshold, org key configured) -->
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
								<span class="text-text-tertiary font-mono text-xs">
									{blastProgress.sent} sent, {blastProgress.failed} failed / {blastProgress.total}
								</span>
							</div>
							<div class="bg-surface-border-strong h-2 w-full rounded-full">
								<div
									class="h-2 rounded-full transition-all duration-300 {blastProgress.failed > 0
										? 'bg-amber-500'
										: 'bg-teal-500'}"
									style="width: {blastProgress.total > 0
										? Math.round(
												((blastProgress.sent + blastProgress.failed) / blastProgress.total) * 100
											)
										: 0}%"
								></div>
							</div>
						</div>
					{:else if blastResult}
						<!-- Result summary -->
						<div class="space-y-2">
							<div
								class="rounded-lg border px-4 py-3 {blastResult.failed === 0
									? 'border-teal-500/30 bg-teal-500/10'
									: 'border-amber-500/30 bg-amber-500/10'}"
							>
								<p
									class="text-sm font-medium {blastResult.failed === 0
										? 'text-teal-400'
										: 'text-amber-400'}"
								>
									{blastResult.sent} sent{blastResult.failed > 0
										? `, ${blastResult.failed} failed`
										: ''}
								</p>
							</div>
							<button
								type="button"
								class="border-surface-border-strong bg-surface-overlay text-text-primary hover:bg-surface-overlay hover:border-text-quaternary w-full rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors"
								onclick={() => goto(`/org/${data.org.slug}/emails`)}
							>
								Back to delivery records
							</button>
						</div>
					{:else}
						<form
							method="POST"
							action="?/createClientDraft"
							use:enhance={({ cancel }) => {
								if (
									!confirm(
										`Send email to ${recipientCount.toLocaleString()} recipient${recipientCount === 1 ? '' : 's'}? Emails will be decrypted and sent from this browser.`
									)
								) {
									cancel();
									return;
								}
								sending = true;
								return async ({ result, update }) => {
									if (result.type === 'success' && result.data && 'blastId' in result.data) {
										const blastData = result.data as {
											blastId: string;
											orgId: string;
											fromEmail: string;
											fromName: string;
											subject: string;
											bodyHtml: string;
										};
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
							{#each selectedSegmentIds as segmentId}
								<input type="hidden" name="segmentIds" value={segmentId} />
							{/each}
							{#each selectedTagIds as tagId}
								<input type="hidden" name="tagIds" value={tagId} />
							{/each}
							<button
								type="submit"
								class="w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
								disabled={!subject.trim() ||
									!hasBody ||
									!canPublish ||
									recipientCount === 0 ||
									sending ||
									mergeFieldsBlockClientSend}
							>
								{#if sending}
									Preparing...
								{:else if !canPublish}
									Editor role required
								{:else if mergeFieldsBlockClientSend}
									Remove merge fields to send
								{:else}
									Send email to {recipientCount.toLocaleString()} recipient{recipientCount === 1
										? ''
										: 's'}
								{/if}
							</button>
							{#if blastError}
								<div
									class="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400"
								>
									{blastError}
								</div>
							{/if}
							<p class="text-text-quaternary mt-2 text-center text-xs">
								Emails decrypted in this browser, never on our servers
							</p>
						</form>
					{/if}
				{:else}
					<!-- Server-side dispatch queues only when runtime dependencies are present. -->
					<form
						method="POST"
						action="?/send"
						use:enhance={({ cancel }) => {
							const verb = serverDispatchRuntimeArmed ? 'Send email' : 'Save draft';
							const note = serverDispatchRuntimeArmed
								? 'Each email includes your verification proof.'
								: 'It stays a draft until your email infrastructure is connected.';
							if (
								!confirm(
									`${verb} for ${recipientCount.toLocaleString()} recipient${recipientCount === 1 ? '' : 's'}? ${note}`
								)
							) {
								cancel();
								return;
							}
							sending = true;
							if (browser) {
								try {
									localStorage.removeItem(draftKey);
								} catch {}
							}
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
						{#each selectedSegmentIds as segmentId}
							<input type="hidden" name="segmentIds" value={segmentId} />
						{/each}
						{#each selectedTagIds as tagId}
							<input type="hidden" name="tagIds" value={tagId} />
						{/each}
						<button
							type="submit"
							class="w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
							disabled={!subject.trim() ||
								!hasBody ||
								!canPublish ||
								recipientCount === 0 ||
								sending}
						>
							{#if sending}
								{serverDispatchRuntimeArmed ? 'Sending...' : 'Saving draft...'}
							{:else if !canPublish}
								Editor role required
							{:else}
								{serverDispatchRuntimeArmed
									? `Send email to ${recipientCount.toLocaleString()} recipient${recipientCount === 1 ? '' : 's'}`
									: 'Save draft'}
							{/if}
						</button>
						{#if emailLimitNotice && !errorLimitNotice}
							<div class="mt-3">
								<BoundedNotice notice={emailLimitNotice} />
							</div>
						{:else if serverDispatchRuntimeArmed && recipientCount > CLIENT_DIRECT_EMAIL_THRESHOLD}
							<p class="text-text-quaternary mt-2 text-center text-xs">
								Sends this large go out from our servers.
							</p>
						{/if}
					</form>
				{/if}
			</div>
		</div>
	</div>
</div>
