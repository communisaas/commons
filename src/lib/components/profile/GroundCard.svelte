<script module lang="ts">
	/**
	 * Re-verification budget surfaced from `users.getReverificationBudget`.
	 * Exported at module scope so callers (parent pages, AddressChangeFlow)
	 * can share the type without re-declaring it.
	 */
	export interface ReverificationBudget {
		tierBypass: boolean;
		nextAllowedAt: number | null;
		recentCount: number;
		periodCap: number;
		windowMs: number;
		emailSybilTripped: boolean;
	}
</script>

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
		serverAddressVerified = false,
		embedded = false,
		budget = null,
		onVerifyAddress,
		onChangeAddress
	}: {
		userId: string;
		trustTier?: number;
		/**
		 * Server-side address/district attestation. Local IndexedDB address data
		 * is a device cache; this flag is the authority for whether a user can
		 * change their verified address when the cache is missing.
		 */
		serverAddressVerified?: boolean;
		embedded?: boolean;
		/**
		 * Re-verification budget — drives the legibility of the "I moved"
		 * affordance. When throttled, the affordance is disabled with a calm
		 * reason; when tier-bypassed, it carries a small "free for verified IDs"
		 * note. Pass `null` to suppress all budget-aware decoration.
		 */
		budget?: ReverificationBudget | null;
		onVerifyAddress?: () => void;
		/**
		 * Secondary "I moved" action, only surfaced when a verified address is
		 * already present. Triggers the re-grounding flow.
		 */
		onChangeAddress?: () => void;
	} = $props();

	// Tick once a minute so the throttle countdown stays fresh without a
	// per-render setInterval explosion. Reactivity is gated on `budget` being
	// present and currently throttled; idle budget states pay zero cost.
	let now = $state<number>(Date.now());
	$effect(() => {
		if (!budget?.nextAllowedAt || budget.tierBypass) return;
		if (budget.nextAllowedAt <= now) return;
		const id = setInterval(() => {
			now = Date.now();
		}, 60_000);
		return () => clearInterval(id);
	});

	const throttled = $derived(
		Boolean(budget?.nextAllowedAt && !budget.tierBypass && budget.nextAllowedAt > now)
	);
	const periodFull = $derived(
		Boolean(budget && !budget.tierBypass && budget.recentCount >= budget.periodCap)
	);
	const sybilBlocked = $derived(Boolean(budget?.emailSybilTripped));
	// User can move iff none of the gates are tripped. Tier-3+ users are
	// always allowed.
	const canMove = $derived(
		!budget || budget.tierBypass || (!throttled && !periodFull && !sybilBlocked)
	);
	const remaining = $derived(
		budget && !budget.tierBypass ? Math.max(0, budget.periodCap - budget.recentCount) : null
	);
	// Hours-until-allowed, rounded up so 5m → "1 hour" instead of "0 hours".
	const hoursUntilAllowed = $derived(
		throttled && budget?.nextAllowedAt
			? Math.max(1, Math.ceil((budget.nextAllowedAt - now) / (60 * 60 * 1000)))
			: null
	);

	function handleMoveClick() {
		if (!canMove) return;
		onChangeAddress?.();
	}

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
		<!-- Embedded loading: matches address block + district bar + encryption footer -->
		<div class="animate-pulse">
			<div class="space-y-1">
				<div class="h-[15px] w-44 rounded bg-slate-100/60"></div>
				<div class="h-[15px] w-32 rounded bg-slate-100/60"></div>
			</div>
			<div class="mt-2.5 flex items-center gap-2 border-l-2 border-slate-200 pl-3">
				<div class="h-3.5 w-20 rounded bg-slate-100/60"></div>
			</div>
			<div class="mt-2.5 flex items-center gap-1.5">
				<div class="h-3 w-3 rounded bg-slate-100/60"></div>
				<div class="h-[11px] w-32 rounded bg-slate-100/60"></div>
			</div>
		</div>
	{:else}
		<div class="rounded-md border border-slate-200/50 bg-white/70 p-4">
			<div class="animate-pulse">
				<!-- "Your ground" header -->
				<div class="h-[11px] w-20 rounded bg-slate-100"></div>
				<!-- Address lines -->
				<div class="mt-3 space-y-1">
					<div class="h-[15px] w-44 rounded bg-slate-100"></div>
					<div class="h-[15px] w-36 rounded bg-slate-100"></div>
				</div>
				<!-- District row (icon + label) -->
				<div class="mt-3 flex items-center gap-2">
					<div class="h-3.5 w-3.5 rounded bg-slate-100"></div>
					<div class="h-3.5 w-20 rounded bg-slate-100"></div>
				</div>
				<!-- Encryption footer (icon + text) -->
				<div class="mt-3 flex items-center gap-1.5">
					<div class="h-3 w-3 rounded bg-slate-100"></div>
					<div class="h-[11px] w-32 rounded bg-slate-100"></div>
				</div>
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

		{#if onChangeAddress}
			<div class="mt-2 flex items-baseline gap-2">
				<button
					type="button"
					class="text-[13px] underline decoration-dotted underline-offset-2 transition-colors disabled:cursor-not-allowed disabled:no-underline"
					class:text-slate-500={canMove}
					class:hover:text-slate-700={canMove}
					class:text-slate-300={!canMove}
					onclick={handleMoveClick}
					disabled={!canMove}
					data-testid="ground-i-moved"
					aria-disabled={!canMove}
				>
					I moved
				</button>
				{#if budget?.tierBypass}
					<span
						class="font-mono text-[10px] text-slate-400 uppercase"
						style="letter-spacing: 0.18em"
						title="Verified IDs (Tier 3+) re-verify without throttling."
					>
						Free for verified ID
					</span>
				{:else if throttled && hoursUntilAllowed !== null}
					<span
						class="font-mono text-[10px] text-amber-600 uppercase"
						style="letter-spacing: 0.18em"
						title="A 24-hour cooldown begins after each address change. This protects against ground-shopping."
					>
						Available in ~{hoursUntilAllowed}h
					</span>
				{:else if periodFull}
					<span
						class="font-mono text-[10px] text-amber-600 uppercase"
						style="letter-spacing: 0.18em"
						title="Limit reached for the trailing 180 days. Contact support if you have moved again."
					>
						180-day limit reached
					</span>
				{:else if sybilBlocked}
					<span
						class="font-mono text-[10px] text-amber-600 uppercase"
						style="letter-spacing: 0.18em"
					>
						Account check needed
					</span>
				{:else if remaining !== null && budget && remaining < budget.periodCap}
					<span
						class="font-mono text-[10px] text-slate-400 uppercase"
						style="letter-spacing: 0.18em"
						title="Up to {budget.periodCap} re-verifications per 180 days. Verifying with a government ID removes the limit."
					>
						{remaining}/{budget.periodCap} left · 180d
					</span>
				{/if}
			</div>
		{/if}
	{:else}
		<div class="rounded-md border border-slate-200/50 bg-white/70 p-4">
			<span class="text-[11px] font-semibold tracking-widest text-slate-400 uppercase">
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

			{#if onChangeAddress}
				<div class="mt-2.5 flex items-baseline gap-2">
					<button
						type="button"
						class="text-[13px] underline decoration-dotted underline-offset-2 transition-colors disabled:cursor-not-allowed disabled:no-underline"
						class:text-slate-500={canMove}
						class:hover:text-slate-700={canMove}
						class:text-slate-300={!canMove}
						onclick={handleMoveClick}
						disabled={!canMove}
						data-testid="ground-i-moved"
						aria-disabled={!canMove}
					>
						I moved
					</button>
					{#if budget?.tierBypass}
						<span
							class="font-mono text-[10px] text-slate-400 uppercase"
							style="letter-spacing: 0.18em"
							title="Verified IDs (Tier 3+) re-verify without throttling."
						>
							Free for verified ID
						</span>
					{:else if throttled && hoursUntilAllowed !== null}
						<span
							class="font-mono text-[10px] text-amber-600 uppercase"
							style="letter-spacing: 0.18em"
							title="A 24-hour cooldown begins after each address change."
						>
							Available in ~{hoursUntilAllowed}h
						</span>
					{:else if periodFull}
						<span
							class="font-mono text-[10px] text-amber-600 uppercase"
							style="letter-spacing: 0.18em"
						>
							180-day limit reached
						</span>
					{:else if sybilBlocked}
						<span
							class="font-mono text-[10px] text-amber-600 uppercase"
							style="letter-spacing: 0.18em"
						>
							Account check needed
						</span>
					{:else if remaining !== null && budget && remaining < budget.periodCap}
						<span
							class="font-mono text-[10px] text-slate-400 uppercase"
							style="letter-spacing: 0.18em"
							title="Up to {budget.periodCap} re-verifications per 180 days. Government-ID verification removes the limit."
						>
							{remaining}/{budget.periodCap} left · 180d
						</span>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
{:else if embedded}
	<!-- Embedded no-address: inline text -->
	{#if needsRecovery}
		<p class="text-sm text-slate-600">
			<RefreshCw class="mr-1.5 inline h-3.5 w-3.5 text-amber-500" />
			Your proof credentials were cleared from this device.
			{#if onVerifyAddress}
				<button
					class="ml-1 font-medium text-amber-600 transition-colors hover:text-amber-700"
					onclick={() => onVerifyAddress?.()}>Restore Credentials &rarr;</button
				>
			{/if}
		</p>
	{:else if expired}
		<p class="text-sm text-slate-600">
			<ShieldAlert class="mr-1.5 inline h-3.5 w-3.5 text-amber-500" />
			Address verification expired.
			{#if onVerifyAddress}
				<button
					class="ml-1 font-medium text-emerald-600 transition-colors hover:text-emerald-700"
					onclick={() => onVerifyAddress?.()}>Re-verify &rarr;</button
				>
			{/if}
		</p>
	{:else if serverAddressVerified}
		<p class="text-sm text-slate-500">
			Address verified. This browser does not hold the encrypted address cache.
			{#if onChangeAddress}
				<button
					class="ml-1 font-medium transition-colors disabled:cursor-not-allowed"
					class:text-slate-600={canMove}
					class:hover:text-slate-800={canMove}
					class:text-slate-300={!canMove}
					onclick={handleMoveClick}
					disabled={!canMove}
					data-testid="ground-i-moved"
					aria-disabled={!canMove}>Change address &rarr;</button
				>
			{/if}
		</p>
	{:else}
		<p class="text-sm text-slate-500">
			Verify your address to be counted as a constituent.
			{#if onVerifyAddress}
				<button
					class="ml-1 font-medium text-emerald-600 transition-colors hover:text-emerald-700"
					onclick={() => onVerifyAddress?.()}>Verify &rarr;</button
				>
			{/if}
		</p>
	{/if}
{:else}
	<div class="rounded-md border border-slate-200/50 bg-white/70 p-4">
		<span class="text-[11px] font-semibold tracking-widest text-slate-400 uppercase">
			Your ground
		</span>

		<div class="mt-3">
			{#if needsRecovery}
				<div class="flex items-start gap-3">
					<RefreshCw class="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
					<div>
						<p class="text-sm font-medium text-slate-700">Proof credentials cleared</p>
						<p class="mt-0.5 text-[13px] text-slate-500">
							Your proof credentials were cleared from this device. A quick re-verification will
							restore them.
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
			{:else if serverAddressVerified}
				<div class="flex items-start gap-3">
					<MapPin class="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
					<div>
						<p class="text-sm font-medium text-slate-700">Address verified</p>
						<p class="mt-0.5 text-[13px] text-slate-500">
							This browser does not hold the encrypted address cache. You can still change your
							verified address; the prior address text just will not be shown.
						</p>
					</div>
				</div>

				{#if onChangeAddress}
					<button
						class="group mt-3 flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:border-emerald-300 hover:bg-emerald-50/50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:text-slate-400 disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:bg-transparent disabled:hover:text-slate-400"
						onclick={handleMoveClick}
						disabled={!canMove}
						data-testid="ground-i-moved"
						aria-disabled={!canMove}
					>
						<span>Change verified address</span>
						<ArrowRight
							class="h-3.5 w-3.5 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-500"
						/>
					</button>
					{#if budget?.tierBypass}
						<p
							class="mt-2 font-mono text-[10px] text-slate-400 uppercase"
							style="letter-spacing: 0.18em"
						>
							Free for verified ID
						</p>
					{:else if throttled && hoursUntilAllowed !== null}
						<p
							class="mt-2 font-mono text-[10px] text-amber-600 uppercase"
							style="letter-spacing: 0.18em"
						>
							Available in ~{hoursUntilAllowed}h
						</p>
					{:else if periodFull}
						<p
							class="mt-2 font-mono text-[10px] text-amber-600 uppercase"
							style="letter-spacing: 0.18em"
						>
							180-day limit reached
						</p>
					{:else if sybilBlocked}
						<p
							class="mt-2 font-mono text-[10px] text-amber-600 uppercase"
							style="letter-spacing: 0.18em"
						>
							Account check needed
						</p>
					{/if}
				{/if}
			{:else}
				<div class="flex items-start gap-3">
					<MapPin class="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
					<div>
						<p class="text-sm font-medium text-slate-700">No address verified</p>
						<p class="mt-0.5 text-[13px] text-slate-500">
							Verify your address to be counted as a constituent. Your address stays encrypted on
							your device — it never reaches our servers.
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
