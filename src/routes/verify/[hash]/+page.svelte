<script lang="ts">
	import { ShieldCheck, AlertCircle, Clock } from '@lucide/svelte';
	import { formatDistrictName } from '$lib/utils/district-names';

	let { data } = $props();

	const districtLabel = $derived(
		data.credential?.district ? formatDistrictName(data.credential.district) : null
	);
</script>

<svelte:head>
	<title>{data.delivery ? 'Verified Report' : data.credential ? 'Verified Constituent' : 'Verification'} | Commons</title>
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
		<!-- Valid credential -->
		<div class="rounded-md border-2 border-green-200 bg-gradient-to-br from-green-50 to-emerald-50 p-8 text-center">
			<div class="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
				<ShieldCheck class="h-8 w-8 text-green-600" />
			</div>
			<h1 class="mb-2 text-xl font-bold text-green-900">Verified Constituent</h1>
			<p class="mb-4 text-sm text-green-800">
				This message was sent by a verified constituent
				{#if districtLabel}
					of <span class="font-semibold">{districtLabel}</span>
				{/if}
			</p>
			<div class="rounded-lg bg-white/60 px-4 py-3 text-xs text-slate-600">
				<p>Verified via {data.credential.method === 'civic_api' ? 'civic data' : data.credential.method}</p>
				<p class="mt-1">Issued {new Date(data.credential.issuedAt).toLocaleDateString()}</p>
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
