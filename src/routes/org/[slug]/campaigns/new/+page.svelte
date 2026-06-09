<script lang="ts">
	import { enhance } from '$app/forms';
	import WorkspaceCapabilityStrip from '$lib/components/org/os/WorkspaceCapabilityStrip.svelte';
	import CountrySelector from '$lib/components/geographic/CountrySelector.svelte';
	import JurisdictionPicker from '$lib/components/geographic/JurisdictionPicker.svelte';
	import { FEATURES } from '$lib/config/features';
	import {
		buildActionRecordReadiness,
		getGateEvidence,
		type ActionRecordReadinessRowKey,
		type CapabilityState
	} from '$lib/data/capability-hypergraph';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel
	} from '$lib/data/capability-state-labels';
	import { Datum } from '$lib/design';
	import type { PageData, ActionData } from './$types';

	type ActionCreationPressureReadout = {
		id: string;
		label: string;
		state: CapabilityState;
		title: string;
		action: string;
		detail: string;
		gate: string;
		href: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const prefill = data.alertPrefill;
	let debateEnabled = $state(false);
	let targetCountry = $state(form?.targetCountry ?? 'US');
	let targetJurisdiction = $state(form?.targetJurisdiction ?? '');
	let position = $state<string>('');
	const actionProofGate = getGateEvidence('CP-receipt-anchoring', ['T6-1', 'T6-2'], {
		name: 'Verified action proof',
		downstream: 8,
		dependency: 'Published participation plus receipt writer/mainnet anchoring'
	});
	const reachExpansionGate = getGateEvidence(
		'CP-reach-expansion',
		['T3-1', 'T3-2', 'T3-3', 'T3-4', 'T3-5'],
		{
			name: 'State, local, and international reach',
			downstream: 5,
			dependency: 'Multi-state + international resolver coverage'
		}
	);
	const qualitySettlementGate = getGateEvidence('CP-quality-settlement', ['T5-3', 'T5-5', 'T5-2'], {
		name: 'Quality settlement',
		downstream: 6,
		dependency: 'TEE + Scroll mainnet settlement'
	});
	const congressionalLaunchGate = getGateEvidence('CP-congressional-launch', ['NEW-A-7'], {
		name: 'Congressional delivery launch',
		downstream: 1,
		dependency: 'First-org staging confirmation + CWC launch flag'
	});
	const coordinationHistoryGate = getGateEvidence('CP-coordination-integrity', ['T10-10'], {
		name: 'Coordination integrity snapshots',
		downstream: 1,
		dependency: 'Packet-local integrity snapshot + history depth'
	});
	const actionRecordReadiness = $derived(
		buildActionRecordReadiness({
			base: `/org/${data.org.slug}`,
			context: 'draft',
			action: {
				targetCountry,
				targetJurisdiction,
				debateEnabled,
				congressionalDelivery: data.congressionalDelivery
			},
			features: {
				CONGRESSIONAL: FEATURES.CONGRESSIONAL
			},
			gates: {
				actionProofGate,
				reachExpansionGate,
				qualitySettlementGate,
				coordinationHistoryGate,
				congressionalLaunchGate
			},
			hrefs: {
				'action-record': '#action-identity',
				'jurisdiction-resolve': '#proof-destination',
				'quality-settlement': '#quality-settlement',
				'congress-proof-delivery': '#proof-delivery-boundary'
			}
		})
	);
	const capabilityRowIds = [
		'action-record',
		'jurisdiction-resolve',
		'quality-settlement',
		'congress-proof-delivery'
	] satisfies ActionRecordReadinessRowKey[];
	const capabilityItems = $derived(
		capabilityRowIds.map((id) => {
			const row = actionRecordReadiness.rows.find((candidate) => candidate.id === id);
			if (!row) throw new Error(`Missing action readiness row: ${id}`);
			return {
				label: row.label,
				state: row.state,
				phase: row.phase,
				cluster: row.clusters,
				action: row.action,
				handoff: row.handoff,
				detail: row.ground,
				unlock: row.boundary,
				href: row.href,
				metric: row.metric
			};
		})
	);
	const congressionalProofDeliveryRow = $derived(
		actionRecordReadiness.rows.find((row) => row.id === 'congress-proof-delivery') ??
			actionRecordReadiness.rows[actionRecordReadiness.rows.length - 1]
	);
	const draftActionRecordRow = $derived(
		actionRecordReadiness.rows.find((row) => row.id === 'action-record') ??
			actionRecordReadiness.rows[0]
	);
	const jurisdictionResolveRow = $derived(
		actionRecordReadiness.rows.find((row) => row.id === 'jurisdiction-resolve') ??
			draftActionRecordRow
	);
	const heldActionCreationRows = $derived(
		actionRecordReadiness.rows.filter(
			(row) =>
				row.id !== 'action-record' &&
				row.id !== 'jurisdiction-resolve' &&
				(row.state === 'draft-only' || row.state === 'gated')
		)
	);
	const nextProofLiftRow = $derived(
		congressionalProofDeliveryRow.state === 'draft-only' ||
			congressionalProofDeliveryRow.state === 'gated'
			? congressionalProofDeliveryRow
			: (heldActionCreationRows[0] ?? congressionalProofDeliveryRow)
	);
	const actionCreationPressureReadouts = $derived<ActionCreationPressureReadout[]>([
		{
			id: 'draft-ground',
			label: 'Draft ground',
			state: draftActionRecordRow.state,
			title: draftActionRecordRow.label,
			action: draftActionRecordRow.action,
			detail: draftActionRecordRow.ground,
			gate: draftActionRecordRow.boundary,
			href: draftActionRecordRow.href,
			metric: draftActionRecordRow.metric
		},
		{
			id: 'proof-route',
			label: 'Proof route',
			state: jurisdictionResolveRow.state,
			title: jurisdictionResolveRow.label,
			action: jurisdictionResolveRow.action,
			detail: jurisdictionResolveRow.ground,
			gate: jurisdictionResolveRow.boundary,
			href: jurisdictionResolveRow.href,
			metric: jurisdictionResolveRow.metric
		},
		{
			id: 'next-proof-lift',
			label: 'Next proof lift',
			state: nextProofLiftRow.state,
			title: nextProofLiftRow.label,
			action: nextProofLiftRow.action,
			detail: nextProofLiftRow.ground,
			gate: nextProofLiftRow.boundary,
			href: nextProofLiftRow.href,
			metric: nextProofLiftRow.metric
		}
	]);

	function actionLabel(state: CapabilityState, action: string): string {
		return operatorCapabilityActionLabel(state, action, { appendReadyArrow: true });
	}

	function pressureCellClass(state: CapabilityState): string {
		const stateClass =
			state === 'live'
				? 'border-teal-500/35 bg-teal-500/10'
				: state === 'partial'
					? 'border-blue-500/30 bg-blue-500/10'
					: state === 'draft-only'
						? 'border-amber-500/30 bg-amber-500/10'
						: 'border-surface-border-strong bg-surface-overlay';
		return `rounded-md border p-3 text-left transition hover:border-text-tertiary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500 ${stateClass}`;
	}

	function stateTone(state: CapabilityState): string {
		if (state === 'live') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300';
		if (state === 'partial') return 'border-amber-500/25 bg-amber-500/10 text-amber-300';
		if (state === 'draft-only')
			return 'border-surface-border bg-surface-raised text-text-secondary';
		return 'border-surface-border bg-surface-raised text-text-tertiary';
	}
</script>

<div class="space-y-6">
	<!-- Header -->
	<div>
		<nav class="text-text-tertiary mb-4 flex items-center gap-2 text-sm">
			<a href="/org/{data.org.slug}/campaigns" class="hover:text-text-secondary transition-colors">
				Action records
			</a>
			<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
			</svg>
			<span class="text-text-tertiary">Draft action</span>
		</nav>
		<h1 class="text-text-primary text-xl font-semibold">Draft action record</h1>
		<p class="text-text-tertiary mt-1 text-sm">
			Create saved authoring ground before reader participation, proof delivery, or settlement is
			claimed.
		</p>
	</div>

	<WorkspaceCapabilityStrip label="Action creation capability" items={capabilityItems} />

	<div class="grid gap-3 md:grid-cols-3" aria-label="Action creation pressure">
		{#each actionCreationPressureReadouts as readout (readout.id)}
			<a
				href={readout.href}
				class={pressureCellClass(readout.state)}
				data-state={readout.state}
				data-sveltekit-preload-data="off"
				aria-label={`${readout.label}: ${operatorCapabilityStateLabel(readout.state)}; ${readout.detail}; ${readout.gate}`}
			>
				<span
					class="text-text-quaternary block font-mono text-[0.65rem] tracking-[0.18em] uppercase"
				>
					{readout.label}
				</span>
				<span class="text-text-primary mt-2 block text-sm font-semibold">{readout.title}</span>
				<span class="text-text-secondary mt-2 flex items-baseline gap-1 text-xs">
					<Datum value={readout.metric.value} cite={readout.metric.cite} />
					<span>{readout.metric.label}</span>
				</span>
				<span class="text-text-tertiary mt-2 block text-xs leading-relaxed">
					{readout.detail}
				</span>
				<span class="mt-3 block text-xs font-semibold text-teal-300">
					{actionLabel(readout.state, readout.action)}
				</span>
				<span class="text-text-quaternary mt-2 block text-xs leading-relaxed">
					{readout.gate}
				</span>
			</a>
		{/each}
	</div>

	{#if form?.error}
		<div class="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
			{form.error}
		</div>
	{/if}

	<form method="POST" use:enhance class="space-y-6">
		{#if prefill}
			<input type="hidden" name="fromAlertId" value={prefill.alertId} />
			<input type="hidden" name="billId" value={prefill.billId} />
			<input type="hidden" name="position" value={position} />

			<!-- Alert context banner -->
			<div class="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
				<p class="mb-1 font-mono text-[10px] tracking-wider text-amber-400/70 uppercase">
					Responding to legislative alert
				</p>
				<p class="text-text-primary text-sm font-medium">{prefill.billTitle}</p>
				{#if prefill.billSummary}
					<p class="text-text-tertiary mt-1 line-clamp-2 text-xs">{prefill.billSummary}</p>
				{/if}

				{#if prefill.billJurisdictionLevel === 'state'}
					<div class="mt-2 rounded border border-amber-500/10 bg-amber-500/5 px-3 py-2">
						<p class="text-[10px] text-amber-400/80">
							State bill -- you may need to manually add target legislators after creating this
							action.
						</p>
					</div>
				{/if}

				<!-- Position selector -->
				<div class="mt-3">
					<p class="text-text-secondary mb-1.5 text-xs font-medium">
						Your organization's position on this bill
					</p>
					<div class="flex gap-3">
						<button
							type="button"
							class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors {position ===
							'support'
								? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
								: 'border-surface-border bg-surface-raised text-text-tertiary hover:text-text-secondary'}"
							onclick={() => {
								position = 'support';
							}}
						>
							Support
						</button>
						<button
							type="button"
							class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors {position ===
							'oppose'
								? 'border-red-500/40 bg-red-500/10 text-red-400'
								: 'border-surface-border bg-surface-raised text-text-tertiary hover:text-text-secondary'}"
							onclick={() => {
								position = 'oppose';
							}}
						>
							Oppose
						</button>
					</div>
				</div>
			</div>
		{/if}

		<!-- Section 1: Who should see this proof? -->
		<div
			id="proof-destination"
			class="bg-surface-base border-surface-border scroll-mt-24 space-y-4 rounded-lg border p-4"
		>
			<div>
				<p class="text-text-secondary text-sm font-medium">Who should see this proof?</p>
				<p class="text-text-tertiary mt-0.5 text-xs">
					Choose the jurisdiction where your proof will land
				</p>
			</div>

			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div>
					<label for="targetCountry" class="text-text-secondary mb-1.5 block text-sm font-medium"
						>Country</label
					>
					<input type="hidden" name="targetCountry" value={targetCountry} />
					<CountrySelector
						value={targetCountry}
						onchange={(c) => {
							targetCountry = c;
							targetJurisdiction = '';
						}}
					/>
				</div>
				<div>
					<label
						for="targetJurisdiction"
						class="text-text-secondary mb-1.5 block text-sm font-medium"
					>
						Jurisdiction
						<span class="text-text-quaternary font-normal">(optional)</span>
					</label>
					<input type="hidden" name="targetJurisdiction" value={targetJurisdiction} />
					<JurisdictionPicker
						value={targetJurisdiction || null}
						country={targetCountry}
						onchange={(j) => {
							targetJurisdiction = j;
						}}
					/>
				</div>
			</div>

			{#if targetJurisdiction}
				<p class="text-text-tertiary text-xs">
					Proof will target decision-makers in <span class="text-text-secondary font-medium"
						>{targetJurisdiction}</span
					>, <span class="text-text-secondary font-medium">{targetCountry}</span>
				</p>
			{/if}
		</div>

		<div
			id="proof-delivery-boundary"
			class="bg-surface-base border-surface-border scroll-mt-24 space-y-4 rounded-lg border p-4"
		>
			<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<p class="text-text-secondary text-sm font-medium">Congressional proof delivery</p>
					<p class="text-text-tertiary mt-0.5 text-xs">
						CWC transport is a Send boundary, not a property of an unsaved action record.
					</p>
				</div>
				<span
					class="inline-flex w-fit rounded border px-2 py-1 font-mono text-[10px] tracking-wider uppercase {stateTone(
						congressionalProofDeliveryRow.state
					)}"
				>
					{operatorCapabilityStateLabel(congressionalProofDeliveryRow.state)}
				</span>
			</div>

			<p class="text-text-secondary text-sm">{congressionalProofDeliveryRow.ground}</p>

			<div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
				<div class="border-surface-border bg-surface-raised rounded border px-3 py-2">
					<p class="text-text-quaternary font-mono text-[10px] tracking-wider uppercase">Launch</p>
					<p class="text-text-secondary mt-1 text-sm">
						{data.congressionalDelivery?.launched ? 'configured' : 'held'}
					</p>
				</div>
				<div class="border-surface-border bg-surface-raised rounded border px-3 py-2">
					<p class="text-text-quaternary font-mono text-[10px] tracking-wider uppercase">
						House proxy
					</p>
					<p class="text-text-secondary mt-1 text-sm">
						{data.congressionalDelivery?.houseTransportConfigured ? 'configured' : 'held'}
					</p>
				</div>
				<div class="border-surface-border bg-surface-raised rounded border px-3 py-2">
					<p class="text-text-quaternary font-mono text-[10px] tracking-wider uppercase">
						Senate API
					</p>
					<p class="text-text-secondary mt-1 text-sm">
						{data.congressionalDelivery?.senateTransportConfigured ? 'configured' : 'held'}
					</p>
				</div>
			</div>

			<a
				href="#proof-delivery-boundary"
				class="text-text-tertiary decoration-surface-border hover:text-text-secondary inline-flex text-sm underline underline-offset-4 transition-colors"
				aria-label="Congress proof delivery action: {operatorCapabilityActionLabel(
					congressionalProofDeliveryRow.state,
					congressionalProofDeliveryRow.action
				)}"
			>
				{operatorCapabilityActionLabel(
					congressionalProofDeliveryRow.state,
					congressionalProofDeliveryRow.action
				)}
			</a>
		</div>

		<!-- Section 2: What are you proving? -->
		<div id="action-identity" class="scroll-mt-24 space-y-5">
			<p class="text-text-secondary text-sm font-medium">What are you proving?</p>

			<!-- Title -->
			<div>
				<label for="title" class="text-text-secondary mb-1.5 block text-sm font-medium">Title</label
				>
				<input
					type="text"
					id="title"
					name="title"
					required
					value={form?.title ?? prefill?.billTitle ?? ''}
					placeholder="e.g., District 5 Zoning Letter Drive"
					class="participation-input w-full rounded-lg text-sm transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
				/>
			</div>

			<!-- Type -->
			<div>
				<label for="type" class="text-text-secondary mb-1.5 block text-sm font-medium">Type</label>
				<select
					id="type"
					name="type"
					required
					class="participation-input w-full rounded-lg text-sm transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
				>
					<option value="LETTER" selected={form?.type === 'LETTER' || !!prefill}>Letter</option>
					<option value="EVENT" selected={form?.type === 'EVENT'}>Event</option>
					<option value="FORM" selected={form?.type === 'FORM'}>Form</option>
				</select>
			</div>

			<!-- Body -->
			<div>
				<label for="body" class="text-text-secondary mb-1.5 block text-sm font-medium">
					Description
					<span class="text-text-quaternary font-normal">(optional)</span>
				</label>
				<textarea
					id="body"
					name="body"
					rows="4"
					placeholder="What civic action are people being asked to prove?"
					class="participation-input w-full resize-y rounded-lg text-sm transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
					>{form?.body ?? prefill?.billSummary ?? ''}</textarea
				>
			</div>

			<!-- Template -->
			<div>
				<label for="templateId" class="text-text-secondary mb-1.5 block text-sm font-medium">
					Template
					<span class="text-text-quaternary font-normal">(optional)</span>
				</label>
				<select
					id="templateId"
					name="templateId"
					class="participation-input w-full rounded-lg text-sm transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
				>
					<option value="">None</option>
					{#each data.templates as template}
						<option value={template.id}>{template.title}</option>
					{/each}
				</select>
			</div>
		</div>

		<!-- Debate settings -->
		<div
			id="quality-settlement"
			class="bg-surface-base border-surface-border scroll-mt-24 space-y-4 rounded-lg border p-4"
		>
			<div class="flex items-center justify-between">
				<div>
					<p class="text-text-secondary text-sm font-medium">Quality settlement</p>
					<p class="text-text-tertiary mt-0.5 text-xs">
						Store a debate threshold; settlement remains gated.
					</p>
				</div>
				<label class="relative inline-flex cursor-pointer items-center">
					<input
						type="checkbox"
						name="debateEnabled"
						class="peer sr-only"
						bind:checked={debateEnabled}
					/>
					<div
						class="bg-surface-border-strong peer after:bg-text-tertiary h-5 w-9 rounded-full peer-checked:bg-teal-600 peer-focus:ring-2 peer-focus:ring-teal-500/40 after:absolute after:top-[2px] after:left-[2px] after:h-4 after:w-4 after:rounded-full after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white peer-checked:after:bg-white"
					></div>
				</label>
			</div>

			{#if debateEnabled}
				<p class="text-text-tertiary text-xs">
					The draft can store a debate threshold. Debate spawning and settlement stay governed by
					participation, quality, TEE, and mainnet gates.
				</p>
				<div>
					<label for="debateThreshold" class="text-text-secondary mb-1.5 block text-sm font-medium">
						Threshold
						<span class="text-text-quaternary font-normal">(minimum verified participants)</span>
					</label>
					<input
						type="number"
						id="debateThreshold"
						name="debateThreshold"
						min="1"
						value="50"
						class="participation-input w-32 rounded-lg font-mono text-sm transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
					/>
				</div>
			{/if}
		</div>

		<!-- Proof preview -->
		<div class="border-surface-border bg-surface-raised space-y-3 rounded-md border p-6">
			<p class="text-text-quaternary font-mono text-[10px] tracking-wider uppercase">
				Proof packet preview
			</p>
			<div class="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
				<p class="text-text-quaternary mb-1 font-mono text-xs tracking-wider uppercase">
					Draft packet
				</p>
				<p class="text-text-quaternary font-mono text-2xl font-bold tabular-nums">Pending</p>
				<p class="text-text-quaternary mt-1 text-xs">
					Packet evidence assembles after save and verified participation.
				</p>
			</div>
		</div>

		<!-- Submit -->
		<div class="flex items-center gap-3 pt-2">
			<button
				type="submit"
				class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-500"
			>
				Create action record
			</button>
			<a
				href="/org/{data.org.slug}/campaigns"
				class="text-text-tertiary hover:text-text-secondary rounded-lg px-4 py-2.5 text-sm transition-colors"
			>
				Cancel
			</a>
		</div>
	</form>
</div>
