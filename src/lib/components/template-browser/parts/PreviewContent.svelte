<script lang="ts">
	import type { Template } from '$lib/types/template';
	import {
		Users,
		ClipboardCopy,
		ClipboardCheck,
		BookOpen,
		Building2,
		Landmark,
		Mail
	} from '@lucide/svelte';
	import TemplateTips from '../TemplateTips.svelte';
	import MessagePreview from '../MessagePreview.svelte';
	import AnimatedPopover from '$lib/components/ui/AnimatedPopover.svelte';
	import ShareButton from '$lib/components/ui/ShareButton.svelte';
	import { extractRecipientEmails } from '$lib/types/templateConfig';
	import {
		deriveTargetPresentation,
		parseRecipientConfig
	} from '$lib/utils/deriveTargetPresentation';
	import { fade } from 'svelte/transition';
	import { coordinated } from '$lib/utils/timerCoordinator';
	import SourceCard from '$lib/components/template/creator/SourceCard.svelte';
	import ResearchLog from '$lib/components/template/creator/ResearchLog.svelte';
	import { hasCitations } from '$lib/utils/message-processing';

	let {
		template,
		inModal,
		context = 'list',
		user,
		onScroll,
		personalConnectionValue = $bindable(),
		onScrollStateChange,
		onTouchStateChange,
		componentId,
		expandToContent = false,
		debateResolution = null,
		onVerifyAddress,
		onVerifyIdentity
	}: {
		template: Template;
		inModal: boolean;
		context?: 'list' | 'page' | 'modal';
		user: { id: string; name: string | null; trust_tier?: number; district_code?: string } | null;
		onScroll: (isAtBottom: boolean, scrollProgress?: number) => void;
		personalConnectionValue: string;
		onScrollStateChange?: (scrollState: unknown) => void;
		onTouchStateChange?: (touchState: unknown) => void;
		componentId: string;
		expandToContent?: boolean;
		debateResolution?: { winningStance: string; participants: number } | null;
		onVerifyAddress?: () => void;
		onVerifyIdentity?: () => void;
	} = $props();

	// Proof footer: what verification the message carries
	const trustTier = $derived(user?.trust_tier ?? 0);
	const proofLocation = $derived(trustTier >= 2 && user?.district_code ? user.district_code : null);
	const proofLabel = $derived.by(() => {
		if (trustTier >= 2) return 'Verified resident';
		if (trustTier >= 1) return 'Verified sender';
		return null;
	});
	const hasGovId = $derived(trustTier >= 3);
	const proofHash = $derived(user?.id ? user.id.slice(0, 8) : null);

	const recipients = $derived(extractRecipientEmails(template?.recipient_config));
	const recipientConfig = $derived(parseRecipientConfig(template?.recipient_config));
	const decisionMakers = $derived(recipientConfig?.decisionMakers ?? []);
	const recipientCount = $derived(decisionMakers.length || recipients.length);
	const targetInfo = $derived(deriveTargetPresentation(template));

	// When all DMs share the same org, hoist it to the header instead of repeating per-row
	const sharedOrg = $derived.by(() => {
		if (decisionMakers.length === 0) return null;
		const first = decisionMakers[0].organization;
		if (!first) return null;
		return decisionMakers.every((dm) => dm.organization === first) ? first : null;
	});

	let copied = $state(false);
	let copyTimeout: string | null = null;
	let showResearchLog = $state(false);

	// Check if template has sources and citations
	const hasSources = $derived(template.sources && template.sources.length > 0);
	const hasResearchLog = $derived(template.research_log && template.research_log.length > 0);
	const hasCitationsInMessage = $derived(hasCitations(template.message_body));

	async function copyToClipboard() {
		const csvEmails = recipients.join(', ');

		try {
			if (navigator.clipboard && window.isSecureContext) {
				await navigator.clipboard.writeText(csvEmails);
			} else {
				// Fallback for older browsers
				const textArea = document.createElement('textarea');
				textArea.value = csvEmails;
				textArea.style.position = 'fixed';
				textArea.style.left = '-999999px';
				textArea.style.top = '-999999px';
				document.body.appendChild(textArea);
				textArea.focus();
				textArea.select();
				document.execCommand('copy');
				textArea.remove();
			}

			// Show success feedback
			copied = true;

			// Clear any existing timeout
			if (copyTimeout) {
				coordinated.autoClose(
					() => {
						/* Clear timeout callback */
					},
					0,
					componentId
				);
			}

			// Reset after 2 seconds
			copyTimeout = coordinated.feedback(
				() => {
					copied = false;
				},
				2000,
				componentId
			);
		} catch {
			/* Ignore clipboard errors - copy operation failed silently */
		}
	}
</script>

{#if debateResolution}
	<div class="mb-3 rounded-lg border px-3 py-2 text-sm
		{debateResolution.winningStance === 'SUPPORT'
			? 'border-emerald-200/60 bg-emerald-50/50 text-emerald-700'
			: debateResolution.winningStance === 'OPPOSE'
				? 'border-red-200/60 bg-red-50/50 text-red-700'
				: 'border-amber-200/60 bg-amber-50/50 text-amber-700'}">
		{#if debateResolution.winningStance === 'SUPPORT'}
			<span class="font-medium">Deliberation-validated framing</span>
			<span class="opacity-70"> · {debateResolution.participants} participants</span>
		{:else if debateResolution.winningStance === 'OPPOSE'}
			<span class="font-medium">Framing contested by deliberation</span>
			<a href="#debate-surface" class="ml-1 underline opacity-70">View arguments</a>
		{:else}
			<span class="font-medium">Amendment proposed by deliberation</span>
			<a href="#debate-surface" class="ml-1 underline opacity-70">View amendment</a>
		{/if}
	</div>
{/if}

{#if template.type === 'certified'}
	<div class="relative mb-4 shrink-0 overflow-visible">
		<TemplateTips isCertified={true} />
	</div>
{/if}

{#if context !== 'page' && (recipientCount > 0 || targetInfo.type === 'district-based')}
	<div class="mb-4 flex shrink-0 items-center gap-2 text-sm">
		{#if targetInfo.type === 'multi-level'}
			<!-- Multi-Level: Compact vertical stack -->
			<div class="flex items-center gap-2 overflow-hidden">
				<div class="space-y-0.5">
					{#each targetInfo.targets as target}
						<div class="flex items-center gap-1.5">
							{#if target.icon === 'Capitol'}
								<Landmark class="h-3.5 w-3.5 shrink-0 text-congressional-500" />
							{:else if target.icon === 'Building'}
								<Building2 class="h-3.5 w-3.5 shrink-0 text-emerald-500" />
							{:else}
								<Users class="h-3.5 w-3.5 shrink-0 text-slate-500" />
							{/if}
							<span
								class="truncate text-sm font-medium"
								class:text-congressional-700={target.emphasis === 'federal'}
								class:text-emerald-700={target.emphasis === 'local'}
								class:text-slate-600={target.emphasis === 'neutral'}
							>
								{target.primary}
							</span>
							{#if target.secondary && (decisionMakers.length > 0 || recipients.length > 0)}
								<AnimatedPopover id="recipients-multi-{template?.id || 'preview'}-{target.primary}">
									{#snippet trigger(_params)}
										<button class="shrink-0 cursor-help text-xs font-medium text-slate-500 transition-colors hover:text-slate-700">
											{target.secondary}
										</button>
									{/snippet}
									{#snippet children(_props)}
										<div class="w-[300px] max-w-[calc(100vw-2rem)] cursor-default">
											{#if decisionMakers.length > 0}
												<div class="mb-2">
													<h3 class="text-sm font-semibold text-slate-900">
														Decision-Makers ({decisionMakers.length})
													</h3>
													{#if sharedOrg}
														<div class="truncate text-xs text-slate-500">{sharedOrg}</div>
													{/if}
												</div>
												<div class="space-y-1">
													{#each decisionMakers as dm}
														<div class="min-w-0 py-0.5">
															<div class="truncate text-sm font-medium text-slate-900">
																{dm.name}
															</div>
															{#if dm.title || (!sharedOrg && dm.organization)}
																<div class="truncate text-xs text-slate-500">
																	{dm.title || ''}{#if !sharedOrg && dm.organization}{dm.title ? ' · ' : ''}{dm.organization}{/if}
																</div>
															{/if}
														</div>
													{/each}
												</div>
											{/if}
										</div>
									{/snippet}
								</AnimatedPopover>
							{:else if target.secondary}
								<span class="shrink-0 text-xs font-medium text-slate-500">{target.secondary}</span>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{:else}
			<!-- Single-Level: Inline with icon -->
			{#if targetInfo.icon === 'Capitol'}
				<Landmark class="h-4 w-4 shrink-0 text-congressional-500" />
			{:else if targetInfo.icon === 'Building'}
				<Building2 class="h-4 w-4 shrink-0 text-emerald-500" />
			{:else if targetInfo.icon === 'Users'}
				<Users class="h-4 w-4 shrink-0 text-slate-500" />
			{:else}
				<Mail class="h-4 w-4 shrink-0 text-slate-500" />
			{/if}

			<span
				class="truncate font-medium"
				class:text-congressional-700={targetInfo.emphasis === 'federal'}
				class:text-emerald-700={targetInfo.emphasis === 'local'}
				class:text-slate-600={targetInfo.emphasis === 'neutral' || targetInfo.emphasis === 'state'}
			>
				{targetInfo.primary}
			</span>
		{/if}

		<!-- Detail popover as "+N more" trigger (single-level only, multi-level handled inline) -->
		{#if targetInfo.type !== 'multi-level' && recipientCount > 1 && (decisionMakers.length > 0 || recipients.length > 0)}
			<AnimatedPopover id="recipients-{template?.id || 'preview'}">
				{#snippet trigger(_params)}
					<button
						class="shrink-0 cursor-help text-xs font-medium text-slate-500 transition-colors hover:text-slate-700"
					>
						+{recipientCount - 1} more
					</button>
				{/snippet}

				{#snippet children(_props)}
					<div class="w-[300px] max-w-[calc(100vw-2rem)] cursor-default">
						{#if decisionMakers.length > 0}
							<!-- Rich decision-maker view -->
							<div class="mb-2 flex items-center justify-between gap-2">
								<div class="min-w-0">
									<h3 class="text-sm font-semibold text-slate-900">
										Decision-Makers ({decisionMakers.length})
									</h3>
									{#if sharedOrg}
										<div class="truncate text-xs text-slate-500">{sharedOrg}</div>
									{/if}
								</div>
								{#if recipients.length > 0}
									<button
										onclick={(e) => {
											e.stopPropagation();
											copyToClipboard();
										}}
										class="shrink-0 cursor-pointer rounded-md p-1.5 transition-colors
										       duration-200 hover:bg-slate-100"
										aria-label="Copy all recipient emails to clipboard"
									>
										{#if copied}
											<div in:fade={{ duration: 200 }}>
												<ClipboardCheck class="h-4 w-4 text-green-500" />
											</div>
										{:else}
											<div in:fade={{ duration: 200 }}>
												<ClipboardCopy class="h-4 w-4 text-slate-400" />
											</div>
										{/if}
									</button>
								{/if}
							</div>
							<div class="space-y-1">
								{#each decisionMakers as dm}
									<div class="min-w-0 py-0.5">
										<div class="truncate text-sm font-medium text-slate-900">
											{dm.name}
										</div>
										{#if dm.title || (!sharedOrg && dm.organization)}
											<div class="truncate text-xs text-slate-500">
												{dm.title || ''}{#if !sharedOrg && dm.organization}{dm.title ? ' · ' : ''}{dm.organization}{/if}
											</div>
										{/if}
									</div>
								{/each}
							</div>
						{:else}
							<!-- Fallback: email-only view (legacy templates) -->
							<div class="flex items-start gap-3">
								<button
									onclick={(e) => {
										e.stopPropagation();
										copyToClipboard();
									}}
									class="shrink-0 cursor-pointer rounded-lg bg-participation-primary-50 p-2 transition-all
									       duration-200 hover:bg-participation-primary-100 focus:outline-none focus:ring-2
									       focus:ring-participation-primary-200 focus:ring-offset-2 active:bg-participation-primary-200"
									aria-label="Copy all recipient emails to clipboard"
								>
									{#if copied}
										<div in:fade={{ duration: 200 }}>
											<ClipboardCheck class="h-5 w-5 text-green-500" />
										</div>
									{:else}
										<div in:fade={{ duration: 200 }}>
											<ClipboardCopy class="h-5 w-5 text-participation-primary-400" />
										</div>
									{/if}
								</button>
								<div class="min-w-0 flex-1">
									<h3 class="mb-1 text-sm font-medium text-slate-900">
										Recipients ({recipients.length})
									</h3>
									<div class="cursor-text space-y-0.5 text-xs text-slate-500">
										{#each recipients as email}
											<div class="truncate">{email}</div>
										{/each}
									</div>
								</div>
							</div>
						{/if}
					</div>
				{/snippet}
			</AnimatedPopover>
		{/if}
		{#if template.category}
			<span class="ml-auto shrink-0 text-xs text-slate-500">{template.category}</span>
		{/if}
	</div>
{/if}

<div
	class={inModal
		? 'min-h-0 flex-1 touch-pan-y overflow-hidden'
		: 'min-h-0 flex-1 touch-pan-y overflow-hidden'}
>
	<MessagePreview
		preview={template.message_body}
		{template}
		{user}
		{context}
		{onScroll}
		onscrollStateChange={onScrollStateChange}
		ontouchStateChange={onTouchStateChange}
		onvariableChange={(e) => {
			if (e?.name === 'Personal Connection') {
				personalConnectionValue = e.value ?? '';
			}
		}}
		initialVariableValues={personalConnectionValue ? { 'Personal Connection': personalConnectionValue } : {}}
		{expandToContent}
	/>

	<!-- Sources section (when available) -->
	{#if hasSources && hasCitationsInMessage}
		<div class="mt-5 space-y-2">
			<div class="flex items-center gap-1.5">
				<BookOpen class="h-4 w-4 text-slate-400" />
				<h4 class="text-xs font-medium uppercase tracking-wider text-slate-400">
					Sources ({template.sources?.length || 0})
				</h4>
			</div>

			<div class="space-y-1.5">
				{#each template.sources || [] as source}
					<SourceCard {source} />
				{/each}
			</div>
		</div>
	{/if}

	<!-- Research log (when available) -->
	{#if hasResearchLog}
		<div class="mt-3">
			<ResearchLog researchLog={template.research_log || []} bind:expanded={showResearchLog} />
		</div>
	{/if}

	<!-- Proof footer: attestation carried by the message -->
	{#if context === 'page' && user}
		<div class="proof-footer mt-8">
			<div class="h-px bg-slate-300/50 mb-4"></div>
			<div class="flex items-baseline gap-1.5 text-[13px]">
				{#if proofLabel}
					<span class="font-medium text-emerald-700">{proofLabel}</span>
					{#if proofLocation}
						<span class="text-slate-300">·</span>
						<span class="text-slate-600">{proofLocation}</span>
					{/if}
					{#if hasGovId}
						<span class="text-slate-300">·</span>
						<span class="text-slate-500">Gov ID</span>
					{/if}
				{/if}
			</div>
			{#if proofHash}
				<a
					href="/v/{proofHash}"
					class="mt-0.5 block font-mono text-xs text-slate-400 hover:text-slate-600 transition-colors"
				>
					commons.email/v/{proofHash}
				</a>
			{/if}

			<!-- Identity verification CTA — gov ID is a distinct action from address
			     verification; address CTAs live on the page-level amber banner and in
			     the landscape's verify-to-see-reps nudge, so this footer focuses only
			     on the tier-2→3 upgrade path. -->
			{#if trustTier >= 2 && trustTier < 3 && onVerifyIdentity}
				<button
					onclick={onVerifyIdentity}
					class="mt-3 min-h-[44px] flex items-center text-[13px] text-emerald-600 hover:text-emerald-700 transition-colors"
				>
					Add government ID for unforgeable proof →
				</button>
			{/if}
		</div>
	{/if}
</div>
