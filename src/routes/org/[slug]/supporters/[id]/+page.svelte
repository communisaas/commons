<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatPeopleSourceLabel } from '$lib/data/platform-export-profiles';
	import type { PageData, ActionData } from './$types';

	type TagView = { id: string; name: string };

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const supporterTags = $derived((data.supporter.tags ?? []) as TagView[]);
	const allTags = $derived((data.allTags ?? []) as TagView[]);

	// ── Client-side PII decryption ──
	let decryptedEmail = $state('');
	let decryptedName = $state('');
	let decryptedPhone = $state('');
	let decryptedCustomFields = $state<Record<string, string>>({});

	$effect(() => {
		decryptDetail();
	});

	async function decryptDetail() {
		try {
			const { getOrPromptOrgKey } = await import('$lib/services/org-key-manager');
			const { decryptOrgPii } = await import('$lib/core/crypto/org-pii-encryption');

			const verifier = data.encryption?.orgKeyVerifier;
			if (!verifier) return;

			const orgKey = await getOrPromptOrgKey(data.org.id, verifier);
			if (!orgKey) return;

			const entityId = `supporter:${data.supporter.id}`;
			const emailHash = data.supporter.emailHash ?? '';
			if (data.supporter.encryptedEmail) {
				try {
					decryptedEmail = await decryptOrgPii(
						JSON.parse(data.supporter.encryptedEmail),
						orgKey,
						emailHash,
						entityId,
						'email'
					);
				} catch {}
			}
			if (data.supporter.encryptedName) {
				try {
					decryptedName = await decryptOrgPii(
						JSON.parse(data.supporter.encryptedName),
						orgKey,
						emailHash,
						entityId,
						'name'
					);
				} catch {}
			}
			if (data.supporter.encryptedPhone) {
				try {
					decryptedPhone = await decryptOrgPii(
						JSON.parse(data.supporter.encryptedPhone),
						orgKey,
						emailHash,
						entityId,
						'phone'
					);
				} catch {}
			}
			if (data.supporter.encryptedCustomFields) {
				try {
					const customFieldsJson = await decryptOrgPii(
						JSON.parse(data.supporter.encryptedCustomFields),
						orgKey,
						emailHash,
						entityId,
						'customFields'
					);
					const parsed = JSON.parse(customFieldsJson);
					decryptedCustomFields =
						parsed && typeof parsed === 'object' && !Array.isArray(parsed)
							? Object.fromEntries(
									Object.entries(parsed as Record<string, unknown>)
										.filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
										.map(([key, value]) => [key, String(value)])
								)
							: {};
				} catch {}
			}
		} catch {}
	}

	const canEdit = $derived(data.membership.role === 'owner' || data.membership.role === 'editor');
	const vState = $derived(
		data.supporter.identityVerified
			? 'Verified'
			: data.supporter.postalCode
				? 'Resolved'
				: 'Imported'
	);

	const currentTagIds = $derived(new Set(supporterTags.map((t) => t.id)));
	const availableTags = $derived(allTags.filter((t) => !currentTagIds.has(t.id)));
	const customFieldEntries = $derived(Object.entries(decryptedCustomFields));
	function sourceLabel(s: string | null): string {
		return formatPeopleSourceLabel(s ?? 'unknown', {
			style: 'record',
			fallback: 'Unknown source'
		});
	}

	function formatDate(iso: string | null): string {
		if (!iso) return '\u2014';
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}
</script>

<div class="space-y-6">
	<!-- Breadcrumb -->
	<nav class="text-text-tertiary flex items-center gap-2 text-sm">
		<a href="/org/{data.org.slug}/supporters" class="hover:text-text-secondary transition-colors">
			People
		</a>
		<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
			<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
		</svg>
		<span class="text-text-tertiary truncate">{decryptedName || decryptedEmail || '\u2014'}</span>
	</nav>

	<!-- Verification status hero -->
	<div id="person-verification" class="border-surface-border bg-surface-base rounded-md border p-6">
		<div class="flex items-center gap-4">
			{#if vState === 'Verified'}
				<div class="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
					<span class="inline-block h-5 w-5 rounded-full bg-emerald-500"></span>
				</div>
				<div>
					<p class="text-sm font-medium text-emerald-400">Verified</p>
					<p class="text-text-tertiary mt-0.5 text-xs">
						Identity verified via ZK proof of residency
					</p>
				</div>
			{:else if vState === 'Resolved'}
				<div class="flex h-12 w-12 items-center justify-center rounded-full bg-teal-500/15">
					<span class="inline-block h-5 w-5 rounded-full border-2 border-teal-500 bg-teal-500/30"
					></span>
				</div>
				<div>
					<p class="text-sm font-medium text-teal-400">District-Resolved</p>
					<p class="text-text-tertiary mt-0.5 text-xs">
						Postal code resolves to a district, awaiting identity verification
					</p>
				</div>
			{:else}
				<div class="bg-surface-overlay flex h-12 w-12 items-center justify-center rounded-full">
					<span class="bg-text-quaternary inline-block h-5 w-5 rounded-full"></span>
				</div>
				<div>
					<p class="text-text-tertiary text-sm font-medium">Imported</p>
					<p class="text-text-tertiary mt-0.5 text-xs">Imported record, no verification data yet</p>
				</div>
			{/if}
		</div>
	</div>

	<!-- Row fields -->
	<div
		id="person-reach-boundary"
		aria-label="Encrypted person row fields"
		class="border-surface-border bg-surface-base divide-surface-border divide-y rounded-md border"
	>
		<div class="flex items-center justify-between px-5 py-4">
			<span class="text-text-tertiary text-xs">Email</span>
			<div class="flex items-center gap-2">
				{#if data.supporter.emailStatus === 'unsubscribed'}
					<span class="inline-block h-1.5 w-1.5 rounded-full bg-yellow-500"></span>
				{:else if data.supporter.emailStatus === 'bounced' || data.supporter.emailStatus === 'complained'}
					<span class="inline-block h-1.5 w-1.5 rounded-full bg-red-500"></span>
				{/if}
				<span
					class="text-text-primary text-sm {data.supporter.emailStatus === 'complained'
						? 'text-text-tertiary line-through'
						: ''}">{decryptedEmail || '\u2014'}</span
				>
				<span class="text-text-quaternary font-mono text-xs capitalize"
					>({data.supporter.emailStatus})</span
				>
			</div>
		</div>
		<div class="flex items-center justify-between px-5 py-4">
			<span class="text-text-tertiary text-xs">Name</span>
			<span class="text-text-primary text-sm">{decryptedName || '\u2014'}</span>
		</div>
		<div class="flex items-center justify-between px-5 py-4">
			<span class="text-text-tertiary text-xs">Postal Code</span>
			<span class="text-text-primary font-mono text-sm"
				>{data.supporter.postalCode || '\u2014'}</span
			>
		</div>
		<div class="flex items-center justify-between px-5 py-4">
			<span class="text-text-tertiary text-xs">State / Province</span>
			<span class="text-text-primary font-mono text-sm">{data.supporter.stateCode || '\u2014'}</span
			>
		</div>
		<div class="flex items-center justify-between px-5 py-4">
			<span class="text-text-tertiary text-xs">Congressional District</span>
			<span class="text-text-primary font-mono text-sm"
				>{data.supporter.congressionalDistrict || '\u2014'}</span
			>
		</div>
		<div class="flex items-center justify-between px-5 py-4">
			<span class="text-text-tertiary text-xs">Country</span>
			<span class="text-text-primary text-sm">{data.supporter.country || '\u2014'}</span>
		</div>
		<div class="flex items-center justify-between px-5 py-4">
			<span class="text-text-tertiary text-xs">Phone</span>
			<span class="text-text-primary text-sm">{decryptedPhone || '\u2014'}</span>
		</div>
		{#if decryptedPhone}
			<div class="flex items-center justify-between px-5 py-4">
				<span class="text-text-tertiary text-xs">SMS Status</span>
				<div class="flex items-center gap-2">
					{#if data.supporter.smsStatus === 'stopped'}
						<span class="inline-block h-1.5 w-1.5 rounded-full bg-red-500"></span>
						<span class="text-text-primary text-sm">Stopped</span>
						<span class="text-text-quaternary text-xs">(via STOP keyword)</span>
					{:else if canEdit}
						<form
							method="POST"
							action="?/updateSmsStatus"
							use:enhance
							class="flex items-center gap-2"
						>
							<select
								name="smsStatus"
								class="border-surface-border-strong bg-surface-raised text-text-secondary rounded-lg border px-3 py-1.5 text-xs transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
							>
								{#each ['none', 'subscribed', 'unsubscribed'] as status}
									<option value={status} selected={data.supporter.smsStatus === status}>
										{status.charAt(0).toUpperCase() + status.slice(1)}
									</option>
								{/each}
							</select>
							<button
								type="submit"
								class="bg-surface-overlay text-text-secondary hover:bg-surface-border-strong rounded-lg px-3 py-1.5 text-xs transition-colors"
							>
								Update
							</button>
						</form>
					{:else}
						<span class="text-text-primary text-sm capitalize">{data.supporter.smsStatus}</span>
					{/if}
				</div>
			</div>
		{/if}
		<div class="flex items-center justify-between px-5 py-4">
			<span class="text-text-tertiary text-xs">Source</span>
			<span class="text-text-primary text-sm">{sourceLabel(data.supporter.source)}</span>
		</div>
		{#if data.supporter.encryptedCustomFields}
			<div class="px-5 py-4">
				<div class="mb-3 flex items-center justify-between gap-4">
					<span class="text-text-tertiary text-xs">Custom fields</span>
					<span class="text-text-quaternary font-mono text-xs">
						{customFieldEntries.length > 0 ? `${customFieldEntries.length} decrypted` : 'encrypted'}
					</span>
				</div>
				{#if customFieldEntries.length > 0}
					<div class="grid gap-2 sm:grid-cols-2">
						{#each customFieldEntries as [key, value]}
							<div class="border-surface-border bg-surface-raised rounded-md border px-3 py-2">
								<p
									class="text-text-quaternary truncate font-mono text-[10px] tracking-wider uppercase"
								>
									{key}
								</p>
								<p class="text-text-primary mt-1 truncate text-sm">{value}</p>
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-text-quaternary text-xs">
						Encrypted custom-field custody is present. Unlock the org key to inspect values.
					</p>
				{/if}
			</div>
		{/if}
		<div class="flex items-center justify-between px-5 py-4">
			<span class="text-text-tertiary text-xs">Imported</span>
			<span class="text-text-primary font-mono text-sm"
				>{formatDate(data.supporter.importedAt)}</span
			>
		</div>
		<div class="flex items-center justify-between px-5 py-4">
			<span class="text-text-tertiary text-xs">Added</span>
			<span class="text-text-primary font-mono text-sm">{formatDate(data.supporter.createdAt)}</span
			>
		</div>
	</div>

	<!-- Tag custody -->
	<div class="border-surface-border bg-surface-base space-y-4 rounded-md border p-5">
		<p class="text-text-tertiary font-mono text-xs tracking-wider uppercase">Tag custody</p>

		{#if form?.error}
			<div class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
				{form.error}
			</div>
		{/if}

		<!-- Current tags -->
		<div class="flex flex-wrap gap-2">
			{#if supporterTags.length === 0}
				<span class="text-text-quaternary text-xs">No row tags</span>
			{/if}
			{#each supporterTags as tag}
				<span
					class="bg-surface-overlay text-text-secondary inline-flex items-center gap-1.5 rounded-full py-1 pr-1.5 pl-3 text-xs"
				>
					{tag.name}
					{#if canEdit}
						<form method="POST" action="?/removeTag" use:enhance class="inline">
							<input type="hidden" name="tagId" value={tag.id} />
							<button
								type="submit"
								aria-label="Remove row tag {tag.name}"
								class="hover:bg-surface-border-strong rounded-full p-0.5 transition-colors"
							>
								<svg
									class="text-text-tertiary h-3 w-3"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
								>
									<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
								</svg>
							</button>
						</form>
					{/if}
				</span>
			{/each}
		</div>

		<!-- Add tag -->
		{#if canEdit && availableTags.length > 0}
			<form method="POST" action="?/addTag" use:enhance class="flex items-center gap-2">
				<select
					name="tagId"
					class="border-surface-border-strong bg-surface-raised text-text-secondary rounded-lg border px-3 py-1.5 text-xs transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
				>
					{#each availableTags as tag}
						<option value={tag.id}>{tag.name}</option>
					{/each}
				</select>
				<button
					type="submit"
					class="bg-surface-overlay text-text-secondary hover:bg-surface-border-strong rounded-lg px-3 py-1.5 text-xs transition-colors"
				>
					Add tag
				</button>
			</form>
		{/if}
	</div>

	<!-- Privacy notice -->
	<div
		class="border-surface-border bg-surface-raised text-text-quaternary rounded-lg border px-4 py-3 text-xs"
	>
		This organization cannot access the person row's underlying identity proof details. Verification
		state is derived from the protocol layer.
	</div>
</div>
