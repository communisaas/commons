<script lang="ts">
	import BoundedNotice from '$lib/components/org/BoundedNotice.svelte';
	import {
		PLATFORM_SYNC_PATH_SENTENCE,
		platformApiSyncLimitNotice
	} from '$lib/data/org-limit-sentences';
	import { PLATFORM_EXPORT_PROFILES } from '$lib/data/platform-export-profiles';
	import { Datum } from '$lib/design';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const sync = $derived(data.sync);
	const isConnected = $derived(data.connected);
	const platformApiSyncReadiness = $derived(data.platformApiSyncReadiness ?? null);
	const credentialCustodyReady = $derived(
		platformApiSyncReadiness?.credentialCustodyReady ?? data.credentialCustodyReady
	);
	const platformApiSyncRuntimeMissing = $derived(
		platformApiSyncReadiness?.missing ?? data.platformApiSyncRuntimeMissing ?? []
	);
	const platformApiSyncRuntimeDependency = $derived(
		platformApiSyncReadiness?.dependency ?? data.platformApiSyncRuntimeDependency ?? ''
	);
	const platformApiSyncRuntimeMessage = $derived(
		platformApiSyncReadiness?.message ?? data.platformApiSyncRuntimeMessage ?? ''
	);
	const directImportArmed = $derived(Boolean(sync?.directImportArmed));
	const platformLimitNotice = $derived(
		directImportArmed || !isConnected
			? null
			: platformApiSyncLimitNotice(
					{
						runtimeMissing: platformApiSyncRuntimeMissing,
						runtimeDependency: platformApiSyncRuntimeDependency,
						runtimeMessage: platformApiSyncRuntimeMessage
					},
					credentialCustodyReady
						? 'platform_api_sync_not_armed'
						: 'platform_api_credential_custody_not_configured'
				)
	);
	const formCode = $derived(typeof form?.code === 'string' ? form.code : null);
	const formMissing = $derived(Array.isArray(form?.missing) ? (form.missing as string[]) : []);
	const adapterLabel = $derived(sync?.adapterLabel ?? form?.adapterLabel ?? null);
	const credentialProbeCompletedAt = $derived(
		sync?.credentialProbeCompletedAt ?? form?.credentialProbeCompletedAt ?? null
	);
	const errorList = $derived(Array.isArray(sync?.errors) ? (sync.errors as string[]) : []);
	const progressPct = $derived(
		sync && sync.totalResources > 0
			? Math.min(100, Math.round((sync.processedResources / sync.totalResources) * 100))
			: null
	);
	// Execution evidence is per-org run output only; never show zero-row counters
	// for an org that has never run an import.
	const platformDirectImportEvidenceObserved = $derived(
		(sync?.totalResources ?? 0) > 0 ||
			(sync?.processedResources ?? 0) > 0 ||
			(sync?.imported ?? 0) > 0 ||
			(sync?.updated ?? 0) > 0 ||
			(sync?.skipped ?? 0) > 0 ||
			Boolean(sync?.lastSyncAt) ||
			Boolean(sync?.checkpoint)
	);

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
				People
			</a>
			<span aria-hidden="true">/</span>
			<a
				href="/org/{data.org.slug}/supporters/import"
				class="hover:text-text-secondary transition-colors"
			>
				Import
			</a>
			<span aria-hidden="true">/</span>
			<span>Platform sync</span>
		</nav>
		<h1 class="text-text-primary text-xl font-semibold">Platform sync</h1>
		{#if !isConnected && !directImportArmed}
			<p class="text-text-tertiary mt-1 text-sm">{PLATFORM_SYNC_PATH_SENTENCE}</p>
		{/if}
	</div>

	{#if platformLimitNotice}
		<div id="platform-sync-boundary" class="border-surface-border bg-surface-base rounded-md border px-4 py-3">
			<BoundedNotice notice={platformLimitNotice} />
		</div>
	{/if}

	{#if form?.error}
		<div class="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
			{form.error}
			{#if formCode || formMissing.length > 0}
				<details class="mt-2">
					<summary class="cursor-pointer text-xs text-red-300/80">
						Details for your administrator
					</summary>
					<ul class="mt-1 space-y-1 pl-4 font-mono text-xs text-red-300/80">
						{#if formCode}
							<li>{formCode}</li>
						{/if}
						{#if formMissing.length > 0}
							<li>Missing: {formMissing.join(', ')}</li>
						{/if}
					</ul>
				</details>
			{/if}
		</div>
	{/if}
	{#if form?.disconnected}
		<div
			class="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300"
		>
			Stored platform connection removed.
		</div>
	{/if}
	{#if form?.connected}
		<div
			class="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700"
		>
			Encrypted {form.adapterLabel ?? 'platform'} credential stored.
		</div>
	{/if}
	{#if form?.probed}
		<div
			class="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700"
		>
			{form.probeMessage}
			<p class="mt-2 font-mono text-xs text-emerald-800/70">
				{form.adapterLabel ?? 'Platform'} · checked {relativeTime(form.credentialProbeCompletedAt)}
			</p>
		</div>
	{/if}

	{#if !isConnected}
		<div class="border-surface-border bg-surface-base rounded-md border p-5">
			<p class="text-text-primary text-sm font-medium">Import by CSV</p>
			<p class="text-text-tertiary mt-1 text-sm">
				Export people from your current platform, then upload the CSV. Commons recognizes common
				export formats and maps email, name, postal code, phone, country, tags, and consent fields.
			</p>
			<div class="mt-4 flex flex-wrap gap-3">
				<a
					href="/org/{data.org.slug}/supporters/import#csv-intake"
					class="bg-surface-overlay text-text-primary hover:bg-surface-raised inline-flex rounded-md px-4 py-2 text-sm font-semibold"
				>
					Open CSV import
				</a>
			</div>
		</div>

		<div class="border-surface-border bg-surface-base rounded-md border p-5">
			<p class="text-text-primary text-sm font-medium">Connect a platform</p>
			<p class="text-text-tertiary mt-1 text-sm">Your API credential is stored encrypted.</p>
			<form method="POST" action="?/connect" class="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
				<label class="grid gap-1 text-sm">
					<span class="text-text-tertiary text-xs font-medium">Platform</span>
					<select
						name="platform_source"
						required
						disabled={!credentialCustodyReady}
						class="border-surface-border bg-surface-base text-text-primary rounded-md border px-3 py-2 text-sm disabled:opacity-50"
					>
						<option value="">Choose platform</option>
						{#each PLATFORM_EXPORT_PROFILES as profile (profile.source)}
							<option value={profile.source}>{profile.label}</option>
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
						placeholder={credentialCustodyReady ? 'stored encrypted at rest' : 'not available yet'}
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
		</div>
	{:else}
		<div id="platform-stored-state" class="border-surface-border space-y-4 rounded-md border p-5">
			<div class="flex items-start justify-between gap-4">
				<div>
					<p class="text-text-primary text-sm font-medium">
						{adapterLabel ?? 'Platform'} connection
					</p>
					<p class="text-text-tertiary mt-1 text-xs">
						Credential stored {relativeTime(sync?.credentialStoredAt)}. Last checked: {relativeTime(
							credentialProbeCompletedAt
						)}. Last import:
						{relativeTime(sync?.lastSyncAt)}
					</p>
				</div>
				<form method="POST" action="?/disconnect">
					<button
						type="submit"
						class="text-xs text-red-400/70 transition-colors hover:text-red-400"
						onclick={(e) => {
							if (
								!confirm('Remove the stored platform connection? Imported people will not be deleted.')
							) {
								e.preventDefault();
							}
						}}
					>
						Remove connection
					</button>
				</form>
			</div>

			{#if platformDirectImportEvidenceObserved}
				<div class="grid gap-3 sm:grid-cols-4" aria-label="Direct import results">
					<div class="border-surface-border bg-surface-base rounded-md border p-3">
						<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
							<Datum value={sync?.imported ?? 0} />
						</p>
						<p class="text-text-tertiary text-xs">imported</p>
					</div>
					<div class="border-surface-border bg-surface-base rounded-md border p-3">
						<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
							<Datum value={sync?.updated ?? 0} />
						</p>
						<p class="text-text-tertiary text-xs">updated</p>
					</div>
					<div class="border-surface-border bg-surface-base rounded-md border p-3">
						<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
							<Datum value={sync?.skipped ?? 0} />
						</p>
						<p class="text-text-tertiary text-xs">skipped</p>
					</div>
					<div class="border-surface-border bg-surface-base rounded-md border p-3">
						<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
							{#if progressPct === null}
								<Datum value={null} />
							{:else}
								<Datum value={progressPct} />%
							{/if}
						</p>
						<p class="text-text-tertiary text-xs">progress</p>
					</div>
				</div>
			{/if}

			<div class="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
				<p class="text-sm font-medium text-emerald-700">Check the stored credential</p>
				<p class="text-text-tertiary mt-1 text-xs">
					Confirms your stored key still opens correctly. It does not contact the platform or
					import anyone.
				</p>
				<form method="POST" action="?/sync" class="mt-3">
					<button
						type="submit"
						class="bg-surface-overlay text-text-primary hover:bg-surface-raised rounded-md px-4 py-2 text-sm font-semibold"
					>
						Check credential
					</button>
				</form>
			</div>

			{#if sync?.directImportArmed}
				{@const resumable =
					Boolean(sync?.checkpoint) && (sync?.status === 'running' || sync?.status === 'failed')}
				<div class="border-surface-border bg-surface-base rounded-md border px-4 py-3">
					<p class="text-text-primary text-sm font-medium">Direct import</p>
					<p class="text-text-tertiary mt-1 text-xs">
						Each run imports up to <Datum value={form?.maxPagesPerSlice ?? data.maxPagesPerSlice} />
						pages of people from {adapterLabel ?? sync?.adapterLabel ?? 'the platform'} and saves its
						place so the next run continues where it left off. Unsubscribes only tighten — people who
						re-subscribed upstream are not automatically re-subscribed here. Run a full import
						periodically to reconcile.
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
									Run import
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
							Fetched <Datum value={form.pagesFetched ?? 0} /> pages.
							{form.syncComplete
								? 'Import complete; the totals above are up to date.'
								: `Saved at page ${form.nextCheckpoint}; run again to continue.`}
							{#if (form.droppedNoEmail ?? 0) > 0}
								<Datum value={form.droppedNoEmail} /> rows had no usable email and were skipped.
							{/if}
							{#if (form.rowErrorCount ?? 0) > 0}
								<Datum value={form.rowErrorCount} /> rows logged import errors; see stored errors below.
							{/if}
						</p>
					{/if}
				</div>
			{/if}

			{#if errorList.length > 0}
				<div class="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3">
					<p class="mb-2 text-sm font-medium text-amber-300">
						Stored errors (<Datum value={errorList.length} />)
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
