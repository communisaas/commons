<script lang="ts">
	import { Shield, MessageSquare, Lock, Award } from '@lucide/svelte';
	import { getJurisdictionLabels } from '$lib/core/locale/jurisdiction';

	interface Props {
		/** Variant style */
		variant?: 'full' | 'compact' | 'inline';
		/** Show privacy section */
		showPrivacy?: boolean;
	}

	let { variant = 'full', showPrivacy = true }: Props = $props();

	const labels = getJurisdictionLabels();
</script>

{#if variant === 'full'}
	<div class="space-y-8">
		<!-- Hero Value Prop -->
		<div class="text-center">
			<div
				class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-600 shadow-lg"
			>
				<Shield class="h-8 w-8 text-white" />
			</div>
			<h2 class="mb-3 text-3xl font-bold text-slate-900">Why Verify Your Identity?</h2>
			<p class="mx-auto max-w-2xl text-lg text-slate-600">
				{labels.legislativeBody} offices receive thousands of messages daily. Verification proves you're a real
				constituent—not a bot, not spam, not someone from another district.
			</p>
		</div>

		<!-- What the legislature Sees -->
		<div class="rounded-md border border-slate-200 bg-white p-6">
			<h3 class="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900">
				<MessageSquare class="h-5 w-5 text-blue-600" />
				What {labels.legislativeBody} Offices See
			</h3>
			<div class="space-y-3">
				<div class="flex items-start gap-3 rounded-lg bg-green-50 p-4">
					<div class="mt-0.5 rounded-full bg-green-100 p-1">
						<Shield class="h-4 w-4 text-green-700" />
					</div>
					<div class="flex-1">
						<p class="font-medium text-green-900">✓ Verified Constituent</p>
						<p class="mt-1 text-sm text-green-700">
							From {labels.districtType} [Your District Number]
						</p>
					</div>
				</div>
				<div class="flex items-start gap-3 rounded-lg bg-blue-50 p-4">
					<div class="mt-0.5 rounded-full bg-blue-100 p-1">
						<Award class="h-4 w-4 text-blue-700" />
					</div>
					<div class="flex-1">
						<p class="font-medium text-blue-900">Reputation Score: High</p>
						<p class="mt-1 text-sm text-blue-700">Based on verified civic participation history</p>
					</div>
				</div>
				<div class="flex items-start gap-3 rounded-lg bg-slate-50 p-4">
					<div class="mt-0.5 rounded-full bg-slate-100 p-1">
						<Lock class="h-4 w-4 text-slate-700" />
					</div>
					<div class="flex-1">
						<p class="font-medium text-slate-900">Your Message Content</p>
						<p class="mt-1 text-sm text-slate-600">
							Encrypted delivery ensures only the {labels.legislativeAdjective} office can read it
						</p>
					</div>
				</div>
			</div>
		</div>

		<!-- Privacy Guarantee -->
		{#if showPrivacy}
			<div
				class="rounded-md border border-green-200 bg-green-50 p-6"
			>
				<div class="flex items-start gap-4">
					<div class="rounded-full bg-green-100 p-3">
						<Lock class="h-6 w-6 text-green-700" />
					</div>
					<div class="flex-1 space-y-3">
						<h3 class="text-lg font-semibold text-slate-900">Your Privacy is Our Foundation</h3>
						<div class="space-y-2 text-sm text-slate-700">
							<p class="flex items-start gap-2">
								<span class="mt-0.5 font-bold text-green-600">✓</span>
								<span>
									<span class="font-semibold">Your address is encrypted at rest.</span>
									After verification, Commons may save an encrypted address vault and disclosed
									district/cell metadata so official delivery can work without making you repeat the
									same step. Plaintext is handled only where district resolution or government delivery
									requires it.
								</span>
							</p>
							<p class="flex items-start gap-2">
								<span class="mt-0.5 font-bold text-green-600">✓</span>
								<span>
									<span class="font-semibold">We don't store identity documents.</span> Verification
									happens through trusted third-party partners who don't share your personal data with
									us.
								</span>
							</p>
							<p class="flex items-start gap-2">
								<span class="mt-0.5 font-bold text-green-600">✓</span>
								<span>
									<span class="font-semibold">What we store:</span> Verification status, timestamps,
									encrypted ground-vault material, and the district/cell facts needed to explain and
									deliver verified constituent messages. We do not store identity documents.
								</span>
							</p>
							<p class="flex items-start gap-2">
								<span class="mt-0.5 font-bold text-green-600">✓</span>
								<span>
									<span class="font-semibold">{labels.legislativeBody} offices see:</span> verified constituent
									status for public/reporting surfaces. Official delivery APIs may require the readable
									address fields in the government request.
								</span>
							</p>
						</div>
					</div>
				</div>
			</div>
		{/if}
	</div>
{:else if variant === 'compact'}
	<div class="space-y-4">
		<div class="text-center">
			<h3 class="mb-2 text-lg font-semibold text-slate-900">Prove You're a Real Constituent</h3>
			<p class="text-sm text-slate-600">
				Verification proves you live in the district — not a bot, not spam
			</p>
		</div>

		{#if showPrivacy}
			<div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
				<div class="flex items-start gap-2">
					<Lock class="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600" />
					<p class="text-xs text-slate-700">
						<span class="font-semibold">Private by design:</span> Your address is saved encrypted
						and disclosed only where official delivery requires it.
					</p>
				</div>
			</div>
		{/if}
	</div>
{:else if variant === 'inline'}
	<div class="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
		<Shield class="h-5 w-5 flex-shrink-0 text-blue-600" />
		<div class="flex-1 text-sm">
			<span class="font-semibold text-blue-900"
				>Verified messages prove you're a real constituent.</span
			>
			<span class="text-blue-700">Your address is encrypted at rest and handled only for delivery.</span>
		</div>
	</div>
{/if}
