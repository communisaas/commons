<!--
  OrgMantle — the persistent authoring-first frame.

  Replaces the fixed 13-link sidebar. The org runs ONE loop —
  INTENT → GROUND → AUTHOR → RESOLVE → SEND → AGGREGATE — and the Mantle is
  the instrument that holds it. Verification is the WATERMARK on the work,
  never the headline.

  Anatomy:
    · Org identity (mark + name + role)
    · Strong center: state-bound authoring command + draft-in-flight
    · Ambient WATERMARK (faint Rings + Datum "authored & sent this period" + Pulse)
    · 4-mark WorkspaceSwitcher (Studio / People / Power / Results)
    · Substrate (authority / API / webhooks / coalition / RegistryMark) —
      ambient, not a workspace
    · Right edge: SignalWell + CommandBar (cmd-K)

  The authoring command targets the org-scoped STUDIO interior (`/org/[slug]/studio`) — the
  authoring loop with the agent's reasoning visible as the strong center. The
  public citizen entry (`/?create=true`, TemplateCreator) remains intact and is
  reachable from inside STUDIO. Draft-in-flight is read from templateDraftStore
  client-side and resumed via the public `?resumeDraft=…` contract.

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
	import { Datum, Ratio, RegistryMark } from '$lib/design';
	import { TIMING, EASING } from '$lib/design/motion';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel,
		operatorCapabilityStateRatioSegments
	} from '$lib/data/capability-state-labels';
	import type { StudioAuthoringReadinessSummary } from '$lib/data/capability-hypergraph';
	import WorkspaceSwitcher, { type WorkspaceMark } from './WorkspaceSwitcher.svelte';
	import MantleWatermark, { type WatermarkTier } from './MantleWatermark.svelte';
	import SignalWell from './SignalWell.svelte';
	import CommandBar from './CommandBar.svelte';
	import ProcessDock from './os/ProcessDock.svelte';

	type OperatingGroundCapabilityState = 'live' | 'partial' | 'gated' | 'testnet';
	type CapabilityPostureState = WorkspaceMark['state'] | OperatingGroundCapabilityState;
	type CapabilityPostureCopy = Partial<Record<CapabilityPostureState, string>>;
	type CapabilityPostureGate = Partial<Record<CapabilityPostureState, string>>;
	type CapabilityPostureSignal = Partial<Record<CapabilityPostureState, string>>;
	type OperatingGroundCapability = {
		label: string;
		value: string;
		state: OperatingGroundCapabilityState;
		action: string;
		gate: string;
		gateSignal?: string;
		href?: string;
	};
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
		operatingGroundCapabilities = [],
		posturePressureCopy = {},
		posturePressureGate = {},
		posturePressureSignal = {},
		studioAuthoringReadiness = null,
		watermark,
		variant = 'rail'
	}: {
		org: { name: string; slug: string; avatar?: string | null };
		role: string;
		marks: WorkspaceMark[];
		substrateLinks: { href: string; label: string; latent?: boolean }[];
		signalEvents?: OrgSignal[] | null;
		operatingGroundCapabilities?: OperatingGroundCapability[];
		posturePressureCopy?: CapabilityPostureCopy;
		posturePressureGate?: CapabilityPostureGate;
		posturePressureSignal?: CapabilityPostureSignal;
		studioAuthoringReadiness?: StudioAuthoringReadinessSummary | null;
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

	const capabilityMapHref = $derived(`${base}/canvas`);
	const capabilityLoopHref = $derived(`${base}/studio#capability-loop`);
	const sendReadinessHref = $derived(`${base}/studio#capability-send`);
	const gateRegisterHref = $derived(`${base}/studio#capability-gates`);
	const authoringRuntimeReady = $derived(studioAuthoringReadiness?.runtimeReady === true);
	const authoringCommandState = $derived<WorkspaceMark['state']>(
		!studioAuthoringReadiness
			? 'gated'
			: authoringRuntimeReady
				? studioAuthoringReadiness.state
				: 'gated'
	);
	const authoringCommandLabel = $derived(
		authoringRuntimeReady ? 'Start authoring' : 'Authoring boundary'
	);
	const authoringCommandSignal = $derived(
		studioAuthoringReadiness?.signal ?? 'authoring readiness uncounted'
	);
	const authoringCommandBoundaryCount = $derived(studioAuthoringReadiness?.boundaryCount ?? null);
	const authoringCommandAction = $derived(
		operatorCapabilityActionLabel(
			authoringCommandState,
			authoringRuntimeReady ? 'open Studio intent' : 'context / read authoring boundary',
			{ appendReadyArrow: true }
		)
	);
	const authoringCommandGate = $derived(
		studioAuthoringReadiness?.gate ?? 'Authoring runtime readiness has not loaded.'
	);
	const authoringCommandTitle = $derived(
		`${studioAuthoringReadiness?.effect ?? 'Studio authoring readiness is uncounted.'} ${authoringCommandGate}`
	);
	const authoringCommandAriaLabel = $derived(
		`${authoringCommandLabel}. ${operatorCapabilityStateLabel(authoringCommandState)}. ${authoringCommandSignal}. ${authoringCommandBoundaryCount ?? 'Uncounted'} authoring boundaries. ${authoringCommandAction}. ${authoringCommandGate}`
	);

	const postureStates = $derived<CapabilityPostureState[]>([
		...marks.map((mark) => mark.state),
		...operatingGroundCapabilities.map((item) => item.state)
	]);
	const postureCounts = $derived({
		live: postureStates.filter((state) => state === 'live').length,
		partial: postureStates.filter((state) => state === 'partial').length,
		'draft-only': postureStates.filter((state) => state === 'draft-only').length,
		gated: postureStates.filter((state) => state === 'gated').length,
		testnet: postureStates.filter((state) => state === 'testnet').length
	});
	const postureTotal = $derived(postureStates.length);
	const postureSegments = $derived(
		operatorCapabilityStateRatioSegments(postureCounts, {
			includeTestnet: true,
			colors: {
				'draft-only': 'oklch(0.72 0.14 65)',
				gated: 'oklch(0.56 0.1 25)'
			}
		})
	);
	const posturePressureState = $derived<CapabilityPostureState>(
		postureCounts.gated > 0
			? 'gated'
			: postureCounts.testnet > 0
				? 'testnet'
				: postureCounts['draft-only'] > 0
					? 'draft-only'
					: postureCounts.partial > 0
						? 'partial'
						: 'live'
	);
	const posturePressureHref = $derived(
		posturePressureState === 'gated' || posturePressureState === 'testnet'
			? gateRegisterHref
			: posturePressureState === 'draft-only'
				? sendReadinessHref
				: capabilityLoopHref
	);
	const posturePressureAction = $derived(
		posturePressureState === 'gated' || posturePressureState === 'testnet'
			? 'context / read gate register'
			: posturePressureState === 'draft-only'
				? 'draft / read send readiness'
				: 'open capability loop ->'
	);
	const defaultPosturePressureCopy: Record<CapabilityPostureState, string> = {
		live: 'All visible surfaces are armed from current state.',
		partial: 'Bounded surfaces are usable, with named trust or scope limits.',
		'draft-only': 'Draft-only execution paths route to Send readiness.',
		gated: 'Dependency-first surfaces route to the gate register.',
		testnet: 'Testnet-bound surfaces route to the gate register.'
	};
	const defaultPosturePressureGate: Record<CapabilityPostureState, string> = {
		live: 'No unresolved visible-surface gate.',
		partial: 'Read bounded scope limits in the capability loop.',
		'draft-only': 'Read the first held send mode in Send readiness.',
		gated: 'Read the load-bearing gate in the gate register.',
		testnet: 'Read the mainnet registry gate.'
	};
	const activePosturePressureCopy = $derived(
		posturePressureCopy[posturePressureState] ?? defaultPosturePressureCopy[posturePressureState]
	);
	const activePosturePressureGate = $derived(
		posturePressureGate[posturePressureState] ?? defaultPosturePressureGate[posturePressureState]
	);
	function defaultPosturePressureSignalFor(state: CapabilityPostureState): string {
		if (state === 'live') return 'all visible surfaces';
		if (state === 'partial') return `${postureCounts.partial} bounded`;
		if (state === 'draft-only') return `${postureCounts['draft-only']} held`;
		if (state === 'testnet') return `${postureCounts.testnet} testnet`;
		return `${postureCounts.gated + postureCounts.testnet} held`;
	}
	const activePosturePressureSignal = $derived(
		posturePressureSignal[posturePressureState] ??
			defaultPosturePressureSignalFor(posturePressureState)
	);
	const posturePressureAriaLabel = $derived(
		`Capability posture: ${operatorCapabilityStateLabel(posturePressureState)}. ${activePosturePressureSignal}. ${posturePressureAction}. ${activePosturePressureCopy}. Next unlock: ${activePosturePressureGate}`
	);

	function operatingGroundActionLabel(item: OperatingGroundCapability): string {
		const action = item.action.trim();
		if (!action) {
			return operatorCapabilityActionLabel(
				item.state,
				item.state === 'gated' || item.state === 'testnet'
					? 'read substrate gate'
					: 'open substrate',
				{ appendReadyArrow: true }
			);
		}
		return operatorCapabilityActionLabel(item.state, action, {
			appendReadyArrow: Boolean(item.href)
		});
	}

	function operatingGroundAriaLabel(item: OperatingGroundCapability): string {
		return `${item.label}: ${item.value}. ${operatorCapabilityStateLabel(item.state)}. ${operatingGroundActionLabel(item)}. ${item.gate}`;
	}

	function operatingGroundGateSignal(item: OperatingGroundCapability): string {
		return item.gateSignal ?? operatorCapabilityStateLabel(item.state);
	}
</script>

{#snippet composeButton()}
	<a
		class="mantle-compose"
		href={composeHref}
		data-state={authoringCommandState}
		aria-label={authoringCommandAriaLabel}
		title={authoringCommandTitle}
		data-sveltekit-preload-data="off"
	>
		<span class="mantle-compose-primary">
			<PenLine class="mantle-compose-icon" aria-hidden="true" />
			<span class="mantle-compose-label">{authoringCommandLabel}</span>
			<span class="mantle-compose-state">{operatorCapabilityStateLabel(authoringCommandState)}</span
			>
		</span>
		<span class="mantle-compose-contract" aria-hidden="true">
			<span class="mantle-compose-axis">signal</span>
			<span class="mantle-compose-value">{authoringCommandSignal}</span>
			<span class="mantle-compose-axis">boundaries</span>
			<span class="mantle-compose-value mantle-compose-value--number">
				<Datum
					value={authoringCommandBoundaryCount}
					cite="buildStudioAuthoringReadiness boundaryCount"
				/>
			</span>
			<span class="mantle-compose-axis">action</span>
			<span class="mantle-compose-value mantle-compose-value--action">{authoringCommandAction}</span
			>
		</span>
	</a>
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

		<!-- Strong center: state-bound authoring command + draft-in-flight -->
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

		<div class="mantle-posture" aria-label="Capability posture across visible Commons surfaces">
			<div class="mantle-posture-head">
				<span class="mantle-posture-title">Capability posture</span>
				<a
					class="mantle-posture-map"
					href={capabilityMapHref}
					aria-label="Open capability map"
					data-sveltekit-preload-data="off"
				>
					Capability map
				</a>
			</div>
			<div class="mantle-posture-ratio" aria-label="Visible capability state mix">
				<Ratio segments={postureSegments} height={8} />
			</div>
			<div
				class="mantle-posture-counts"
				role="group"
				aria-label="{postureTotal} visible capability surfaces"
			>
				<span>
					<Datum value={postureCounts.live} class="mantle-posture-datum" />
					{operatorCapabilityStateLabel('live')}
				</span>
				<span>
					<Datum value={postureCounts.partial} class="mantle-posture-datum" />
					{operatorCapabilityStateLabel('partial')}
				</span>
				<span>
					<Datum value={postureCounts['draft-only']} class="mantle-posture-datum" />
					{operatorCapabilityStateLabel('draft-only')}
				</span>
				<span>
					<Datum value={postureCounts.gated + postureCounts.testnet} class="mantle-posture-datum" />
					{operatorCapabilityStateLabel('gated')}
				</span>
			</div>
			<a
				class="mantle-posture-pressure"
				href={posturePressureHref}
				data-state={posturePressureState}
				aria-label={posturePressureAriaLabel}
				title="{activePosturePressureCopy} Next unlock: {activePosturePressureGate}"
				data-sveltekit-preload-data="off"
			>
				<span class="mantle-posture-pressure-top">
					<span class="mantle-posture-action">{posturePressureAction}</span>
					<span class="mantle-posture-signal"
						>{operatorCapabilityStateLabel(posturePressureState)}</span
					>
				</span>
				<span class="mantle-posture-unlock">
					<span class="mantle-posture-unlock-label">next unlock</span>
					<span>{activePosturePressureSignal}</span>
				</span>
			</a>
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

		<!-- Substrate — ambient, not a workspace -->
		<div class="mantle-substrate">
			<span class="mantle-substrate-label">Substrate</span>
			{#if operatingGroundCapabilities.length > 0}
				<ul class="mantle-substrate-capabilities" aria-label="Substrate status">
					{#each operatingGroundCapabilities as item (`${item.label}-${item.value}`)}
						<li class="mantle-substrate-row">
							{#if item.href}
								<a
									href={item.href}
									class="mantle-substrate-capability"
									aria-label={operatingGroundAriaLabel(item)}
									title={item.gate}
								>
									<span
										class="mantle-substrate-state mantle-substrate-state--{item.state}"
										aria-hidden="true"
									></span>
									<span class="mantle-substrate-name">{item.label}</span>
									<span class="mantle-substrate-state-label"
										>{operatorCapabilityStateLabel(item.state)}</span
									>
									<span class="mantle-substrate-value">{item.value}</span>
									<span class="mantle-substrate-action">{operatingGroundActionLabel(item)}</span>
									<span class="mantle-substrate-gate">{operatingGroundGateSignal(item)}</span>
								</a>
							{:else}
								<span
									class="mantle-substrate-capability"
									aria-label={operatingGroundAriaLabel(item)}
									title={item.gate}
								>
									<span
										class="mantle-substrate-state mantle-substrate-state--{item.state}"
										aria-hidden="true"
									></span>
									<span class="mantle-substrate-name">{item.label}</span>
									<span class="mantle-substrate-state-label"
										>{operatorCapabilityStateLabel(item.state)}</span
									>
									<span class="mantle-substrate-value">{item.value}</span>
									<span class="mantle-substrate-action">{operatingGroundActionLabel(item)}</span>
									<span class="mantle-substrate-gate">{operatingGroundGateSignal(item)}</span>
								</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
			<nav class="mantle-substrate-links" aria-label="Substrate handoffs">
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

	.mantle--header .mantle-compose-contract {
		display: none;
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

	/* ─── State-bound authoring command (strong center) ─── */
	.mantle-center {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.mantle-compose {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		justify-content: center;
		gap: 0.625rem;
		padding: 0.75rem 0.875rem;
		border: 1px solid var(--org-sidebar-border);
		border-left: 3px solid var(--coord-route-solid);
		border-radius: 8px;
		background: oklch(0.33 0.03 230 / 0.72);
		color: var(--org-sidebar-text);
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

	.mantle-compose[data-state='live'] {
		border-left-color: var(--coord-verified, #10b981);
		background: var(--coord-route-solid);
		color: var(--org-sidebar-bg);
	}

	.mantle-compose[data-state='partial'] {
		border-left-color: var(--coord-route-solid);
	}

	.mantle-compose[data-state='draft-only'] {
		border-left-color: oklch(0.72 0.14 65);
		border-left-style: dashed;
	}

	.mantle-compose[data-state='gated'] {
		border-left-color: oklch(0.56 0.1 25);
		border-left-style: dashed;
		background: transparent;
		color: var(--org-sidebar-text);
	}

	.mantle-compose:hover,
	.mantle-compose:focus-visible {
		border-color: var(--coord-route-solid);
		filter: brightness(1.06);
		outline: none;
	}

	.mantle-compose-primary {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.mantle-compose-icon {
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

	.mantle-compose-state {
		flex: 0 0 auto;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5625rem;
		font-weight: 700;
		color: currentColor;
		opacity: 0.72;
	}

	.mantle-compose-contract {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.1875rem 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid currentColor;
		font-weight: 500;
		color: currentColor;
		opacity: 0.78;
	}

	.mantle-compose-axis,
	.mantle-compose-value {
		min-width: 0;
		font-size: 0.625rem;
		line-height: 1.25;
	}

	.mantle-compose-axis {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-weight: 700;
	}

	.mantle-compose-value {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mantle-compose-value--number,
	.mantle-compose-value--action {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-weight: 700;
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

	/* ─── Capability posture ─── */
	.mantle-posture {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem 0.25rem 0.875rem;
		border-top: 1px solid var(--org-sidebar-border);
		border-bottom: 1px solid var(--org-sidebar-border);
	}

	.mantle-posture-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.mantle-posture-title,
	.mantle-posture-map,
	.mantle-posture-action {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.mantle-posture-title {
		color: var(--org-sidebar-text-muted);
	}

	.mantle-posture-map {
		color: var(--org-sidebar-text-dim);
		text-decoration: none;
		transition: color var(--timing-normal) var(--easing);
	}

	.mantle-posture-map:hover,
	.mantle-posture-map:focus-visible {
		color: var(--coord-route-solid);
		outline: none;
	}

	.mantle-posture-ratio {
		width: 100%;
	}

	.mantle-posture-counts {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.25rem 0.5rem;
	}

	.mantle-posture-counts span {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
		min-width: 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		color: var(--org-sidebar-text-dim);
	}

	.mantle-posture-counts :global(.mantle-posture-datum) {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-weight: 700;
		color: var(--org-sidebar-text);
	}

	.mantle-posture-pressure {
		display: flex;
		flex-direction: column;
		gap: 0.3125rem;
		padding-left: 0.625rem;
		border-left: 2px solid var(--coord-route-solid);
		color: inherit;
		text-decoration: none;
		transition:
			border-color var(--timing-normal) var(--easing),
			color var(--timing-normal) var(--easing);
	}

	.mantle-posture-pressure[data-state='draft-only'],
	.mantle-posture-pressure[data-state='gated'],
	.mantle-posture-pressure[data-state='testnet'] {
		border-left-style: dashed;
	}

	.mantle-posture-pressure[data-state='live'] {
		border-left-color: var(--coord-verified, #10b981);
	}

	.mantle-posture-pressure[data-state='partial'] {
		border-left-color: var(--coord-route-solid, #3bc4b8);
	}

	.mantle-posture-pressure[data-state='draft-only'] {
		border-left-color: oklch(0.72 0.14 65);
	}

	.mantle-posture-pressure[data-state='gated'] {
		border-left-color: oklch(0.56 0.1 25);
	}

	.mantle-posture-pressure[data-state='testnet'] {
		border-left-color: oklch(0.65 0.1 245);
	}

	.mantle-posture-pressure:hover,
	.mantle-posture-pressure:focus-visible {
		color: var(--org-sidebar-text);
		outline: none;
	}

	.mantle-posture-action {
		min-width: 0;
		color: var(--org-sidebar-text-muted);
		text-transform: none;
		letter-spacing: 0;
	}

	.mantle-posture-pressure-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		min-width: 0;
	}

	.mantle-posture-signal {
		flex: 0 0 auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		color: var(--org-sidebar-text);
	}

	.mantle-posture-unlock {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.35rem;
		min-width: 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		line-height: 1.35;
		color: var(--org-sidebar-text-dim);
	}

	.mantle-posture-unlock-label {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5625rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--org-sidebar-text-muted);
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

	.mantle-substrate-capabilities {
		display: flex;
		flex-direction: column;
		gap: 0.3125rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.mantle-substrate-row {
		min-width: 0;
	}

	.mantle-substrate-capability {
		display: grid;
		grid-template-columns: 0.5rem minmax(0, 1fr) auto;
		grid-template-areas:
			'dot name state'
			'. value value'
			'. action gate';
		align-items: start;
		gap: 0.1875rem 0.375rem;
		min-width: 0;
		color: inherit;
		text-decoration: none;
	}

	a.mantle-substrate-capability {
		transition: color var(--timing-normal) var(--easing);
	}

	a.mantle-substrate-capability:hover,
	a.mantle-substrate-capability:focus-visible {
		color: var(--org-sidebar-text);
		outline: none;
	}

	.mantle-substrate-state {
		grid-area: dot;
		margin-top: 0.1875rem;
		width: 0.4375rem;
		height: 0.4375rem;
		border-radius: 4px;
		background: var(--org-sidebar-text-dim);
		box-shadow: 0 0 0 1px oklch(1 0 0 / 0.08);
	}

	.mantle-substrate-state--live {
		background: var(--coord-route-solid);
	}

	.mantle-substrate-state--partial {
		background: oklch(0.72 0.14 65);
	}

	.mantle-substrate-state--gated {
		background: oklch(0.56 0.1 25);
	}

	.mantle-substrate-state--testnet {
		background: oklch(0.65 0.1 245);
	}

	.mantle-substrate-name,
	.mantle-substrate-state-label,
	.mantle-substrate-value,
	.mantle-substrate-action,
	.mantle-substrate-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		line-height: 1.25;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.mantle-substrate-name {
		grid-area: name;
		color: var(--org-sidebar-text-dim);
		white-space: nowrap;
	}

	.mantle-substrate-state-label {
		grid-area: state;
		max-width: 5.5rem;
		color: var(--org-sidebar-text-muted);
		text-align: right;
		white-space: nowrap;
	}

	.mantle-substrate-value {
		grid-area: value;
		color: var(--org-sidebar-text);
		white-space: nowrap;
	}

	.mantle-substrate-action {
		grid-area: action;
		color: var(--coord-route-solid);
		white-space: nowrap;
	}

	.mantle-substrate-gate {
		grid-area: gate;
		justify-self: end;
		max-width: 6rem;
		color: var(--org-sidebar-text-muted);
		font-size: 0.625rem;
		text-align: right;
		white-space: nowrap;
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
