<script lang="ts">
	import { ShieldCheck, Smartphone, ScanLine, MapPin, ChevronDown, ChevronUp } from '@lucide/svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let openFaq = $state<number | null>(null);

	function toggleFaq(index: number) {
		openFaq = openFaq === index ? null : index;
	}

	const faqs = [
		{
			q: "My browser says it's not supported",
			a: 'Switch to Chrome 141+ or Safari 26+. On mobile, you can scan the QR code with your phone to verify using its native wallet.',
		},
		{
			q: "My wallet doesn't show my license",
			a: "Make sure your state's mobile driver's license (mDL) has been added to Apple Wallet or Google Wallet. Check your state DMV's website for setup instructions.",
		},
		{
			q: 'Verification failed',
			a: "Your state's credential may not be supported yet. Check the supported states list above. If your state is listed, try again — transient network issues can cause failures.",
		},
		{
			q: "I verified but my trust level didn't change",
			a: 'Reload the page. If it persists, try verifying again from your profile page. The trust level update may take a moment to propagate.',
		},
	];

	const steps = [
		{
			icon: Smartphone,
			title: 'Request credential',
			desc: 'Your browser requests your digital credential from your phone\'s wallet.',
		},
		{
			icon: ScanLine,
			title: 'Minimal disclosure',
			desc: 'Your wallet shares postal code, city, state, birth date, and document number. Name, photo, and full street address stay out of the request.',
		},
		{
			icon: ShieldCheck,
			title: 'Cryptographic verification',
			desc: "We verify the credential's cryptographic signature against your state's certificate authority.",
		},
		{
			icon: MapPin,
			title: 'District confirmed',
			desc: 'Your district is confirmed and a privacy-preserving proof is generated.',
		},
	];
</script>

<svelte:head>
	<title>Identity Verification | Commons</title>
	<meta name="description" content="How identity verification works on Commons — privacy, browser support, and troubleshooting." />
</svelte:head>

<div class="mx-auto max-w-2xl">
	<!-- Header -->
	<h1 class="text-2xl font-bold text-slate-900 sm:text-3xl">Identity Verification</h1>
	<p class="mt-3 text-base text-slate-600 leading-relaxed">
		Commons verifies your identity using your state-issued mobile driver's license (mDL).
		This confirms you're a real constituent in your district without storing your personal information.
	</p>

	<!-- How it works -->
	<section class="mt-10">
		<h2 class="text-lg font-semibold text-slate-900">How it works</h2>
		<div class="mt-4 space-y-4">
			{#each steps as step, i}
				<div class="flex gap-4">
					<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
						<step.icon class="h-5 w-5" />
					</div>
					<div>
						<p class="font-medium text-slate-900">
							<span class="text-sm text-blue-600 mr-1.5">{i + 1}.</span>{step.title}
						</p>
						<p class="mt-0.5 text-sm text-slate-600">{step.desc}</p>
					</div>
				</div>
			{/each}
		</div>
	</section>

	<!-- Privacy guarantees -->
	<section class="mt-10">
		<h2 class="text-lg font-semibold text-slate-900">Privacy guarantees</h2>
		<ul class="mt-3 space-y-2">
			<li class="flex items-start gap-2 text-sm text-slate-700">
				<span class="mt-0.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-green-500"></span>
				Your wallet shares postal code, city, state, birth date, and document number.
				Those fields transit our servers briefly to derive your congressional district
				and a private identity commitment, then are discarded. We never persist them.
			</li>
			<li class="flex items-start gap-2 text-sm text-slate-700">
				<span class="mt-0.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-green-500"></span>
				No identity documents are stored
			</li>
			<li class="flex items-start gap-2 text-sm text-slate-700">
				<span class="mt-0.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-green-500"></span>
				Only your district (not your street address) is recorded
			</li>
			<li class="flex items-start gap-2 text-sm text-slate-700">
				<span class="mt-0.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-green-500"></span>
				Your identity commitment is a one-way hash &mdash; it can't be reversed to reveal your identity
			</li>
		</ul>
		<p class="mt-3 text-xs text-slate-500 leading-relaxed">
			Note: hardware-isolated processing (TEE/enclave) is on the roadmap. Today the district
			derivation runs in our standard server runtime. We commit not to retain raw address fields
			beyond the duration of district resolution.
		</p>
	</section>

	<!-- Browser requirements -->
	<section class="mt-10">
		<h2 class="text-lg font-semibold text-slate-900">Browser requirements</h2>
		<div class="mt-3 overflow-hidden rounded-lg border border-slate-200">
			<table class="w-full text-sm">
				<thead>
					<tr class="bg-slate-50">
						<th class="px-4 py-2.5 text-left font-medium text-slate-700">Browser</th>
						<th class="px-4 py-2.5 text-left font-medium text-slate-700">Support</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					<tr>
						<td class="px-4 py-2.5 text-slate-700">Chrome 141+ <span class="text-slate-400">(desktop & Android)</span></td>
						<td class="px-4 py-2.5"><span class="font-mono text-xs text-green-700">Full support</span></td>
					</tr>
					<tr>
						<td class="px-4 py-2.5 text-slate-700">Safari 26+ <span class="text-slate-400">(macOS & iOS)</span></td>
						<td class="px-4 py-2.5"><span class="font-mono text-xs text-green-700">Full support</span></td>
					</tr>
					<tr>
						<td class="px-4 py-2.5 text-slate-700">Firefox, Edge, older browsers</td>
						<td class="px-4 py-2.5"><span class="font-mono text-xs text-slate-600">Not yet supported</span></td>
					</tr>
				</tbody>
			</table>
		</div>
		<p class="mt-2 text-xs text-slate-500">
			On unsupported browsers, use your phone to verify by scanning the QR code.
		</p>
	</section>

	<!-- Supported states -->
	<section class="mt-10">
		<h2 class="text-lg font-semibold text-slate-900">Supported states</h2>
		<p class="mt-1 text-sm text-slate-600">
			{data.supportedStates.length} states and territories currently supported.
		</p>
		<div class="mt-3 flex flex-wrap gap-2">
			{#each data.supportedStates.sort() as state}
				<span class="inline-flex items-center rounded-md border border-slate-200 bg-white px-2.5 py-1 text-sm font-medium text-slate-700">
					{state}
				</span>
			{/each}
		</div>
		<p class="mt-3 text-xs text-slate-500">
			More states are added regularly. If your state isn't listed, check back soon.
		</p>
	</section>

	<!-- Troubleshooting -->
	<section class="mt-10 mb-8">
		<h2 class="text-lg font-semibold text-slate-900">Troubleshooting</h2>
		<div class="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200">
			{#each faqs as faq, i}
				<button
					class="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-slate-50 transition-colors"
					onclick={() => toggleFaq(i)}
				>
					<span class="font-medium text-slate-800">{faq.q}</span>
					{#if openFaq === i}
						<ChevronUp class="h-4 w-4 shrink-0 text-slate-400" />
					{:else}
						<ChevronDown class="h-4 w-4 shrink-0 text-slate-400" />
					{/if}
				</button>
				{#if openFaq === i}
					<div class="border-t border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">
						{faq.a}
					</div>
				{/if}
			{/each}
		</div>
	</section>
</div>
