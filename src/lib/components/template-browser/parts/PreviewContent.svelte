<script lang="ts">
	import type { Template } from '$lib/types/template';
	import {
		ClipboardCopy,
		ClipboardCheck,
		BookOpen,
		ChevronDown,
		Landmark,
		Building2,
		Users,
		Mail
	} from '@lucide/svelte';
	import TemplateTips from '../TemplateTips.svelte';
	import MessagePreview from '../MessagePreview.svelte';
	import ShareButton from '$lib/components/ui/ShareButton.svelte';
	import { extractRecipientEmails } from '$lib/types/templateConfig';
	import { deriveTargetPresentation, parseRecipientConfig } from '$lib/utils/deriveTargetPresentation';
	import { fade, slide } from 'svelte/transition';
	import { coordinated } from '$lib/utils/timerCoordinator';
	import SourceCard from '$lib/components/template/creator/SourceCard.svelte';
	import ResearchLog from '$lib/components/template/creator/ResearchLog.svelte';
	import { hasCitations } from '$lib/utils/message-processing';

	type PreviewDecisionMaker = {
		name: string;
		/** The human-readable position/title — what the reader recognises as the person's
		 *  power ("Secretary of Transportation", "Mayor", "City Council Member"). The seed
		 *  carries this as `role`; older data may use `title`. */
		role?: string;
		title?: string;
		organization?: string;
		/** Internal power-type taxonomy (votes / executes / shapes / funds / oversees).
		 *  NOT shown to visitors — it reads as jargon; the human `role` is shown instead. */
		roleCategory?: string;
		// === "Why we reach them" — populated by the agent decision-maker-resolution
		// pipeline, EMPTY in hand-authored seeds. These are runtime-present on
		// recipient_config (listPublic ships it raw); the type just makes them visible. ===
		/** Specific votes / decisions / statements — the receipts (the reveal body). */
		publicActions?: string[];
		/** Verification provenance. */
		provenance?: string;
		source?: string;
		source_url?: string;
		recencyCheck?: string;
		positionSourceDate?: string;
		isAiResolved?: boolean;
		emailVerified?: 'deliverable' | 'risky';
		emailGrounded?: boolean;
		emailSource?: string;
	};

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
		user: { id: string; name: string | null; trust_tier?: number; district_code?: string; credentialHash?: string | null } | null;
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
	// The verify URL must point at a resolvable record. Only the user's active
	// district credentialHash resolves at /v/[hash]; a truncated user id 404s.
	// Null when unverified → no link is rendered (see {#if proofHash}).
	const proofHash = $derived(user?.credentialHash ?? null);

	// Suppress the footer entirely when there's nothing to attest — otherwise an
	// unverified user (no label, no resolvable hash, no gov-ID upgrade CTA) gets
	// an orphan divider over empty space.
	const showProofFooter = $derived(
		context === 'page' &&
			!!user &&
			(!!proofLabel || !!proofHash || (trustTier >= 2 && trustTier < 3 && !!onVerifyIdentity))
	);

	const recipients = $derived(extractRecipientEmails(template?.recipient_config));
	const recipientConfig = $derived(parseRecipientConfig(template?.recipient_config));
	const decisionMakers = $derived<PreviewDecisionMaker[]>(recipientConfig?.decisionMakers ?? []);

	// When all DMs share the same org, hoist it to the header instead of repeating per-row
	const sharedOrg = $derived.by(() => {
		if (decisionMakers.length === 0) return null;
		const first = decisionMakers[0].organization;
		if (!first) return null;
		return decisionMakers.every((dm) => dm.organization === first) ? first : null;
	});

	// Who-you-reach: the same target presentation the card shows (primary org + "+N
	// more"), reused on the compact toggle so the collapsed line is as informative as
	// the card — just made the entry point to the full roster.
	const targetInfo = $derived(deriveTargetPresentation(template));
	const reachCount = $derived(decisionMakers.length || recipients.length);

	// The roster is COLLAPSED by default so the title + letter stay focal; it discloses
	// on intent. Once open, a long agent-generated list is still capped so it never
	// runs away — the rest expand inline via "show all".
	let rosterOpen = $state(false);
	const ROSTER_CAP = 6;
	let showAllRoster = $state(false);
	const visibleDecisionMakers = $derived(
		showAllRoster ? decisionMakers : decisionMakers.slice(0, ROSTER_CAP)
	);

	// Per-row "why we reach them" disclosure. Click/tap (never hover) toggles one open
	// at a time — so desktop and mobile (TouchModal) run the identical path. A row only
	// becomes a toggle when it has a WHY body (the honest-absent gate); seed rows, which
	// carry no why-fields, stay byte-identical to a plain identity row.
	let expandedWhyKey = $state<string | null>(null);
	const dmKey = (dm: PreviewDecisionMaker) => dm.name + (dm.role ?? dm.title ?? '');
	const dmHasWhy = (dm: PreviewDecisionMaker) => !!dm.publicActions?.length;
	function toggleWhy(key: string, headerEl?: HTMLElement) {
		const opening = expandedWhyKey !== key;
		expandedWhyKey = opening ? key : null;
		// Keep the freshly-opened panel in view (esp. inside the mobile TouchModal).
		if (opening && headerEl) {
			requestAnimationFrame(() => headerEl.scrollIntoView({ block: 'nearest' }));
		}
	}
	/** Bare host of a verification URL, for the provenance footer (no scheme/path). */
	function sourceHost(url?: string): string | null {
		if (!url) return null;
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return null;
		}
	}

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
	<div class="mb-3 rounded border px-3 py-2 text-sm
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

{#if context !== 'page' && (decisionMakers.length > 0 || recipients.length > 0)}
	<!-- Who you reach: COMPACT by default so the title + letter stay focal. The full
	     named roster — the depth the card teases with "+N more" — discloses ON INTENT,
	     not at rest, so it never out-weighs the message it sits above. -->
	<div class="reach">
		<button
			type="button"
			class="reach-toggle group"
			aria-expanded={rosterOpen}
			aria-label={`Reaches ${reachCount} decision-maker${reachCount === 1 ? '' : 's'} — show details`}
			onclick={() => (rosterOpen = !rosterOpen)}
		>
			{#if targetInfo.icon === 'Capitol'}
				<Landmark class="h-4 w-4 shrink-0 card-icon" />
			{:else if targetInfo.icon === 'Building'}
				<Building2 class="h-4 w-4 shrink-0 card-icon" />
			{:else if targetInfo.icon === 'Users'}
				<Users class="h-4 w-4 shrink-0 card-icon-muted" />
			{:else}
				<Mail class="h-4 w-4 shrink-0 card-icon-muted" />
			{/if}
			<span class="reach-primary card-label">{targetInfo.primary}</span>
			{#if targetInfo.secondary}
				<span class="reach-secondary">{targetInfo.secondary}</span>
			{/if}
			<ChevronDown
				class="h-3.5 w-3.5 shrink-0 text-slate-400 transition duration-150 group-hover:text-slate-600 {rosterOpen
					? 'rotate-180'
					: 'group-hover:translate-y-px'}"
			/>
		</button>

		{#if rosterOpen}
			<div class="reach-body" transition:slide={{ duration: 180 }}>
				{#if decisionMakers.length > 0}
					{#if sharedOrg}
						<p class="reach-org">{sharedOrg}</p>
					{/if}
					<ul class="reach-list">
						{#each visibleDecisionMakers as dm (dmKey(dm))}
							{@const key = dmKey(dm)}
							{@const hasWhy = dmHasWhy(dm)}
							{@const open = expandedWhyKey === key}
							<!-- Three-tier identity: WHO (name, the scan anchor) → their POSITION
							     (the real role/title — their power) → the INSTITUTION. The internal
							     roleCategory taxonomy ("executes"/"shapes") is deliberately not shown.
							     When the agent pipeline has resolved the public actions behind WHY we
							     reach this person, the identity header becomes a click/tap toggle that
							     discloses those receipts + their verification in-flow beneath it —
							     otherwise the row is a plain, inert identity (absent-not-flat). -->
							<li class="reach-person">
								{#if hasWhy}
									<button
										type="button"
										class="reach-person-toggle group"
										aria-expanded={open}
										aria-label={`Why we reach ${dm.name}${dm.role || dm.title ? ', ' + (dm.role || dm.title) : ''}`}
										onclick={(e) => toggleWhy(key, e.currentTarget)}
									>
										<span class="reach-person-id">
											<span class="reach-name">{dm.name}</span>
											{#if dm.role || dm.title}
												<span class="reach-role">{dm.role || dm.title}</span>
											{/if}
											{#if !sharedOrg && dm.organization}
												<span class="reach-org-line">{dm.organization}</span>
											{/if}
										</span>
										<ChevronDown
											class="h-3.5 w-3.5 shrink-0 text-slate-300 transition duration-150 group-hover:text-slate-500 {open
												? 'rotate-180'
												: ''}"
										/>
									</button>
									{#if open}
										{@const host = sourceHost(dm.source || dm.source_url)}
										<div class="reach-why" transition:slide={{ duration: 180 }}>
											{#if dm.publicActions?.length}
												<ul class="reach-why-receipts">
													{#each dm.publicActions.slice(0, 3) as action}
														<li>{action}</li>
													{/each}
													{#if dm.publicActions.length > 3}
														<li class="reach-why-more">+{dm.publicActions.length - 3} more</li>
													{/if}
												</ul>
											{/if}
											{#if dm.isAiResolved || host || dm.positionSourceDate || dm.provenance}
												<p class="reach-why-prov">
													{#if dm.isAiResolved}<span class="cite-method">AI-resolved</span>{/if}
													{#if host}{#if dm.isAiResolved}<span class="cite-sep"></span>{/if}<a
															class="cite-anchor"
															href={dm.source || dm.source_url}
															target="_blank"
															rel="noopener noreferrer">{host}</a
														>{/if}
													{#if dm.positionSourceDate}<span class="cite-sep"></span><span class="cite-anchor"
															>{dm.positionSourceDate}</span
														>{/if}
													{#if !dm.isAiResolved && !host && !dm.positionSourceDate && dm.provenance}{dm.provenance}{/if}
												</p>
											{/if}
											{#if dm.recencyCheck}
												<p class="reach-why-recency">{dm.recencyCheck}</p>
											{/if}
											{#if dm.emailVerified === 'risky'}
												<p class="reach-why-caution">unverified contact</p>
											{/if}
										</div>
									{/if}
								{:else}
									<span class="reach-name">{dm.name}</span>
									{#if dm.role || dm.title}
										<span class="reach-role">{dm.role || dm.title}</span>
									{/if}
									{#if !sharedOrg && dm.organization}
										<span class="reach-org-line">{dm.organization}</span>
									{/if}
								{/if}
							</li>
						{/each}
					</ul>
					<div class="reach-actions">
						{#if decisionMakers.length > ROSTER_CAP}
							<button type="button" class="reach-more" onclick={() => (showAllRoster = !showAllRoster)}>
								{showAllRoster ? 'Show fewer' : `Show all ${decisionMakers.length}`}
							</button>
						{/if}
						{#if recipients.length > 0}
							<button
								type="button"
								onclick={copyToClipboard}
								class="reach-copy"
								aria-label="Copy all recipient emails to clipboard"
							>
								{#if copied}
									<div in:fade={{ duration: 200 }}><ClipboardCheck class="h-4 w-4 text-emerald-500" /></div>
								{:else}
									<div in:fade={{ duration: 200 }}><ClipboardCopy class="h-4 w-4" /></div>
								{/if}
							</button>
						{/if}
					</div>
				{:else}
					<ul class="reach-list">
						{#each recipients as email (email)}
							<li class="reach-meta reach-email">{email}</li>
						{/each}
					</ul>
					<div class="reach-actions">
						<button
							type="button"
							onclick={copyToClipboard}
							class="reach-copy"
							aria-label="Copy all recipient emails to clipboard"
						>
							{#if copied}
								<div in:fade={{ duration: 200 }}><ClipboardCheck class="h-4 w-4 text-emerald-500" /></div>
							{:else}
								<div in:fade={{ duration: 200 }}><ClipboardCopy class="h-4 w-4" /></div>
							{/if}
						</button>
					</div>
				{/if}
			</div>
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
	{#if showProofFooter}
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
				<!-- href carries the full hash (must match to resolve); the display is
				     elided so the 64-char hash doesn't sprawl the proof footer. -->
				<a
					href="/v/{proofHash}"
					class="mt-0.5 block font-mono text-xs text-slate-400 hover:text-slate-600 transition-colors"
				>
					commons.email/v/{proofHash.slice(0, 8)}&hellip;
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

<style>
	/*
	 * Reach disclosure — the preview's progressive disclosure of WHO you reach.
	 *
	 * COMPACT by default: a single quiet toggle line, so the title + letter stay the
	 * focal content. On intent it expands the full named roster (the depth the card
	 * teases with "+N more"), bounded by the domain-hue left keyline — continuity with
	 * the card without repeating its header. Names are the peak; role/organization the
	 * valley; the role-in-the-decision a quiet trailing label (never a pill).
	 */
	.reach {
		margin-bottom: 1rem;
	}

	.reach-toggle {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		max-width: 100%;
		padding: 0.125rem 0;
		text-align: left;
		cursor: pointer;
		border-radius: 4px;
	}

	/* Keyboard affordance — the hue focus ring the card uses (.card-topic:focus-visible). */
	.reach-toggle:focus-visible {
		outline: 2px solid oklch(0.5 0.16 var(--card-hue));
		outline-offset: 3px;
	}

	/* Primary target — same hue-tinted label the card uses (.card-label provides the
	   color); names who you reach instead of a bare count. */
	.reach-primary {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.reach-secondary {
		flex-shrink: 0;
		font-size: 0.75rem;
		font-weight: 500;
		color: oklch(0.55 0.02 250);
		transition: color 150ms ease-out;
	}

	.reach-toggle:hover .reach-secondary {
		color: oklch(0.4 0.02 250);
	}

	/* The expanded roster is bounded by the hue keyline — hue continuity, contained. */
	.reach-body {
		margin-top: 0.625rem;
		padding-left: 0.875rem;
		border-left: 2px solid oklch(0.7 0.08 var(--card-hue) / 0.4);
	}

	.reach-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-top: 0.875rem;
	}

	/* Icon control — activates by darkening on hover (no hover background), matching the
	   system's latent→active affordance posture. */
	.reach-copy {
		display: inline-flex;
		padding: 0.25rem;
		border-radius: 6px;
		cursor: pointer;
		color: oklch(0.62 0.02 250);
		transition: color 150ms ease-out;
	}

	.reach-copy:hover {
		color: oklch(0.38 0.02 250);
	}

	.reach-copy:focus-visible {
		outline: 2px solid oklch(0.5 0.16 var(--card-hue));
		outline-offset: 2px;
	}

	.reach-org {
		font-size: 0.75rem;
		color: oklch(0.5 0.02 250);
		margin-bottom: 0.625rem;
	}

	.reach-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.875rem; /* the void between people is the boundary */
	}

	/* Three-tier identity, descending weight: name (the scan anchor) → role (the
	   person's actual power) → organization (the institution, quietest). */
	.reach-person {
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
		min-width: 0;
	}

	.reach-name {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.9375rem;
		font-weight: 600;
		line-height: 1.3;
		color: oklch(0.26 0.02 250);
	}

	.reach-role {
		font-size: 0.8125rem;
		font-weight: 500;
		line-height: 1.35;
		color: oklch(0.42 0.03 250);
	}

	.reach-org-line {
		font-size: 0.75rem;
		font-weight: 400;
		line-height: 1.3;
		color: oklch(0.56 0.02 250);
	}

	/* ── "Why we reach them" disclosure ──────────────────────────────────────
	   The identity header becomes a click/tap toggle ONLY when there is a why to
	   tell. Text activates on hover (no background fill); the panel discloses
	   in-flow beneath — no card, no shadow, no bg-white, no popover. */
	.reach-person-toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		width: 100%;
		min-height: 44px; /* touch floor — design-system.md, no exceptions */
		padding: 0;
		background: none;
		border: none;
		text-align: left;
		cursor: pointer;
	}

	.reach-person-id {
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
		min-width: 0;
	}

	/* Text-only activation, mirroring .reach-more:hover — the name warms to the
	   card hue; the caret (Tailwind group-hover) darkens. No background. */
	.reach-person-toggle:hover .reach-name {
		color: oklch(0.45 0.14 var(--card-hue));
	}

	.reach-person-toggle:focus-visible {
		outline: 2px solid oklch(0.5 0.16 var(--card-hue));
		outline-offset: 3px;
		border-radius: 4px;
	}

	.reach-why {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0.25rem 0 0.5rem;
		padding: 0.5rem 0 0.125rem 0.75rem;
		border-left: 2px solid oklch(0.7 0.08 var(--card-hue) / 0.4); /* the hue keyline */
	}

	/* Receipts: specific votes / decisions / statements, as plain text rows. */
	.reach-why-receipts {
		display: flex;
		flex-direction: column;
		gap: 0.1875rem;
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.reach-why-receipts li {
		position: relative;
		padding-left: 0.75rem;
		font-size: 0.78rem;
		line-height: 1.4;
		color: oklch(0.4 0.02 250);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.reach-why-receipts li::before {
		content: '·';
		position: absolute;
		left: 0;
		color: oklch(0.62 0.02 250);
	}

	.reach-why-more {
		color: oklch(0.55 0.02 250) !important;
		font-size: 0.75rem !important;
	}

	/* Provenance footer: subordinate, mono numerals via the global .cite-* classes. */
	.reach-why-prov {
		font-size: 0.75rem;
		line-height: 1.4;
		color: oklch(0.5 0.02 250);
	}

	.reach-why-recency {
		font-size: 0.72rem;
		line-height: 1.35;
		color: oklch(0.56 0.02 250);
	}

	.reach-why-caution {
		font-size: 0.72rem;
		line-height: 1.35;
		color: oklch(0.5 0.08 60); /* muted amber — a quiet word, never a red pill */
	}

	.reach-email {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.75rem;
		color: oklch(0.5 0.02 250);
	}

	.reach-more {
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		color: oklch(0.45 0.14 var(--card-hue));
		border-radius: 4px;
		transition: color 150ms ease-out;
	}

	.reach-more:focus-visible {
		outline: 2px solid oklch(0.5 0.16 var(--card-hue));
		outline-offset: 2px;
	}

	.reach-more:hover {
		text-decoration: underline;
	}
</style>
