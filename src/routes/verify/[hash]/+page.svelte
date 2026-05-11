<script lang="ts">
	import { ShieldCheck, AlertCircle, Clock } from '@lucide/svelte';
	import { formatDistrictName } from '$lib/utils/district-names';
	import { getJurisdictionLabels } from '$lib/core/locale/jurisdiction';

	const labels = getJurisdictionLabels();

	let { data } = $props();

	const districtLabel = $derived(
		data.credential?.district ? formatDistrictName(data.credential.district) : null
	);

	// H6 — single source of truth: data.credential.tierDisplay is computed
	// server-side via formatTierDisplay() so this page, AttestationFooter, and
	// the email footer can all share the same epistemic copy. We keep the
	// method-conditional flags here ONLY for the auxiliary fine-print under
	// each headline, which is method-specific (the tierDisplay.description
	// is a slightly different framing than the receipt-page paragraph).
	const tierDisplay = $derived(data.credential?.tierDisplay ?? null);
	const isMdlMethod = $derived(tierDisplay?.confidenceClass === 'mdl');
	const isCivicApiMethod = $derived(tierDisplay?.confidenceClass === 'self-reported');

	const headlineText = $derived(tierDisplay?.headline ?? 'Verified Constituent');

	function formatDate(iso: string | null): string {
		if (!iso) return '--';
		return new Date(iso).toLocaleDateString();
	}

	function methodLabel(method: string | undefined): string {
		switch (method) {
			case 'mdl':
			case 'digital-credentials-api':
				return "mobile driver's license (mDL)";
			case 'civic_api':
				return 'self-reported address (Census Geocoder)';
			case 'postal':
				return 'postal verification';
			case 'shadow_atlas':
				return 'Shadow Atlas registry';
			default:
				return method ?? '--';
		}
	}
</script>

<svelte:head>
	<title>{data.delivery ? 'Verified Report' : data.credential ? headlineText : 'Verification'} | Commons</title>
</svelte:head>

<div class="mx-auto max-w-lg px-4 py-16">
	{#if data.delivery}
		<!-- Report delivery verification -->
		<div class="rounded-md border-2 border-green-200 bg-gradient-to-br from-green-50 to-emerald-50 p-8 text-center">
			<div class="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
				<ShieldCheck class="h-8 w-8 text-green-600" />
			</div>
			<h1 class="mb-2 text-xl font-bold text-green-900">Verified Report</h1>
			<p class="mb-4 text-sm text-green-800">
				This proof report was generated with cryptographic verification by commons.email.
			</p>
			<div class="rounded-lg bg-white/60 px-4 py-3 text-xs text-slate-600 space-y-1">
				<p class="font-semibold text-slate-700">{data.delivery.campaignTitle}</p>
				{#if data.delivery.verified !== null}
					<p><span class="font-mono font-semibold text-green-700">{data.delivery.verified.toLocaleString('en-US')}</span> verified constituents</p>
				{/if}
				{#if data.delivery.districtCount !== null}
					<p><span class="font-mono font-semibold text-teal-700">{data.delivery.districtCount}</span> districts reached</p>
				{/if}
				{#if data.delivery.district}
					<p>Delivered to representative in <span class="font-semibold">{data.delivery.district}</span></p>
				{/if}
				{#if data.delivery.sentAt}
					<p>Sent {new Date(data.delivery.sentAt).toLocaleDateString()}</p>
				{/if}
			</div>
		</div>
	{:else if data.credential && !data.credential.expired}
		<!-- Valid credential. G5/G5r honesty: tier the visual hierarchy by
		     epistemic strength. Self-reported (civic_api) gets amber, NOT green —
		     the attestation is a Census Geocoder lookup of user-typed input.
		     mDL gets green but the headline says "Address-Resolved" not just
		     "Verified" — the wallet attests postal+city+state at issuance, not
		     a current street address. -->
		<div class={`rounded-md border-2 p-8 text-center ${
			isMdlMethod
				? 'border-green-200 bg-gradient-to-br from-green-50 to-emerald-50'
				: isCivicApiMethod
					? 'border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50'
					: 'border-green-200 bg-gradient-to-br from-green-50 to-emerald-50'
		}`}>
			<div class={`mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full ${
				isCivicApiMethod ? 'bg-amber-100' : 'bg-green-100'
			}`}>
				{#if isCivicApiMethod}
					<AlertCircle class="h-8 w-8 text-amber-600" />
				{:else}
					<ShieldCheck class="h-8 w-8 text-green-600" />
				{/if}
			</div>
			<h1 class={`mb-2 text-xl font-bold ${
				isCivicApiMethod ? 'text-amber-900' : 'text-green-900'
			}`}>
				{headlineText}
			</h1>
			<p class={`mb-4 text-sm ${isCivicApiMethod ? 'text-amber-800' : 'text-green-800'}`}>
				This message was sent by a constituent
				{#if districtLabel}
					of <span class="font-semibold">{districtLabel}</span>
				{/if}
				{#if isMdlMethod}
					— address resolved from a state-issued credential.
				{:else if isCivicApiMethod}
					— address self-reported and geocoded by Census, not credential-attested.
				{:else}
					.
				{/if}
			</p>
			<div class="rounded-lg bg-white/60 px-4 py-3 text-xs text-slate-600 space-y-1">
				<p>Method: {methodLabel(data.credential.method)}</p>
				<p>Issued {formatDate(data.credential.issuedAt)}</p>
				{#if isMdlMethod}
					<p class="text-slate-500 mt-2 leading-relaxed">
						"Address-resolved" means the wallet disclosed postal code, city, and
						state at issuance, which were geocoded to a {labels.legislativeAdjective} district.
						The credential does NOT attest to a current street-level address.
					</p>
				{:else if isCivicApiMethod}
					<p class="text-slate-500 mt-2 leading-relaxed">
						"Self-reported" means the user typed an address and the Census
						Geocoder mapped it to a district. There is no third-party
						credential signature behind this verification.
					</p>
				{/if}
				{#if tierDisplay?.atlasDriftLabel}
					<!-- H6 — atlas-version drift. The credential committed to an
					     earlier atlas; the current published atlas has rotated.
					     Honest framing: districts haven't been re-derived for this
					     credential, so reads against the current atlas may resolve
					     to a different district than the issuance-time atlas would. -->
					<p class="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900 leading-relaxed">
						⚠ {tierDisplay.atlasDriftLabel} The credential's binding has not been re-derived for the new atlas.
					</p>
				{/if}
				{#if tierDisplay?.isBoundaryCell}
					<!-- H6 — H1's cellStraddles flag surfaced post-hoc here. H2's
					     pre-send banner is the user-facing surface that mattered;
					     /v/[hash] is the staffer-facing surface, also worth knowing. -->
					<p class="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900 leading-relaxed">
						This credential's H3 cell straddles a district boundary; routing
						followed the cell's primary district at issuance time.
					</p>
				{/if}
			</div>
		</div>
	{:else if data.credential?.expired}
		<!-- Expired credential -->
		<div class="rounded-md border-2 border-amber-200 bg-amber-50 p-8 text-center">
			<div class="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
				<Clock class="h-8 w-8 text-amber-600" />
			</div>
			<h1 class="mb-2 text-xl font-bold text-amber-900">Credential Expired</h1>
			<p class="text-sm text-amber-800">
				This constituent credential has expired and needs to be renewed.
			</p>
		</div>
	{:else}
		<!-- Error state -->
		<div class="rounded-md border-2 border-slate-200 bg-slate-50 p-8 text-center">
			<div class="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
				<AlertCircle class="h-8 w-8 text-slate-500" />
			</div>
			<h1 class="mb-2 text-xl font-bold text-slate-900">Verification Unavailable</h1>
			<p class="text-sm text-slate-600">{data.error || 'Could not verify this credential.'}</p>
		</div>
	{/if}

	<div class="mt-8 text-center">
		<a href="/" class="text-sm text-slate-500 underline hover:text-slate-700">
			Back to Commons
		</a>
	</div>
</div>
