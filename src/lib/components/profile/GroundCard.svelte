<script lang="ts">
	/**
	 * GroundCard — Your literal ground in the democracy.
	 *
	 * Decrypts the constituent address from IndexedDB (never touches server)
	 * and displays it alongside the congressional district. The address is
	 * the person's anchor — where they stand, who represents them.
	 *
	 * States: loading → has-address | no-address | expired
	 * Modes: card (default) | embedded (no wrapper, for document layout)
	 */
	import { onMount } from 'svelte';
	import { Lock, MapPin, ShieldAlert, ArrowRight, RefreshCw } from '@lucide/svelte';
	import { getConstituentAddress } from '$lib/core/identity/constituent-address';
	import { getSessionCredential } from '$lib/core/identity/session-credentials';
	import { needsCredentialRecovery } from '$lib/core/identity/recovery-detector';

	let {
		userId,
		trustTier = 0,
		embedded = false,
		onVerifyAddress
	}: {
		userId: string;
		trustTier?: number;
		embedded?: boolean;
		onVerifyAddress?: () => void;
	} = $props();

	let loading = $state(true);
	let address = $state<{
		street: string;
		city: string;
		state: string;
		zip: string;
		district?: string;
	} | null>(null);
	let congressionalDistrict = $state<string | null>(null);
	let expired = $state(false);
	let needsRecovery = $state(false);

	onMount(async () => {
		try {
			const stored = await getConstituentAddress(userId);

			if (stored) {
				address = stored;
			}

			const credential = await getSessionCredential(userId);
			if (credential) {
				congressionalDistrict = credential.congressionalDistrict;
			}

			if (!stored && !credential) {
				expired = false;
			}

			// Check if tier-5 user needs credential recovery
			if (!credential && trustTier >= 5) {
				needsRecovery = await needsCredentialRecovery(userId, trustTier);
			}
		} catch (e) {
			console.warn('[GroundCard] Failed to load address:', e);
		} finally {
			loading = false;
		}
	});

	const district = $derived(address?.district || congressionalDistrict);
</script>

{#if loading}
	{#if embedded}
		<!-- Embedded loading: inline text skeleton -->
		<div class="animate-pulse space-y-2">
			<div class="h-4 w-44 rounded bg-slate-100/60"></div>
			<div class="h-4 w-32 rounded bg-slate-100/60"></div>
		</div>
	{:else}
		<div
			class="rounded-xl border border-slate-200/60 bg-white/80 p-5 backdrop-blur-sm"
			style="box-shadow: inset 0 1px 0 0 rgba(255,255,255,0.6), 0 1px 2px 0 rgba(0,0,0,0.05)"
		>
			<div class="animate-pulse space-y-3">
				<div class="h-3 w-24 rounded bg-slate-100"></div>
				<div class="h-4 w-48 rounded bg-slate-100"></div>
				<div class="h-4 w-36 rounded bg-slate-100"></div>
			</div>
		</div>
	{/if}
{:else if address}
	{#if embedded}
		<!-- Embedded: flush content, no card wrapper -->
		<div class="space-y-1">
			<p class="text-[15px] font-medium text-slate-800">{address.street}</p>
			<p class="text-[15px] text-slate-600">
				{address.city}, {address.state}
				{address.zip}
			</p>
		</div>

		{#if district}
			<div class="mt-2.5 flex items-center gap-2 border-l-2 border-emerald-400 pl-3">
				<span class="text-sm font-medium text-emerald-700">{district}</span>
			</div>
		{/if}

		<div class="mt-2.5 flex items-center gap-1.5 text-[11px] text-slate-400">
			<Lock class="h-3 w-3" />
			<span>Encrypted on this device</span>
		</div>
	{:else}
		<div
			class="rounded-xl border border-slate-200/60 bg-white/80 p-5 backdrop-blur-sm"
			style="box-shadow: inset 0 1px 0 0 rgba(255,255,255,0.6), 0 1px 2px 0 rgba(0,0,0,0.05)"
		>
			<span class="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
				Your ground
			</span>

			<div class="mt-3 space-y-1">
				<p class="text-[15px] font-medium text-slate-800">{address.street}</p>
				<p class="text-[15px] text-slate-600">
					{address.city}, {address.state}
					{address.zip}
				</p>
			</div>

			{#if district}
				<div class="mt-3 flex items-center gap-2">
					<MapPin class="h-3.5 w-3.5 text-emerald-500" />
					<span class="text-sm font-medium text-emerald-700">{district}</span>
				</div>
			{/if}

			<div class="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
				<Lock class="h-3 w-3" />
				<span>Encrypted on this device</span>
			</div>
		</div>
	{/if}
{:else}
	{#if embedded}
		<!-- Embedded no-address: inline text -->
		{#if needsRecovery}
			<p class="text-sm text-slate-600">
				<RefreshCw class="mr-1.5 inline h-3.5 w-3.5 text-amber-500" />
				Your proof credentials were cleared from this device.
				{#if onVerifyAddress}
					<button
						class="ml-1 font-medium text-amber-600 transition-colors hover:text-amber-700"
						onclick={() => onVerifyAddress?.()}
					>Restore Credentials &rarr;</button>
				{/if}
			</p>
		{:else if expired}
			<p class="text-sm text-slate-600">
				<ShieldAlert class="mr-1.5 inline h-3.5 w-3.5 text-amber-500" />
				Address verification expired.
				{#if onVerifyAddress}
					<button
						class="ml-1 font-medium text-emerald-600 transition-colors hover:text-emerald-700"
						onclick={() => onVerifyAddress?.()}
					>Re-verify &rarr;</button>
				{/if}
			</p>
		{:else}
			<p class="text-sm text-slate-500">
				Verify your address to be counted as a constituent.
				{#if onVerifyAddress}
					<button
						class="ml-1 font-medium text-emerald-600 transition-colors hover:text-emerald-700"
						onclick={() => onVerifyAddress?.()}
					>Verify &rarr;</button>
				{/if}
			</p>
		{/if}
	{:else}
		<div
			class="rounded-xl border border-slate-200/60 bg-white/80 p-5 backdrop-blur-sm"
			style="box-shadow: inset 0 1px 0 0 rgba(255,255,255,0.6), 0 1px 2px 0 rgba(0,0,0,0.05)"
		>
			<span class="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
				Your ground
			</span>

			<div class="mt-3">
				{#if needsRecovery}
					<div class="flex items-start gap-3">
						<RefreshCw class="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
						<div>
							<p class="text-sm font-medium text-slate-700">Proof credentials cleared</p>
							<p class="mt-0.5 text-[13px] text-slate-500">
								Your proof credentials were cleared from this device.
								A quick re-verification will restore them.
							</p>
						</div>
					</div>

					{#if onVerifyAddress}
						<button
							class="group mt-3 flex w-full items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2 text-left text-sm font-medium text-amber-700 transition-colors hover:border-amber-300 hover:bg-amber-100/50"
							onclick={() => onVerifyAddress?.()}
						>
							<RefreshCw class="h-3.5 w-3.5" />
							<span>Restore Credentials</span>
							<ArrowRight
								class="h-3.5 w-3.5 text-amber-400 transition-transform group-hover:translate-x-0.5"
							/>
						</button>
					{/if}
				{:else if expired}
					<div class="flex items-start gap-3">
						<ShieldAlert class="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
						<div>
							<p class="text-sm font-medium text-slate-700">Address verification expired</p>
							<p class="mt-0.5 text-[13px] text-slate-500">
								Re-verify to maintain constituent status.
							</p>
						</div>
					</div>

					{#if onVerifyAddress}
						<button
							class="group mt-3 flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:border-emerald-300 hover:bg-emerald-50/50 hover:text-emerald-700"
							onclick={() => onVerifyAddress?.()}
						>
							<span>Re-verify address</span>
							<ArrowRight
								class="h-3.5 w-3.5 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-500"
							/>
						</button>
					{/if}
				{:else}
					<div class="flex items-start gap-3">
						<MapPin class="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
						<div>
							<p class="text-sm font-medium text-slate-700">No address verified</p>
							<p class="mt-0.5 text-[13px] text-slate-500">
								Verify your address to be counted as a constituent. Your address stays
								encrypted on your device — it never reaches our servers.
							</p>
						</div>
					</div>

					{#if onVerifyAddress}
						<button
							class="group mt-3 flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:border-emerald-300 hover:bg-emerald-50/50 hover:text-emerald-700"
							onclick={() => onVerifyAddress?.()}
						>
							<span>Verify your address</span>
							<ArrowRight
								class="h-3.5 w-3.5 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-500"
							/>
						</button>
					{/if}
				{/if}
			</div>
		</div>
	{/if}
{/if}
