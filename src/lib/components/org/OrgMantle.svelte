<!--
  OrgMantle — the persistent authoring-first frame.

  Replaces the fixed 13-link sidebar. The org runs ONE loop —
  INTENT → GROUND → AUTHOR → RESOLVE → SEND → AGGREGATE — and the Mantle is
  the instrument that holds it. Verification is the WATERMARK on the work,
  never the headline.

  Anatomy:
    · Org identity (mark + name + role)
    · Strong center: authoring command + draft-in-flight
    · Ambient WATERMARK (faint Rings + Datum "authored & sent this period" + Pulse)
    · 4-mark WorkspaceSwitcher (Studio / People / Power / Results)
    · Substrate (authority / webhooks / coalition / RegistryMark) —
      plain nav links, ambient, not a workspace
    · Right edge: SignalWell + CommandBar (cmd-K)

  The authoring command targets the org-scoped STUDIO interior (`/org/[slug]/studio`) — the
  authoring loop with the agent's reasoning visible as the strong center. The
  public citizen entry (`/?create=true`, TemplateCreator) remains intact and is
  reachable from inside STUDIO. Draft-in-flight is read from templateDraftStore
  client-side and resumed via the public `?resumeDraft=…` contract.

  The command binds to one readiness boolean from the server env probe: when
  the authoring runtime is ready it is a live link into Studio; when it is not,
  it renders disabled with the shared plain-language limit sentence as its
  title and accessible label.

  Renders in two variants:
    'rail'   — desktop vertical rail (warm-dark Mantle ground)
    'header' — mobile top frame, same Mantle at reduced density

  Motion law: spring is reserved for coordination signals (the watermark
  Datum). Navigation uses ease-out (TIMING/EASING). No spring on nav.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { PenLine } from '@lucide/svelte';
	import { page } from '$app/stores';
	import { templateDraftStore } from '$lib/stores/templateDraft';
	import { RegistryMark } from '$lib/design';
	import { TIMING, EASING } from '$lib/design/motion';
	import { orgLimitSentence } from '$lib/data/org-limit-sentences';
	import WorkspaceSwitcher, { type WorkspaceMark } from './WorkspaceSwitcher.svelte';
	import MantleWatermark, { type WatermarkTier } from './MantleWatermark.svelte';
	import SignalWell from './SignalWell.svelte';
	import CommandBar from './CommandBar.svelte';
	import ProcessDock from './os/ProcessDock.svelte';

	type OrgSignal = {
		id: string;
		event: string;
		emittedAt: number;
	};

	let {
		org,
		role,
		marks,
		substrateLinks,
		signalEvents = null,
		authoringReady = false,
		watermark,
		variant = 'rail'
	}: {
		org: { name: string; slug: string; avatar?: string | null };
		role: string;
		marks: WorkspaceMark[];
		substrateLinks: { href: string; label: string; latent?: boolean }[];
		signalEvents?: OrgSignal[] | null;
		authoringReady?: boolean;
		watermark: { thisWeek: number | null; lastWeek: number | null; tiers: WatermarkTier[] };
		variant?: 'rail' | 'header';
	} = $props();

	// ─── Draft-in-flight ─────────────────────────────────────────────
	// The strongest signal that the org is mid-loop: an unfinished authored
	// action. Read client-side from templateDraftStore (localStorage). null
	// until mounted so SSR renders the bare authoring center.
	let draft = $state<{ id: string; title: string; step: string } | null>(null);

	onMount(() => {
		try {
			const ids = templateDraftStore.getAllDraftIds();
			let newest: { id: string; lastSaved: number } | null = null;
			for (const id of ids) {
				const d = templateDraftStore.getDraft(id);
				if (d && (!newest || d.lastSaved > newest.lastSaved)) {
					newest = { id, lastSaved: d.lastSaved };
				}
			}
			if (newest) {
				const d = templateDraftStore.getDraft(newest.id);
				if (d) {
					const title =
						d.data?.objective?.title?.trim() ||
						d.data?.objective?.rawInput?.trim() ||
						'Untitled action';
					draft = {
						id: newest.id,
						title: title.length > 48 ? title.slice(0, 47) + '…' : title,
						step: d.currentStep
					};
				}
			}
		} catch {
			// localStorage unavailable or malformed — no draft surfaced.
			draft = null;
		}
	});

	const currentPath = $derived($page.url.pathname);
	const base = $derived(`/org/${org.slug}`);

	// The command opens the org-scoped STUDIO interior, the authoring loop with
	// the agent's reasoning visible. The public citizen entry at `/?create=true`
	// stays intact and reachable from inside STUDIO.
	const composeHref = $derived(`${base}/studio`);

	// Draft-in-flight stays bound to the public authoring entry: drafts live in
	// templateDraftStore (the citizen flow's localStorage), and resumption uses
	// the `?resumeDraft=` + sessionStorage OAuth contract that only `/` honors.
	const resumeHref = $derived(
		draft ? `/?create=true&resumeDraft=${encodeURIComponent(draft.id)}` : '/?create=true'
	);

	const STEP_LABEL: Record<string, string> = {
		objective: 'Intent',
		audience: 'Resolve',
		content: 'Author'
	};

	// The one plain-language sentence shown when the authoring runtime is held.
	// Sourced from the shared limit-sentence module so the copy cannot drift
	// from the server readiness probe that enforces it.
	const authoringHeldSentence = orgLimitSentence('authoring_runtime');
</script>

{#snippet composeButton()}
	{#if authoringReady}
		<a class="mantle-compose" href={composeHref} data-sveltekit-preload-data="off">
			<PenLine class="mantle-compose-icon" aria-hidden="true" />
			<span class="mantle-compose-label">Start authoring</span>
		</a>
	{:else}
		<span
			class="mantle-compose mantle-compose--held"
			role="link"
			aria-disabled="true"
			title={authoringHeldSentence}
			aria-label="Start authoring. {authoringHeldSentence}"
		>
			<PenLine class="mantle-compose-icon" aria-hidden="true" />
			<span class="mantle-compose-label">Start authoring</span>
		</span>
	{/if}
{/snippet}

{#snippet identityMark()}
	<a class="mantle-org" href="/org/{org.slug}">
		{#if org.avatar}
			<img src={org.avatar} alt="" class="mantle-avatar" />
		{:else}
			<span class="mantle-avatar mantle-avatar--mono">{org.name.charAt(0).toUpperCase()}</span>
		{/if}
		<span class="mantle-org-text">
			<span class="mantle-org-name">{org.name}</span>
			<span class="mantle-org-role">{role}</span>
		</span>
	</a>
{/snippet}

<div
	class="mantle mantle--{variant}"
	style="--timing-normal: {TIMING.NORMAL}ms; --timing-slow: {TIMING.SLOW}ms; --easing: {EASING};"
>
	{#if variant === 'rail'}
		<!-- ─── Desktop rail: full vertical instrument ─── -->
		<div class="mantle-identity">
			{@render identityMark()}
		</div>

		<!-- Strong center: authoring command + draft-in-flight -->
		<div class="mantle-center">
			{@render composeButton()}
			{#if draft}
				<a class="mantle-draft" href={resumeHref} data-sveltekit-preload-data="off">
					<span class="mantle-draft-head">
						<span class="mantle-draft-tag">Draft in flight</span>
						<span class="mantle-draft-step">{STEP_LABEL[draft.step] ?? draft.step}</span>
					</span>
					<span class="mantle-draft-title">{draft.title}</span>
				</a>
			{/if}
		</div>

		<!-- Ambient watermark — verification as signal-weight, not headline -->
		<div class="mantle-watermark">
			<MantleWatermark
				thisWeek={watermark.thisWeek}
				lastWeek={watermark.lastWeek}
				tiers={watermark.tiers}
			/>
		</div>

		<!-- Workspace switcher: Studio / People / Power / Results -->
		<div class="mantle-workspaces">
			<WorkspaceSwitcher {marks} {base} orientation="vertical" />
		</div>

		<!-- Process center — live authoring processes, visible from any space.
		     The multitasking tell: a running process persists here while the
		     operator works elsewhere. Renders nothing when the registry is idle. -->
		<div class="mantle-processes">
			<ProcessDock />
		</div>

		<!-- Substrate — plain nav links, ambient, not a workspace -->
		<div class="mantle-substrate">
			<span class="mantle-substrate-label">Substrate</span>
			<nav class="mantle-substrate-links" aria-label="Substrate">
				{#each substrateLinks as link (link.href)}
					<a
						href={link.href}
						class="mantle-substrate-link"
						class:mantle-substrate-link--active={currentPath.startsWith(link.href)}
						aria-current={currentPath.startsWith(link.href) ? 'page' : undefined}
					>
						{link.label}
					</a>
				{/each}
			</nav>
			<div class="mantle-registry">
				<RegistryMark
					variant="tag"
					value="Sepolia testnet"
					copy={false}
					class="mantle-registry-mark"
				/>
			</div>
		</div>

		<!-- Right-edge well + cmd-K live at the rail foot on desktop -->
		<div class="mantle-foot">
			<SignalWell events={signalEvents} />
			<CommandBar />
			<a class="mantle-back" href="/">
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					aria-hidden="true"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
					/>
				</svg>
				Back to commons.email
			</a>
		</div>
	{:else}
		<!-- ─── Mobile header: same instrument, reduced density ─── -->
		<div class="mantle-header-row">
			{@render identityMark()}
			<div class="mantle-header-right">
				<span class="mantle-watermark mantle-watermark--inline">
					<MantleWatermark
						thisWeek={watermark.thisWeek}
						lastWeek={watermark.lastWeek}
						tiers={watermark.tiers}
					/>
				</span>
				<CommandBar />
			</div>
		</div>

		<div class="mantle-header-row mantle-header-row--actions">
			{@render composeButton()}
			{#if draft}
				<a
					class="mantle-draft mantle-draft--inline"
					href={resumeHref}
					data-sveltekit-preload-data="off"
				>
					<span class="mantle-draft-tag">Draft</span>
					<span class="mantle-draft-title">{draft.title}</span>
				</a>
			{/if}
		</div>

		<WorkspaceSwitcher {marks} {base} orientation="horizontal" />
	{/if}
</div>

<style>
	.mantle {
		display: flex;
		flex-direction: column;
		background: var(--org-sidebar-bg);
		color: var(--org-sidebar-text);
	}

	.mantle--rail {
		width: 15rem;
		min-height: 100vh;
		border-right: 1px solid var(--org-sidebar-border);
		padding: 1.25rem 0.875rem;
		gap: 1.25rem;
	}

	.mantle--header {
		width: 100%;
		border-bottom: 1px solid var(--org-sidebar-border);
		padding: 0.625rem 1rem 0;
		gap: 0.625rem;
	}

	/* ─── Mobile header rows ─── */
	.mantle-header-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.mantle-header-row--actions {
		gap: 0.5rem;
	}

	.mantle-header-right {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		flex-shrink: 0;
	}

	.mantle--header .mantle-compose {
		flex: 0 0 auto;
		padding: 0.5rem 0.75rem;
		font-size: 0.875rem;
	}

	.mantle-draft--inline {
		flex: 1 1 auto;
		flex-direction: row;
		align-items: baseline;
		gap: 0.5rem;
		padding: 0.5rem 0.625rem;
		min-width: 0;
	}

	/* ─── Identity ─── */
	.mantle-identity {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.mantle-org {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		text-decoration: none;
		color: inherit;
		min-width: 0;
	}

	.mantle-avatar {
		width: 2rem;
		height: 2rem;
		border-radius: 8px;
		flex-shrink: 0;
		object-fit: cover;
	}

	.mantle-avatar--mono {
		display: flex;
		align-items: center;
		justify-content: center;
		background: oklch(0.6 0.14 175 / 0.18);
		color: var(--coord-route-solid);
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-weight: 600;
		font-size: 0.875rem;
	}

	.mantle-org-text {
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
		min-width: 0;
	}

	.mantle-org-name {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--org-sidebar-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.mantle-org-role {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
		font-size: 0.625rem;
		color: var(--org-sidebar-text-dim);
	}

	/* ─── Authoring command (strong center) ─── */
	.mantle-center {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.mantle-compose {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.75rem 0.875rem;
		border: 1px solid var(--org-sidebar-border);
		border-left: 3px solid var(--coord-verified, #10b981);
		border-radius: 8px;
		background: var(--coord-route-solid);
		color: var(--org-sidebar-bg);
		text-decoration: none;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.9375rem;
		font-weight: 700;
		letter-spacing: 0;
		transition:
			border-color var(--timing-normal) var(--easing),
			filter var(--timing-normal) var(--easing),
			transform var(--timing-normal) var(--easing);
	}

	/* Held: the runtime is not ready — same command, visibly dormant. The
	   plain-language sentence rides on title/aria-label. */
	.mantle-compose--held {
		border-left-color: oklch(0.56 0.1 25);
		border-left-style: dashed;
		background: transparent;
		color: var(--org-sidebar-text-muted);
		cursor: default;
	}

	a.mantle-compose:hover,
	a.mantle-compose:focus-visible {
		border-color: var(--coord-route-solid);
		filter: brightness(1.06);
		outline: none;
	}

	.mantle-compose :global(.mantle-compose-icon) {
		width: 1.125rem;
		height: 1.125rem;
		flex: 0 0 auto;
	}

	.mantle-compose-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mantle-draft {
		display: flex;
		flex-direction: column;
		gap: 0.1875rem;
		padding: 0.625rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--org-sidebar-border);
		text-decoration: none;
		color: inherit;
		transition: border-color var(--timing-normal) var(--easing);
	}

	.mantle-draft:hover,
	.mantle-draft:focus-visible {
		border-color: var(--coord-route-solid);
		outline: none;
	}

	.mantle-draft-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.mantle-draft-tag {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.625rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--org-sidebar-text-muted);
	}

	.mantle-draft-step {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5625rem;
		letter-spacing: 0.02em;
		color: var(--coord-route-solid);
	}

	.mantle-draft-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		color: var(--org-sidebar-text);
		/* In the inline (mobile header) variant the title is a row-flex child;
		   without min-width: 0 it refuses to shrink and long titles hard-clip
		   instead of ellipsizing. Harmless in the column-flex rail variant. */
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* ─── Watermark ─── */
	.mantle-watermark {
		padding: 0 0.25rem;
	}

	/* Inline (mobile header): collapse to Rings + count only, drop the label
	   line and the pulse so the watermark stays a faint mark, not a row. */
	.mantle-watermark--inline {
		display: inline-flex;
		padding: 0;
	}
	.mantle-watermark--inline :global(.watermark-label),
	.mantle-watermark--inline :global(.watermark-pulse) {
		display: none;
	}

	/* ─── Workspaces ─── */
	.mantle-workspaces {
		flex: 1 1 auto;
	}

	/* ─── Process center ─── */
	.mantle-processes:empty {
		display: none;
	}

	/* ─── Substrate band ─── */
	.mantle-substrate {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding-top: 0.875rem;
		border-top: 1px solid var(--org-sidebar-border);
	}

	.mantle-substrate-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.625rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--org-sidebar-text-muted);
	}

	.mantle-substrate-links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.875rem;
	}

	.mantle-substrate-link {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		color: var(--org-sidebar-text-dim);
		text-decoration: none;
		transition: color var(--timing-normal) var(--easing);
	}

	.mantle-substrate-link:hover,
	.mantle-substrate-link:focus-visible {
		color: var(--org-sidebar-text);
		outline: none;
	}

	.mantle-substrate-link--active {
		color: var(--org-sidebar-text);
	}

	.mantle-registry {
		opacity: 0.6;
	}

	.mantle :global(.mantle-registry-mark) {
		font-size: 0.625rem;
		color: var(--org-sidebar-text-dim);
	}

	/* ─── Foot (rail only) ─── */
	.mantle-foot {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		padding-top: 0.875rem;
		border-top: 1px solid var(--org-sidebar-border);
	}

	.mantle-back {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		color: var(--org-sidebar-text-dim);
		text-decoration: none;
		transition: color var(--timing-normal) var(--easing);
	}
	.mantle-back:hover,
	.mantle-back:focus-visible {
		color: var(--org-sidebar-text-muted);
		outline: none;
	}
	.mantle-back svg {
		width: 0.875rem;
		height: 0.875rem;
	}
</style>
