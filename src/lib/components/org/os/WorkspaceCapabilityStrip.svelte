<!--
  WorkspaceCapabilityStrip — compact capability status inside a workspace.

  This is not the full capability map. It is the local instrument readout:
  what this workspace can do now, what is bounded/not armed, and where to go next.
  Numbers are optional and must be loaded from the workspace's existing slice.
-->
<script lang="ts">
	import { Datum, Ratio } from '$lib/design';
	import { SPRINGS } from '$lib/design/motion';
	import { formatCapabilityClusters } from '$lib/data/capability-clusters';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel,
		operatorCapabilityStateRatioSegments,
		operatorCapabilityStateVerbLabel
	} from '$lib/data/capability-state-labels';

	type CapabilityState = 'live' | 'partial' | 'draft-only' | 'gated';

	type WorkspaceCapabilityItem = {
		label: string;
		state: CapabilityState;
		phase: string;
		cluster: string;
		action: string;
		handoff?: string;
		detail: string;
		unlock: string;
		href: string;
		metric?: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type StateContract = {
		state: CapabilityState;
		label: string;
		count: number;
		verb: string;
		meaning: string;
	};

	let {
		label = 'Capability status',
		items
	}: {
		label?: string;
		items: WorkspaceCapabilityItem[];
	} = $props();

	const stateCounts = $derived({
		live: items.filter((item) => item.state === 'live').length,
		partial: items.filter((item) => item.state === 'partial').length,
		'draft-only': items.filter((item) => item.state === 'draft-only').length,
		gated: items.filter((item) => item.state === 'gated').length
	});
	const itemCount = $derived(items.length);
	const heldContractCount = $derived(stateCounts['draft-only'] + stateCounts.gated);

	const stateSegments = $derived(operatorCapabilityStateRatioSegments(stateCounts));
	const stateContracts = $derived<StateContract[]>([
		{
			state: 'live',
			label: stateLabel('live'),
			count: stateCounts.live,
			verb: stateVerbLabel('live'),
			meaning: 'armed output or computed result exists here'
		},
		{
			state: 'partial',
			label: stateLabel('partial'),
			count: stateCounts.partial,
			verb: stateVerbLabel('partial'),
			meaning: 'usable with a named trust, scope, or ops limit'
		},
		{
			state: 'draft-only',
			label: stateLabel('draft-only'),
			count: stateCounts['draft-only'],
			verb: stateVerbLabel('draft-only'),
			meaning: 'shape or save work without side effects'
		},
		{
			state: 'gated',
			label: stateLabel('gated'),
			count: stateCounts.gated,
			verb: stateVerbLabel('gated'),
			meaning: 'dependency first; route gives context, not execution'
		}
	]);
	const pressureItem = $derived(
		items.find((item) => item.state === 'gated') ??
			items.find((item) => item.state === 'draft-only') ??
			items.find((item) => item.state === 'partial') ??
			items[0] ??
			null
	);

	function stateLabel(state: CapabilityState): string {
		return operatorCapabilityStateLabel(state);
	}

	function stateVerbLabel(state: CapabilityState): string {
		return operatorCapabilityStateVerbLabel(state);
	}

	function actionLabel(item: WorkspaceCapabilityItem): string {
		return operatorCapabilityActionLabel(item.state, item.action, { appendReadyArrow: true });
	}

	function pressureLabel(item: WorkspaceCapabilityItem | null): string {
		if (!item) return 'No local capability rows loaded.';
		if (item.state === 'live') return 'All visible local rows are armed from loaded data.';
		if (item.state === 'partial') return `${item.label}: usable, with a named boundary.`;
		if (item.state === 'draft-only') return `${item.label}: draft only until its gate clears.`;
		return `${item.label}: not armed; dependency first before execution.`;
	}

	function itemAria(item: WorkspaceCapabilityItem): string {
		const metric =
			item.metric && item.metric.value !== null
				? `${item.metric.value.toLocaleString('en-US')} ${item.metric.label}. `
				: '';
		const handoff = item.handoff ? `Handoff: ${item.handoff}. ` : '';
		return `${item.label}. ${stateLabel(item.state)}. Claim grammar: ${stateVerbLabel(item.state)}. ${metric}${handoff}${item.detail} Gate: ${item.unlock}`;
	}
</script>

<section class="cap-strip" aria-label={label}>
	<div class="strip-head">
		<div class="strip-head-copy">
			<span class="strip-title">{label}</span>
			<span
				class="strip-count"
				aria-label={`${itemCount} local capability contracts; ${stateCounts.live} armed; ${stateCounts.partial} bounded; ${heldContractCount} held`}
			>
				<span class="strip-count-total">
					<Datum value={itemCount} cite="WorkspaceCapabilityStrip local rows" />
					<span>contracts</span>
				</span>
				<span class="strip-count-split">
					<Datum value={stateCounts.live} cite="WorkspaceCapabilityStrip local rows" />
					<span>armed</span>
					<span>/</span>
					<Datum value={stateCounts.partial} cite="WorkspaceCapabilityStrip local rows" />
					<span>bounded</span>
					<span>/</span>
					<Datum value={heldContractCount} cite="WorkspaceCapabilityStrip local rows" />
					<span>held</span>
				</span>
			</span>
		</div>
		<div class="strip-state-ratio" aria-label="Local capability state mix">
			<Ratio segments={stateSegments} height={8} />
		</div>
	</div>

	<div class="strip-contract" aria-label="Local state contract">
		{#each stateContracts as contract (contract.state)}
			<span
				class="contract-cell"
				data-state={contract.state}
				aria-label="{contract.count} {contract.label}: {contract.meaning}"
				title={contract.meaning}
			>
				<span class="contract-label-block">
					<span class="contract-count"><Datum value={contract.count} /></span>
					<span class="contract-label">{contract.label}</span>
				</span>
				<span class="contract-verb">{contract.verb}</span>
			</span>
		{/each}
	</div>

	{#if pressureItem}
		<a
			class="strip-pressure"
			href={pressureItem.href}
			data-state={pressureItem.state}
			aria-label="Next local unlock: {pressureLabel(pressureItem)} Action: {actionLabel(
				pressureItem
			)}. Gate: {pressureItem.unlock}"
			data-sveltekit-preload-data="off"
		>
			<span class="pressure-kicker">next unlock</span>
			<span class="pressure-copy">{pressureLabel(pressureItem)}</span>
			<span class="pressure-verb">{stateVerbLabel(pressureItem.state)}</span>
			<span class="pressure-action">{actionLabel(pressureItem)}</span>
			<span class="pressure-unlock">
				<span class="pressure-unlock-label">Gate</span>
				<span>{pressureItem.unlock}</span>
			</span>
		</a>
	{/if}

	<div class="strip-list">
		{#each items as item (item.label)}
			<a
				class="strip-item"
				href={item.href}
				data-state={item.state}
				aria-label={itemAria(item)}
				data-sveltekit-preload-data="off"
			>
				<span class="strip-main">
					<span class="strip-name">{item.label}</span>
					<span class="strip-detail">{item.detail}</span>
					<span class="strip-route">
						<span>{item.phase}</span>
						<span>{formatCapabilityClusters(item.cluster)}</span>
						{#if item.handoff}
							<span>{item.handoff}</span>
						{/if}
					</span>
				</span>
				<span class="strip-state">{stateLabel(item.state)}</span>
				{#if item.metric}
					<span class="strip-metric">
						<Datum
							value={item.metric.value}
							animate
							spring={SPRINGS.METRIC}
							cite={item.metric.cite}
						/>
						<span>{item.metric.label}</span>
					</span>
				{/if}
				<span class="strip-verb">{stateVerbLabel(item.state)}</span>
				<span class="strip-action">{actionLabel(item)}</span>
				<span class="strip-unlock">{item.unlock}</span>
			</a>
		{/each}
	</div>
</section>

<style>
	.cap-strip {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.875rem 0;
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
	}
	.strip-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.strip-head-copy {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}
	.strip-title,
	.strip-state,
	.strip-route,
	.strip-verb,
	.strip-action {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}
	.strip-title {
		color: oklch(0.52 0.012 250);
	}
	.strip-count,
	.strip-count-total,
	.strip-count-split {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		line-height: 1.4;
		text-transform: uppercase;
		color: var(--text-secondary, oklch(0.42 0.012 60));
	}
	.strip-count {
		gap: 0.3rem 0.8rem;
	}
	.strip-count-total {
		gap: 0.3rem;
		white-space: nowrap;
	}
	.strip-count-split {
		gap: 0.25rem 0.4rem;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.strip-state-ratio {
		width: min(12rem, 38vw);
		flex-shrink: 0;
	}
	.strip-contract {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1px;
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
	}
	@media (min-width: 760px) {
		.strip-contract {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}
	.contract-cell {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		min-width: 0;
		padding: 0.45rem 0.5rem;
		border-left: 2px solid transparent;
		background: oklch(0.99 0.003 60);
	}
	.contract-label-block {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		min-width: 0;
	}
	.contract-count,
	.contract-label,
	.contract-verb,
	.pressure-kicker,
	.pressure-verb,
	.pressure-action,
	.pressure-unlock-label {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.contract-count {
		font-size: 0.8rem;
		letter-spacing: 0;
	}
	.contract-label {
		color: oklch(0.48 0.012 60);
	}
	.contract-verb {
		color: oklch(0.52 0.012 60);
		text-transform: none;
		letter-spacing: 0;
		white-space: nowrap;
	}
	.contract-cell[data-state='live'] {
		border-left-color: var(--coord-verified, #10b981);
	}
	.contract-cell[data-state='partial'] {
		border-left-color: var(--coord-route-solid, #3bc4b8);
	}
	.contract-cell[data-state='draft-only'] {
		border-left-color: oklch(0.65 0.12 78);
	}
	.contract-cell[data-state='gated'] {
		border-left-color: oklch(0.5 0.02 60);
	}
	.strip-pressure {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.2rem 0.75rem;
		padding: 0.55rem 0.625rem;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-left: 2px solid var(--coord-route-solid, #3bc4b8);
		background: oklch(0.99 0.003 60);
		color: inherit;
		text-decoration: none;
		transition:
			border-color 320ms cubic-bezier(0.4, 0, 0.2, 1),
			background-color 320ms cubic-bezier(0.4, 0, 0.2, 1);
	}
	@media (min-width: 760px) {
		.strip-pressure {
			grid-template-columns: 7rem minmax(0, 1fr) auto auto;
			align-items: baseline;
		}
	}
	.strip-pressure:hover,
	.strip-pressure:focus-visible {
		border-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.985 0.006 65);
		outline: none;
	}
	.strip-pressure[data-state='live'] {
		border-left-color: var(--coord-verified, #10b981);
	}
	.strip-pressure[data-state='draft-only'],
	.strip-pressure[data-state='gated'] {
		border-style: dashed;
		background: oklch(0.986 0.004 60);
	}
	.strip-pressure[data-state='draft-only'] {
		border-left-color: oklch(0.65 0.12 78);
	}
	.strip-pressure[data-state='gated'] {
		border-left-color: oklch(0.5 0.02 60);
	}
	.pressure-kicker {
		color: oklch(0.52 0.012 250);
	}
	.pressure-copy {
		min-width: 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		line-height: 1.35;
		color: var(--text-secondary, oklch(0.38 0.012 60));
	}
	.pressure-unlock {
		grid-column: 1 / -1;
		display: flex;
		min-width: 0;
		gap: 0.5rem;
		padding-top: 0.25rem;
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.76));
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.72rem;
		line-height: 1.35;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.pressure-unlock-label {
		flex-shrink: 0;
		color: oklch(0.52 0.012 250);
	}
	.pressure-unlock span:last-child {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.pressure-action {
		justify-self: start;
		color: var(--coord-route-solid, #3bc4b8);
		text-transform: none;
		letter-spacing: 0;
	}
	.pressure-verb {
		justify-self: start;
		color: oklch(0.48 0.012 60);
		text-transform: none;
		letter-spacing: 0;
		white-space: nowrap;
	}
	@media (min-width: 760px) {
		.pressure-verb {
			justify-self: end;
		}
		.pressure-action {
			justify-self: end;
		}
	}
	.strip-list {
		display: grid;
		gap: 0.25rem;
	}
	.strip-item {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.25rem 0.75rem;
		padding: 0.5rem 0;
		text-decoration: none;
		border-left: 2px solid transparent;
		transition: border-color 320ms cubic-bezier(0.4, 0, 0.2, 1);
	}
	@media (min-width: 760px) {
		.strip-item {
			grid-template-columns:
				minmax(12rem, 1.1fr) 5rem 7rem 6.5rem auto
				minmax(0, 1.25fr);
			align-items: baseline;
			padding: 0.45rem 0.5rem;
		}
	}
	.strip-item:hover,
	.strip-item:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		outline: none;
	}
	.strip-main {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}
	.strip-name {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.strip-detail,
	.strip-unlock,
	.strip-metric {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.72rem;
		line-height: 1.4;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.strip-state,
	.strip-metric,
	.strip-verb,
	.strip-action {
		white-space: nowrap;
	}
	.strip-route {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		color: oklch(0.52 0.012 250);
		letter-spacing: 0.08em;
	}
	.strip-action {
		color: oklch(0.5 0.012 60);
		text-transform: none;
		letter-spacing: 0;
	}
	.strip-verb {
		color: oklch(0.48 0.012 60);
		text-transform: none;
		letter-spacing: 0;
	}
	.strip-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		color: oklch(0.45 0.012 60);
	}
	.strip-unlock {
		grid-column: 1 / -1;
	}
	@media (min-width: 760px) {
		.strip-unlock {
			grid-column: auto;
		}
	}
	.strip-item[data-state='live'] .strip-state {
		color: var(--coord-verified, #10b981);
	}
	.strip-item[data-state='live'] .strip-action {
		color: var(--coord-verified, #10b981);
	}
	.strip-item[data-state='live'] .strip-verb {
		color: var(--coord-verified, #10b981);
	}
	.strip-item[data-state='partial'] .strip-state {
		color: var(--coord-route-solid, #3bc4b8);
	}
	.strip-item[data-state='partial'] .strip-action {
		color: var(--coord-route-solid, #3bc4b8);
	}
	.strip-item[data-state='partial'] .strip-verb {
		color: var(--coord-route-solid, #3bc4b8);
	}
	.strip-item[data-state='draft-only'] .strip-state {
		color: oklch(0.62 0.12 78);
	}
	.strip-item[data-state='draft-only'] .strip-action {
		color: oklch(0.62 0.12 78);
	}
	.strip-item[data-state='draft-only'] .strip-verb {
		color: oklch(0.62 0.12 78);
	}
	.strip-item[data-state='draft-only'],
	.strip-item[data-state='gated'] {
		background: oklch(0.986 0.004 60);
		border-left-color: oklch(0.76 0.02 60);
		border-left-style: dashed;
	}
	.strip-item[data-state='gated'] .strip-state {
		color: oklch(0.48 0.02 60);
	}
	.strip-item[data-state='gated'] .strip-action {
		color: oklch(0.48 0.02 60);
	}
	.strip-item[data-state='gated'] .strip-verb {
		color: oklch(0.48 0.02 60);
	}
	.strip-item[data-state='gated'] {
		opacity: 0.78;
	}
</style>
