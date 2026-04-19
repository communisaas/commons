<script lang="ts">
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import { modalActions } from '$lib/stores/modalSystem.svelte';

	let { data }: { data: PageData } = $props();

	const user = $derived(data.user);

	function handleSignIn(): void {
		modalActions.openModal('sign-in-modal', 'sign-in');
	}

	function handleCreate(): void {
		if (user) {
			goto('/org');
		} else {
			handleSignIn();
		}
	}
</script>

<svelte:head>
	<title>State legislature | Commons for Orgs</title>
	<meta
		name="description"
		content="State-leg intake is fragmented. In 24 states, your testimony is read by one session aide. Commons produces a verification packet the aide can route — identity-proven, district-matched, authored."
	/>
</svelte:head>

<div class="leg-page">
	<a href="/org/for" class="back-link">&larr; all segments</a>

	<div class="leg-page__inner">
		<!-- Segment marker -->
		<p class="seg-marker">
			<span class="seg-marker__ord">01</span>
			<span class="seg-marker__label">State legislature</span>
		</p>

		<!-- ═══ HERO — research-grounded, state-leg specific ═══ -->
		<h1 class="hero">
			In <span class="hero__count">24</span> states, your bill testimony is read by one session aide. Or the legislator, personally.
		</h1>

		<p class="hero__sub">
			Only 26 states keep year-round personal staff. Everywhere else the filter collapses to one question: <em>real constituent in my district?</em>
		</p>

		<p class="hero__citation">
			NCSL Legislative Staffing &middot; CMF 2017 &middot; Walker &amp; Le, Socius 2023
		</p>

		<!-- ═══ THE COMPARISON ═══ -->
		<div class="comparison">
			<!-- GAP ARTIFACT — the shared inbox spray -->
			<div class="comparison__before">
				<p class="comparison__label">What the session aide opens</p>

				<div class="gap-artifact">
					<div class="gap-artifact__chrome">
						<span class="gap-artifact__dot"></span>
						<span class="gap-artifact__dot"></span>
						<span class="gap-artifact__dot"></span>
						<span class="gap-artifact__path">staff@txsenate.gov &middot; Inbox &middot; 312 unread</span>
					</div>

					<ul class="gap-list">
						<li class="gap-row">
							<span class="gap-row__from">action@noreply.texansfor.org</span>
							<span class="gap-row__subj">Oppose SB-4 — Abortion Ban Appeal</span>
						</li>
						<li class="gap-row">
							<span class="gap-row__from">action@noreply.texansfor.org</span>
							<span class="gap-row__subj">Oppose SB-4 — Abortion Ban Appeal</span>
						</li>
						<li class="gap-row">
							<span class="gap-row__from">action@noreply.texansfor.org</span>
							<span class="gap-row__subj">Oppose SB-4 — Abortion Ban Appeal</span>
						</li>
						<li class="gap-row">
							<span class="gap-row__from">action@noreply.texansfor.org</span>
							<span class="gap-row__subj">Oppose SB-4 — Abortion Ban Appeal</span>
						</li>
						<li class="gap-row">
							<span class="gap-row__from">action@noreply.texansfor.org</span>
							<span class="gap-row__subj">Oppose SB-4 — Abortion Ban Appeal</span>
						</li>
						<li class="gap-row">
							<span class="gap-row__from">action@noreply.texansfor.org</span>
							<span class="gap-row__subj">Oppose SB-4 — Abortion Ban Appeal</span>
						</li>
						<li class="gap-row">
							<span class="gap-row__from">action@noreply.texansfor.org</span>
							<span class="gap-row__subj">Oppose SB-4 — Abortion Ban Appeal</span>
						</li>
						<li class="gap-row gap-row--truncated">
							<span class="gap-row__from">action@noreply.texansfor.org</span>
							<span class="gap-row__subj">Oppose SB-4 — Abortion Ban Appeal</span>
						</li>
					</ul>

					<div class="gap-artifact__footer">
						305 more identical subject lines &middot; aide rule-filed them to a folder before the hearing
					</div>
				</div>

				<p class="comparison__absence">
					No identity verification. No district proof. No local specificity. Rule-filed to &ldquo;mass comment&rdquo; before hearing.
				</p>
			</div>

			<!-- SPECIMEN — state-leg specific -->
			<div class="comparison__after">
				<p class="comparison__label">What the session aide receives from Commons</p>
				<p class="comparison__provenance">
					Example packet &middot; Texas HD-108 &middot; Feb 2026
				</p>

				<figure class="specimen">
					<div class="specimen__title">Texas HD-108 &middot; SB-4 Testimony Packet</div>

					<div class="specimen__meta">
						<div class="specimen__row">
							<span class="specimen__label">District</span>
							<span class="specimen__value">Texas House District 108</span>
						</div>
						<div class="specimen__row">
							<span class="specimen__label">Bill</span>
							<span class="specimen__value">SB-4 (reproductive rights restoration)</span>
						</div>
						<div class="specimen__row">
							<span class="specimen__label">Period</span>
							<span class="specimen__value">Feb 12 &ndash; Mar 4, 2026</span>
						</div>
					</div>

					<div class="specimen__divider"></div>

					<div class="specimen__hero">
						<span class="specimen__count">1,204</span>
						<span class="specimen__count-label">verified constituents<br/>in HD-108</span>
					</div>

					<div class="specimen__divider"></div>

					<div class="specimen__evidence">
						<div class="specimen__evidence-row">
							<span class="specimen__evidence-label">Identity</span>
							<span class="specimen__evidence-detail">
								<strong>812</strong> gov ID
								<span class="specimen__sep">&middot;</span>
								<strong>392</strong> address-matched
							</span>
						</div>
						<div class="specimen__evidence-row">
							<span class="specimen__evidence-label">Authorship</span>
							<span class="specimen__evidence-detail">
								<strong>967</strong> individually composed
								<span class="specimen__sep">&middot;</span>
								<strong>237</strong> shared statements
							</span>
						</div>
						<div class="specimen__evidence-row">
							<span class="specimen__evidence-label">Geography</span>
							<span class="specimen__evidence-detail">
								<strong>43</strong> communities across district
							</span>
						</div>
						<div class="specimen__evidence-row">
							<span class="specimen__evidence-label">Screening</span>
							<span class="specimen__evidence-detail">
								One submission per person &middot; duplicates removed
							</span>
						</div>
					</div>

					<div class="specimen__seal">
						<span class="specimen__seal-text">Cryptographic audit trail &middot; independently verifiable</span>
					</div>
				</figure>
			</div>
		</div>

		<!-- ═══ FILTER MAP — specimen field → session aide question → citation ═══ -->
		<section class="filter-section" aria-labelledby="filter-heading">
			<h2 id="filter-heading" class="sr-only">How each field answers the session aide's triage question</h2>

			<dl class="filter-map" aria-label="How each specimen field maps to the triage question the session aide answers">
				<div class="filter-map__row">
					<dt class="filter-map__field">Identity</dt>
					<dd class="filter-map__answer">answers the triage question:</dd>
					<dd class="filter-map__question">&ldquo;Is this person actually in my district?&rdquo;</dd>
					<dd class="filter-map__citation">CMF 2004 / CMF 2015 &middot; constituent identity and address the primary filter for state legislative offices; form-letter submissions lack both</dd>
				</div>
				<div class="filter-map__row">
					<dt class="filter-map__field">Geography</dt>
					<dd class="filter-map__answer">answers:</dd>
					<dd class="filter-map__question">&ldquo;What district is this? What communities are represented?&rdquo;</dd>
					<dd class="filter-map__citation">CMF 2017 &middot; district-specific impact information weighted by 91% of Congressional staff; the same geographic specificity drives local credibility in state offices</dd>
				</div>
				<div class="filter-map__row">
					<dt class="filter-map__field">Authorship</dt>
					<dd class="filter-map__answer">answers:</dd>
					<dd class="filter-map__question">&ldquo;Did they actually write this, or is it a form email?&rdquo;</dd>
					<dd class="filter-map__citation">CMF 2015 &middot; 92% of staff weight individualized constituent contact; 51% weight form email</dd>
				</div>
				<div class="filter-map__row">
					<dt class="filter-map__field">Screening</dt>
					<dd class="filter-map__answer">answers:</dd>
					<dd class="filter-map__question">&ldquo;Is this astroturf from out of state?&rdquo;</dd>
					<dd class="filter-map__citation">CMF 2004 &middot; Walker &amp; Le, <cite>Socius</cite> 2023 &middot; unverified out-of-district submissions undermine credibility of legitimate constituent contact</dd>
				</div>
			</dl>
		</section>

		<!-- ═══ CATEGORY DISPLACEMENT ═══ -->
		<p class="displacement">
			Your platform submits to Fireside State, IQ, or nothing at all. Commons delivers a document the session aide can route immediately &mdash; each constituent individually authored, identity-proven, district-matched, screened for duplicates.
		</p>

		<p class="displacement__citation">
			CMF 2015: 92% of staff weight individualized constituent email &middot; 51% weight form email
		</p>

		<!-- ═══ OUTCOME ═══ -->
		<p class="outcome">
			Verified constituent packets enter the committee analysis. Form-email counts don't.
		</p>

		<!-- ═══ ANCHOR BOUNDARY LIST ═══ -->
		<section class="anchors" aria-labelledby="anchors-heading">
			<h2 id="anchors-heading" class="sr-only">State legislative boundaries we cover</h2>

			<ul class="anchors__list" role="list">
				<li class="anchors__item">Texas HD-108</li>
				<li class="anchors__item">California SD-14</li>
				<li class="anchors__item">New York Assembly Health Cmte</li>
				<li class="anchors__item">Pennsylvania General Assembly</li>
				<li class="anchors__item">Illinois General Assembly</li>
				<li class="anchors__item">Ohio HB-68</li>
				<li class="anchors__item">Florida Senate Rules Cmte</li>
				<li class="anchors__item">Georgia HD-52</li>
				<li class="anchors__item">Michigan Senate Judiciary</li>
			</ul>

			<p class="anchors__footer">
				<span class="anchors__stat">50</span> state legislatures.
				<span class="anchors__stat">7,383</span> state legislators. Commons supports district-keyed packets across every chamber.
			</p>

			<p class="anchors__reach">
				NCSL total, 99 chambers. Includes CA Position Letter Portal, IL Witness Slips, TX Witness Registration — and the 40+ states with no standardized intake system at all.
			</p>
		</section>

		<!-- ═══ INCUMBENT WINDOW ═══ -->
		<section class="window" aria-labelledby="window-heading">
			<h2 id="window-heading" class="window__pull-quote">
				State legislative intake has no CWC. 24 states have no year-round personal staff. The aide who reads your bill testimony is the same person scheduling appointments.
			</h2>

			<p class="window__body">
				The fragmentation is the opportunity: California has a Position Letter Portal, Illinois has Witness Slips, but Pennsylvania, Ohio, Florida, Georgia &mdash; most states &mdash; have a personal inbox and a single session aide. The &ldquo;real constituent in my district&rdquo; filter is the entire triage in 24 states. A verification packet that arrives with authorship, district, and proof is instantly dispositive. California's Position Letter Portal is the exception that shows what the packet achieves at scale; the other 40+ states are where it becomes the aide's only structured input.
			</p>

			<p class="window__citation">
				NCSL Legislative Staffing Survey &middot; synthesis lines 99&ndash;105 &middot; CA Position Letter Portal (leginfo.legislature.ca.gov) &middot; IL Witness Slips (ilga.gov)
			</p>
		</section>

		<!-- ═══ PRICE + FRICTION ═══ -->
		<div class="pricing">
			<p class="pricing__moment">
				The advocacy stack has changed hands four times this cycle. Session aides have read the form letter 50,000 times. Orgs are shopping.
			</p>

			<div class="pricing__anchor">
				<div class="pricing__anchor-line pricing__anchor-line--strike">
					<span class="pricing__anchor-text">Not <span class="pricing__anchor-num">$15</span>/mo per seat.</span>
				</div>
				<div class="pricing__anchor-line pricing__anchor-line--strike">
					<span class="pricing__anchor-text">Not <span class="pricing__anchor-num">$40,000</span>/yr with a year-long implementation.</span>
				</div>
				<div class="pricing__anchor-line pricing__anchor-line--punchline">
					<span class="pricing__free">$0.</span>
					<span class="pricing__free-scope">
						<span class="pricing__free-scope-num">100</span> verified actions
						<span class="pricing__free-scope-sep">&middot;</span>
						<span class="pricing__free-scope-num">2</span> seats
						<span class="pricing__free-scope-sep">&middot;</span>
						no time limit
					</span>
				</div>
			</div>

			<p class="pricing__anchor-source">
				Starter tier published &middot; enterprise by quote &middot; Apr 2026
			</p>

			<p class="pricing__legend">
				One verified action = one constituent, identity-proven, district-matched, authored for you. Metered at submission, not at send.
			</p>

			<div class="pricing-grid">
				<div class="pricing-row">
					<span class="pricing-name">Free</span>
					<span class="pricing-price">$0</span>
					<span class="pricing-limits"><span class="pricing-num">100</span> verified actions &middot; <span class="pricing-num">1,000</span> emails &middot; <span class="pricing-num">2</span> seats</span>
				</div>
				<div class="pricing-row">
					<span class="pricing-name">Starter</span>
					<span class="pricing-price">$10<span class="pricing-mo">/mo</span></span>
					<span class="pricing-limits"><span class="pricing-num">1,000</span> verified actions &middot; <span class="pricing-num">20,000</span> emails &middot; <span class="pricing-num">5</span> seats</span>
				</div>
				<div class="pricing-row">
					<span class="pricing-name">Organization</span>
					<span class="pricing-price">$75<span class="pricing-mo">/mo</span></span>
					<span class="pricing-limits"><span class="pricing-num">5,000</span> verified actions &middot; <span class="pricing-num">100,000</span> emails &middot; <span class="pricing-num">10</span> seats</span>
				</div>
				<div class="pricing-row">
					<span class="pricing-name">Coalition</span>
					<span class="pricing-price">$200<span class="pricing-mo">/mo</span></span>
					<span class="pricing-limits"><span class="pricing-num">10,000</span> verified actions &middot; <span class="pricing-num">250,000</span> emails &middot; <span class="pricing-num">25</span> seats</span>
				</div>
			</div>

			<p class="pricing__friction">
				No demo required. No procurement review. Import your list from Action Network, EveryAction, NationBuilder, or any CSV export &mdash; a packet produced before the next hearing, not a year from now.
			</p>
		</div>

		<!-- ═══ CTA ═══ -->
		<div class="threshold">
			{#if user}
				<button class="cta" onclick={handleCreate}>
					Create your organization
				</button>
			{:else}
				<button class="cta" onclick={handleSignIn}>
					Sign in to create your organization
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	/* ═══════════════════════════════════════════
	   LEG PAGE — Document Layout
	   ═══════════════════════════════════════════ */
	.leg-page {
		min-height: 100vh;
		padding: 1.5rem 1.5rem 4rem;
		background: oklch(0.995 0.004 55);
	}

	@media (min-width: 640px) {
		.leg-page {
			padding: 2rem 2rem 5rem;
		}
	}

	@media (min-width: 1024px) {
		.leg-page {
			padding: 2.5rem 3rem 6rem;
			padding-left: max(3rem, 12vw);
		}
	}

	.back-link {
		display: inline-block;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 500;
		color: oklch(0.52 0.02 250);
		text-decoration: none;
		margin-bottom: 2rem;
		transition: color 200ms ease-out;
	}

	.back-link:hover {
		color: oklch(0.35 0.06 180);
	}

	@media (min-width: 640px) {
		.back-link {
			margin-bottom: 2.5rem;
		}
	}

	.leg-page__inner {
		width: 100%;
		max-width: 54rem;
	}

	/* ═══ SEGMENT MARKER ═══ */
	.seg-marker {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		margin: 0 0 1.5rem;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: oklch(0.55 0.01 250);
	}

	.seg-marker__ord {
		font-weight: 600;
		color: oklch(0.35 0.08 180);
	}

	/* ═══ HERO ═══ */
	.hero {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: clamp(1.5rem, 1.1rem + 2vw, 2.25rem);
		line-height: 1.2;
		font-weight: 700;
		color: oklch(0.2 0.03 250);
		margin: 0 0 1rem;
		max-width: 36rem;
		letter-spacing: -0.01em;
	}

	.hero__count {
		font-family: 'JetBrains Mono', monospace;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.hero__sub {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: clamp(1rem, 0.92rem + 0.4vw, 1.125rem);
		line-height: 1.55;
		font-weight: 400;
		color: oklch(0.38 0.015 250);
		margin: 0 0 0.75rem;
		max-width: 36rem;
	}

	.hero__sub em {
		font-style: italic;
		color: oklch(0.28 0.02 250);
	}

	.hero__citation {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		line-height: 1.55;
		color: oklch(0.55 0.01 250);
		letter-spacing: 0.02em;
		margin: 0 0 2.75rem;
		max-width: 42rem;
	}

	/* ═══ COMPARISON ═══ */
	.comparison {
		display: flex;
		flex-direction: column;
		gap: 2.5rem;
		margin-bottom: 3rem;
	}

	@media (min-width: 768px) {
		.comparison {
			flex-direction: row;
			align-items: flex-start;
			gap: 2.5rem;
		}
	}

	@media (min-width: 1024px) {
		.comparison {
			gap: 3rem;
		}
	}

	.comparison__before {
		flex-shrink: 0;
	}

	@media (min-width: 768px) {
		.comparison__before {
			width: 24rem;
			padding-top: 1.5rem;
		}
	}

	@media (min-width: 1280px) {
		.comparison__before {
			width: 26rem;
		}
	}

	.comparison__after {
		flex: 1;
		min-width: 0;
		max-width: 38rem;
	}

	.comparison__label {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 500;
		color: oklch(0.48 0.012 250);
		margin: 0 0 0.75rem;
	}

	.comparison__absence {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 500;
		line-height: 1.55;
		color: oklch(0.42 0.015 250);
		margin: 1rem 0 0;
		max-width: 26rem;
	}

	.comparison__provenance {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		font-weight: 400;
		line-height: 1.5;
		color: oklch(0.58 0.008 250);
		margin: 0 0 0.625rem;
		letter-spacing: 0.02em;
	}

	/* ═══ GAP ARTIFACT — the inbox spray ═══ */
	.gap-artifact {
		max-width: 24rem;
		background: #ffffff;
		border: 1px solid oklch(0.88 0.006 250);
		box-shadow:
			0 1px 2px oklch(0.15 0.01 250 / 0.04),
			0 4px 14px oklch(0.15 0.01 250 / 0.06);
		overflow: hidden;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
		font-size: 0.75rem;
		line-height: 1.55;
		color: oklch(0.42 0.008 250);
	}

	.gap-artifact__chrome {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.3125rem 0.5rem;
		background: oklch(0.95 0.003 250);
		border-bottom: 1px solid oklch(0.91 0.005 250);
	}

	.gap-artifact__dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: oklch(0.84 0.004 250);
	}

	.gap-artifact__path {
		margin-left: auto;
		font-size: 0.625rem;
		color: oklch(0.55 0.008 250);
		font-family: 'JetBrains Mono', monospace;
	}

	.gap-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.gap-row {
		display: grid;
		grid-template-columns: 8rem 1fr;
		gap: 0.5rem;
		padding: 0.4375rem 0.75rem;
		border-bottom: 1px solid oklch(0.945 0.004 250);
		font-size: 0.6875rem;
		line-height: 1.4;
		align-items: baseline;
	}

	@media (min-width: 480px) {
		.gap-row {
			grid-template-columns: 11rem 1fr;
			gap: 0.625rem;
			padding: 0.4375rem 0.875rem;
		}
	}

	.gap-row--truncated {
		opacity: 0.6;
	}

	.gap-row__from {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		color: oklch(0.5 0.008 250);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.gap-row__subj {
		color: oklch(0.38 0.008 250);
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.gap-artifact__footer {
		padding: 0.5rem 0.75rem 0.625rem;
		font-size: 0.625rem;
		color: oklch(0.55 0.008 250);
		line-height: 1.5;
		font-style: italic;
	}

	/* ═══ SPECIMEN ═══ */
	.specimen {
		margin: 0;
		padding: 0;
		background: #ffffff;
		border: 1px solid oklch(0.84 0.008 250);
		box-shadow:
			0 1px 2px oklch(0.15 0.01 250 / 0.05),
			0 4px 16px oklch(0.15 0.01 250 / 0.07);
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		line-height: 1.6;
		color: oklch(0.3 0.02 250);
	}

	@media (min-width: 640px) {
		.specimen { font-size: 0.8125rem; }
	}

	.specimen__title {
		padding: 0.625rem 1.25rem;
		font-size: 0.5625rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: oklch(0.5 0.012 250);
		border-bottom: 1px solid oklch(0.91 0.006 250);
		background: oklch(0.985 0.002 250);
	}

	@media (min-width: 640px) {
		.specimen__title {
			padding: 0.75rem 2rem;
			font-size: 0.625rem;
		}
	}

	.specimen__meta {
		padding: 1.125rem 1.25rem 0;
	}

	@media (min-width: 640px) {
		.specimen__meta { padding: 1.375rem 2rem 0; }
	}

	.specimen__row {
		display: flex;
		gap: 0.75rem;
		margin-bottom: 0.125rem;
	}

	@media (max-width: 479px) {
		.specimen__row { flex-direction: column; gap: 0; }
	}

	.specimen__label {
		color: oklch(0.55 0.01 250);
		min-width: 5.5rem;
		flex-shrink: 0;
	}

	.specimen__value {
		color: oklch(0.2 0.02 250);
		font-weight: 500;
	}

	.specimen__divider {
		height: 1px;
		background: oklch(0.91 0.006 250);
		margin: 0.875rem 1.25rem;
	}

	@media (min-width: 640px) {
		.specimen__divider { margin: 1rem 2rem; }
	}

	.specimen__hero {
		padding: 1rem 1.25rem 1.25rem;
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}

	@media (min-width: 640px) {
		.specimen__hero { padding: 1.5rem 2rem 1.75rem; }
	}

	.specimen__count {
		font-size: 2.5rem;
		font-weight: 700;
		color: oklch(0.35 0.12 165);
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}

	@media (min-width: 640px) {
		.specimen__count { font-size: 3.25rem; }
	}

	.specimen__count-label {
		font-size: 0.6875rem;
		color: oklch(0.48 0.01 250);
		font-weight: 400;
		line-height: 1.35;
	}

	.specimen__evidence {
		padding: 0 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.4375rem;
	}

	@media (min-width: 640px) {
		.specimen__evidence { padding: 0 2rem; }
	}

	.specimen__evidence-row {
		display: flex;
		gap: 0.75rem;
		font-size: 0.6875rem;
		line-height: 1.5;
	}

	@media (max-width: 479px) {
		.specimen__evidence-row { flex-direction: column; gap: 0; }
	}

	@media (min-width: 640px) {
		.specimen__evidence-row { font-size: 0.75rem; }
	}

	.specimen__evidence-label {
		color: oklch(0.52 0.01 250);
		min-width: 5.5rem;
		flex-shrink: 0;
	}

	.specimen__evidence-detail {
		color: oklch(0.38 0.01 250);
	}

	.specimen__evidence-detail strong {
		color: oklch(0.2 0.02 250);
		font-weight: 600;
	}

	.specimen__sep {
		margin: 0 0.2rem;
		color: oklch(0.72 0.006 250);
	}

	.specimen__seal {
		margin-top: 1rem;
		padding: 0.75rem 1.25rem;
		border-top: 1px solid oklch(0.88 0.01 165 / 0.4);
		background: oklch(0.97 0.008 165 / 0.35);
	}

	@media (min-width: 640px) {
		.specimen__seal { padding: 0.875rem 2rem; }
	}

	.specimen__seal-text {
		font-size: 0.6875rem;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		font-weight: 500;
		color: oklch(0.4 0.05 165);
	}

	@media (min-width: 640px) {
		.specimen__seal-text { font-size: 0.75rem; }
	}

	/* ═══ DISPLACEMENT + OUTCOME ═══ */
	.displacement {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: clamp(1rem, 0.9rem + 0.5vw, 1.125rem);
		line-height: 1.55;
		font-weight: 500;
		color: oklch(0.28 0.02 250);
		margin: 0 0 0.75rem;
		max-width: 42rem;
	}

	.displacement__citation {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		line-height: 1.5;
		color: oklch(0.55 0.01 250);
		letter-spacing: 0.03em;
		margin: 0 0 2.25rem;
		max-width: 42rem;
	}

	.outcome {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.9375rem;
		line-height: 1.55;
		font-weight: 400;
		color: oklch(0.42 0.015 250);
		margin: 0 0 4rem;
		max-width: 40rem;
	}

	/* ═══════════════════════════════════════════
	   ANCHOR BOUNDARY TYPES
	   ═══════════════════════════════════════════ */
	.anchors {
		max-width: 44rem;
		margin-bottom: 4rem;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.anchors__list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.5rem 2rem;
	}

	@media (min-width: 480px) {
		.anchors__list {
			grid-template-columns: 1fr 1fr;
			gap: 0.625rem 2.5rem;
		}
	}

	@media (min-width: 768px) {
		.anchors__list {
			grid-template-columns: repeat(3, 1fr);
			gap: 0.75rem 2.5rem;
		}
	}

	.anchors__item {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: clamp(1.0625rem, 0.92rem + 0.65vw, 1.3125rem);
		font-weight: 700;
		line-height: 1.25;
		color: oklch(0.22 0.03 250);
		letter-spacing: -0.01em;
	}

	.anchors__footer {
		margin: 2.25rem 0 0;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.9375rem;
		line-height: 1.6;
		color: oklch(0.38 0.015 250);
		max-width: 42rem;
	}

	.anchors__stat {
		font-family: 'JetBrains Mono', monospace;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		color: oklch(0.22 0.03 250);
	}

	.anchors__reach {
		margin: 0.75rem 0 0;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		line-height: 1.55;
		color: oklch(0.48 0.012 250);
		max-width: 40rem;
	}

	/* ═══ FILTER MAP ═══ */
	.filter-section {
		margin: 0 0 3rem;
	}

	.filter-map {
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		max-width: 38rem;
	}

	@media (min-width: 640px) {
		.filter-map { gap: 1.5rem; }
	}

	.filter-map__row {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.375rem;
		padding-top: 1.25rem;
		border-top: 1.5px solid oklch(0.84 0.008 250);
	}

	@media (min-width: 640px) {
		.filter-map__row {
			gap: 0.125rem;
			padding-top: 1.125rem;
			border-top-width: 1px;
			border-top-color: oklch(0.88 0.006 250);
		}
	}

	.filter-map__row:first-child {
		padding-top: 0;
		border-top: none;
	}

	.filter-map__field {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: oklch(0.35 0.12 165);
		margin: 0 0 0.125rem;
	}

	.filter-map__answer {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		line-height: 1.4;
		font-weight: 400;
		color: oklch(0.5 0.015 250);
		margin: 0;
	}

	.filter-map__question {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: clamp(1.125rem, 1rem + 0.6vw, 1.25rem);
		line-height: 1.3;
		font-weight: 600;
		color: oklch(0.18 0.03 250);
		font-style: italic;
		margin: 0.125rem 0 0.5rem;
		letter-spacing: -0.005em;
	}

	.filter-map__citation {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		line-height: 1.55;
		color: oklch(0.55 0.01 250);
		margin: 0;
		letter-spacing: 0.01em;
	}

	.filter-map__citation cite { font-style: italic; }

	/* ═══ INCUMBENT WINDOW ═══ */
	.window {
		margin-bottom: 5.5rem;
	}

	.window__pull-quote {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: clamp(1.3125rem, 1rem + 1.6vw, 1.75rem);
		line-height: 1.28;
		font-weight: 600;
		color: oklch(0.2 0.03 250);
		margin: 0 0 1.25rem;
		padding-left: 1.125rem;
		border-left: 2px solid oklch(0.55 0.12 165);
		letter-spacing: -0.01em;
		max-width: 36rem;
	}

	.window__body {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 1rem;
		line-height: 1.6;
		font-weight: 400;
		color: oklch(0.32 0.02 250);
		margin: 0 0 1.25rem;
		max-width: 36rem;
	}

	.window__citation {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		line-height: 1.55;
		color: oklch(0.55 0.01 250);
		margin: 0;
		letter-spacing: 0.01em;
		max-width: 40rem;
	}

	.window__citation cite { font-style: italic; }

	/* ═══════════════════════════════════════════
	   PRICING
	   ═══════════════════════════════════════════ */
	.pricing {
		max-width: 38rem;
	}

	.pricing__moment {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.9375rem;
		line-height: 1.55;
		font-weight: 400;
		color: oklch(0.42 0.015 250);
		margin: 0 0 2rem;
		max-width: 36rem;
	}

	.pricing__anchor {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		margin-bottom: 1.5rem;
	}

	.pricing__anchor-line {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 1.125rem;
		line-height: 1.3;
		font-weight: 500;
	}

	.pricing__anchor-line--strike {
		color: oklch(0.62 0.008 250);
		text-decoration: line-through;
		text-decoration-thickness: 1px;
		text-decoration-color: oklch(0.72 0.008 250);
	}

	.pricing__anchor-num {
		font-family: 'JetBrains Mono', monospace;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	.pricing__anchor-line--punchline {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.625rem 0.875rem;
		margin-top: 0.5rem;
	}

	.pricing__anchor-source {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		line-height: 1.5;
		color: oklch(0.55 0.01 250);
		margin: 0.625rem 0 0;
		letter-spacing: 0.02em;
	}

	.pricing__free {
		font-family: 'JetBrains Mono', monospace;
		font-size: clamp(1.75rem, 1.4rem + 1.75vw, 2.375rem);
		font-weight: 700;
		color: oklch(0.48 0.16 160);
		letter-spacing: -0.02em;
		line-height: 1;
	}

	.pricing__free-scope {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8125rem;
		line-height: 1.4;
		font-weight: 400;
		color: oklch(0.38 0.015 250);
		letter-spacing: 0.005em;
	}

	.pricing__free-scope-num {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		color: oklch(0.22 0.03 250);
	}

	.pricing__free-scope-sep {
		margin: 0 0.25rem;
		color: oklch(0.72 0.008 250);
	}

	.pricing__legend {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.9375rem;
		line-height: 1.55;
		color: oklch(0.38 0.015 250);
		margin: 2rem 0 1.25rem;
		max-width: 36rem;
	}

	.pricing__friction {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.9375rem;
		line-height: 1.55;
		font-weight: 500;
		color: oklch(0.32 0.02 250);
		margin: 1.75rem 0 0;
		max-width: 36rem;
	}

	.pricing-grid {
		margin: 0;
		max-width: 38rem;
	}

	.pricing-num {
		font-family: 'JetBrains Mono', monospace;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		color: oklch(0.28 0.02 250);
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
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.75rem;
		color: oklch(0.48 0.012 250);
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
			font-size: 0.8125rem;
		}
	}

	/* ═══ THRESHOLD ═══ */
	.threshold {
		margin-top: 2rem;
		max-width: 28rem;
	}

	.cta {
		display: inline-block;
		padding: 0.75rem 1.5rem;
		min-height: 44px;
		border-radius: 4px;
		border: 1px solid oklch(0.45 0.1 180);
		background: oklch(0.42 0.1 180);
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 600;
		color: #ffffff;
		cursor: pointer;
		transition: background 150ms ease-out, border-color 150ms ease-out;
	}

	.cta:hover {
		background: oklch(0.38 0.11 180);
		border-color: oklch(0.38 0.11 180);
	}

	.cta:focus-visible {
		outline: 2px solid oklch(0.45 0.1 180);
		outline-offset: 2px;
	}
</style>
