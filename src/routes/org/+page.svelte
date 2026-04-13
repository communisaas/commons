<script lang="ts">
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import { modalActions } from '$lib/stores/modalSystem.svelte';

	let { data }: { data: PageData } = $props();

	const user = $derived(data.user);
	const orgs = $derived(user?.orgMemberships ?? []);

	// Creation form state
	let showCreate = $state(false);
	let orgName = $state('');
	let orgSlug = $state('');
	let slugEdited = $state(false);
	let submitting = $state(false);
	let errorMsg = $state('');

	function deriveSlug(name: string): string {
		return name
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, '')
			.replace(/\s+/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 48);
	}

	function handleNameInput(e: Event): void {
		const val = (e.target as HTMLInputElement).value;
		orgName = val;
		if (!slugEdited) {
			orgSlug = deriveSlug(val);
		}
	}

	function handleSlugInput(e: Event): void {
		const val = (e.target as HTMLInputElement).value;
		orgSlug = val.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 48);
		slugEdited = true;
	}

	function openCreate(): void {
		showCreate = true;
		orgName = '';
		orgSlug = '';
		slugEdited = false;
		errorMsg = '';
	}

	async function handleCreate(): Promise<void> {
		if (!orgName.trim() || !orgSlug.trim()) return;

		submitting = true;
		errorMsg = '';

		try {
			const res = await fetch('/api/org', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: orgName.trim(), slug: orgSlug.trim() })
			});

			if (!res.ok) {
				const data = await res.json().catch(() => null);
				if (res.status === 409) {
					errorMsg = 'That slug is taken. Try another.';
				} else {
					errorMsg = data?.message || 'Something went wrong.';
				}
				return;
			}

			const { slug } = await res.json();
			await goto(`/org/${slug}`);
		} finally {
			submitting = false;
		}
	}

	function handleSignIn(): void {
		modalActions.openModal('sign-in-modal', 'sign-in');
	}
</script>

<svelte:head>
	<title>Organizations | Commons</title>
	<meta name="description" content="Verified advocacy infrastructure. Deliver cryptographic proof to decision-makers." />
</svelte:head>

<div class="org-page">
	<a href="/" class="back-link">&larr; commons.email</a>

	{#if orgs.length > 0}
		<!-- ═══ RETURNING USER ═══ -->
		<div class="org-page__inner">
			<h1 class="page-heading">Your organizations</h1>

			<div class="org-list">
				{#each orgs as org}
					<a href="/org/{org.orgSlug}" class="org-card">
						{#if org.orgAvatar}
							<img src={org.orgAvatar} alt="" class="org-card__avatar" />
						{:else}
							<div class="org-card__avatar org-card__avatar--fallback">
								{org.orgName.charAt(0).toUpperCase()}
							</div>
						{/if}
						<div class="org-card__info">
							<span class="org-card__name">{org.orgName}</span>
							<span class="org-card__meta">
								{org.role}{#if org.activeCampaignCount > 0}
									&middot; {org.activeCampaignCount} active
								{/if}
							</span>
						</div>
						<span class="org-card__arrow" aria-hidden="true">&rarr;</span>
					</a>
				{/each}
			</div>

			{#if showCreate}
				<form class="create-form" onsubmit={(e) => { e.preventDefault(); handleCreate(); }}>
					<label class="create-form__label">
						<span class="create-form__label-text">Name</span>
						<input
							type="text"
							class="create-form__input"
							placeholder="Acme Coalition"
							value={orgName}
							oninput={handleNameInput}
							maxlength="100"
							required
						/>
					</label>
					<label class="create-form__label">
						<span class="create-form__label-text">Slug</span>
						<div class="create-form__slug-row">
							<span class="create-form__slug-prefix">/org/</span>
							<input
								type="text"
								class="create-form__input create-form__input--slug"
								placeholder="acme-coalition"
								value={orgSlug}
								oninput={handleSlugInput}
								maxlength="48"
								required
							/>
						</div>
					</label>
					{#if errorMsg}
						<p class="create-form__error">{errorMsg}</p>
					{/if}
					<div class="create-form__actions">
						<button type="button" class="create-form__cancel" onclick={() => { showCreate = false; }}>Cancel</button>
						<button type="submit" class="cta" disabled={submitting || !orgName.trim() || !orgSlug.trim()}>
							{submitting ? 'Creating...' : 'Create'}
						</button>
					</div>
				</form>
			{:else}
				<button class="create-link" onclick={openCreate}>
					Create new organization
				</button>
			{/if}
		</div>
	{:else}
		<!-- ═══ NARRATIVE ═══ -->
		<div class="org-page__narrative">

			<!-- Act 1: The Vision — what becomes possible -->
			<p class="narrative__opening">
				What a decision-maker receives from your organization:
			</p>

			<figure class="specimen">
				<div class="specimen__row">
					<span class="specimen__label">Campaign</span>
					<span class="specimen__value">Aquifer Monitoring Expansion — Budget Allocation</span>
				</div>
				<div class="specimen__row">
					<span class="specimen__label">District</span>
					<span class="specimen__value">NV Water District 7</span>
				</div>

				<div class="specimen__divider"></div>

				<div class="specimen__count-block">
					<span class="specimen__count">248</span>
					<span class="specimen__count-label">verified constituents in your district</span>
				</div>

				<div class="specimen__evidence">
					<div class="specimen__evidence-row">
						<span class="specimen__evidence-label">Identity</span>
						<span class="specimen__evidence-detail">
							<strong>156</strong> government ID verified
							<span class="specimen__sep" aria-hidden="true">&middot;</span>
							<strong>92</strong> address-matched
						</span>
					</div>
					<div class="specimen__evidence-row">
						<span class="specimen__evidence-label">Messages</span>
						<span class="specimen__evidence-detail">
							<strong>196</strong> individually composed
							<span class="specimen__sep" aria-hidden="true">&middot;</span>
							<strong>52</strong> shared statements
						</span>
					</div>
				</div>

				<div class="specimen__divider"></div>

				<div class="specimen__geography">
					Across <strong>14</strong> communities in the district
				</div>
				<div class="specimen__period">
					Submissions <strong>Feb 12 – Mar 4, 2026</strong>
				</div>
				<div class="specimen__screening">
					One submission per person &middot; duplicates removed
				</div>

				<div class="specimen__attestation">
					Cryptographic audit trail available &middot; independently verifiable
				</div>
			</figure>

			<div class="narrative__context">
				<p>
					Every claim is independently verifiable — the decision-maker's office
					can audit the proof without trusting your organization or the platform.
				</p>
				<p class="narrative__context-emphasis">
					No other advocacy platform produces this.
				</p>
			</div>

			<hr class="section-rule" />

			<!-- Act 2: The System — how it works -->
			<p class="narrative__mechanism">
				Import supporters from any platform. Launch a campaign targeting officials across
				24 boundary types — Congress, state legislatures, county boards, school districts,
				water districts, transit authorities. Constituents take verified action.
				The proof assembles itself.
			</p>

			<div class="narrative__capabilities">
				<p>
					<strong>Campaigns</strong> with verification packets that assemble automatically — district-level
					counts, engagement tier distributions, coordination integrity scores.
					<strong>Email and SMS</strong> at scale with verification context.
					A/B testing. Segmentation by tier and district.
					<strong>Patch-through calling</strong> with verified caller district.
				</p>
				<p>
					<strong>Automation</strong> triggered by verification events — when a supporter
					verifies, the system responds. <strong>Legislative monitoring</strong> personalized to
					your supporters' verified districts. <strong>Coalition networks</strong> that
					aggregate proof across organizations.
				</p>
			</div>

			<hr class="section-rule" />

			<!-- Act 3: Access — pricing + threshold -->
			<div class="narrative__pricing">
				<span class="section-label">Pricing</span>

				<div class="pricing-grid">
					<div class="pricing-row">
						<span class="pricing-name">Free</span>
						<span class="pricing-price">$0</span>
						<span class="pricing-limits">100 verified actions &middot; 1,000 emails &middot; 2 seats</span>
					</div>
					<div class="pricing-row">
						<span class="pricing-name">Starter</span>
						<span class="pricing-price">$10<span class="pricing-mo">/mo</span></span>
						<span class="pricing-limits">1,000 verified actions &middot; 20,000 emails &middot; 5 seats</span>
					</div>
					<div class="pricing-row">
						<span class="pricing-name">Organization</span>
						<span class="pricing-price">$75<span class="pricing-mo">/mo</span></span>
						<span class="pricing-limits">5,000 verified actions &middot; 100,000 emails &middot; 10 seats</span>
					</div>
					<div class="pricing-row">
						<span class="pricing-name">Coalition</span>
						<span class="pricing-price">$200<span class="pricing-mo">/mo</span></span>
						<span class="pricing-limits">10,000 verified actions &middot; 250,000 emails &middot; 25 seats</span>
					</div>
				</div>

				<p class="pricing-note">
					Individuals are always free. Verification is the upgrade path, not payment.
				</p>
			</div>

			<hr class="section-rule" />

			<!-- Threshold -->
			<div class="narrative__threshold">
				{#if user}
					<form class="create-form" onsubmit={(e) => { e.preventDefault(); handleCreate(); }}>
						<label class="create-form__label">
							<span class="create-form__label-text">Name</span>
							<input
								type="text"
								class="create-form__input"
								placeholder="Your organization"
								value={orgName}
								oninput={handleNameInput}
								maxlength="100"
								required
							/>
						</label>
						<label class="create-form__label">
							<span class="create-form__label-text">Slug</span>
							<div class="create-form__slug-row">
								<span class="create-form__slug-prefix">/org/</span>
								<input
									type="text"
									class="create-form__input create-form__input--slug"
									placeholder="your-organization"
									value={orgSlug}
									oninput={handleSlugInput}
									maxlength="48"
									required
								/>
							</div>
						</label>
						{#if errorMsg}
							<p class="create-form__error">{errorMsg}</p>
						{/if}
						<button
							type="submit"
							class="cta cta--full"
							disabled={submitting || !orgName.trim() || !orgSlug.trim()}
						>
							{submitting ? 'Creating...' : 'Create organization'}
						</button>
					</form>
				{:else}
					<button class="cta" onclick={handleSignIn}>
						Sign in to create your organization
					</button>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	/* ═══════════════════════════════════════════
	   ORG PAGE — Document Layout
	   ═══════════════════════════════════════════ */
	.org-page {
		min-height: 100vh;
		padding: 1.5rem 1.5rem 4rem;
	}

	@media (min-width: 640px) {
		.org-page {
			padding: 2rem 2rem 5rem;
		}
	}

	@media (min-width: 1024px) {
		.org-page {
			padding: 2.5rem 3rem 6rem;
		}
	}

	/* ═══ BACK LINK ═══ */
	.back-link {
		display: inline-block;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 500;
		color: oklch(0.52 0.02 250);
		text-decoration: none;
		margin-bottom: 3rem;
		transition: color 200ms ease-out;
	}

	.back-link:hover {
		color: oklch(0.35 0.06 180);
	}

	@media (min-width: 640px) {
		.back-link {
			margin-bottom: 4rem;
		}
	}

	/* ═══ RETURNING USER VIEW ═══ */
	.org-page__inner {
		max-width: 28rem;
		width: 100%;
	}

	.page-heading {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: clamp(1.25rem, 1.188rem + 0.31vw, 1.5rem);
		font-weight: 700;
		color: oklch(0.2 0.03 250);
		margin: 0 0 1.5rem;
	}

	.org-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.org-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		border-radius: 6px;
		border: 1px solid oklch(0.92 0.01 250);
		background: oklch(0.99 0.003 250);
		text-decoration: none;
		transition: border-color 200ms ease-out, background 200ms ease-out;
	}

	.org-card:hover {
		border-color: oklch(0.8 0.04 180);
		background: oklch(0.98 0.008 180 / 0.5);
	}

	.org-card__avatar {
		width: 2rem;
		height: 2rem;
		border-radius: 6px;
		object-fit: cover;
		flex-shrink: 0;
	}

	.org-card__avatar--fallback {
		display: flex;
		align-items: center;
		justify-content: center;
		background: oklch(0.92 0.06 180);
		color: oklch(0.4 0.12 180);
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 600;
	}

	.org-card__info {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
		flex: 1;
	}

	.org-card__name {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 600;
		color: oklch(0.25 0.02 250);
	}

	.org-card__meta {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.75rem;
		color: oklch(0.5 0.02 250);
		text-transform: capitalize;
	}

	.org-card__arrow {
		font-size: 0.875rem;
		color: oklch(0.6 0.02 250);
		flex-shrink: 0;
		transition: transform 150ms ease-out, color 150ms ease-out;
	}

	.org-card:hover .org-card__arrow {
		transform: translateX(2px);
		color: oklch(0.45 0.08 180);
	}

	.create-link {
		display: inline-block;
		margin-top: 1.25rem;
		padding: 0;
		border: none;
		background: transparent;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 500;
		color: oklch(0.5 0.06 180);
		cursor: pointer;
		transition: color 150ms ease-out;
	}

	.create-link:hover {
		color: oklch(0.38 0.1 180);
	}

	/* ═══════════════════════════════════════════
	   NARRATIVE VIEW
	   ═══════════════════════════════════════════ */
	.org-page__narrative {
		max-width: 38rem;
		width: 100%;
	}

	/* ═══ OPENING ═══ */
	.narrative__opening {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: clamp(1.125rem, 1.063rem + 0.31vw, 1.375rem);
		font-weight: 500;
		line-height: 1.5;
		color: oklch(0.35 0.02 250);
		margin: 0 0 2rem;
	}

	/* ═══════════════════════════════════════════
	   SPECIMEN — Verification Packet
	   ═══════════════════════════════════════════ */
	.specimen {
		margin: 0;
		padding: 1.25rem 1.25rem;
		background: oklch(0.995 0.003 155 / 0.85);
		border: 1px solid oklch(0.9 0.012 155 / 0.4);
		border-radius: 4px;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		line-height: 1.65;
		color: oklch(0.32 0.02 250);
	}

	@media (min-width: 640px) {
		.specimen {
			padding: 1.5rem 1.75rem;
			font-size: 0.8125rem;
		}
	}

	.specimen__row {
		display: flex;
		gap: 0.75rem;
		margin-bottom: 0.25rem;
	}

	@media (max-width: 479px) {
		.specimen__row {
			flex-direction: column;
			gap: 0.125rem;
		}
	}

	.specimen__label {
		color: oklch(0.55 0.015 250);
		min-width: 5.5rem;
		flex-shrink: 0;
	}

	.specimen__label--block {
		display: block;
		margin-bottom: 0.375rem;
		min-width: unset;
	}

	.specimen__value {
		color: oklch(0.22 0.02 250);
		font-weight: 500;
	}

	.specimen__divider {
		height: 1px;
		background: oklch(0.88 0.01 155 / 0.5);
		margin: 0.875rem 0;
	}

	.specimen__count-block {
		display: flex;
		align-items: baseline;
		gap: 0.625rem;
		margin-bottom: 0.875rem;
	}

	.specimen__count {
		font-size: 1.625rem;
		font-weight: 700;
		color: oklch(0.18 0.03 250);
		line-height: 1;
	}

	@media (min-width: 640px) {
		.specimen__count {
			font-size: 2rem;
		}
	}

	.specimen__count-label {
		font-size: 0.6875rem;
		color: oklch(0.5 0.015 250);
		font-weight: 400;
	}

	/* Evidence rows — identity + authorship */
	.specimen__evidence {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.specimen__evidence-row {
		display: flex;
		gap: 0.75rem;
		font-size: 0.6875rem;
		line-height: 1.6;
	}

	@media (max-width: 479px) {
		.specimen__evidence-row {
			flex-direction: column;
			gap: 0.125rem;
		}
	}

	@media (min-width: 640px) {
		.specimen__evidence-row {
			font-size: 0.75rem;
		}
	}

	.specimen__evidence-label {
		color: oklch(0.52 0.015 250);
		min-width: 4.5rem;
		flex-shrink: 0;
	}

	@media (min-width: 640px) {
		.specimen__evidence-label {
			min-width: 5rem;
		}
	}

	.specimen__evidence-detail {
		color: oklch(0.38 0.015 250);
	}

	.specimen__evidence-detail strong {
		color: oklch(0.22 0.02 250);
		font-weight: 600;
	}

	.specimen__sep {
		margin: 0 0.3rem;
		color: oklch(0.72 0.01 250);
	}

	/* Geography, period, screening — compact factual lines */
	.specimen__geography,
	.specimen__period,
	.specimen__screening {
		font-size: 0.6875rem;
		color: oklch(0.48 0.015 250);
		line-height: 1.7;
	}

	@media (min-width: 640px) {
		.specimen__geography,
		.specimen__period,
		.specimen__screening {
			font-size: 0.75rem;
		}
	}

	.specimen__geography strong,
	.specimen__period strong {
		color: oklch(0.25 0.02 250);
		font-weight: 600;
	}

	.specimen__screening {
		color: oklch(0.52 0.015 250);
	}

	.specimen__attestation {
		margin-top: 0.625rem;
		font-size: 0.625rem;
		color: oklch(0.52 0.02 155);
		letter-spacing: 0.015em;
	}

	@media (min-width: 640px) {
		.specimen__attestation {
			font-size: 0.6875rem;
		}
	}

	/* ═══ CONTEXT ═══ */
	.narrative__context {
		margin-top: 2rem;
	}

	.narrative__context p {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.9375rem;
		line-height: 1.65;
		color: oklch(0.38 0.02 250);
		margin: 0 0 0.625rem;
	}

	.narrative__context-emphasis {
		font-weight: 600;
		color: oklch(0.22 0.025 250) !important;
		margin-bottom: 0 !important;
	}

	/* ═══ SECTION RULE ═══ */
	.section-rule {
		border: none;
		border-top: 1px dotted oklch(0.82 0.01 60 / 0.6);
		margin: 2.5rem 0;
	}

	@media (min-width: 640px) {
		.section-rule {
			margin: 3rem 0;
		}
	}

	/* ═══ MECHANISM ═══ */
	.narrative__mechanism {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.9375rem;
		line-height: 1.75;
		color: oklch(0.38 0.02 250);
		margin: 0 0 1.75rem;
	}

	/* ═══ CAPABILITIES ═══ */
	.narrative__capabilities {
		display: flex;
		flex-direction: column;
		gap: 1.125rem;
	}

	.narrative__capabilities p {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.9375rem;
		line-height: 1.75;
		color: oklch(0.42 0.02 250);
		margin: 0;
	}

	.narrative__capabilities strong {
		color: oklch(0.22 0.02 250);
		font-weight: 600;
	}

	/* ═══ PRICING ═══ */
	.section-label {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: oklch(0.55 0.02 250);
	}

	.pricing-grid {
		margin-top: 1rem;
	}

	.pricing-row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.375rem 0.875rem;
		padding: 0.6875rem 0;
		border-bottom: 1px solid oklch(0.91 0.006 250 / 0.5);
	}

	.pricing-row:first-child {
		border-top: 1px solid oklch(0.91 0.006 250 / 0.5);
	}

	.pricing-name {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 600;
		color: oklch(0.25 0.02 250);
	}

	.pricing-price {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8125rem;
		font-weight: 700;
		color: oklch(0.2 0.03 250);
	}

	.pricing-mo {
		font-weight: 400;
		font-size: 0.6875rem;
		color: oklch(0.55 0.015 250);
	}

	.pricing-limits {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		color: oklch(0.5 0.015 250);
		width: 100%;
	}

	@media (min-width: 640px) {
		.pricing-row {
			display: grid;
			grid-template-columns: 7rem 4rem 1fr;
			gap: 0.75rem;
		}

		.pricing-limits {
			width: auto;
			font-size: 0.75rem;
		}
	}

	.pricing-note {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		color: oklch(0.5 0.02 250);
		margin: 1.25rem 0 0;
		line-height: 1.5;
	}

	/* ═══ THRESHOLD ═══ */
	.narrative__threshold {
		/* Terminal CTA section — no extra chrome */
	}

	/* ═══════════════════════════════════════════
	   SHARED: CTA + FORM
	   ═══════════════════════════════════════════ */
	.cta {
		display: inline-block;
		padding: 0.625rem 1.25rem;
		border-radius: 6px;
		border: 1px solid oklch(0.8 0.04 180);
		background: oklch(0.97 0.01 180);
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 500;
		color: oklch(0.35 0.1 180);
		cursor: pointer;
		transition: background 150ms ease-out, border-color 150ms ease-out;
	}

	.cta:hover {
		background: oklch(0.94 0.03 180);
		border-color: oklch(0.7 0.06 180);
	}

	.cta:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.cta--full {
		display: block;
		width: 100%;
		text-align: center;
		margin-top: 0.5rem;
	}

	.create-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1.25rem;
		border-radius: 6px;
		border: 1px solid oklch(0.88 0.015 180 / 0.4);
		background: oklch(0.985 0.005 180 / 0.5);
	}

	.create-form__label {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.create-form__label-text {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.6875rem;
		font-weight: 600;
		color: oklch(0.42 0.02 250);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.create-form__input {
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		border: 1px solid oklch(0.88 0.02 250);
		background: white;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		color: oklch(0.2 0.02 250);
		outline: none;
		transition: border-color 150ms ease-out;
	}

	.create-form__input:focus {
		border-color: oklch(0.65 0.1 180);
	}

	.create-form__input::placeholder {
		color: oklch(0.7 0.01 250);
	}

	.create-form__slug-row {
		display: flex;
		align-items: center;
	}

	.create-form__slug-prefix {
		padding: 0.5rem 0 0.5rem 0.75rem;
		border-radius: 6px 0 0 6px;
		border: 1px solid oklch(0.88 0.02 250);
		border-right: none;
		background: oklch(0.96 0.005 250);
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8125rem;
		color: oklch(0.5 0.02 250);
		user-select: none;
	}

	.create-form__input--slug {
		border-radius: 0 6px 6px 0;
		flex: 1;
		min-width: 0;
		font-family: 'JetBrains Mono', monospace;
	}

	.create-form__error {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		color: oklch(0.5 0.15 25);
		margin: 0;
	}

	.create-form__actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
		margin-top: 0.25rem;
	}

	.create-form__cancel {
		padding: 0.5rem 1rem;
		border: none;
		background: transparent;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 500;
		color: oklch(0.5 0.02 250);
		cursor: pointer;
		transition: color 150ms ease-out;
	}

	.create-form__cancel:hover {
		color: oklch(0.3 0.02 250);
	}
</style>
