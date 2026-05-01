<script lang="ts">
	import { AlertCircle, Home, Search, X } from '@lucide/svelte';
	import Button from '$lib/components/ui/Button.svelte';

	let {
		streetAddress = $bindable(),
		city = $bindable(),
		stateCode = $bindable(),
		zipCode = $bindable(),
		detectedCountry = 'US',
		errorMessage = '',
		geoPermissionDenied = false,
		onSubmit,
		onCancel,
		onKeydown
	}: {
		streetAddress: string;
		city: string;
		stateCode: string;
		zipCode: string;
		detectedCountry?: 'US' | 'CA';
		errorMessage?: string;
		geoPermissionDenied?: boolean;
		onSubmit: () => void;
		onCancel?: () => void;
		onKeydown: (event: KeyboardEvent) => void;
	} = $props();

	const regionLabel = $derived(
		detectedCountry === 'CA' ? 'federal electoral district' : 'congressional district'
	);
	const postalLabel = $derived(detectedCountry === 'CA' ? 'Postal' : 'ZIP');
	const postalPlaceholder = $derived(detectedCountry === 'CA' ? 'K1A 0B1' : '94102');
	const stateLabel = $derived(detectedCountry === 'CA' ? 'Prov' : 'State');
	const statePlaceholder = $derived(detectedCountry === 'CA' ? 'ON' : 'CA');
	const isFormComplete = $derived(
		Boolean(streetAddress.trim() && city.trim() && stateCode.trim() && zipCode.trim())
	);

	const inputClass =
		'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-participation-primary-500 focus:ring-2 focus:ring-participation-primary-500/20 focus:outline-none';
</script>

<section class="pt-2 pb-2" data-testid="regrounding-address-capture">
	<div class="mb-5">
		<p class="font-mono text-[10px] text-slate-500 uppercase" style="letter-spacing: 0.22em">
			New ground
		</p>
		<h2
			class="mt-1.5 text-xl leading-tight font-semibold text-slate-900"
			style="font-family: 'Satoshi', system-ui, sans-serif"
		>
			Enter your new address.
		</h2>
		<p class="mt-2 text-sm leading-relaxed text-slate-500">
			We resolve the address to your {regionLabel}, then replace the verified address on this device
			after attestation.
		</p>
		{#if geoPermissionDenied}
			<p class="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
				<AlertCircle class="h-3.5 w-3.5 shrink-0" />
				Location access was denied. Enter the address instead.
			</p>
		{/if}
	</div>

	<div class="space-y-3 border-t border-b border-dotted border-slate-300 py-4">
		<div>
			<label
				for="reground-street"
				class="mb-1 block text-xs font-medium tracking-wider text-slate-500 uppercase"
			>
				Street
			</label>
			<input
				id="reground-street"
				type="text"
				bind:value={streetAddress}
				placeholder="123 Main Street"
				class={inputClass}
				onkeydown={onKeydown}
			/>
		</div>

		<div class="grid grid-cols-6 gap-3">
			<div class="col-span-3">
				<label
					for="reground-city"
					class="mb-1 block text-xs font-medium tracking-wider text-slate-500 uppercase"
				>
					City
				</label>
				<input
					id="reground-city"
					type="text"
					bind:value={city}
					placeholder="San Francisco"
					class={inputClass}
					onkeydown={onKeydown}
				/>
			</div>
			<div class="col-span-1">
				<label
					for="reground-state"
					class="mb-1 block text-xs font-medium tracking-wider text-slate-500 uppercase"
				>
					{stateLabel}
				</label>
				<input
					id="reground-state"
					type="text"
					bind:value={stateCode}
					placeholder={statePlaceholder}
					maxlength={2}
					class="{inputClass} text-center uppercase"
					onkeydown={onKeydown}
				/>
			</div>
			<div class="col-span-2">
				<label
					for="reground-zip"
					class="mb-1 block text-xs font-medium tracking-wider text-slate-500 uppercase"
				>
					{postalLabel}
				</label>
				<input
					id="reground-zip"
					type="text"
					bind:value={zipCode}
					placeholder={postalPlaceholder}
					maxlength={10}
					class={inputClass}
					onkeydown={onKeydown}
				/>
			</div>
		</div>
	</div>

	{#if errorMessage}
		<div class="mt-4 flex items-start gap-2 border-t border-dotted border-red-300 pt-3">
			<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
			<p class="text-sm text-red-700">{errorMessage}</p>
		</div>
	{/if}

	<div
		class="mt-6 flex items-center justify-between gap-3 border-t border-dotted border-slate-300 pt-4"
	>
		{#if onCancel}
			<Button variant="secondary" size="sm" onclick={onCancel}>
				<X class="h-3.5 w-3.5" />
				Cancel
			</Button>
		{/if}
		<Button
			variant="primary"
			size="sm"
			onclick={onSubmit}
			disabled={!isFormComplete}
			classNames="ml-auto"
		>
			<Search class="h-3.5 w-3.5" />
			Verify address
		</Button>
	</div>

	<div class="mt-4 flex items-start gap-2 text-xs leading-relaxed text-slate-500">
		<Home class="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
		<p>
			Address text is required for a verified address change. It is geocoded for the district check
			and stored only in the browser-local encrypted address cache after success.
		</p>
	</div>
</section>
