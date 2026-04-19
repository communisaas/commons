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
	<title>Agency rulemaking | Commons for Orgs</title>
	<meta
		name="description"
		content="Mass comment campaigns get one sample posted and a thematic paragraph in the preamble. Commons delivers comments the docket officer reads individually — identity-verified, proximate-impact, rule-section specific."
	/>
</svelte:head>

<div class="reg-page">
	<a href="/org/for" class="back-link">&larr; all segments</a>

	<div class="reg-page__inner">
		<!-- Segment marker -->
		<p class="seg-marker">
			<span class="seg-marker__ord">02</span>
			<span class="seg-marker__label">Agency rulemaking</span>
		</p>

		<!-- ═══ HERO — research-grounded, rulemaking-specific ═══ -->
		<h1 class="hero">
			Your <span class="hero__count">40,000</span>-comment campaign got one sentence in the preamble. The technical brief is in a different bucket.
		</h1>

		<p class="hero__sub">
			<span class="hero__stat">54%</span> of comments on federal rules did not match any dimension of the final rule change. Agencies weight <em>sophisticated, individually-authored</em> comments disproportionately &mdash; and bucket identical-language submissions as one.
		</p>

		<p class="hero__citation">
			GW Regulatory Studies Center, <cite>Are Agencies Responsive to Mass Comment Campaigns?</cite> &middot; ACUS, <cite>Managing Mass, Computer-Generated, and Falsely Attributed Comments</cite> &middot; regulations.gov v4
		</p>

		<!-- ═══ THE COMPARISON ═══ -->
		<div class="comparison">
			<!-- GAP ARTIFACT — the docket folder view -->
			<div class="comparison__before">
				<p class="comparison__label">What appears on the public docket</p>

				<figure class="gap-artifact" aria-label="Regulations.gov docket folder view showing mass comment bucket collapsed">
					<div class="gap-artifact__chrome">
						<span class="gap-artifact__dot"></span>
						<span class="gap-artifact__dot"></span>
						<span class="gap-artifact__dot"></span>
						<span class="gap-artifact__path">regulations.gov &middot; EPA-HQ-OAR-2025-0147</span>
					</div>

					<div class="gap-artifact__toolbar">
						<span class="gap-artifact__tool-label">Public Submissions</span>
						<span class="gap-artifact__tool-count">
							<span class="gap-artifact__tool-num">40,214</span> received
						</span>
					</div>

					<ul class="docket-list" role="list">
						<li class="docket-row docket-row--bucket">
							<span class="docket-row__icon" aria-hidden="true">&#9662;</span>
							<div class="docket-row__body">
								<span class="docket-row__title">Mass Comment Campaign &mdash; Group 1</span>
								<span class="docket-row__meta">
									<span class="docket-row__badge">SAMPLED</span>
									<span class="docket-row__count">+40,128 more &middot; one representative posted</span>
								</span>
							</div>
						</li>
						<li class="docket-row">
							<span class="docket-row__icon" aria-hidden="true">&#8226;</span>
							<div class="docket-row__body">
								<span class="docket-row__title">Comment by Environmental Defense Fund</span>
								<span class="docket-row__meta-plain">312-page technical &middot; posted individually</span>
							</div>
						</li>
						<li class="docket-row">
							<span class="docket-row__icon" aria-hidden="true">&#8226;</span>
							<div class="docket-row__body">
								<span class="docket-row__title">Comment by American Petroleum Institute</span>
								<span class="docket-row__meta-plain">184-page technical &middot; posted individually</span>
							</div>
						</li>
						<li class="docket-row">
							<span class="docket-row__icon" aria-hidden="true">&#8226;</span>
							<div class="docket-row__body">
								<span class="docket-row__title">Comment by State AG Coalition (17 states)</span>
								<span class="docket-row__meta-plain">joint filing &middot; posted individually</span>
							</div>
						</li>
						<li class="docket-row docket-row--faint">
							<span class="docket-row__icon" aria-hidden="true">&#8226;</span>
							<div class="docket-row__body">
								<span class="docket-row__title">Comment by J. Rivera (independent)</span>
								<span class="docket-row__meta-plain">8-page individually-authored &middot; posted individually</span>
							</div>
						</li>
					</ul>

					<div class="gap-artifact__footer">
						Mass-comment bucket collapses to one row. Individually-authored comments each get their own.
					</div>
				</figure>

				<p class="comparison__absence">
					The docket officer's triage rule is the bucket. Your 40,000 signers are a count. The analytic lane is the individual-comment lane, and your submission never reaches it.
				</p>
			</div>

			<!-- SPECIMEN — agency-docket specific -->
			<div class="comparison__after">
				<p class="comparison__label">What the docket officer receives from Commons</p>
				<p class="comparison__provenance">
					Example packet &middot; EPA-HQ-OAR-2025-0147 &middot; Mar 2026
				</p>

				<figure class="specimen">
					<div class="specimen__title">EPA-HQ-OAR-2025-0147 &middot; Methane Rule Packet</div>

					<div class="specimen__meta">
						<div class="specimen__row">
							<span class="specimen__label">Docket</span>
							<span class="specimen__value">EPA-HQ-OAR-2025-0147</span>
						</div>
						<div class="specimen__row">
							<span class="specimen__label">Rulemaking</span>
							<span class="specimen__value">Oil &amp; gas methane emissions &middot; subpart OOOOb</span>
						</div>
						<div class="specimen__row">
							<span class="specimen__label">Agency</span>
							<span class="specimen__value">EPA, Office of Air and Radiation</span>
						</div>
						<div class="specimen__row">
							<span class="specimen__label">Comment period</span>
							<span class="specimen__value">Jan 15 &ndash; Mar 30, 2026</span>
						</div>
					</div>

					<div class="specimen__divider"></div>

					<div class="specimen__hero">
						<span class="specimen__count">3,428</span>
						<span class="specimen__count-label">verified commenters<br/>individually authored</span>
					</div>

					<div class="specimen__divider"></div>

					<div class="specimen__evidence">
						<div class="specimen__evidence-row">
							<span class="specimen__evidence-label">Identity</span>
							<span class="specimen__evidence-detail">
								<strong>2,891</strong> gov ID
								<span class="specimen__sep">&middot;</span>
								<strong>537</strong> address-matched
							</span>
						</div>
						<div class="specimen__evidence-row">
							<span class="specimen__evidence-label">Authorship</span>
							<span class="specimen__evidence-detail">
								<strong>2,612</strong> individually composed
								<span class="specimen__sep">&middot;</span>
								<strong>816</strong> shared templates (disclosed)
							</span>
						</div>
						<div class="specimen__evidence-row">
							<span class="specimen__evidence-label">Proximate impact</span>
							<span class="specimen__evidence-detail">
								<strong>2,104</strong> in affected counties
								<span class="specimen__sep">&middot;</span>
								<strong>89</strong> counties
							</span>
						</div>
						<div class="specimen__evidence-row">
							<span class="specimen__evidence-label">Rule citations</span>
							<span class="specimen__evidence-detail">
								<strong>1,844</strong> reference specific rule sections
							</span>
						</div>
						<div class="specimen__evidence-row">
							<span class="specimen__evidence-label">Geography</span>
							<span class="specimen__evidence-detail">
								<strong>47</strong> states
								<span class="specimen__sep">&middot;</span>
								<strong>312</strong> counties
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

		<!-- ═══ FILTER MAP — specimen field → docket officer question → citation ═══ -->
		<section class="filter-section" aria-labelledby="filter-heading">
			<h2 id="filter-heading" class="sr-only">How each field answers the docket officer's triage question</h2>

			<dl class="filter-map" aria-label="How each specimen field maps to the triage question the docket officer answers">
				<div class="filter-map__row">
					<dt class="filter-map__field">Identity</dt>
					<dd class="filter-map__answer">answers the triage question:</dd>
					<dd class="filter-map__question">&ldquo;Is this an identified person or an auto-generated submission?&rdquo;</dd>
					<dd class="filter-map__citation">ACUS, <cite>Managing Mass, Computer-Generated, and Falsely Attributed Comments</cite> (2021) &middot; identity closes the triage question: is this a real, identified person or an auto-generated submission?</dd>
				</div>
				<div class="filter-map__row">
					<dt class="filter-map__field">Authorship</dt>
					<dd class="filter-map__answer">answers:</dd>
					<dd class="filter-map__question">&ldquo;Is the body identical to 40,000 others, or individually composed?&rdquo;</dd>
					<dd class="filter-map__citation">regulations.gov v4 &middot; identical-language submissions collapse to a single &ldquo;mass comment campaign&rdquo; row with a sampled representative</dd>
				</div>
				<div class="filter-map__row">
					<dt class="filter-map__field">Proximate impact</dt>
					<dd class="filter-map__answer">answers:</dd>
					<dd class="filter-map__question">&ldquo;Does this person live near the regulated activity?&rdquo;</dd>
					<dd class="filter-map__citation">EPA public comments guidance, <cite>epa.gov/dockets</cite> &middot; proximate-impact evidence differentiates a submission from the mass-comment bucket; agencies treat identical-language submissions as signals of political opinion, not technical input</dd>
				</div>
				<div class="filter-map__row">
					<dt class="filter-map__field">Rule citations</dt>
					<dd class="filter-map__answer">answers:</dd>
					<dd class="filter-map__question">&ldquo;Does this comment engage the actual rule text?&rdquo;</dd>
					<dd class="filter-map__citation">GW Regulatory Studies Center &middot; technical-economic comments weighted disproportionately; generic support rarely moves a final rule</dd>
				</div>
				<div class="filter-map__row">
					<dt class="filter-map__field">Screening</dt>
					<dd class="filter-map__answer">answers:</dd>
					<dd class="filter-map__question">&ldquo;Is this astroturf or falsely-attributed?&rdquo;</dd>
					<dd class="filter-map__citation">Walker &amp; Le, <cite>Socius</cite> 2023 &middot; unverified submissions erode trust in legitimate advocacy orgs</dd>
				</div>
			</dl>
		</section>

		<!-- ═══ CATEGORY DISPLACEMENT ═══ -->
		<p class="displacement">
			Your existing comment tool sprays identical body language through a regulations.gov relay and lands in the mass-comment bucket. Commons delivers comments the docket officer reads individually &mdash; each verified, each proximate to the regulated activity, each citing the rule provision it addresses.
		</p>

		<p class="displacement__citation">
			GW Regulatory Studies Center: 54% of comments did not match on any dimension of final rule change &middot; regulations.gov v4 &middot; ACUS 2021 recommendations on mass-comment triage
		</p>

		<!-- ═══ OUTCOME ═══ -->
		<p class="outcome">
			Individually-authored, identity-verified comments enter the rulemaking record as individual comments. Mass-comment campaigns enter the bucket.
		</p>

		<!-- ═══ ANCHOR BOUNDARY LIST ═══ -->
		<section class="anchors" aria-labelledby="anchors-heading">
			<h2 id="anchors-heading" class="sr-only">Federal and state rulemaking dockets we cover</h2>

			<ul class="anchors__list" role="list">
				<li class="anchors__item">EPA-HQ-OAR (Air)</li>
				<li class="anchors__item">EPA-HQ-OW (Water)</li>
				<li class="anchors__item">FDA food labeling</li>
				<li class="anchors__item">HUD fair housing</li>
				<li class="anchors__item">DOE efficiency standards</li>
				<li class="anchors__item">DOL wage &amp; hour</li>
				<li class="anchors__item">OSHA standards</li>
				<li class="anchors__item">CFPB rulemakings</li>
				<li class="anchors__item">California PUC</li>
				<li class="anchors__item">Oregon PUC (UM)</li>
				<li class="anchors__item">Hawaii PUC</li>
				<li class="anchors__item">Pennsylvania PUC</li>
			</ul>

			<p class="anchors__footer">
				<span class="anchors__stat">~300</span> federal agencies and sub-agencies on regulations.gov. <span class="anchors__stat">4M+</span> comments on high-profile dockets. Commons submits through the regulations.gov v4 API across federal rulemaking dockets; state PUCs onboarded selectively.
			</p>

			<p class="anchors__reach">
				Plus state PUC / BOE / state-EPA dockets in OR, HI, CO, CA, PA &mdash; expanding. EPA's 2025 endangerment-finding reconsideration received <span class="anchors__stat">534,000</span> comments across <span class="anchors__stat">169</span> mass-comment campaigns; acknowledged but not individually addressed in the preamble.
			</p>

			<p class="anchors__citation">
				regulations.gov v4 &middot; U.S. Federal Register &middot; Environmental Data &amp; Governance Initiative (EDGI) docket workflow analysis
			</p>
		</section>

		<!-- ═══ INCUMBENT WINDOW ═══ -->
		<section class="window" aria-labelledby="window-heading">
			<h2 id="window-heading" class="window__pull-quote">
				Mass comment campaigns don't move rules. Named commenters with substantive content do.
			</h2>

			<p class="window__body">
				The platform-generated bulk comment &mdash; Quorum Grassroots, EngagingNetworks regulations.gov extensions, Phone2Action pipelines &mdash; produces volume that the docket officer collapses on ingestion. The workflow already exists to weigh individually-authored, technically-specific comments; the gap is producing enough of them to matter. That is the work Commons does.
			</p>

			<p class="window__citation">
				GW Regulatory Studies Center (Lens 2) &middot; ACUS 2021 &middot; Walker &amp; Le, <cite>Socius</cite> 2023 &middot; regulations.gov v4 API documentation
			</p>
		</section>

		<!-- ═══ PRICE + FRICTION ═══ -->
		<div class="pricing">
			<p class="pricing__moment">
				The incumbent advocacy stack has changed hands four times this cycle. Docket officers have triaged the same form comment 50,000 times. Orgs are shopping.
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
				One verified action = one commenter, identity-proven, proximate-impact mapped, authored for you. Metered at submission, not at send.
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
				No demo required. No procurement review. Import your list from Action Network, EveryAction, NationBuilder, or any CSV export &mdash; a packet produced before the comment period closes, not a year from now.
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
	   REG PAGE — Document Layout
	   Warm cream ground. Artifacts (docket view +
	   specimen) are the only white-bounded surfaces.
	   ═══════════════════════════════════════════ */
	.reg-page {
		min-height: 100vh;
		padding: 1.5rem 1.5rem 4rem;
		background: oklch(0.995 0.004 55);
	}

	@media (min-width: 640px) {
		.reg-page { padding: 2rem 2rem 5rem; }
	}

	@media (min-width: 1024px) {
		.reg-page {
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

	.back-link:hover { color: oklch(0.35 0.06 180); }

	@media (min-width: 640px) {
		.back-link { margin-bottom: 2.5rem; }
	}

	.reg-page__inner {
		width: 100%;
		max-width: 54rem;
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

	.hero__stat {
		font-family: 'JetBrains Mono', monospace;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
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

	.hero__citation cite { font-style: italic; }

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
		.comparison { gap: 3rem; }
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
		.comparison__before { width: 26rem; }
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

	/* ═══ GAP ARTIFACT — regulations.gov docket folder view ═══ */
	.gap-artifact {
		margin: 0;
		max-width: 26rem;
		background: #ffffff;
		border: 1px solid oklch(0.88 0.006 250);
		box-shadow:
			0 1px 2px oklch(0.15 0.01 250 / 0.04),
			0 4px 14px oklch(0.15 0.01 250 / 0.06);
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
		font-size: 0.75rem;
		color: oklch(0.3 0.01 250);
		overflow: hidden;
	}

	.gap-artifact__chrome {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 0.4rem 0.625rem;
		background: oklch(0.96 0.003 250);
		border-bottom: 1px solid oklch(0.91 0.005 250);
	}

	.gap-artifact__dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: oklch(0.82 0.004 250);
	}

	.gap-artifact__path {
		margin-left: 0.5rem;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		color: oklch(0.55 0.01 250);
		letter-spacing: 0.02em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.gap-artifact__toolbar {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		padding: 0.5rem 0.875rem;
		border-bottom: 1px solid oklch(0.93 0.005 250);
		background: oklch(0.985 0.003 250);
	}

	.gap-artifact__tool-label {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.6875rem;
		color: oklch(0.4 0.015 250);
		font-weight: 600;
	}

	.gap-artifact__tool-count {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.6875rem;
		color: oklch(0.5 0.01 250);
	}

	.gap-artifact__tool-num {
		font-family: 'JetBrains Mono', monospace;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		color: oklch(0.22 0.03 250);
	}

	.docket-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.docket-row {
		display: flex;
		gap: 0.5rem;
		padding: 0.5rem 0.875rem;
		border-bottom: 1px solid oklch(0.945 0.004 250);
		align-items: flex-start;
	}

	.docket-row--bucket {
		background: oklch(0.975 0.008 55);
		border-bottom: 1px solid oklch(0.9 0.015 55);
	}

	.docket-row--faint {
		opacity: 0.55;
	}

	.docket-row__icon {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		line-height: 1.3;
		color: oklch(0.55 0.01 250);
		flex-shrink: 0;
		padding-top: 0.0625rem;
	}

	.docket-row--bucket .docket-row__icon {
		color: oklch(0.45 0.1 50);
	}

	.docket-row__body {
		display: flex;
		flex-direction: column;
		gap: 0.1875rem;
		min-width: 0;
		flex: 1;
	}

	.docket-row__title {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.6875rem;
		font-weight: 600;
		color: oklch(0.22 0.03 250);
		line-height: 1.35;
	}

	.docket-row--bucket .docket-row__title {
		color: oklch(0.25 0.06 50);
	}

	.docket-row__meta {
		display: flex;
		align-items: center;
		gap: 0.4375rem;
		flex-wrap: wrap;
	}

	.docket-row__badge {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.5625rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: oklch(0.45 0.12 50);
		padding: 0.0625rem 0.3125rem;
		border: 1px solid oklch(0.82 0.08 50);
		background: oklch(0.97 0.02 55);
		border-radius: 2px;
	}

	.docket-row__count {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		color: oklch(0.45 0.08 50);
		font-variant-numeric: tabular-nums;
	}

	.docket-row__meta-plain {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		color: oklch(0.52 0.008 250);
		letter-spacing: 0.01em;
	}

	.gap-artifact__footer {
		padding: 0.625rem 0.875rem 0.75rem;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.625rem;
		color: oklch(0.5 0.008 250);
		line-height: 1.5;
		font-style: italic;
		background: oklch(0.985 0.003 250);
		border-top: 1px solid oklch(0.93 0.005 250);
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

	.specimen__meta { padding: 1.125rem 1.25rem 0; }

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
		min-width: 7rem;
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
		min-width: 7rem;
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

	/* ═══ FILTER MAP — specimen field → docket-officer question → citation ═══ */
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
		line-height: 1.55;
		color: oklch(0.55 0.01 250);
		letter-spacing: 0.02em;
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
	   ANCHOR BOUNDARY LIST
	   ═══════════════════════════════════════════ */
	.anchors {
		max-width: 44rem;
		margin-bottom: 4rem;
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
		margin: 0.75rem 0 0.75rem;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		line-height: 1.55;
		color: oklch(0.48 0.012 250);
		max-width: 42rem;
	}

	.anchors__citation {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		line-height: 1.55;
		color: oklch(0.55 0.01 250);
		letter-spacing: 0.02em;
		margin: 0.5rem 0 0;
		max-width: 42rem;
	}

	/* ═══════════════════════════════════════════
	   INCUMBENT WINDOW
	   ═══════════════════════════════════════════ */
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
