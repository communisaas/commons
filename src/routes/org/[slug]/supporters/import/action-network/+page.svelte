<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let apiKeyInput = $state('');
	let connecting = $state(false);
	let syncing = $state(false);
	let pollInterval = $state<ReturnType<typeof setInterval> | null>(null);

	// Start polling when sync is running
	$effect(() => {
		const isRunning = data.sync?.status === 'running';
		if (isRunning && !pollInterval) {
			pollInterval = setInterval(() => {
				invalidateAll();
			}, 3000);
		} else if (!isRunning && pollInterval) {
			clearInterval(pollInterval);
			pollInterval = null;
		}

		return () => {
			if (pollInterval) {
				clearInterval(pollInterval);
				pollInterval = null;
			}
		};
	});

	// Derived state
	const isConnected = $derived(data.connected);
	const sync = $derived(data.sync);
	const isRunning = $derived(sync?.status === 'running');
	const progressPct = $derived(
		sync && sync.totalResources > 0
			? Math.min(100, Math.round((sync.processedResources / sync.totalResources) * 100))
			: null
	);

	function relativeTime(iso: string | null): string {
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

<div class="space-y-6">
	<!-- Header -->
	<div>
		<nav class="flex items-center gap-2 text-sm text-text-tertiary mb-4">
			<a href="/org/{data.org.slug}/supporters" class="hover:text-text-secondary transition-colors">
				Supporters
			</a>
			<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
			</svg>
			<a href="/org/{data.org.slug}/supporters/import" class="hover:text-text-secondary transition-colors">
				Import
			</a>
			<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
			</svg>
			<span class="text-text-tertiary">Action Network</span>
		</nav>
		<h1 class="text-xl font-semibold text-text-primary">Action Network Sync</h1>
		<p class="text-sm text-text-tertiary mt-1">
			Connect your Action Network API key to sync supporters, tags, and actions.
		</p>
	</div>

	<!-- Error display -->
	{#if form?.error}
		<div class="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
			{form.error}
		</div>
	{/if}

	<!-- Success messages -->
	{#if form?.connected}
		<div class="rounded-lg border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-300">
			API key connected successfully. You can now start a sync.
		</div>
	{/if}
	{#if form?.disconnected}
		<div class="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
			Action Network connection removed.
		</div>
	{/if}

	{#if !isConnected}
		<!-- ── Connect Form ─────────────────────────────────────── -->
		<div class="rounded-md border border-surface-border bg-surface-base p-6 space-y-4">
			<div class="flex items-center gap-3">
				<div class="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
					<svg class="w-5 h-5 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
					</svg>
				</div>
				<div>
					<p class="text-sm font-medium text-text-primary">Connect Action Network</p>
					<p class="text-xs text-text-tertiary">Enter your OSDI API Token to sync supporters.</p>
				</div>
			</div>

			<form
				method="POST"
				action="?/connect"
				use:enhance={() => {
					connecting = true;
					return async ({ update }) => {
						connecting = false;
						await update();
					};
				}}
			>
				<div class="space-y-3">
					<div>
						<label for="api-key" class="block text-xs text-text-tertiary mb-1.5">OSDI API Token</label>
						<input
							id="api-key"
							type="password"
							name="api_key"
							bind:value={apiKeyInput}
							placeholder="Paste your API key here..."
							autocomplete="off"
							class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-4 py-2.5 text-sm text-text-primary placeholder-text-quaternary focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none transition-colors font-mono"
						/>
					</div>
					<p class="text-xs text-text-quaternary">
						Find your API key at
						<span class="text-text-tertiary">actionnetwork.org &rarr; Start Organizing &rarr; Details &rarr; API &amp; Sync</span>
					</p>
					<button
						type="submit"
						disabled={!apiKeyInput.trim() || connecting}
						class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white transition-colors
						{!apiKeyInput.trim() || connecting ? 'opacity-50 cursor-not-allowed' : 'hover:bg-teal-500'}"
					>
						{#if connecting}
							<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
							</svg>
							Validating...
						{:else}
							Connect
						{/if}
					</button>
				</div>
			</form>
		</div>

	{:else}
		<!-- ── Connected State ──────────────────────────────────── -->

		<!-- Connection status card -->
		<div class="rounded-md border border-surface-border bg-surface-base p-6 space-y-4">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3">
					<div class="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
						<svg class="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
					</div>
					<div>
						<p class="text-sm font-medium text-text-primary">Action Network Connected</p>
						<p class="text-xs text-text-tertiary">
							Last synced: {relativeTime(sync?.lastSyncAt ?? null)}
						</p>
					</div>
				</div>

				<form method="POST" action="?/disconnect">
					<button
						type="submit"
						class="text-xs text-red-400/70 hover:text-red-400 transition-colors"
						onclick={(e) => {
							if (!confirm('Disconnect Action Network? This removes the stored API key. Imported supporters will not be deleted.')) {
								e.preventDefault();
							}
						}}
					>
						Disconnect
					</button>
				</form>
			</div>
		</div>

		<!-- Sync controls -->
		{#if !isRunning}
			<div class="flex items-center gap-3">
				<form
					method="POST"
					action="?/sync"
					use:enhance={() => {
						syncing = true;
						return async ({ update }) => {
							syncing = false;
							await update();
						};
					}}
				>
					<input type="hidden" name="sync_type" value="full" />
					<button
						type="submit"
						disabled={syncing}
						class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white transition-colors
						{syncing ? 'opacity-60 cursor-wait' : 'hover:bg-teal-500'}"
					>
						{#if syncing}
							<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
							</svg>
						{/if}
						Full Sync
					</button>
				</form>

				{#if sync?.lastSyncAt}
					<form
						method="POST"
						action="?/sync"
						use:enhance={() => {
							syncing = true;
							return async ({ update }) => {
								syncing = false;
								await update();
							};
						}}
					>
						<input type="hidden" name="sync_type" value="incremental" />
						<button
							type="submit"
							disabled={syncing}
							class="inline-flex items-center gap-2 rounded-lg border border-surface-border-strong bg-surface-raised px-5 py-2.5 text-sm font-medium text-text-primary transition-colors
							{syncing ? 'opacity-60 cursor-wait' : 'hover:bg-surface-overlay hover:border-text-quaternary'}"
						>
							Incremental Sync
						</button>
					</form>
				{/if}
			</div>

			<p class="text-xs text-text-quaternary">
				Full sync imports all supporters. Incremental sync only imports changes since the last sync.
			</p>
		{/if}

		<!-- ── Running sync progress ────────────────────────────── -->
		{#if isRunning && sync}
			<div class="rounded-md border border-teal-500/30 bg-teal-500/5 p-6 space-y-4">
				<div class="flex items-center gap-3">
					<svg class="w-5 h-5 text-teal-400 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
					<div>
						<p class="text-sm font-medium text-teal-300">Sync in progress</p>
						<p class="text-xs text-text-tertiary">
							{sync.syncType === 'incremental' ? 'Incremental' : 'Full'} sync
							{#if sync.currentResource}
								&mdash; processing {sync.currentResource}
							{/if}
						</p>
					</div>
				</div>

				<!-- Progress bar -->
				{#if progressPct !== null}
					<div class="space-y-1.5">
						<div class="flex items-center justify-between text-xs">
							<span class="text-text-tertiary">{sync.processedResources.toLocaleString()} / {sync.totalResources.toLocaleString()}</span>
							<span class="font-mono text-text-tertiary">{progressPct}%</span>
						</div>
						<div class="h-1.5 rounded-full bg-surface-overlay overflow-hidden">
							<div
								class="h-full rounded-full bg-teal-500 transition-all duration-500"
								style="width: {progressPct}%"
							></div>
						</div>
					</div>
				{:else}
					<div class="h-1.5 rounded-full bg-surface-overlay overflow-hidden">
						<div class="h-full w-1/3 rounded-full bg-teal-500 animate-pulse"></div>
					</div>
				{/if}

				<!-- Live counters -->
				<div class="grid grid-cols-3 gap-3">
					<div class="rounded-lg border border-surface-border bg-surface-base p-3 text-center">
						<p class="font-mono tabular-nums text-lg font-bold text-text-primary">{sync.imported}</p>
						<p class="text-xs text-text-tertiary">Imported</p>
					</div>
					<div class="rounded-lg border border-surface-border bg-surface-base p-3 text-center">
						<p class="font-mono tabular-nums text-lg font-bold text-text-primary">{sync.updated}</p>
						<p class="text-xs text-text-tertiary">Updated</p>
					</div>
					<div class="rounded-lg border border-surface-border bg-surface-base p-3 text-center">
						<p class="font-mono tabular-nums text-lg font-bold text-text-primary">{sync.skipped}</p>
						<p class="text-xs text-text-tertiary">Skipped</p>
					</div>
				</div>
			</div>
		{/if}

		<!-- ── Completed sync summary ───────────────────────────── -->
		{#if sync && (sync.status === 'completed' || sync.status === 'failed') && !isRunning}
			<div class="rounded-md border {sync.status === 'completed' ? 'border-teal-500/30 bg-teal-500/10' : 'border-red-500/30 bg-red-500/10'} p-6 space-y-4">
				<div class="flex items-center gap-3">
					{#if sync.status === 'completed'}
						<svg class="w-6 h-6 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
						<p class="text-lg font-medium text-teal-300">Sync Complete</p>
					{:else}
						<svg class="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
						</svg>
						<p class="text-lg font-medium text-red-300">Sync Failed</p>
					{/if}
				</div>

				<div class="grid grid-cols-3 gap-4">
					<div class="rounded-lg border border-surface-border bg-surface-base p-3 text-center">
						<p class="font-mono tabular-nums text-2xl font-bold text-text-primary">{sync.imported}</p>
						<p class="text-xs text-text-tertiary">Imported</p>
					</div>
					<div class="rounded-lg border border-surface-border bg-surface-base p-3 text-center">
						<p class="font-mono tabular-nums text-2xl font-bold text-text-primary">{sync.updated}</p>
						<p class="text-xs text-text-tertiary">Updated</p>
					</div>
					<div class="rounded-lg border border-surface-border bg-surface-base p-3 text-center">
						<p class="font-mono tabular-nums text-2xl font-bold text-text-primary">{sync.skipped}</p>
						<p class="text-xs text-text-tertiary">Skipped</p>
					</div>
				</div>

				{#if sync.completedAt}
					<p class="text-xs text-text-quaternary">
						{sync.syncType === 'incremental' ? 'Incremental' : 'Full'} sync completed {relativeTime(sync.completedAt)}
					</p>
				{/if}

				{#if sync.errors && sync.errors.length > 0}
					<div class="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
						<p class="text-sm font-medium text-amber-300 mb-2">Errors ({sync.errors.length})</p>
						<ul class="text-xs text-amber-400/80 space-y-1 font-mono max-h-40 overflow-y-auto">
							{#each sync.errors.slice(0, 20) as err}
								<li>{err}</li>
							{/each}
							{#if sync.errors.length > 20}
								<li class="text-amber-500/50">...and {sync.errors.length - 20} more</li>
							{/if}
						</ul>
					</div>
				{/if}

				<div class="flex items-center gap-3 pt-2">
					<a
						href="/org/{data.org.slug}/supporters"
						class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-teal-500 transition-colors"
					>
						View Supporters
					</a>
				</div>
			</div>
		{/if}

		<!-- ── Idle / no sync yet ───────────────────────────────── -->
		{#if sync?.status === 'idle' && !form?.connected}
			<div class="rounded-lg border border-surface-border bg-surface-base px-4 py-3 text-sm text-text-tertiary">
				Ready to sync. Click "Full Sync" to import all supporters from Action Network.
			</div>
		{/if}
	{/if}

	<!-- Back link -->
	<div class="pt-2">
		<a
			href="/org/{data.org.slug}/supporters/import"
			class="inline-flex items-center gap-2 text-sm text-text-tertiary hover:text-text-secondary transition-colors"
		>
			<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
				<path stroke-linecap="round" stroke-linejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
			</svg>
			Back to Import
		</a>
	</div>
</div>
