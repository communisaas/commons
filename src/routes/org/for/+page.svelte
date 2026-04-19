<script lang="ts">
	// Menu surface. No state; pure routing. Segment destinations handle CTAs.
</script>

<svelte:head>
	<title>Segments | Commons for Orgs</title>
	<meta
		name="description"
		content="Commons produces the same verification packet across three decision-maker tiers. Pick the surface that matches the staffer who reads your mail."
	/>
</svelte:head>

<div class="menu-page">
	<a href="/org" class="back-link">&larr; commons for orgs</a>

	<div class="menu-page__inner">
		<!-- Orienting statement -->
		<p class="orient">
			Commons produces verified constituent packets for three decision-maker tiers. Pick the surface that matches the staffer who reads your mail.
		</p>

		<!-- Three segment blocks -->
		<nav class="segments" aria-label="Segments">
			<a href="/org/for/state-legislature" class="segment">
				<span class="segment__ord">01</span>
				<div class="segment__body">
					<h2 class="segment__title">State legislature</h2>
					<p class="segment__desc">
						For orgs fighting 50-state bill drops: reproductive rights, gun safety, LGBTQ, criminal justice, environmental state chapters.
					</p>
				</div>
				<span class="segment__cue" aria-hidden="true">open &rarr;</span>
			</a>

			<a href="/org/for/agency-rulemaking" class="segment">
				<span class="segment__ord">02</span>
				<div class="segment__body">
					<h2 class="segment__title">Federal agency rulemaking</h2>
					<p class="segment__desc">
						For orgs working regulations.gov: EPA, FDA, HUD, DOE, DOL, and state PUC equivalents.
					</p>
				</div>
				<span class="segment__cue" aria-hidden="true">open &rarr;</span>
			</a>

			<a href="/org/for/local-government" class="segment">
				<span class="segment__ord">03</span>
				<div class="segment__body">
					<h2 class="segment__title">Local government</h2>
					<p class="segment__desc">
						For orgs fighting city councils, county boards, special districts, school boards.
					</p>
				</div>
				<span class="segment__cue" aria-hidden="true">open &rarr;</span>
			</a>
		</nav>

		<!-- Footer note -->
		<p class="footnote">
			All three surfaces produce the same verification packet. Content differs to match your decision-maker.
		</p>
	</div>
</div>

<style>
	/* ═══════════════════════════════════════════
	   /org/for — segment routing menu
	   Typographic blocks only. Hairline rules.
	   No cards, no shadows, no pill badges.
	   ═══════════════════════════════════════════ */

	.menu-page {
		min-height: 100vh;
		padding: 1.5rem 1.5rem 4rem;
		background: oklch(0.995 0.004 55);
	}

	@media (min-width: 640px) {
		.menu-page { padding: 2rem 2rem 5rem; }
	}

	@media (min-width: 1024px) {
		.menu-page {
			padding: 2.5rem 3rem 6rem;
			padding-left: max(3rem, 12vw);
		}
	}

	/* ═══ BACK LINK — matches /org and state-legislature chrome ═══ */
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

	.back-link:hover { color: oklch(0.35 0.06 180); }

	@media (min-width: 640px) {
		.back-link { margin-bottom: 4rem; }
	}

	.menu-page__inner {
		width: 100%;
		max-width: 54rem;
	}

	/* ═══ ORIENTING STATEMENT ═══ */
	.orient {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: clamp(1.0625rem, 0.98rem + 0.5vw, 1.1875rem);
		line-height: 1.5;
		font-weight: 500;
		color: oklch(0.32 0.02 250);
		margin: 0 0 2.75rem;
		max-width: 36rem;
	}

	@media (min-width: 768px) {
		.orient { margin-bottom: 3.5rem; }
	}

	/* ═══ SEGMENT BLOCKS ═══ */
	.segments {
		display: flex;
		flex-direction: column;
		/* First block's top rule + last block's bottom rule share with siblings.
		   Border-top on each, border-bottom on the last yields continuous hairlines. */
	}

	.segment {
		display: grid;
		grid-template-columns: 2.25rem 1fr;
		grid-template-areas:
			'ord body'
			'ord cue';
		column-gap: 1rem;
		row-gap: 0.625rem;
		align-items: start;
		padding: 1.5rem 0;
		border-top: 1px solid oklch(0.86 0.008 250);
		text-decoration: none;
		color: inherit;
		transition: background 150ms ease-out;
	}

	.segment:last-child {
		border-bottom: 1px solid oklch(0.86 0.008 250);
	}

	@media (min-width: 640px) {
		.segment {
			grid-template-columns: 3rem 1fr auto;
			grid-template-areas: 'ord body cue';
			column-gap: 1.5rem;
			row-gap: 0;
			align-items: baseline;
			padding: 1.75rem 0.25rem 1.75rem 0.25rem;
		}
	}

	@media (min-width: 1024px) {
		.segment {
			grid-template-columns: 3.5rem 1fr auto;
			column-gap: 2rem;
			padding: 2rem 0.5rem;
		}
	}

	.segment:hover {
		background: oklch(0.985 0.006 180 / 0.6);
	}

	/* Subtle latent-to-active affordance on the cue (per design-system.md §Action Affordances) */
	.segment:hover .segment__cue {
		color: oklch(0.38 0.11 180);
	}

	.segment:hover .segment__title {
		color: oklch(0.14 0.03 250);
	}

	.segment:focus-visible {
		outline: 2px solid oklch(0.45 0.1 180);
		outline-offset: -2px;
	}

	/* Ordinal — mono, teal, small. Sits in the left gutter. */
	.segment__ord {
		grid-area: ord;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8125rem;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
		color: oklch(0.5 0.1 180);
		letter-spacing: 0.02em;
		/* Baseline-shift so the ordinal sits with the title's x-height on desktop */
		padding-top: 0.25rem;
	}

	@media (min-width: 640px) {
		.segment__ord {
			font-size: 0.875rem;
			padding-top: 0;
		}
	}

	.segment__body {
		grid-area: body;
		min-width: 0;
	}

	.segment__title {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: clamp(1.5rem, 1.2rem + 1.2vw, 2rem);
		line-height: 1.15;
		font-weight: 700;
		color: oklch(0.2 0.03 250);
		letter-spacing: -0.015em;
		margin: 0 0 0.5rem;
		transition: color 150ms ease-out;
	}

	@media (min-width: 640px) {
		.segment__title { margin-bottom: 0.625rem; }
	}

	.segment__desc {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 1rem;
		line-height: 1.55;
		font-weight: 400;
		color: oklch(0.42 0.015 250);
		margin: 0;
		max-width: 36rem;
	}

	/* "open →" cue — mono, bottom-right on desktop, below the body on mobile */
	.segment__cue {
		grid-area: cue;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8125rem;
		font-weight: 400;
		color: oklch(0.55 0.015 250);
		letter-spacing: 0.02em;
		white-space: nowrap;
		transition: color 150ms ease-out;
	}

	@media (min-width: 640px) {
		.segment__cue {
			align-self: end;
			padding-bottom: 0.25rem;
		}
	}

	/* ═══ FOOTER NOTE — mono, small, muted ═══ */
	.footnote {
		margin: 2.75rem 0 0;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		line-height: 1.6;
		color: oklch(0.55 0.01 250);
		letter-spacing: 0.01em;
		max-width: 42rem;
	}

	@media (min-width: 768px) {
		.footnote { margin-top: 3.25rem; }
	}
</style>
