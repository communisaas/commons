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

	export interface ProfileGroundState {
		vault: {
			status?: string;
		} | null;
		cell: {
			cellId?: string;
			h3Cell?: string;
			source?: string;
			expiresAt?: number;
		} | null;
		wrappers: Array<{
			status?: string;
		}>;
	}
</script>

<script lang="ts">
	/**
	 * GroundCard — Your literal ground in the democracy.
	 *
	 * Reads the local constituent address when available and combines it with
	 * redacted server ground metadata. Verification status is separate from
	 * whether this device can read the address for delivery.
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
		groundState = null,
		embedded = false,
		budget = null,
		onVerifyAddress,
		onRestoreAddress,
		onChangeAddress
	}: {
		userId: string;
		trustTier?: number;
		/**
		 * Server-side address/district attestation. The profile distinguishes
		 * verification status from whether the address is currently readable:
		 * readable, locked, or requiring re-entry.
		 */
		serverAddressVerified?: boolean;
		groundState?: ProfileGroundState | null;
		embedded?: boolean;
		/**
		 * Re-verification budget — drives the legibility of the re-grounding
		 * affordance. When throttled, the affordance is disabled with a calm
		 * reason; when tier-bypassed, it carries a small "free for verified IDs"
		 * note. Pass `null` to suppress all budget-aware decoration.
		 */
		budget?: ReverificationBudget | null;
		onVerifyAddress?: () => void;
		/**
		 * Repair path for verified users whose browser no longer has a readable
		 * address. This re-enters the address and persists encrypted ground
		 * against the active credential; it is not a re-verification budget event.
		 */
		onRestoreAddress?: () => void;
		/**
		 * Secondary re-grounding action, only surfaced when a verified address
		 * is already present. Triggers credential retirement and new issuance.
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

	type ReGroundStatusTone = 'neutral' | 'caution';
	type ReGroundStatus = { text: string; tone: ReGroundStatusTone; hint: string };

	// Re-ground status annotation. Collapses five mutually-exclusive budget
	// states into one derived so the action and its status render as a clean
	// pair (action above, status below) instead of typographic siblings.
	const reGroundStatus: ReGroundStatus | null = $derived.by(() => {
		if (budget?.tierBypass) {
			return {
				text: 'Free for verified ID',
				tone: 'neutral' as const,
				hint: 'Verified IDs (Tier 3+) re-verify without throttling.'
			};
		}
		if (throttled && hoursUntilAllowed !== null) {
			return {
				text: `Available in ~${hoursUntilAllowed}h`,
				tone: 'caution' as const,
				hint: 'A 24-hour cooldown begins after each address change. This protects against ground-shopping.'
			};
		}
		if (periodFull) {
			return {
				text: '180-day limit reached',
				tone: 'caution' as const,
				hint: 'Limit reached for the trailing 180 days. Contact support if you have moved again.'
			};
		}
		if (sybilBlocked) {
			return {
				text: 'Account check needed',
				tone: 'caution' as const,
				hint: ''
			};
		}
		if (remaining !== null && budget && remaining < budget.periodCap) {
			return {
				text: `${remaining}/${budget.periodCap} left · 180d`,
				tone: 'neutral' as const,
				hint: `Up to ${budget.periodCap} re-verifications per 180 days. Government-ID verification removes the limit.`
			};
		}
		return null;
	});

	function handleMoveClick() {
		if (!canMove) return;
		onChangeAddress?.();
	}

	function handleRestoreClick() {
		(onRestoreAddress ?? onChangeAddress)?.();
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
	const activeWrapperCount = $derived(
		groundState?.wrappers?.filter((wrapper) => wrapper.status === 'active').length ?? 0
	);
	const savedDistrict = $derived(district ?? null);
	const hasServerVault = $derived(Boolean(groundState?.vault));
	const hasSavedGroundMetadata = $derived(Boolean(groundState?.cell || serverAddressVerified));
	const vaultDisplayState = $derived(
		address
			? 'unlocked'
			: hasServerVault && activeWrapperCount > 0
				? 'locked'
				: hasSavedGroundMetadata
					? 'reentry'
					: 'absent'
	);
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

		{#if savedDistrict}
			<div class="mt-2.5 flex items-center gap-2 border-l-2 border-emerald-400 pl-3">
				<span class="text-sm font-medium text-emerald-700">{savedDistrict}</span>
			</div>
		{/if}

		<div
			class="mt-2.5 flex items-center gap-1.5 text-[11px] text-slate-400"
			title="Encrypted on this device and used when official delivery requires an address."
		>
			<Lock class="h-3 w-3" />
			<span>Address saved for official delivery</span>
		</div>

		{#if onChangeAddress}
			<div class="mt-3 border-t border-dotted border-slate-300 pt-2.5">
				<button
					type="button"
					class="group inline-flex items-center gap-1 text-[13px] font-medium transition-colors disabled:cursor-not-allowed
						{canMove
						? 'text-slate-700 hover:text-[var(--coord-route-solid)]'
						: 'text-slate-400'}"
					onclick={handleMoveClick}
					disabled={!canMove}
					data-testid="ground-i-moved"
					aria-disabled={!canMove}
					title="Retire this district credential and attest a new address."
				>
					<span>Re-ground address</span>
					{#if canMove}
						<ArrowRight
							class="h-3.5 w-3.5 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
						/>
					{/if}
				</button>
				{#if reGroundStatus}
					<p
						class="mt-1 font-mono text-[10px] tracking-[0.1em] uppercase {reGroundStatus.tone ===
						'caution'
							? 'text-amber-600'
							: 'text-slate-400'}"
						title={reGroundStatus.hint}
					>
						{reGroundStatus.text}
					</p>
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

			{#if savedDistrict}
				<div class="mt-3 flex items-center gap-2">
					<MapPin class="h-3.5 w-3.5 text-emerald-500" />
					<span class="text-sm font-medium text-emerald-700">{savedDistrict}</span>
				</div>
			{/if}

			<div
				class="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400"
				title="Encrypted on this device and used when official delivery requires an address."
			>
				<Lock class="h-3 w-3" />
				<span>Address saved for official delivery</span>
			</div>

			{#if onChangeAddress}
				<div class="reground mt-3 border-t border-dotted border-slate-300 pt-2.5">
					<button
						type="button"
						class="reground__action group inline-flex items-center gap-1 text-[13px] font-medium transition-colors disabled:cursor-not-allowed"
						class:reground__action--idle={canMove}
						class:reground__action--blocked={!canMove}
						onclick={handleMoveClick}
						disabled={!canMove}
						data-testid="ground-i-moved"
						aria-disabled={!canMove}
						title="Retire this district credential and attest a new address."
					>
						<span>Re-ground address</span>
						<ArrowRight class="reground__arrow h-3.5 w-3.5 transition-all" />
					</button>
					{#if reGroundStatus}
						<p
							class="reground__status mt-1"
							class:reground__status--caution={reGroundStatus.tone === 'caution'}
							title={reGroundStatus.hint}
						>
							{reGroundStatus.text}
						</p>
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
	{:else if vaultDisplayState === 'locked'}
		<div class="space-y-2">
			<p class="text-sm text-slate-600">
				<ShieldAlert class="mr-1.5 inline h-3.5 w-3.5 text-amber-500" />
				Saved address locked.
			</p>
			{#if savedDistrict}
				<p class="text-xs text-slate-500">
					{savedDistrict}
				</p>
			{/if}
			{#if onRestoreAddress || onChangeAddress}
				<div class="border-t border-dotted border-slate-300 pt-2">
					<button
						type="button"
						class="font-mono text-[12px] font-medium text-slate-600 uppercase underline decoration-dotted underline-offset-4 transition-colors hover:text-slate-800"
						onclick={handleRestoreClick}
						data-testid="ground-i-moved"
						title="Re-enter the address and bind a fresh encrypted ground record."
					>
						Re-enter address &rarr;
					</button>
				</div>
			{/if}
		</div>
	{:else if vaultDisplayState === 'reentry'}
		<div class="space-y-2">
			<p class="text-sm text-slate-600">
				<ShieldAlert class="mr-1.5 inline h-3.5 w-3.5 text-amber-500" />
				Address needs re-entry.
			</p>
			{#if savedDistrict}
				<p class="text-xs text-slate-500">
					{savedDistrict}
				</p>
			{/if}
			{#if onRestoreAddress || onChangeAddress}
				<div class="border-t border-dotted border-slate-300 pt-2">
					<button
						type="button"
						class="font-mono text-[12px] font-medium text-slate-600 uppercase underline decoration-dotted underline-offset-4 transition-colors hover:text-slate-800"
						onclick={handleRestoreClick}
						data-testid="ground-i-moved"
						title="Re-enter the address and bind a fresh encrypted ground record."
					>
						Re-enter address &rarr;
					</button>
				</div>
			{/if}
		</div>
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
			{:else if vaultDisplayState === 'locked'}
				<div class="flex items-start gap-3">
					<ShieldAlert class="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
					<div>
						<p class="text-sm font-medium text-slate-700">Saved address locked</p>
						<p class="mt-0.5 text-[13px] text-slate-500">
							Your district proof is still active. This device cannot read the saved address right
							now, so re-enter it before delivery.
						</p>
						{#if savedDistrict}
							<p class="mt-1 text-[11px] text-slate-400">
								{savedDistrict}
							</p>
						{/if}
					</div>
				</div>

				{#if onRestoreAddress || onChangeAddress}
					<button
						class="group mt-3 flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:border-emerald-300 hover:bg-emerald-50/50 hover:text-emerald-700"
						onclick={handleRestoreClick}
						data-testid="ground-i-moved"
						title="Re-enter the address and bind a fresh encrypted ground record."
					>
						<span>Re-enter address</span>
						<ArrowRight
							class="h-3.5 w-3.5 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-500"
						/>
					</button>
				{/if}
			{:else if vaultDisplayState === 'reentry'}
				<div class="flex items-start gap-3">
					<ShieldAlert class="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
					<div>
						<p class="text-sm font-medium text-slate-700">Address needs re-entry</p>
						<p class="mt-0.5 text-[13px] text-slate-500">
							Your district proof is still active, but this device does not have the address needed
							for delivery.
						</p>
						{#if savedDistrict}
							<p class="mt-1 text-[11px] text-slate-400">
								{savedDistrict}
							</p>
						{/if}
					</div>
				</div>

				{#if onRestoreAddress || onChangeAddress}
					<button
						class="group mt-3 flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:border-emerald-300 hover:bg-emerald-50/50 hover:text-emerald-700"
						onclick={handleRestoreClick}
						data-testid="ground-i-moved"
						title="Re-enter the address and bind a fresh encrypted ground record."
					>
						<span>Re-enter address</span>
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
							Verify your address to be counted as a constituent. We keep the saved address
							encrypted and only disclose it when a government delivery API requires it.
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
