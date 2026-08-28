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
		data.mode === 'campaign' ? (data.campaignContext?.attestationHash ?? null) : null
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
		if (data.trustTier === null) return 'Sender record';
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
		if (data.trustTier === null) {
			return data.record.status === 'active'
				? 'This page records the sender information captured when the record was issued.'
				: 'The sender information on this page was captured when the record was issued.';
		}
		const isActive = data.record.status === 'active';
		if (
			data.location.state.value.state === 'present' &&
			data.location.state.source.state === 'present' &&
			data.location.state.source.value === 'atlas-derived'
		) {
			const state = data.location.state.value.value;
			if (data.trustTier >= 3) {
				return isActive
					? `The person who sent you this message proved their identity and residency in ${state} with a government credential.`
					: `When this record was issued, the sender had proved their identity and residency in ${state} with a government credential.`;
			}
			if (data.trustTier >= 2) {
				return isActive
					? `The person who sent you this message verified their address in ${state} before sending.`
					: `When this record was issued, the sender had verified their address in ${state}.`;
			}
		}
		if (data.trustTier >= 3) {
			return isActive
				? 'The person who sent you this message proved their identity and residency with a government credential.'
				: 'When this record was issued, the sender had proved their identity and residency with a government credential.';
		}
		if (data.trustTier >= 2) {
			return isActive
				? 'The person who sent you this message verified their address before sending.'
				: 'The sender had verified their address when this record was issued.';
		}
		if (data.trustTier >= 1) {
			return isActive
				? 'The person who sent you this message authenticated their account via email before sending.'
				: 'The sender had authenticated their account via email when this record was issued.';
		}
		return isActive
			? 'This sender has not completed verification.'
			: 'When this record was issued, the sender had not completed verification.';
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
			return {
				label: 'Identity',
				value: 'Government credential (mDL)',
				verified: data.identity.verified
			};
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
		data.mode === 'campaign'
			? attestationHash !== null
			: data.record.status === 'active' && data.trustTier !== null && data.trustTier >= 1
	);

	// B3 — district-resolution freshness. Two INDEPENDENT clocks: the BOUNDARY
	// clock (when the district geometry was generated, labeled by its TIGER
	// vintage) and the OFFICIALS clock (when the roster was generated). Each is
	// shown ONLY when the credential carries a real value — `null` means honestly
	// unknown at issuance and renders nothing. We never copy one clock's value
	// into the other and make no comparative "fresher than X" claim. Campaign
	// mode has no per-credential freshness, so these resolve to null there.
	function formatClock(value: string | number | null | undefined): string | null {
		if (value === null || value === undefined || value === '') return null;
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return typeof value === 'string' ? value : null;
		return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
	}
	const boundaryClock = $derived(
		data.mode === 'individual' ? formatClock(data.location.boundaryAsOf) : null
	);
	const officialsClock = $derived(
		data.mode === 'individual' ? formatClock(data.location.officialsAsOf) : null
	);
	const tigerVintage = $derived(
		data.mode === 'individual' ? (data.location.tigerVintage ?? null) : null
	);
	const resolutionConfidence = $derived(
		data.mode === 'individual' ? (data.location.resolutionConfidence ?? null) : null
	);
	const confidencePct = $derived(
		resolutionConfidence !== null ? Math.round(resolutionConfidence * 100) : null
	);
	const terminalStateLine = $derived.by(() => {
		if (data.mode !== 'individual' || data.record.status === 'active') return null;
		const date = formatClock(data.record.retiredAt);
		if (!date) return null;
		switch (data.record.status) {
			case 'superseded':
				return `This record stopped standing on ${date}. The sender re-verified their address; this page does not link to the newer record.`;
			case 'operator_retired':
				return `This record was retired by Commons on ${date} during a credential rotation.`;
			case 'retired_reason_unrecorded':
				return `This record was retired on ${date}. The reason was not recorded.`;
			case 'lapsed':
				return `This record lapsed on ${date}. It was accurate when issued and has not been renewed.`;
		}
	});
</script>

<svelte:head>
	<title>Sender Verification — Commons</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div
	class="flex flex-col px-6"
	style="background: oklch(0.993 0.003 60); min-height: calc(100vh - 48px);"
>
	<div class="mx-auto w-full max-w-lg pt-[5vh]">
		<!-- Header -->
		<div class="verify-stagger mb-2 flex items-center gap-3.5" style="--stagger: 0">
			<div
				class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full"
				style="background: oklch(0.95 0.03 160 / 0.5); border: 1px solid oklch(0.88 0.04 160 / 0.4);"
			>
				{#if showShield}
					<svg
						class="h-5 w-5"
						style="color: oklch(0.45 0.12 160)"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
						<path d="m9 12 2 2 4-4" />
					</svg>
				{:else}
					<svg
						class="text-text-quaternary h-5 w-5"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
					</svg>
				{/if}
			</div>
			<div>
				<h1 class="font-brand text-text-primary text-2xl font-bold tracking-tight">
					{headline}
				</h1>
				<p class="text-text-quaternary mt-0.5 font-mono text-[13px]">commons.email</p>
			</div>
		</div>

		<p
			class="font-brand text-text-tertiary verify-stagger mb-8 text-[15px] leading-relaxed sm:ml-[54px]"
			style="--stagger: 1"
		>
			{lead}
		</p>

		{#if terminalStateLine}
			<p
				data-terminal-state
				class="verify-stagger mb-8 text-[15px] leading-relaxed sm:ml-[54px]"
				style="--stagger: 2"
			>
				{terminalStateLine}
			</p>
		{/if}

		<!-- Jurisdictions: the strong center -->
		{#if data.mode === 'individual'}
			<div
				class="rounded-participation-lg border-surface-border bg-surface-raised shadow-atmospheric-card verify-stagger mb-2 border px-5 py-4"
				style="--stagger: 2"
			>
				<p
					class="text-text-accent mb-3 font-mono text-[11px] font-medium tracking-widest uppercase"
				>
					Containment
				</p>
				<div class="space-y-2">
					{#each data.location.districts as d}
						<div class="flex items-start justify-between gap-6" data-containment-slot={d.slot}>
							<span class="text-text-tertiary shrink-0 text-sm">{d.label}</span>
							<span class="flex flex-col items-end text-right">
								{#if d.value.state === 'present'}
									<span class="text-text-primary font-mono text-sm font-medium"
										>{d.value.value}</span
									>
								{:else if d.value.state === 'absent'}
									<span class="text-text-tertiary font-mono text-sm font-medium">ABSENT</span>
									<span class="text-text-quaternary text-[10px]">not carried by credential</span>
								{:else if d.value.state === 'withheld'}
									<span class="text-text-tertiary font-mono text-sm font-medium">WITHHELD</span>
									<span class="text-text-quaternary text-[10px]">{d.value.why}</span>
								{:else}
									<span class="text-text-tertiary font-mono text-sm font-medium">BLOCKED</span>
									<span class="text-text-quaternary text-[10px]">{d.value.why}</span>
								{/if}
								<span class="text-text-quaternary font-mono text-[10px]">
									provenance:
									{#if d.source.state === 'present'}
										{d.source.value}
									{:else if d.source.state === 'absent'}
										ABSENT
									{:else if d.source.state === 'withheld'}
										WITHHELD — {d.source.why}
									{:else}
										BLOCKED — {d.source.why}
									{/if}
								</span>
							</span>
						</div>
					{/each}
				</div>
			</div>
			<p class="text-text-quaternary verify-stagger mb-8 px-1 text-xs" style="--stagger: 3">
				Atlas-derived rows were checked against the published district atlas. Self-reported rows
				were supplied by the sender and not independently checked. Exact address is never revealed.
			</p>
		{:else if data.location.state.value.state === 'present'}
			<div class="verify-stagger mb-8 px-1" style="--stagger: 2">
				<span class="text-text-quaternary text-sm">State:</span>
				<span class="text-text-secondary ml-1 font-mono text-sm font-medium"
					>{data.location.state.value.value}</span
				>
			</div>
		{/if}

		<!-- B3 — district-resolution freshness: two SEPARATE labeled clocks.
		     Boundary (when the district geometry was generated; TIGER vintage
		     labels it) and Officials (when the roster was generated) are distinct
		     and shown only when the credential carries a real value. No comparative
		     "fresher than X" claim — these are this credential's own provenance. -->
		{#if boundaryClock || officialsClock || confidencePct !== null}
			<div class="verify-stagger mb-8 px-1" style="--stagger: 3">
				<p
					class="text-text-quaternary mb-2 font-mono text-[11px] font-medium tracking-widest uppercase"
				>
					Resolution freshness
				</p>
				<div class="grid grid-cols-[auto_1fr] gap-x-8 gap-y-1.5 text-[13px]">
					{#if boundaryClock}
						<span class="text-text-quaternary">
							District boundary{tigerVintage ? ` (${tigerVintage})` : ''}
						</span>
						<span class="text-text-secondary text-right font-mono">{boundaryClock}</span>
					{/if}
					{#if officialsClock}
						<span class="text-text-quaternary">Officials roster</span>
						<span class="text-text-secondary text-right font-mono">{officialsClock}</span>
					{/if}
					{#if confidencePct !== null}
						<span class="text-text-quaternary">Match confidence</span>
						<span class="text-text-secondary text-right font-mono">{confidencePct}%</span>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Compact metadata -->
		<div class="border-surface-border verify-stagger mb-8 border-t pt-5" style="--stagger: 4">
			<div class="grid grid-cols-[auto_1fr] gap-x-8 gap-y-2.5 text-[13px]">
				<span class="text-text-quaternary">{authRow.label}</span>
				<span
					class="text-right {authRow.verified ? 'text-channel-verified-700' : 'text-text-tertiary'}"
				>
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
				<span class="text-text-tertiary text-right font-mono">{data.hash}</span>

				<span class="text-text-quaternary">Verified</span>
				<span class="text-text-secondary text-right">{verifiedDate}</span>
			</div>
		</div>
	</div>

	<!-- Browser-side attestation recomputation (recipient pastes their report's
	     offline-verify block; nothing private is published on this surface). -->
	{#if data.mode === 'campaign' && attestationHash}
		<div class="verify-stagger mx-auto w-full max-w-lg" style="--stagger: 5">
			<AttestationVerifier
				expectedHash={attestationHash}
				campaignId={data.hash}
				blockPaste={true}
			/>
		</div>
	{/if}

	<!-- Footer: explanation flows into attribution -->
	<footer class="verify-stagger mx-auto mt-auto w-full max-w-lg pt-6 pb-6" style="--stagger: 5">
		<p class="mb-4 text-[13px] leading-relaxed" style="color: oklch(0.48 0.02 55)">
			Commons verifies identity and location for civic communication where the certificate marks an
			atlas-derived row. Self-reported rows are labeled and are not independently checked. Exact
			addresses remain private, and each completed check produces a cryptographic attestation.
		</p>
		<div class="flex items-baseline justify-between text-[13px]" style="color: oklch(0.55 0.02 55)">
			<a
				href="/"
				class="font-brand hover:text-text-accent duration-participation font-semibold transition-colors"
			>
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
