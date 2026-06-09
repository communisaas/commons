<script lang="ts">
	import WorkspaceCapabilityStrip from '$lib/components/org/os/WorkspaceCapabilityStrip.svelte';
	import { formatCapabilityClusters } from '$lib/data/capability-clusters';
	import {
		buildPlatformIntakeReadiness,
		formatGateEvidence,
		getGateEvidence,
		type PlatformApiProofRow,
		type PlatformIntakeProfileRow,
		type PlatformIntakeStageRow
	} from '$lib/data/capability-hypergraph';
	import {
		operatorCapabilityStateLabel,
		operatorCapabilityStateRatioSegments,
		type OperatorCapabilityStateCounts
	} from '$lib/data/capability-state-labels';
	import { Datum, Ratio } from '$lib/design';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type CapabilityState = 'live' | 'partial' | 'draft-only' | 'gated';
	type CapabilityItem = {
		label: string;
		state: CapabilityState;
		phase: string;
		cluster: string;
		action: string;
		detail: string;
		unlock: string;
		href: string;
		metric?: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	const sync = $derived(data.sync);
	const isConnected = $derived(data.connected);
	const platformApiSyncReadiness = $derived(data.platformApiSyncReadiness ?? null);
	const credentialCustodyReady = $derived(
		platformApiSyncReadiness?.credentialCustodyReady ?? data.credentialCustodyReady
	);
	const platformApiSyncRuntimeReady = $derived(platformApiSyncReadiness?.ready ?? false);
	const platformApiSyncRuntimeMissing = $derived(
		platformApiSyncReadiness?.missing ?? data.platformApiSyncRuntimeMissing ?? []
	);
	const platformApiSyncRuntimeDependency = $derived(
		platformApiSyncReadiness?.dependency ?? data.platformApiSyncRuntimeDependency
	);
	const platformApiSyncRuntimeMessage = $derived(
		platformApiSyncReadiness?.message ??
			'Direct platform sync is not armed; CSV export intake remains the live migration path.'
	);
	const platformApiSyncRunnerImplemented = $derived(
		platformApiSyncReadiness?.runnerImplemented ?? false
	);
	const platformApiProfileCount = $derived(
		platformApiSyncReadiness?.profileCount ?? data.platformApiSyncReadiness?.profileCount ?? null
	);
	const formCode = $derived(typeof form?.code === 'string' ? form.code : null);
	const formMissing = $derived(Array.isArray(form?.missing) ? (form.missing as string[]) : []);
	const adapterLabel = $derived(sync?.adapterLabel ?? form?.adapterLabel ?? null);
	const credentialProbeCompletedAt = $derived(
		sync?.credentialProbeCompletedAt ?? form?.credentialProbeCompletedAt ?? null
	);
	const credentialProbeComplete = $derived(Boolean(credentialProbeCompletedAt));
	const errorList = $derived(Array.isArray(sync?.errors) ? (sync.errors as string[]) : []);
	const progressPct = $derived(
		sync && sync.totalResources > 0
			? Math.min(100, Math.round((sync.processedResources / sync.totalResources) * 100))
			: null
	);
	const platformApiSyncGround = $derived({
		runtimeReady: platformApiSyncRuntimeReady,
		runtimeMissing: platformApiSyncRuntimeMissing,
		runtimeDependency: platformApiSyncRuntimeDependency,
		runtimeMessage: platformApiSyncRuntimeMessage,
		credentialCustodyReady,
		credentialStored: isConnected,
		credentialProbeComplete,
		credentialProbeCompletedAt,
		adapterSource: sync?.adapterSource ?? null,
		runnerImplemented: platformApiSyncRunnerImplemented,
		armedAdapterSources: platformApiSyncReadiness?.armedAdapterSources ?? [],
		profileCount: platformApiProfileCount
	});
	const platformApiRuntimeHeldCount = $derived(platformApiSyncRuntimeMissing.length);
	// Execution evidence is per-org run output only. The runner/readiness flags
	// are global capability ground and must not surface zero-row counters for an
	// org that has never run an import (the page promises exactly that below).
	const platformDirectImportEvidenceObserved = $derived(
		(sync?.totalResources ?? 0) > 0 ||
			(sync?.processedResources ?? 0) > 0 ||
			(sync?.imported ?? 0) > 0 ||
			(sync?.updated ?? 0) > 0 ||
			(sync?.skipped ?? 0) > 0 ||
			Boolean(sync?.lastSyncAt) ||
			Boolean(sync?.checkpoint)
	);
	const platformApiGate = getGateEvidence('CP-platform-api-sync', ['T1-3'], {
		name: 'Direct platform sync',
		downstream: 1,
		dependency: 'Encrypted credential custody + direct sync execution'
	});
	const platformApiGateSummary = $derived(
		formatGateEvidence(platformApiGate, {
			prefix: platformApiSyncRuntimeMessage,
			density: 'operator'
		})
	);
	const platformIntakeReadiness = $derived(
		buildPlatformIntakeReadiness({
			base: `/org/${data.org.slug}`,
			platformApiGate,
			platformApiSync: platformApiSyncGround
		})
	);
	const platformProfileRows = $derived<PlatformIntakeProfileRow[]>(platformIntakeReadiness.rows);
	const platformIntakeStageRows = $derived<PlatformIntakeStageRow[]>(
		platformIntakeReadiness.stageRows
	);
	const platformApiProofRows = $derived<PlatformApiProofRow[]>(platformIntakeReadiness.proofRows);
	const platformProfileCount = $derived(platformIntakeReadiness.profileCount);
	const csvContractCount = $derived(platformIntakeReadiness.csvContractCount);
	const apiBoundaryCount = $derived(platformIntakeReadiness.apiBoundaryCount);
	const platformProfileStateCounts = $derived<OperatorCapabilityStateCounts>(
		platformProfileRows.reduce(
			(counts, row) => {
				counts[row.csvState] = (counts[row.csvState] ?? 0) + 1;
				counts[row.apiState] = (counts[row.apiState] ?? 0) + 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as OperatorCapabilityStateCounts
		)
	);
	const platformProfileSegments = $derived(
		operatorCapabilityStateRatioSegments(platformProfileStateCounts, {
			labelSuffix: ' source-custody contracts'
		})
	);
	const platformApiProofStateCounts = $derived<OperatorCapabilityStateCounts>(
		platformApiProofRows.reduce(
			(counts, row) => {
				counts[row.state] = (counts[row.state] ?? 0) + 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as OperatorCapabilityStateCounts
		)
	);
	const platformApiProofSegments = $derived(
		operatorCapabilityStateRatioSegments(platformApiProofStateCounts, {
			labelSuffix: ' direct sync proof rows'
		})
	);
	const platformApiProofLiveCount = $derived(platformApiProofStateCounts.live ?? 0);
	const heldPlatformApiProofCount = $derived(
		(platformApiProofStateCounts.gated ?? 0) + (platformApiProofStateCounts['draft-only'] ?? 0)
	);
	const capabilityItems = $derived<CapabilityItem[]>(
		platformIntakeStageRows.map((row) => ({
			label: row.handoff,
			state: row.state,
			phase: row.phase,
			cluster: row.clusters,
			action: row.action,
			handoff: row.handoff,
			detail: row.effect,
			unlock: row.gate,
			href: row.href,
			metric: row.metric
		}))
	);

	function stateLabel(state: CapabilityState): string {
		return operatorCapabilityStateLabel(state);
	}

	function relativeTime(iso: string | null | undefined): string {
		if (!iso) return 'never';
		const now = Date.now();
		const then = new Date(iso).getTime();
		const diffMs = now - then;
		const diffMin = Math.floor(diffMs / 60000);
		const diffHr = Math.floor(diffMs / 3600000);
		const diffDay = Math.floor(diffMs / 86400000);

		if (diffMin < 1) return 'just now';
		if (diffMin < 60) return `${diffMin}m ago`;
		if (diffHr < 24) return `${diffHr}h ago`;
		if (diffDay < 7) return `${diffDay}d ago`;

		return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}
</script>

<div id="platform-intake" class="space-y-6">
	<div>
		<nav class="text-text-tertiary mb-4 flex items-center gap-2 text-sm">
			<a href="/org/{data.org.slug}/supporters" class="hover:text-text-secondary transition-colors">
				People ledger
			</a>
			<span aria-hidden="true">/</span>
			<a
				href="/org/{data.org.slug}/supporters/import"
				class="hover:text-text-secondary transition-colors"
			>
				Import
			</a>
			<span aria-hidden="true">/</span>
			<span>Platform portability boundary</span>
		</nav>
		<h1 class="text-text-primary text-xl font-semibold">Platform portability boundary</h1>
		<p class="text-text-tertiary mt-1 text-sm">
			{platformIntakeReadiness.effect}
			{platformIntakeReadiness.boundary}
			{platformApiSyncRuntimeMessage}
		</p>
	</div>

	<WorkspaceCapabilityStrip label="Platform intake capability" items={capabilityItems} />

	<section
		id="platform-profile-contract"
		class="border-surface-border bg-surface-base rounded-md border p-4"
		aria-labelledby="platform-profile-contract-title"
	>
		<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
			<div>
				<p class="text-text-tertiary text-xs font-semibold tracking-[0.08em] uppercase">
					Source portability
				</p>
				<h2
					id="platform-profile-contract-title"
					class="text-text-primary mt-1 text-base font-semibold"
				>
					Incumbent exports become source custody
				</h2>
				<p class="text-text-tertiary mt-1 max-w-3xl text-sm">
					{platformIntakeReadiness.detail} CSV recognition preserves origin and header evidence; direct
					sync stays behind the same execution boundary until adapter-specific proof is present.
				</p>
			</div>
			<div class="grid min-w-[13rem] grid-cols-3 gap-2 text-right">
				<div>
					<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
						<Datum value={platformProfileCount} cite="buildPlatformIntakeReadiness" />
					</p>
					<p class="text-text-tertiary text-[11px]">profiles</p>
				</div>
				<div>
					<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
						<Datum value={csvContractCount} cite="buildPlatformIntakeReadiness csvContractCount" />
					</p>
					<p class="text-text-tertiary text-[11px]">CSV live</p>
				</div>
				<div>
					<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
						<Datum value={apiBoundaryCount} cite="buildPlatformIntakeReadiness apiBoundaryCount" />
					</p>
					<p class="text-text-tertiary text-[11px]">API gated</p>
				</div>
			</div>
		</div>

		<div class="mt-3" aria-label="Source-custody state mix">
			<Ratio segments={platformProfileSegments} height={8} />
		</div>

		<div class="mt-4 grid gap-2" aria-label="Recognized incumbent export profiles">
			{#each platformProfileRows as row (row.source)}
				<div
					class="border-surface-border hover:border-surface-border-strong grid gap-3 rounded-md border px-3 py-3 transition-colors md:grid-cols-[minmax(10rem,1.2fr)_minmax(11rem,1fr)_minmax(12rem,1.2fr)_minmax(7rem,auto)] md:items-center"
					data-state={row.apiState}
					aria-label="{row.label}: CSV profile {stateLabel(row.csvState)}, direct API {stateLabel(
						row.apiState
					)}. Gate: {formatGateEvidence(row.gate, { density: 'operator' })}"
				>
					<span>
						<span class="text-text-primary block text-sm font-semibold">{row.label}</span>
						<span class="text-text-tertiary block font-mono text-[11px]">{row.source}</span>
					</span>
					<span class="flex flex-wrap gap-2">
						<a
							href={row.csvHref}
							data-sveltekit-preload-data="off"
							class="rounded border border-emerald-500/30 px-2 py-1 text-[11px] text-emerald-700 transition-colors hover:border-emerald-600/60 hover:bg-emerald-500/10 focus:ring-1 focus:ring-emerald-500/50 focus:outline-none"
						>
							CSV profile · {stateLabel(row.csvState)}
						</a>
						<a
							href={row.apiHref}
							data-sveltekit-preload-data="off"
							class="rounded border border-amber-500/30 px-2 py-1 text-[11px] text-amber-700 transition-colors hover:border-amber-600/60 hover:bg-amber-500/10 focus:ring-1 focus:ring-amber-500/50 focus:outline-none"
						>
							Direct sync · {stateLabel(row.apiState)}
						</a>
					</span>
					<span class="text-text-tertiary text-xs">
						{row.fingerprint}
						{#if row.requiredCount > 0}
							<span class="text-text-quaternary">/ {row.requiredCount} required anchors</span>
						{/if}
						<span class="text-text-quaternary mt-1 block">
							Sync proof: {row.apiProofSummary}
						</span>
					</span>
					<span
						class="text-text-tertiary flex flex-wrap items-center justify-between gap-3 text-xs md:justify-end"
					>
						<span>{formatCapabilityClusters(row.clusters)}</span>
						<span class="font-mono tabular-nums">
							<Datum value={row.matchCount} cite="platform export profile header signatures" />
							signals
						</span>
						<span class="font-mono tabular-nums">
							<Datum value={row.apiProofCount} cite="direct sync proof checklist" />
							sync checks
						</span>
					</span>
				</div>
			{/each}
		</div>
	</section>

	{#if form?.error}
		<div class="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
			{form.error}
			{#if formCode}
				<p class="mt-2 font-mono text-xs text-red-300/80">{formCode}</p>
			{/if}
			{#if formMissing.length > 0}
				<p class="mt-1 text-xs text-red-300/80">Missing: {formMissing.join(', ')}</p>
			{/if}
		</div>
	{/if}
	{#if form?.disconnected}
		<div
			class="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300"
		>
			Stored platform adapter state removed.
		</div>
	{/if}
	{#if form?.connected}
		<div
			class="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700"
		>
			Encrypted {form.adapterLabel ?? 'platform'} credential stored. Direct import remains gated.
		</div>
	{/if}
	{#if form?.probed}
		<div
			class="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700"
		>
			{form.probeMessage}
			<p class="mt-2 font-mono text-xs text-emerald-800/70">
				{form.adapterLabel ?? 'Platform'} · {form.credentialVersion ?? 'credential envelope'} · custody
				probe {relativeTime(form.credentialProbeCompletedAt)}
			</p>
			<p class="mt-1 text-xs text-emerald-800/80">
				Direct sync remains a held route handoff. {platformApiGateSummary}
			</p>
		</div>
	{/if}

	<div
		id="platform-connection-boundary"
		class="rounded-md border {isConnected || credentialCustodyReady
			? 'border-emerald-500/30 bg-emerald-500/10'
			: 'border-amber-500/30 bg-amber-500/10'} px-4 py-3"
	>
		<p
			class="text-sm font-medium {isConnected || credentialCustodyReady
				? 'text-emerald-700'
				: 'text-amber-300'}"
		>
			{isConnected
				? 'Encrypted credential stored'
				: credentialCustodyReady
					? 'Credential custody is ready'
					: 'API credential custody is dependency-first'}
		</p>
		<p class="text-text-tertiary mt-1 text-sm">
			{#if isConnected}
				Commons has sealed a {adapterLabel ?? 'platform'} API credential for this org.
				{#if credentialProbeComplete}
					The envelope opened under the org/profile binding {relativeTime(
						credentialProbeCompletedAt
					)}.
				{/if}
				It is not used for import until direct sync execution is armed.
			{:else if credentialCustodyReady}
				CSV export intake is live. You can store an encrypted API credential now; direct import
				still waits for platform-specific sync proof.
			{:else}
				CSV export intake is live. Credential storage waits on a configured server encryption key,
				and import waits on direct sync execution.
			{/if}
		</p>
	</div>

	<div
		id="platform-sync-boundary"
		class="border-surface-border bg-surface-base grid gap-3 rounded-md border p-4 sm:grid-cols-3"
	>
		<div>
			<p class="text-text-tertiary text-xs font-medium">Connection state</p>
			<p class="text-text-primary mt-1 text-lg font-bold">
				{isConnected ? 'stored' : 'not stored'}
			</p>
		</div>
		<div>
			<p class="text-text-tertiary text-xs font-medium">Direct sync</p>
			<p class="text-text-primary mt-1 text-lg font-bold">
				{platformApiSyncRuntimeReady ? 'execution ready' : 'not armed'}
			</p>
			<p class="text-text-tertiary mt-1 text-xs">
				direct sync {platformApiSyncRunnerImplemented ? 'armed' : 'held'}
			</p>
		</div>
		<div>
			<p class="text-text-tertiary text-xs font-medium">Unlock</p>
			<p class="text-text-secondary mt-1 text-sm">
				{formatGateEvidence(platformApiGate, {
					prefix: platformApiSyncRuntimeMessage
				})}
			</p>
		</div>
	</div>

	<section
		id="platform-sync-proof-contract"
		class="border-surface-border bg-surface-base rounded-md border p-4"
		aria-labelledby="platform-sync-proof-contract-title"
	>
		<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
			<div>
				<p class="text-text-tertiary text-xs font-semibold tracking-[0.08em] uppercase">
					Direct sync proof
				</p>
				<h2
					id="platform-sync-proof-contract-title"
					class="text-text-primary mt-1 text-base font-semibold"
				>
					What must be true before imports run
				</h2>
				<p class="text-text-tertiary mt-1 max-w-3xl text-sm">
					Direct platform sync is a proof contract, not a stored-secret affordance. CSV export
					intake remains live while adapter execution, import safety, and continuation proof stay
					held.
				</p>
			</div>
			<div class="grid min-w-[13rem] grid-cols-3 gap-2 text-right">
				<div>
					<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
						<Datum
							value={platformApiProofRows.length}
							cite="buildPlatformIntakeReadiness proofRows"
						/>
					</p>
					<p class="text-text-tertiary text-[11px]">proof rows</p>
				</div>
				<div>
					<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
						<Datum value={platformApiProofLiveCount} cite="direct sync proof contract" />
					</p>
					<p class="text-text-tertiary text-[11px]">armed</p>
				</div>
				<div>
					<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
						<Datum value={heldPlatformApiProofCount} cite="direct sync proof contract" />
					</p>
					<p class="text-text-tertiary text-[11px]">held</p>
				</div>
			</div>
		</div>

		<div class="mt-3" aria-label="Direct sync proof state mix">
			<Ratio segments={platformApiProofSegments} height={8} />
		</div>

		<div class="mt-4 grid gap-2" aria-label="Direct platform sync proof contract">
			{#each platformApiProofRows as row (row.id)}
				<a
					class="border-surface-border hover:border-surface-border-strong grid gap-3 rounded-md border px-3 py-3 transition-colors md:grid-cols-[minmax(11rem,0.9fr)_minmax(11rem,1fr)_minmax(15rem,1.4fr)_minmax(8rem,auto)] md:items-center"
					href={row.href}
					data-state={row.state}
					data-sveltekit-preload-data="off"
					aria-label="{row.label}: {stateLabel(row.state)}. {row.effect} Gate: {row.gate}"
				>
					<span>
						<span class="text-text-primary block text-sm font-semibold">{row.label}</span>
						<span class="text-text-tertiary block text-xs">{row.handoff}</span>
					</span>
					<span class="text-text-tertiary text-xs">
						<span class="block">{formatCapabilityClusters(row.clusters)}</span>
						<span class="mt-1 block font-mono">{stateLabel(row.state)}</span>
					</span>
					<span class="text-text-tertiary text-xs">
						{row.effect}
						<span class="text-text-quaternary mt-1 block">{row.gate}</span>
					</span>
					<span
						class="text-text-tertiary flex flex-wrap items-center justify-between gap-3 text-xs md:justify-end"
					>
						<span class="font-mono tabular-nums">
							<Datum value={row.metric.value} cite={row.metric.cite} />
							{row.metric.label}
						</span>
						<span>{stateLabel(row.state)} / {row.action}</span>
					</span>
				</a>
			{/each}
		</div>
	</section>

	{#if !isConnected}
		<div class="border-surface-border bg-surface-base rounded-md border p-5">
			<p class="text-text-primary text-sm font-medium">Use CSV export profiles now</p>
			<p class="text-text-tertiary mt-1 text-sm">
				Export people from a supported platform, then upload the CSV. Commons can recognize known
				export profiles and map email, name, postal code, phone, country, tags, and message-consent
				fields through the shipped import path.
			</p>
			<div class="mt-4 flex flex-wrap gap-3">
				<a
					href="/org/{data.org.slug}/supporters/import#csv-intake"
					class="bg-surface-overlay text-text-primary hover:bg-surface-raised inline-flex rounded-md px-4 py-2 text-sm font-semibold"
				>
					Open CSV intake
				</a>
			</div>
		</div>

		<div class="border-surface-border bg-surface-base rounded-md border p-5">
			<p class="text-text-primary text-sm font-medium">Store encrypted API credential</p>
			<p class="text-text-tertiary mt-1 text-sm">
				This only stores custody for a selected platform profile. It does not call the platform,
				page through records, or import people.
			</p>
			<form method="POST" action="?/connect" class="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
				<label class="grid gap-1 text-sm">
					<span class="text-text-tertiary text-xs font-medium">Platform profile</span>
					<select
						name="platform_source"
						required
						disabled={!credentialCustodyReady}
						class="border-surface-border bg-surface-base text-text-primary rounded-md border px-3 py-2 text-sm disabled:opacity-50"
					>
						<option value="">Choose profile</option>
						{#each platformProfileRows as row (row.source)}
							<option value={row.source}>{row.label}</option>
						{/each}
					</select>
				</label>
				<label class="grid gap-1 text-sm">
					<span class="text-text-tertiary text-xs font-medium">API credential</span>
					<input
						name="api_key"
						type="password"
						autocomplete="off"
						required
						disabled={!credentialCustodyReady}
						class="border-surface-border bg-surface-base text-text-primary rounded-md border px-3 py-2 text-sm disabled:opacity-50"
						placeholder={credentialCustodyReady
							? 'stored encrypted at rest'
							: 'custody key missing'}
					/>
				</label>
				<button
					type="submit"
					disabled={!credentialCustodyReady}
					class="bg-surface-overlay text-text-primary hover:bg-surface-raised self-end rounded-md px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
				>
					Store credential
				</button>
			</form>
			{#if !credentialCustodyReady}
				<p class="text-text-quaternary mt-3 text-xs">
					Configure platform credential encryption before platform API credentials can be stored.
				</p>
			{/if}
		</div>
	{:else}
		<div id="platform-stored-state" class="border-surface-border space-y-4 rounded-md border p-5">
			<div class="flex items-start justify-between gap-4">
				<div>
					<p class="text-text-primary text-sm font-medium">Stored platform state</p>
					<p class="text-text-tertiary mt-1 text-xs">
						{adapterLabel ?? 'Platform'} credential stored {relativeTime(sync?.credentialStoredAt)}.
						Custody probe: {relativeTime(credentialProbeCompletedAt)}. Last recorded sync:
						{relativeTime(sync?.lastSyncAt)}
					</p>
				</div>
				<form method="POST" action="?/disconnect">
					<button
						type="submit"
						class="text-xs text-red-400/70 transition-colors hover:text-red-400"
						onclick={(e) => {
							if (
								!confirm('Remove stored platform sync state? Imported people will not be deleted.')
							) {
								e.preventDefault();
							}
						}}
					>
						Remove stored state
					</button>
				</form>
			</div>

			{#if platformDirectImportEvidenceObserved}
				<div class="grid gap-3 sm:grid-cols-4" aria-label="Direct import execution evidence">
					<div class="border-surface-border bg-surface-base rounded-md border p-3">
						<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
							<Datum value={sync?.imported ?? 0} cite="stored platform adapter imported" />
						</p>
						<p class="text-text-tertiary text-xs">imported</p>
					</div>
					<div class="border-surface-border bg-surface-base rounded-md border p-3">
						<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
							<Datum value={sync?.updated ?? 0} cite="stored platform adapter updated" />
						</p>
						<p class="text-text-tertiary text-xs">updated</p>
					</div>
					<div class="border-surface-border bg-surface-base rounded-md border p-3">
						<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
							<Datum value={sync?.skipped ?? 0} cite="stored platform adapter skipped" />
						</p>
						<p class="text-text-tertiary text-xs">skipped</p>
					</div>
					<div class="border-surface-border bg-surface-base rounded-md border p-3">
						<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
							{#if progressPct === null}
								<Datum value={null} cite="stored platform adapter processed/total" />
							{:else}
								<Datum value={progressPct} cite="stored platform adapter processed/total" />%
							{/if}
						</p>
						<p class="text-text-tertiary text-xs">execution progress</p>
					</div>
				</div>
			{:else}
				<div class="grid gap-3 sm:grid-cols-4" aria-label="Stored platform custody evidence">
					<div class="border-surface-border bg-surface-base rounded-md border p-3">
						<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
							<Datum value={isConnected ? 1 : 0} cite="stored platform credential envelope" />
						</p>
						<p class="text-text-tertiary text-xs">stored envelope</p>
					</div>
					<div class="border-surface-border bg-surface-base rounded-md border p-3">
						<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
							<Datum
								value={credentialProbeComplete ? 1 : 0}
								cite="stored platform credential probe"
							/>
						</p>
						<p class="text-text-tertiary text-xs">custody probe</p>
					</div>
					<div class="border-surface-border bg-surface-base rounded-md border p-3">
						<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
							<Datum
								value={platformApiSyncRunnerImplemented ? 1 : 0}
								cite="PLATFORM_API_SYNC_RUNNER_IMPLEMENTED"
							/>
						</p>
						<p class="text-text-tertiary text-xs">direct runner</p>
					</div>
					<div class="border-surface-border bg-surface-base rounded-md border p-3">
						<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
							<Datum
								value={platformApiRuntimeHeldCount}
								cite="getPlatformApiSyncReadiness.missing"
							/>
						</p>
						<p class="text-text-tertiary text-xs">held checks</p>
					</div>
				</div>
			{/if}

			<p class="text-text-quaternary text-xs">
				Stored status `{sync?.status ?? 'unknown'}` and credential version `{sync?.credentialVersion ??
					'unknown'}` are custody metadata. Probe version `{sync?.credentialProbeVersion ??
					'not probed'}` proves only that the encrypted envelope opened for this org/profile. Direct
				import counters stay hidden until execution evidence exists, so stored custody cannot read
				as a zero-row sync.
			</p>

			<div class="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
				<p class="text-sm font-medium text-emerald-700">Verify custody boundary</p>
				<p class="text-text-tertiary mt-1 text-xs">
					Probe opens the encrypted credential envelope for this org/profile and then stops. It does
					not call the platform, page through records, or import people.
				</p>
				<form method="POST" action="?/sync" class="mt-3">
					<button
						type="submit"
						class="bg-surface-overlay text-text-primary hover:bg-surface-raised rounded-md px-4 py-2 text-sm font-semibold"
					>
						Verify stored credential
					</button>
				</form>
			</div>

			{#if sync?.directImportArmed}
				{@const resumable =
					Boolean(sync?.checkpoint) && (sync?.status === 'running' || sync?.status === 'failed')}
				<div class="border-surface-border bg-surface-base rounded-md border px-4 py-3">
					<p class="text-text-primary text-sm font-medium">Bounded direct import</p>
					<p class="text-text-tertiary mt-1 text-xs">
						Each run fetches at most <Datum
							value={form?.maxPagesPerSlice ?? data.maxPagesPerSlice}
							cite="runner.MAX_PAGES_PER_SLICE"
						/> vendor pages through the {adapterLabel ?? sync?.adapterLabel ?? 'platform'} adapter, hands
						records to the existing encrypted import pipeline, and persists a continuation checkpoint.
						Subscription status maps to email/SMS state in the stricter direction only — upstream re-subscribes
						are not auto-applied — and consent text is not fabricated. Page-offset checkpoints can shift
						if the vendor list changes mid-sync; a periodic full import reconciles. Tag and list sync
						stay gated.
					</p>
					<div class="mt-3 flex flex-wrap items-center gap-2">
						<form method="POST" action="?/import">
							<button
								type="submit"
								class="bg-surface-overlay text-text-primary hover:bg-surface-raised rounded-md px-4 py-2 text-sm font-semibold"
							>
								{#if resumable}
									Continue import (next: page {sync?.checkpoint})
								{:else}
									Run bounded import slice
								{/if}
							</button>
						</form>
						{#if !resumable && sync?.lastSyncAt}
							<form method="POST" action="?/import">
								<input type="hidden" name="sync_type" value="incremental" />
								<button
									type="submit"
									class="border-surface-border text-text-secondary hover:bg-surface-raised rounded-md border px-4 py-2 text-sm font-medium"
								>
									Import changes since last sync
								</button>
							</form>
						{/if}
					</div>
					{#if form?.sliceComplete}
						<p class="text-text-tertiary mt-3 font-mono text-xs">
							Slice fetched <Datum value={form.pagesFetched ?? 0} cite="?/import slice result" /> vendor
							pages.
							{form.syncComplete
								? 'Sync complete; counters above are the stored run totals.'
								: `Checkpoint persisted at page ${form.nextCheckpoint}; continue to fetch the next slice.`}
							{#if (form.droppedNoEmail ?? 0) > 0}
								<Datum value={form.droppedNoEmail} cite="adapter rows without email" /> vendor rows had
								no usable email and were skipped.
							{/if}
							{#if (form.rowErrorCount ?? 0) > 0}
								<Datum value={form.rowErrorCount} cite="importWithEncryption row errors" /> rows logged
								import errors; see stored errors below.
							{/if}
						</p>
					{/if}
				</div>
			{/if}

			{#if errorList.length > 0}
				<div class="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3">
					<p class="mb-2 text-sm font-medium text-amber-300">
						Stored errors (<Datum value={errorList.length} cite="stored platform adapter errors" />)
					</p>
					<ul class="max-h-40 space-y-1 overflow-y-auto font-mono text-xs text-amber-400/80">
						{#each errorList.slice(0, 20) as err}
							<li>{err}</li>
						{/each}
						{#if errorList.length > 20}
							<li class="text-amber-500/50">...and {errorList.length - 20} more</li>
						{/if}
					</ul>
				</div>
			{/if}
		</div>
	{/if}

	<div class="pt-2">
		<a
			href="/org/{data.org.slug}/supporters/import"
			class="text-text-tertiary hover:text-text-secondary inline-flex items-center gap-2 text-sm transition-colors"
		>
			Back to import
		</a>
	</div>
</div>
