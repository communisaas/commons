<script lang="ts">
	/**
	 * Sender Verification Page
	 *
	 * Perceptual target: notarized certificate. Dense, authoritative, quiet.
	 * Fits in a single viewport. Jurisdictions are the strong center.
	 *
	 * Design system alignment:
	 * - Satoshi (font-brand) for human language
	 * - JetBrains Mono (font-mono) for district codes, hashes, data
	 * - Surface tokens for warmth (base, raised, border)
	 * - Text hierarchy (primary, secondary, tertiary, quaternary)
	 * - participation-lg radius, atmospheric-card shadow
	 * - Staggered fade-in on load
	 */
	import type { PageData } from './$types';
	import AttestationVerifier from '$lib/components/verify/AttestationVerifier.svelte';

	let { data }: { data: PageData } = $props();

	// Campaign mode is a K-anonymized COHORT report — the public surface cannot
	// supply the exact preimage, so the recipient recomputes the attestation from
	// the "Verify offline" block in their email (the recipient is the oracle). The
	// page passes only the hash to compare against; the verifier owns the
	// recipient-entered preimage.
	const attestationHash = $derived(
		data.mode === 'campaign' ? data.campaignContext?.attestationHash ?? null : null
	);

	const verifiedDate = $derived(
		new Date(data.verifiedAt).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		})
	);

	const headline = $derived.by(() => {
		// Campaign mode is a cohort report — NO per-sender tier claim.
		if (data.mode === 'campaign') return 'Constituent report';
		if (data.trustTier >= 3) return 'Government-Verified Identity';
		if (data.trustTier >= 2) return 'Verified Resident';
		if (data.trustTier >= 1) return 'Authenticated Sender';
		return 'Unverified Sender';
	});

	const lead = $derived.by(() => {
		if (data.mode === 'campaign') {
			// Cohort language from the K-gated qualitative phrase, or a count
			// sentence. No "verified their address" — that is a per-sender claim.
			const ctx = data.campaignContext;
			if (ctx?.identityPhrase) return ctx.identityPhrase;
			const n = ctx?.verified ?? 0;
			return n > 0
				? `This report aggregates ${n} verified constituent action${n === 1 ? '' : 's'}. Recompute its cryptographic attestation below.`
				: 'This report carries a cryptographic attestation you can recompute below.';
		}
		const state = data.location.state;
		if (data.trustTier >= 3) {
			return `The person who sent you this message proved their identity and residency${state ? ` in ${state}` : ''} with a government credential.`;
		}
		if (data.trustTier >= 2) {
			return `The person who sent you this message verified their address${state ? ` in ${state}` : ''} before sending.`;
		}
		if (data.trustTier >= 1) {
			return 'The person who sent you this message authenticated their account via email before sending.';
		}
		return 'This sender has not completed verification.';
	});

	const authRow = $derived.by(() => {
		if (data.mode === 'campaign') {
			// Only promise "recompute below" when an attestation actually exists (the
			// verifier block gates on attestationHash); otherwise say so plainly.
			return attestationHash
				? { label: 'Attestation', value: 'SHA-256 (recompute below)', verified: true }
				: { label: 'Attestation', value: 'No attestation issued yet', verified: false };
		}
		if (data.identity.method === 'gov-id') {
			return { label: 'Identity', value: 'Government credential (mDL)', verified: true };
		}
		return { label: 'Authentication', value: 'Email', verified: data.identity.verified };
	});

	// Campaign mode has no single composition; omit the row (null).
	const compositionValue = $derived.by(() => {
		if (data.mode === 'campaign') return null;
		return data.composition === 'individual' ? 'Individually composed' : 'Template-adapted';
	});

	// The shield: in campaign mode it marks a real cryptographic attestation (not a
	// per-sender tier); in individual mode it marks tier-1+ verification.
	const showShield = $derived(
		data.mode === 'campaign' ? attestationHash !== null : data.trustTier >= 1
	);
</script>

<svelte:head>
	<title>Sender Verification — Commons</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="flex flex-col px-6"
	style="background: oklch(0.993 0.003 60); min-height: calc(100vh - 48px);"
>
	<div class="w-full max-w-lg mx-auto pt-[5vh]">

		<!-- Header -->
		<div class="flex items-center gap-3.5 mb-2 verify-stagger" style="--stagger: 0">
			<div class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
				style="background: oklch(0.95 0.03 160 / 0.5); border: 1px solid oklch(0.88 0.04 160 / 0.4);"
			>
				{#if showShield}
					<svg class="w-5 h-5" style="color: oklch(0.45 0.12 160)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
						<path d="m9 12 2 2 4-4" />
					</svg>
				{:else}
					<svg class="w-5 h-5 text-text-quaternary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
					</svg>
				{/if}
			</div>
			<div>
				<h1 class="font-brand text-2xl font-bold tracking-tight text-text-primary">
					{headline}
				</h1>
				<p class="font-mono text-[13px] text-text-quaternary mt-0.5">commons.email</p>
			</div>
		</div>

		<p class="font-brand text-[15px] text-text-tertiary leading-relaxed mb-8 sm:ml-[54px] verify-stagger" style="--stagger: 1">
			{lead}
		</p>

		<!-- Topic (when message-level data exists) -->
		{#if data.topic}
			<div class="mb-5 sm:ml-[54px] text-[15px] verify-stagger" style="--stagger: 2">
				<span class="text-text-quaternary">Topic:</span>
				<span class="font-brand text-text-primary font-medium ml-1">{data.topic}</span>
				{#if data.participantCount && data.participantCount > 1}
					<span class="text-text-quaternary ml-1">
						({data.participantCount} verified senders)
					</span>
				{/if}
			</div>
		{/if}

		<!-- Jurisdictions: the strong center -->
		{#if data.location.verified && data.location.districts.length > 0}
			<div class="rounded-participation-lg border border-surface-border bg-surface-raised shadow-atmospheric-card px-5 py-4 mb-2 verify-stagger" style="--stagger: 2">
				<p class="font-mono text-[11px] font-medium text-text-accent uppercase tracking-widest mb-3">
					Proven Jurisdictions
				</p>
				<div class="space-y-2">
					{#each data.location.districts as d}
						<div class="flex items-baseline justify-between gap-6">
							<span class="text-sm text-text-tertiary shrink-0">{d.label}</span>
							<span class="font-mono text-sm font-medium text-text-primary text-right">{d.value}</span>
						</div>
					{/each}
				</div>
			</div>
			<p class="text-xs text-text-quaternary mb-8 px-1 verify-stagger" style="--stagger: 3">
				Proven at the district level — exact address is never revealed.
			</p>
		{:else if data.location.state}
			<div class="mb-8 px-1 verify-stagger" style="--stagger: 2">
				<span class="text-sm text-text-quaternary">State:</span>
				<span class="font-mono text-sm font-medium text-text-secondary ml-1">{data.location.state}</span>
			</div>
		{/if}

		<!-- Compact metadata -->
		<div class="border-t border-surface-border pt-5 mb-8 verify-stagger" style="--stagger: 4">
			<div class="grid grid-cols-[auto_1fr] gap-x-8 gap-y-2.5 text-[13px]">
				<span class="text-text-quaternary">{authRow.label}</span>
				<span class="text-right {authRow.verified ? 'text-channel-verified-700' : 'text-text-tertiary'}">
					{authRow.value}
				</span>

				{#if compositionValue}
					<span class="text-text-quaternary">Composition</span>
					<span class="text-text-secondary text-right">{compositionValue}</span>
				{/if}

				<!-- `data.hash` is the route param: the real SHA-256 attestation in
				     individual mode, but the campaign ROUTE ID in campaign mode (the
				     real attestation is the verifier block below). Label honestly. -->
				<span class="text-text-quaternary"
					>{data.mode === 'campaign' ? 'Report ID' : 'Attestation'}</span
				>
				<span class="font-mono text-text-tertiary text-right">{data.hash}</span>

				<span class="text-text-quaternary">Verified</span>
				<span class="text-text-secondary text-right">{verifiedDate}</span>
			</div>
		</div>
	</div>

	<!-- Browser-side attestation recomputation (recipient pastes their report's
	     offline-verify block; nothing private is published on this surface). -->
	{#if data.mode === 'campaign' && attestationHash}
		<div class="w-full max-w-lg mx-auto verify-stagger" style="--stagger: 5">
			<AttestationVerifier
				expectedHash={attestationHash}
				campaignId={data.hash}
				blockPaste={true}
			/>
		</div>
	{/if}

	<!-- Footer: explanation flows into attribution -->
	<footer class="mt-auto w-full max-w-lg mx-auto pb-6 pt-6 verify-stagger" style="--stagger: 5">
		<p class="text-[13px] leading-relaxed mb-4" style="color: oklch(0.48 0.02 55)">
			Commons verifies identity and location for civic communication.
			Location is proven through a zero-knowledge proof — residency
			is demonstrated without revealing the sender's address. Each
			check produces a cryptographic attestation.
		</p>
		<div class="flex items-baseline justify-between text-[13px]" style="color: oklch(0.55 0.02 55)">
			<a href="/" class="font-brand font-semibold hover:text-text-accent transition-colors duration-participation">
				commons.email
			</a>
			<span>&copy; {new Date().getFullYear()} Commons PBC</span>
		</div>
	</footer>
</div>

<style>
	/* Staggered reveal — each element fades up in sequence */
	.verify-stagger {
		animation: verify-enter 0.5s ease-out both;
		animation-delay: calc(var(--stagger, 0) * 80ms + 100ms);
	}

	@keyframes verify-enter {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* Respect reduced motion */
	@media (prefers-reduced-motion: reduce) {
		.verify-stagger {
			animation: none;
			opacity: 1;
		}
	}
</style>
