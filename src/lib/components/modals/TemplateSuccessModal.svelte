<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import {
		CheckCircle,
		Clock,
		Share2,
		LayoutDashboard,
		X,
		Link,
		Check,
		AlertCircle,
		ChevronRight
	} from '@lucide/svelte';
	import type { Template } from '$lib/types/template';
	import { parseRecipientConfig } from '$lib/types/template';
	import { supportsWebShare, copyToClipboard as clipboardCopy } from '$lib/utils/browserUtils';
	import { generateShareMessage } from '$lib/utils/share-messages';

	let {
		template,
		publishing = false,
		error = null,
		onclose,
		onretry,
		ondashboard,
		onsend
	}: {
		template: Template;
		publishing?: boolean;
		error?: string | null;
		onclose?: () => void;
		onretry?: () => void;
		ondashboard?: () => void;
		onsend?: () => void;
	} = $props();

	// Extract decision-maker names from recipient_config for the send preview
	const recipientNames = $derived((() => {
		const rc = parseRecipientConfig(template.recipient_config);
		const dms = rc.decisionMakers ?? [];
		return dms.map(dm => dm.name).filter(Boolean);
	})());

	// Build the contextual send preview label
	const sendPreviewText = $derived((() => {
		if (recipientNames.length === 0) {
			// Fall back to a congressional framing if cwc, otherwise generic
			return template.deliveryMethod === 'cwc'
				? 'Send to your representatives'
				: 'Send your message';
		}
		const [first, second, ...rest] = recipientNames;
		if (recipientNames.length === 1) return `Send to ${first}`;
		if (rest.length === 0) return `Send to ${first} and ${second}`;
		return `Send to ${first}, ${second}, and ${rest.length} other${rest.length === 1 ? '' : 's'}`;
	})());

	let copied = $state(false);
	let shareUrl = $derived(
		`${typeof window !== 'undefined' ? window.location.origin : ''}/s/${template.slug}`
	);

	let shareMessage = $derived(
		generateShareMessage(
			{
				template: {
					title: template.title,
					domain: template.domain || 'advocacy',
					description: template.description || template.preview
				},
				contactedNames: [],
				totalRecipients: 0,
				shareUrl
			},
			'medium'
		)
	);

	// State derivations
	let isPublished = $derived(
		!publishing && !error && template.status === 'published' && template.is_public
	);
	let isDraft = $derived(
		!publishing && !error && (template.status === 'draft' || !template.is_public)
	);
	let showShareActions = $derived(publishing || isPublished);
	let hasError = $derived(!!error);
	let useNativeShare = supportsWebShare();

	function handleClose() {
		onclose?.();
	}

	async function handleShare() {
		const shareData = {
			title: template.title,
			text: shareMessage,
			url: shareUrl
		};

		if (
			typeof navigator !== 'undefined' &&
			navigator.share &&
			navigator.canShare?.(shareData)
		) {
			try {
				await navigator.share(shareData);
			} catch (err) {
				if (err instanceof Error && err.name !== 'AbortError') {
					console.error('[Share] Native share failed:', err);
				}
			}
		} else {
			await handleCopy();
		}
	}

	async function handleCopy() {
		const success = await clipboardCopy(shareUrl);
		if (success) {
			copied = true;
			setTimeout(() => (copied = false), 2000);
		}
	}

	function handleViewTemplate() {
		window.open(shareUrl, '_blank');
	}

	function handleDashboard() {
		ondashboard?.();
		window.location.href = '/';
	}
</script>

<div
	class="fixed inset-0 z-[1010] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
	onclick={handleClose}
	onkeydown={(e) => {
		if (e.key === 'Escape') handleClose();
		if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
			handleClose();
		}
	}}
	role="dialog"
	aria-modal="true"
	aria-label="Template created successfully"
	tabindex="0"
	in:fade={{ duration: 200 }}
	out:fade={{ duration: 150 }}
>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="relative w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl"
		role="presentation"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
		in:scale={{
			duration: 300,
			start: 0.9,
			opacity: 0.5
		}}
	>
		<!-- Close button -->
		<button
			onclick={handleClose}
			class="absolute right-4 top-4 z-10 rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
			aria-label="Close"
		>
			<X class="h-5 w-5" />
		</button>

		<!-- State-Aware Header -->
		<div
			class="px-6 pb-6 pt-8 text-center {hasError
				? 'bg-gradient-to-br from-red-50 to-orange-50'
				: isDraft
					? 'bg-gradient-to-br from-amber-50 to-orange-50'
					: 'bg-gradient-to-br from-emerald-50 to-blue-50'}"
		>
			<div
				class="mb-4 inline-flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-lg"
				class:publishing-pulse={publishing}
				in:scale={{ duration: 600, delay: 200, start: 0 }}
			>
				{#if hasError}
					<AlertCircle class="h-12 w-12 text-red-500" />
				{:else if isDraft}
					<Clock class="h-12 w-12 text-amber-500" />
				{:else}
					<CheckCircle class="h-12 w-12 text-emerald-500" />
				{/if}
			</div>

			{#if hasError}
				<h2 class="mb-2 text-2xl font-bold text-slate-900">Couldn't publish</h2>
				<p class="text-sm text-red-600">{error}</p>
			{:else if isDraft}
				<h2 class="mb-2 text-2xl font-bold text-slate-900">Template Saved as Draft</h2>
				<p class="text-slate-600">
					Content is being reviewed. You'll be notified when it's published.
				</p>
			{:else if publishing}
				<h2 class="mb-2 text-2xl font-bold text-slate-900">Publishing...</h2>
				<p class="text-slate-600">Your link is ready to share</p>
			{:else}
				<h2 class="mb-2 text-2xl font-bold text-slate-900">Published!</h2>
				<p class="text-slate-600">Your template is live and ready to share</p>
			{/if}
		</div>

		<!-- Template Preview -->
		<div class="px-6 pb-4 pt-5">
			<div class="rounded-lg border border-slate-200 bg-slate-50 p-4">
				<h3 class="mb-1 font-semibold text-slate-900">
					{template.title}
				</h3>
				<p class="line-clamp-2 text-sm text-slate-600">
					{template.description || template.preview}
				</p>
				<div class="mt-3 flex items-center gap-2">
					<span
						class="inline-flex items-center rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700"
					>
						{template.domain}
					</span>
					<span
						class="inline-flex items-center rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600"
					>
						{template.deliveryMethod === 'cwc' ? 'Congressional' : 'Direct'}
					</span>
				</div>
			</div>
		</div>

		{#if showShareActions}
			{#if isPublished}
				<!-- Beat 2: Decision-maker preview — fade+slide in at 800ms -->
				<div class="beat-2 px-6 pb-3 pt-1">
					<p class="text-center text-sm font-medium text-slate-700">
						{sendPreviewText}
					</p>
				</div>

				<!-- Beat 3: Primary action — "Send your message" -->
				<div class="beat-3 px-6 pb-2">
					<button
						onclick={() => onsend?.()}
						class="flex w-full items-center justify-center gap-2 rounded-lg bg-participation-primary-600 px-6 py-3 font-semibold text-white shadow-sm transition-all hover:bg-participation-primary-700 active:scale-95"
					>
						<span>Send your message</span>
						<ChevronRight class="h-5 w-5" />
					</button>
				</div>

				<!-- Beat 4: Secondary share/copy — visually subordinate -->
				<div class="beat-4 px-6 pb-3">
					{#if useNativeShare}
						<div class="flex justify-center">
							<button
								onclick={handleShare}
								class="flex items-center gap-1.5 text-sm text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-700 hover:decoration-slate-500"
							>
								<Share2 class="h-3.5 w-3.5" />
								<span>Share link</span>
							</button>
						</div>
					{:else}
						<!-- URL bar — clickable copy surface -->
						<button onclick={handleCopy} class="url-copy-bar" class:url-copy-bar--copied={copied}>
							{#if copied}
								<Check class="h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
								<span class="flex-1 text-left text-sm font-medium text-emerald-600">
									Link copied
								</span>
							{:else}
								<Link class="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
								<span class="flex-1 truncate text-left font-mono text-xs text-slate-500">
									{shareUrl}
								</span>
								<span class="flex-shrink-0 text-xs font-semibold text-participation-primary-600">
									Copy link
								</span>
							{/if}
						</button>
					{/if}
				</div>

				<!-- Warm closing note -->
				<div class="beat-4 px-6 pb-6 pt-0">
					<p class="text-center text-sm leading-relaxed text-slate-500">
						Share the link. Others send the same message.
					</p>
				</div>
			{:else}
				<!-- Publishing state: device-adaptive share surface (unchanged) -->
				<div class="px-6 pb-2 pt-1">
					{#if useNativeShare}
						<button
							onclick={handleShare}
							class="flex w-full items-center justify-center gap-2 rounded-lg bg-participation-primary-600 px-6 py-3 font-semibold text-white shadow-sm transition-all hover:bg-participation-primary-700 active:scale-95"
						>
							<Share2 class="h-5 w-5" />
							<span>Share</span>
						</button>
					{:else}
						<button
							onclick={handleCopy}
							class="flex w-full items-center justify-center gap-2 rounded-lg px-6 py-3 font-semibold shadow-sm transition-all active:scale-95 {copied
								? 'bg-emerald-600 text-white'
								: 'bg-participation-primary-600 text-white hover:bg-participation-primary-700'}"
						>
							{#if copied}
								<Check class="h-5 w-5" />
								<span>Copied!</span>
							{:else}
								<Link class="h-5 w-5" />
								<span>Copy link</span>
							{/if}
						</button>
					{/if}
				</div>

				<div class="px-6 pb-4">
					<button onclick={handleCopy} class="url-copy-bar" class:url-copy-bar--copied={copied}>
						{#if copied}
							<Check class="h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
							<span class="flex-1 text-left text-sm font-medium text-emerald-600">
								Link copied
							</span>
						{:else}
							<Link class="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
							<span class="flex-1 truncate text-left font-mono text-xs text-slate-500">
								{shareUrl}
							</span>
							<span class="flex-shrink-0 text-xs font-semibold text-participation-primary-600">
								Copy
							</span>
						{/if}
					</button>
				</div>

				<div class="px-6 pb-6 pt-1">
					<p class="text-center text-sm leading-relaxed text-slate-500">
						Share the link. Others send the same message.
					</p>
				</div>
			{/if}
		{:else if isDraft}
			<!-- Draft: Explain what's happening -->
			<div class="px-6 pb-4">
				<div class="rounded-lg bg-amber-50 p-4">
					<p class="text-sm font-medium text-amber-800">Why is my template a draft?</p>
					<p class="mt-1 text-sm text-amber-700">
						Our automated review couldn't verify the content. This usually resolves within
						a few minutes. Check your dashboard for updates.
					</p>
				</div>
			</div>

			<!-- Draft: Primary action -->
			<div class="px-6 pb-2">
				<button
					onclick={handleDashboard}
					class="flex w-full items-center justify-center gap-2 rounded-lg bg-participation-primary-600 px-6 py-3 font-semibold text-white shadow-sm transition-all hover:bg-participation-primary-700 active:scale-95"
				>
					<LayoutDashboard class="h-5 w-5" />
					Go to Dashboard
				</button>
			</div>

			<!-- Draft: What happens next -->
			<div class="px-6 pb-3 pt-1">
				<p class="text-xs font-medium text-amber-800">What happens next</p>
				<p class="mt-1.5 text-xs leading-relaxed text-amber-700">
					Your template is being reviewed automatically. Most reviews complete within a few
					minutes — check your dashboard for updates.
				</p>
			</div>

			<!-- Draft: Secondary link -->
			<div class="flex justify-center px-6 pb-6">
				<button
					onclick={handleViewTemplate}
					class="text-sm text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-700 hover:decoration-slate-500"
				>
					Preview draft
				</button>
			</div>
		{:else if hasError}
			<!-- Error: Retry -->
			<div class="px-6 pb-4 pt-1">
				<button
					onclick={() => onretry?.()}
					class="flex w-full items-center justify-center gap-2 rounded-lg bg-participation-primary-600 px-6 py-3 font-semibold text-white shadow-sm transition-all hover:bg-participation-primary-700 active:scale-95"
				>
					Try again
				</button>
			</div>

			<div class="flex justify-center px-6 pb-6">
				<button
					onclick={handleClose}
					class="text-sm text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-700 hover:decoration-slate-500"
				>
					Close
				</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.line-clamp-2 {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	@keyframes publish-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.6;
		}
	}

	.publishing-pulse {
		animation: publish-pulse 1.5s ease-in-out infinite;
	}

	.url-copy-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.625rem 0.75rem;
		border-radius: 0.5rem;
		border: 1.5px solid oklch(0.92 0.01 250);
		background: oklch(0.98 0.005 250);
		cursor: pointer;
		transition:
			border-color 150ms,
			background-color 150ms;
	}

	.url-copy-bar:hover {
		border-color: oklch(0.85 0.03 250);
		background: oklch(0.965 0.01 250);
	}

	.url-copy-bar--copied {
		border-color: oklch(0.78 0.12 155);
		background: oklch(0.96 0.03 155);
	}

	@keyframes beat-enter {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.beat-2 {
		animation: beat-enter 300ms ease-out 800ms both;
	}

	.beat-3 {
		animation: beat-enter 250ms ease-out 1200ms both;
	}

	.beat-4 {
		animation: beat-enter 200ms ease-out 1350ms both;
	}

	@media (prefers-reduced-motion: reduce) {
		.beat-2,
		.beat-3,
		.beat-4 {
			animation: none;
			opacity: 1;
			transform: none;
		}
	}
</style>
