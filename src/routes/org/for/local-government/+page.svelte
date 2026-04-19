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
	<title>Local government | Commons for Orgs</title>
	<meta
		name="description"
		content="Local intake is a clerk-assembled PDF packet, distributed Friday, skimmed Monday. Commons produces a verification packet with named authors and census-tract provenance — testimony, not Item 7's form-letter bloat."
	/>
</svelte:head>

<div class="seg-page">
	<a href="/org/for" class="back-link">&larr; all segments</a>

	<div class="seg-page__inner">
		<!-- Segment marker -->
		<p class="seg-marker">
			<span class="seg-marker__ord">03</span>
			<span class="seg-marker__label">Local government</span>
		</p>

		<!-- ═══ HERO — research-grounded, local-gov specific ═══ -->
		<h1 class="hero">
			Your comment is item <span class="hero__count">7</span> in a <span class="hero__count">89</span>-page PDF the clerk distributed Friday. Five board members open it Monday morning.
		</h1>

		<p class="hero__sub">
			At Santa Clara Valley Water, at Snowmass Water &amp; Sanitation, at the Colorado State Board of Education, local intake is the same shape: an email to <code>board@</code>, a packet assembled by the clerk, <em>scrolled — not queried — before the vote.</em>
		</p>

		<p class="hero__citation">
			Santa Clara Valley Water District public comment procedure &middot; Snowmass Water &amp; Sanitation (swsd.org) &middot; Colorado State Board of Education public comment guidelines &middot; California State Water Board notices (waterboards.ca.gov)
		</p>

		<!-- ═══ THE COMPARISON ═══ -->
		<div class="comparison">
			<!-- GAP ARTIFACT — the PDF packet page -->
			<div class="comparison__before">
				<p class="comparison__label">What the board member opens Monday morning</p>

				<figure class="pdf-artifact" aria-label="Public comment packet PDF showing clustered identical comments">
					<div class="pdf-artifact__chrome">
						<span class="pdf-artifact__chrome-label">public-comment-packet.pdf &middot; page 43 of 89</span>
					</div>

					<div class="pdf-artifact__page">
						<div class="pdf-artifact__header">
							<div class="pdf-artifact__title">BOARD MEETING &middot; APR 20, 2026</div>
							<div class="pdf-artifact__subtitle">Public Comment Packet &middot; Item 7 &middot; Rate Adjustment</div>
						</div>

						<div class="pdf-artifact__toc">
							<div class="pdf-artifact__toc-label">Contents, Item 7 comments received</div>
							<ul class="pdf-toc">
								<li class="pdf-toc__row">
									<span class="pdf-toc__no">7.01</span>
									<span class="pdf-toc__body">Oppose rate adjustment &mdash; form letter</span>
									<span class="pdf-toc__page">p. 44</span>
								</li>
								<li class="pdf-toc__row">
									<span class="pdf-toc__no">7.02</span>
									<span class="pdf-toc__body">Oppose rate adjustment &mdash; form letter</span>
									<span class="pdf-toc__page">p. 45</span>
								</li>
								<li class="pdf-toc__row">
									<span class="pdf-toc__no">7.03</span>
									<span class="pdf-toc__body">Oppose rate adjustment &mdash; form letter</span>
									<span class="pdf-toc__page">p. 46</span>
								</li>
								<li class="pdf-toc__row">
									<span class="pdf-toc__no">7.04</span>
									<span class="pdf-toc__body">Oppose rate adjustment &mdash; form letter</span>
									<span class="pdf-toc__page">p. 47</span>
								</li>
								<li class="pdf-toc__row pdf-toc__row--dim">
									<span class="pdf-toc__no">7.05</span>
									<span class="pdf-toc__body">Oppose rate adjustment &mdash; form letter</span>
									<span class="pdf-toc__page">p. 48</span>
								</li>
								<li class="pdf-toc__row pdf-toc__row--dimmer">
									<span class="pdf-toc__no">7.06</span>
									<span class="pdf-toc__body">Oppose rate adjustment &mdash; form letter</span>
									<span class="pdf-toc__page">p. 49</span>
								</li>
								<li class="pdf-toc__row pdf-toc__row--dimmest">
									<span class="pdf-toc__no">7.07</span>
									<span class="pdf-toc__body">Oppose rate adjustment &mdash; form letter</span>
									<span class="pdf-toc__page">p. 50</span>
								</li>
							</ul>
						</div>

						<div class="pdf-artifact__footnote">
							<span class="pdf-artifact__footnote-mark">*</span>
							Staff received <strong>47</strong> comments substantially identical to 7.01&ndash;7.07; names attached as Exhibit A (not rendered here).
						</div>

						<div class="pdf-artifact__distribution">
							Distributed Fri Apr 17, 4:47 PM &middot; Read before Mon Apr 20, 9:00 AM
						</div>
					</div>
				</figure>

				<p class="comparison__absence">
					No identity verification. No census-tract provenance. No neighborhood-association affiliation. The board member skims the Item 7 block, sees the form letter, skips the exhibit, votes.
				</p>
			</div>

			<!-- SPECIMEN — local-gov specific -->
			<div class="comparison__after">
				<p class="comparison__label">What the clerk files in the packet from Commons</p>
				<p class="comparison__provenance">
					Example packet &middot; Santa Clara Valley Water &middot; Apr 2026
				</p>

				<figure class="specimen">
					<div class="specimen__title">Santa Clara Valley Water &middot; Rate Adjustment Testimony</div>

					<div class="specimen__meta">
						<div class="specimen__row">
							<span class="specimen__label">Meeting</span>
							<span class="specimen__value">Board of Directors, Apr 20, 2026</span>
						</div>
						<div class="specimen__row">
							<span class="specimen__label">Item</span>
							<span class="specimen__value">Item 7 &middot; FY27 Rate Adjustment</span>
						</div>
						<div class="specimen__row">
							<span class="specimen__label">District</span>
							<span class="specimen__value">Santa Clara County (7-director at-large)</span>
						</div>
						<div class="specimen__row">
							<span class="specimen__label">Period</span>
							<span class="specimen__value">Mar 18 &ndash; Apr 17, 2026</span>
						</div>
					</div>

					<div class="specimen__divider"></div>

					<div class="specimen__hero">
						<span class="specimen__count">874</span>
						<span class="specimen__count-label">verified residents<br/>in district boundary</span>
					</div>

					<div class="specimen__subcount">
						<span class="specimen__subcount-num">312</span>
						<span class="specimen__subcount-label">within the proposed rate-adjustment service area</span>
					</div>

					<div class="specimen__divider"></div>

					<div class="specimen__evidence">
						<div class="specimen__evidence-row">
							<span class="specimen__evidence-label">Identity</span>
							<span class="specimen__evidence-detail">
								<strong>612</strong> gov ID
								<span class="specimen__sep">&middot;</span>
								<strong>262</strong> address-matched
							</span>
						</div>
						<div class="specimen__evidence-row">
							<span class="specimen__evidence-label">Authorship</span>
							<span class="specimen__evidence-detail">
								<strong>701</strong> individually composed
								<span class="specimen__sep">&middot;</span>
								<strong>173</strong> shared statements
							</span>
						</div>
						<div class="specimen__evidence-row">
							<span class="specimen__evidence-label">Census tracts</span>
							<span class="specimen__evidence-detail">
								<strong>28</strong> tracts represented
							</span>
						</div>
						<div class="specimen__evidence-row">
							<span class="specimen__evidence-label">Neighborhoods</span>
							<span class="specimen__evidence-detail">
								<strong>11</strong> neighborhood associations
							</span>
						</div>
						<div class="specimen__evidence-row">
							<span class="specimen__evidence-label">Agenda-linked</span>
							<span class="specimen__evidence-detail">
								Item 7 &middot; FY27 Rate Adjustment (first reading)
							</span>
						</div>
						<div class="specimen__evidence-row">
							<span class="specimen__evidence-label">Screening</span>
							<span class="specimen__evidence-detail">
								One submission per resident &middot; duplicates removed
							</span>
						</div>
					</div>

					<div class="specimen__seal">
						<span class="specimen__seal-text">Cryptographic audit trail &middot; independently verifiable</span>
					</div>
				</figure>
			</div>
		</div>

		<!-- ═══ CATEGORY DISPLACEMENT ═══ -->
		<p class="displacement">
			A 47-comment PDF distributed Friday and skimmed Monday is processed by item number. A verification packet with named authors and census-tract provenance enters the public record as testimony.
		</p>

		<p class="displacement__citation">
			CMF 2017: 91% of Congressional staff weight district-specific impact information &mdash; the same geographic specificity that drives credibility in local intake &middot; Walker &amp; Le, <cite>Socius</cite> 2023 (astroturf harm)
		</p>

		<!-- ═══ CATEGORY NAMING ═══ -->
		<p class="category">
			Granicus and Legistar publish the agenda and collect emails. Commons produces the <em>packet page</em> &mdash; attributed to verified residents, linked to the item, signed by a Merkle root. The packet is where the vote happens. Commons sits there.
		</p>

		<!-- ═══ OUTCOME ═══ -->
		<p class="outcome">
			Your verified residents appear in the public comment packet by name, by tract, by neighborhood association. Form-letter exhibits stay in the appendix.
		</p>

		<!-- ═══ ANCHOR BOUNDARY LIST ═══ -->
		<section class="anchors" aria-labelledby="anchors-heading">
			<h2 id="anchors-heading" class="sr-only">Local government boundaries we cover</h2>

			<ul class="anchors__list" role="list">
				<li class="anchors__item">Santa Clara Valley Water</li>
				<li class="anchors__item">Snowmass Water &amp; Sanitation</li>
				<li class="anchors__item">Colorado State Board of Education</li>
				<li class="anchors__item">Oakland Unified School Board</li>
				<li class="anchors__item">Cook County Board of Commissioners</li>
				<li class="anchors__item">Austin City Council District 5</li>
				<li class="anchors__item">Portland Planning Commission</li>
				<li class="anchors__item">SFMTA Board of Directors</li>
				<li class="anchors__item">Denver Police Oversight Commission</li>
				<li class="anchors__item">San Diego County Supervisors</li>
				<li class="anchors__item">Seattle Community Police Commission</li>
				<li class="anchors__item">Boston Zoning Board of Appeals</li>
			</ul>

			<p class="anchors__footer">
				<span class="anchors__stat">24</span> boundary types &middot; <span class="anchors__stat">90,887</span> local government entities. Commons supports clerk-assembled packets across most district types.
			</p>

			<p class="anchors__reach">
				Water districts, school boards, city councils, county boards, fire districts, transit authorities, hospital districts, library districts, park districts, conservation districts, utility districts &mdash; clerk-assembled packets across most district types, one intake model.
			</p>

			<p class="anchors__citation">
				U.S. Census Bureau <cite>Census of Governments</cite> 2022 &middot; Granicus + Legistar agenda coverage
			</p>
		</section>

		<!-- ═══ INCUMBENT WINDOW ═══ -->
		<div class="window">
			<h2 class="window__pull-quote">
				A small district clerk's filing experience is four hundred Action Network blasts against <code>board@district.gov</code>, with no triage tool.
			</h2>

			<p class="window__body">
				The shared-mailbox problem is the intake. There is no staff layer to sort it. Identical subject lines arrive from generic campaign domains; the clerk rule-files them into a folder the board members never open. When a verified packet arrives &mdash; one page, named authors, census-tract provenance &mdash; it enters the packet <em>itself</em>, not the Exhibit A appendix. The same district-specific geographic specificity CMF 2017 found decisive for Congressional staff applies here: local clerks assemble what they can verify.
			</p>

			<p class="window__citation">
				CMF 2017 &middot; Walker &amp; Le, <cite>Socius</cite> 2023 &middot; special-district intake pattern documented across water, school, transit, and fire district clerk procedures
			</p>
		</div>

		<!-- ═══ PRICE + FRICTION ═══ -->
		<div class="pricing">
			<p class="pricing__moment">
				A small district runs on a part-time clerk and an agenda portal from 2014. The org tools built for them were built for a seat count they don't have. Commons is priced for a board that meets once a month.
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
				One verified action = one resident, identity-proven, district-matched, agenda-linked, authored for you. Metered at submission, not at send.
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
				No demo required. No procurement review. Import your list from Action Network, EveryAction, NationBuilder, or any CSV export &mdash; a packet page produced before Friday's distribution deadline, not a year from now.
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
	   SEG PAGE — Document Layout
	   Matches /org + /org/for/state-legislature
	   ═══════════════════════════════════════════ */
	.seg-page {
		min-height: 100vh;
		padding: 1.5rem 1.5rem 4rem;
		background: oklch(0.995 0.004 55);
	}

	@media (min-width: 640px) {
		.seg-page {
			padding: 2rem 2rem 5rem;
		}
	}

	@media (min-width: 1024px) {
		.seg-page {
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

	.seg-page__inner {
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

	.hero__sub code {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.9em;
		background: oklch(0.97 0.005 250);
		padding: 0 0.2rem;
		color: oklch(0.3 0.02 250);
		border-radius: 2px;
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

	/* ═══ GAP ARTIFACT — the PDF packet page ═══ */
	.pdf-artifact {
		max-width: 24rem;
		margin: 0;
		background: #ffffff;
		border: 1px solid oklch(0.86 0.006 250);
		border-radius: 2px;
		box-shadow:
			0 1px 2px oklch(0.15 0.01 250 / 0.06),
			0 10px 28px oklch(0.15 0.01 250 / 0.08);
		font-family: 'Times New Roman', Times, 'Liberation Serif', serif;
		font-size: 0.75rem;
		line-height: 1.55;
		color: oklch(0.22 0.01 250);
		overflow: hidden;
	}

	.pdf-artifact__chrome {
		padding: 0.375rem 0.75rem;
		background: oklch(0.94 0.004 250);
		border-bottom: 1px solid oklch(0.88 0.006 250);
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		color: oklch(0.5 0.01 250);
		letter-spacing: 0.02em;
	}

	.pdf-artifact__page {
		padding: 1.125rem 1.125rem 1rem;
	}

	.pdf-artifact__header {
		padding-bottom: 0.625rem;
		border-bottom: 1px solid oklch(0.78 0.008 250);
		margin-bottom: 0.875rem;
	}

	.pdf-artifact__title {
		font-family: 'Times New Roman', Times, serif;
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: oklch(0.18 0.01 250);
		text-transform: uppercase;
	}

	.pdf-artifact__subtitle {
		font-family: 'Times New Roman', Times, serif;
		font-size: 0.75rem;
		font-style: italic;
		color: oklch(0.28 0.01 250);
		margin-top: 0.1875rem;
	}

	.pdf-artifact__toc-label {
		font-family: 'Times New Roman', Times, serif;
		font-size: 0.6875rem;
		font-weight: 600;
		color: oklch(0.22 0.01 250);
		margin-bottom: 0.375rem;
		letter-spacing: 0.01em;
	}

	.pdf-toc {
		list-style: none;
		margin: 0 0 0.75rem;
		padding: 0;
	}

	.pdf-toc__row {
		display: grid;
		grid-template-columns: 2rem 1fr auto;
		gap: 0.5rem;
		padding: 0.1875rem 0;
		font-size: 0.6875rem;
		line-height: 1.4;
		border-bottom: 1px dotted oklch(0.85 0.006 250);
		align-items: baseline;
	}

	.pdf-toc__row:last-child {
		border-bottom: none;
	}

	.pdf-toc__no {
		font-family: 'JetBrains Mono', monospace;
		font-variant-numeric: tabular-nums;
		color: oklch(0.4 0.01 250);
	}

	.pdf-toc__body {
		color: oklch(0.3 0.01 250);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pdf-toc__page {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		color: oklch(0.5 0.01 250);
		font-variant-numeric: tabular-nums;
	}

	.pdf-toc__row--dim { opacity: 0.72; }
	.pdf-toc__row--dimmer { opacity: 0.5; }
	.pdf-toc__row--dimmest { opacity: 0.3; }

	.pdf-artifact__footnote {
		padding-top: 0.625rem;
		margin-top: 0.25rem;
		border-top: 1px solid oklch(0.86 0.006 250);
		font-size: 0.625rem;
		line-height: 1.55;
		color: oklch(0.4 0.01 250);
		font-style: italic;
	}

	.pdf-artifact__footnote strong {
		font-weight: 700;
		color: oklch(0.22 0.01 250);
		font-style: normal;
	}

	.pdf-artifact__footnote-mark {
		font-weight: 700;
		margin-right: 0.125rem;
	}

	.pdf-artifact__distribution {
		margin-top: 0.625rem;
		padding-top: 0.5rem;
		border-top: 1px dashed oklch(0.86 0.006 250);
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.5625rem;
		color: oklch(0.55 0.01 250);
		letter-spacing: 0.02em;
		text-align: right;
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
		padding: 1rem 1.25rem 0.5rem;
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}

	@media (min-width: 640px) {
		.specimen__hero { padding: 1.5rem 2rem 0.5rem; }
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

	.specimen__subcount {
		padding: 0 1.25rem 1.25rem;
		display: flex;
		align-items: baseline;
		gap: 0.625rem;
		font-size: 0.6875rem;
		color: oklch(0.45 0.01 250);
		line-height: 1.4;
	}

	@media (min-width: 640px) {
		.specimen__subcount { padding: 0 2rem 1.5rem; }
	}

	.specimen__subcount-num {
		font-weight: 700;
		color: oklch(0.3 0.02 250);
		font-variant-numeric: tabular-nums;
		font-size: 0.8125rem;
	}

	.specimen__subcount-label {
		max-width: 18rem;
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
		min-width: 6.25rem;
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

	/* ═══ DISPLACEMENT + CATEGORY + OUTCOME ═══ */
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
		letter-spacing: 0.02em;
		margin: 0 0 2rem;
		max-width: 42rem;
	}

	.category {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.9375rem;
		line-height: 1.6;
		font-weight: 400;
		color: oklch(0.35 0.015 250);
		margin: 0 0 2.25rem;
		max-width: 42rem;
	}

	.category em {
		font-style: italic;
		color: oklch(0.22 0.02 250);
		font-weight: 500;
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
		line-height: 1.6;
		color: oklch(0.48 0.012 250);
		max-width: 44rem;
	}

	.anchors__citation {
		margin: 0.625rem 0 0;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		line-height: 1.55;
		color: oklch(0.55 0.01 250);
		letter-spacing: 0.02em;
		max-width: 44rem;
	}

	.anchors__citation cite { font-style: italic; }

	/* ═══════════════════════════════════════════
	   INCUMBENT WINDOW
	   ═══════════════════════════════════════════ */
	.window {
		margin-bottom: 5.5rem;
		max-width: 40rem;
	}

	.window__pull-quote {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: clamp(1.25rem, 1rem + 1.4vw, 1.625rem);
		line-height: 1.3;
		font-weight: 600;
		color: oklch(0.2 0.03 250);
		margin: 0 0 1.25rem;
		padding-left: 1.125rem;
		border-left: 2px solid oklch(0.55 0.12 165);
		letter-spacing: -0.01em;
		max-width: 36rem;
	}

	.window__pull-quote code {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.92em;
		font-weight: 500;
		background: oklch(0.97 0.005 250);
		padding: 0 0.25rem;
		border-radius: 2px;
		color: oklch(0.3 0.02 250);
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

	.window__body em {
		font-style: italic;
		color: oklch(0.22 0.02 250);
	}

	.window__stat {
		font-family: 'JetBrains Mono', monospace;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		color: oklch(0.22 0.03 250);
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
		line-height: 1.6;
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

	.pricing-num {
		font-family: 'JetBrains Mono', monospace;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		color: oklch(0.28 0.02 250);
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
