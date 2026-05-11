<!--
  Public Record · Volume 1 · Issue 1.

  Reading-room register. The page is a faithful presentation of two markdown
  sources: this issue (which promulgates the constitution) and the
  constitution itself. Markdown is canonical; this is the rendered web form
  named in the hash manifest.

  Typography:
  - Body prose at 17/28 in Satoshi (var(--font-sans)).
  - Verifiable claims (hashes, dates, version numbers, file paths) in
    JetBrains Mono with tabular numerals.
  - Long-line measure capped near 720px.
  - No gradients, no card chrome, no marketing affordances.

  Heading hierarchy: page <h1> is the masthead. Markdown headings are
  shifted down one level by the loader so the document outline remains
  honest under a single page-level <h1>.

  Per CONSTITUTION.md §2.3: the cryptographic substrate is visible as
  registry marks — hashes, version anchors, the commit SHA pinning the
  source links — appear in the masthead's footer ledger and the page
  footer's source line as marks of the substrate, not as content about
  themselves.
-->
<script lang="ts">
	import type { PageData } from './$types';
	import { RegistryMark } from '$lib/design';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title
		>Public record · Volume 1 · Issue 1 — Promulgation of the Commons design constitution</title
	>
	<meta
		name="description"
		content="Volume 1, Issue 1 of the Commons public record. Promulgates CONSTITUTION.md@v1.0.0, the design constitution of the reference implementation, on 2026-05-06."
	/>
</svelte:head>

<main class="record-page" aria-label="Public record · Volume 1 · Issue 1">
	<!-- Skip-to-content target sits at top of <main> so it is the first
	     focus stop after page nav. The page is wrapped in <main> rather than
	     <article> so the document has the single page-level landmark axe-core
	     expects; the article semantics are not load-bearing here because the
	     rendered route IS the page. -->
	<a class="sr-only-focusable" href="#issue-body">Skip to issue body</a>

	<header class="masthead">
		<p class="masthead__kicker">Public record</p>
		<h1 class="masthead__title">
			Volume <span class="num">{data.meta.volume}</span> · Issue
			<span class="num">{data.meta.issue}</span>
		</h1>
		<p class="masthead__deck">
			Promulgation of <code class="ref"
				>CONSTITUTION.md<RegistryMark
					variant="version"
					value={data.meta.version.replace(/^v/, '')}
					copy={false}
					class="version"
				/></code
			>
		</p>

		<dl class="masthead__facts">
			<div class="fact">
				<dt>Date</dt>
				<dd class="num">{data.meta.date}</dd>
			</div>
			<div class="fact">
				<dt>Status</dt>
				<dd>{data.meta.status}</dd>
			</div>
			<div class="fact">
				<dt>Maintainer</dt>
				<dd>{data.meta.maintainer}</dd>
			</div>
			<div class="fact">
				<dt>Licence</dt>
				<dd>{data.meta.licence}</dd>
			</div>
		</dl>

		<!--
		  First-publication hash manifest, rendered as a marginal ledger
		  rather than as a chapter about itself. No <h2>, no lede, no
		  bordered card — hashes are substrate marks (per §2.3), not
		  content. Single hairline rule above and below; mono register
		  only; entries align as label / value rows.
		-->
		<dl class="manifest" aria-label="First-publication hash manifest">
			<div class="manifest-row">
				<dt class="manifest-label">
					<code class="ref"
						>CONSTITUTION.md<RegistryMark
							variant="version"
							value={data.meta.version.replace(/^v/, '')}
							copy={false}
							class="version"
						/></code
					>
				</dt>
				<dd class="manifest-value num">
					<RegistryMark variant="sha256" value={data.constitution.hash} />
				</dd>
			</div>
			<div class="manifest-row">
				<dt class="manifest-label">
					<code class="ref"
						>record/vol-1/issue-1.md<RegistryMark
							variant="version"
							value={data.meta.version.replace(/^v/, '')}
							copy={false}
							class="version"
						/></code
					>
				</dt>
				<dd class="manifest-value num">
					<RegistryMark variant="sha256" value={data.issue.hash} />
				</dd>
			</div>
		</dl>
	</header>

	<hr class="rule" />

	<!-- Issue 1 prose. The markdown's own H1, meta paragraph, and Hash
	     manifest section are stripped by the loader so the chrome above
	     remains the single masthead. The first preserved heading is
	     "§A Promulgation" (rendered as <h3> after the level-shift).

	     The screen-reader-only <h2> inside this section closes the
	     heading-hierarchy gap: the masthead emits <h1>, the body's first
	     heading is <h3>, so axe flags the missing intermediate level.
	     Visually the chrome already scopes the section; for assistive
	     readers we surface the section name as the explicit <h2>. -->
	<section id="issue-body" class="prose-host" aria-labelledby="issue-section-heading">
		<h2 id="issue-section-heading" class="sr-only">Issue 1 — promulgation</h2>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html data.issue.html}
	</section>

	<hr class="rule rule--strong" />

	<!-- Constitution: the promulgated artifact. The screen-reader <h2> is
	     paired with the visible artifact-label paragraph so the section
	     announces with a heading, not with a label-only association. -->
	<section class="prose-host" aria-labelledby="constitution-section-heading">
		<h2 id="constitution-section-heading" class="sr-only">
			Promulgated artifact — CONSTITUTION.md@{data.meta.version}
		</h2>
		<p id="constitution-marker" class="artifact-label" aria-hidden="true">
			Promulgated artifact
			<span class="sep" aria-hidden="true">·</span>
			<code class="ref"
				>CONSTITUTION.md<RegistryMark
					variant="version"
					value={data.meta.version.replace(/^v/, '')}
					copy={false}
					class="version"
				/></code
			>
		</p>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html data.constitution.html}
	</section>

	<hr class="rule" />

	<footer class="record-footer">
		<p class="record-footer__licence">
			This issue and the artifact it promulgates are licensed under the recipient's choice of
			<a href="https://creativecommons.org/licenses/by/4.0/" rel="license">CC-BY-4.0</a> or
			<a href="https://www.apache.org/licenses/LICENSE-2.0" rel="license">Apache-2.0</a>.
		</p>
		<p class="record-footer__sources">
			<span class="record-footer__sources-label">Source</span>
			<span class="sep" aria-hidden="true">·</span>
			<a class="mono-path" href={data.sources.constitution}>CONSTITUTION.md</a>
			<span class="sep" aria-hidden="true">·</span>
			<a class="mono-path" href={data.sources.issue}>record/vol-1/issue-1.md</a>
			<span class="sep" aria-hidden="true">·</span>
			<RegistryMark
				variant="commit"
				value={data.meta.commitSha}
				truncate
				class="record-footer__sha mono"
			/>
		</p>
		<p class="record-footer__plain">
			<span class="record-footer__plain-label">Also available</span>
			<span class="sep" aria-hidden="true">·</span>
			<a class="mono-path" href="/record/vol-1/issue-1.pdf" type="application/pdf"
				>issue-1.pdf</a
			>
			<span class="sep" aria-hidden="true">·</span>
			<a class="mono-path" href="/record/vol-1/issue-1.txt" type="text/plain"
				>issue-1.txt</a
			>
		</p>
		<p class="record-footer__sr sr-only">
			Where any conflict arises between this rendered web form and the canonical source markdown,
			the source markdown governs.
		</p>
	</footer>
</main>

<style>
	/*
	 * Reading-room register.
	 *
	 * Body prose: Satoshi at 17px / 28px line-height (~1.65 ratio — a small
	 * vertical-air bump from the prior 26px to give plain-English long
	 * paragraphs more breathing room without narrowing the measure).
	 * Verifiable claims: JetBrains Mono with tabular numerals.
	 * Long-line measure capped near 720px.
	 * Side margins are generous; chrome is absent.
	 */

	.record-page {
		max-width: 720px;
		margin: 0 auto;
		padding: 2.5rem 1.5rem 4rem;
		font-family: var(--font-sans, 'Satoshi', system-ui, sans-serif);
		font-size: 17px;
		line-height: 28px;
		color: #0f172a; /* slate-900 */
		background: transparent;
	}

	@media (min-width: 768px) {
		.record-page {
			padding: 4rem 2rem 6rem;
		}
	}

	/* Skip link — visually hidden until focused. */
	.sr-only-focusable {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
	.sr-only-focusable:focus {
		position: static;
		width: auto;
		height: auto;
		clip: auto;
		padding: 0.5rem 0.75rem;
		background: #0f172a;
		color: #ffffff;
		font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
		font-size: 13px;
		font-variant-numeric: tabular-nums;
		text-decoration: none;
	}

	/* Masthead. */
	.masthead {
		margin-bottom: 2.5rem;
	}

	.masthead__kicker {
		font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
		font-size: 12px;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #475569; /* slate-600 */
		margin: 0 0 1.25rem;
	}

	.masthead__title {
		font-family: var(--font-sans, 'Satoshi', system-ui, sans-serif);
		font-size: 32px;
		line-height: 38px;
		font-weight: 700;
		letter-spacing: -0.01em;
		color: #0f172a;
		margin: 0 0 0.75rem;
	}

	@media (min-width: 768px) {
		.masthead__title {
			font-size: 40px;
			line-height: 46px;
		}
	}

	.masthead__title .num {
		font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	.masthead__deck {
		font-family: var(--font-sans, 'Satoshi', system-ui, sans-serif);
		font-size: 17px;
		line-height: 28px;
		color: #334155; /* slate-700 */
		margin: 0 0 1.75rem;
	}

	.masthead__deck :global(.version .rm-prefix) {
		/* Version anchor stays single-tone (inherits .ref slate-700) here;
		   the default RegistryMark prefix opacity would two-tone the @v
		   glyphs against the 1.0.0 digits. */
		opacity: 1;
	}

	.masthead__facts {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.75rem 2rem;
		margin: 0 0 1.5rem;
		padding: 1rem 0;
		border-top: 1px solid #e2e8f0; /* slate-200 */
		border-bottom: 1px solid #e2e8f0;
	}

	@media (min-width: 640px) {
		.masthead__facts {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	.fact {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.fact dt {
		font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
		font-size: 11px;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #64748b; /* slate-500 */
	}

	.fact dd {
		margin: 0;
		font-size: 15px;
		line-height: 22px;
		color: #0f172a;
	}

	.fact dd.num {
		font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
		font-variant-numeric: tabular-nums;
	}

	/*
	 * Hash manifest, rendered as a flat ledger flush with the masthead.
	 * No card chrome, no heading, no lede — the hashes are registry marks
	 * that hold the artifact together, not a chapter about themselves.
	 * Single hairline rule below the masthead facts, mono register only.
	 */
	.manifest {
		margin: 0 0 2.5rem;
		padding: 0.75rem 0 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		border-bottom: 1px solid #e2e8f0;
	}

	.manifest-row {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
		margin: 0;
	}

	.manifest-label {
		margin: 0;
		min-width: 0;
	}

	.manifest-label .ref {
		font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
		font-size: 13px;
		line-height: 18px;
		font-variant-numeric: tabular-nums;
		color: #475569;
		background: transparent;
		padding: 0;
	}

	.manifest-label :global(.version) {
		/* slate-500 (#64748b) ≈ 5.0:1 against #ffffff — passes WCAG AA for
		   normal text. Previously slate-400 (#94a3b8) ≈ 2.56:1, flagged
		   serious by axe-core. The rule targets the RegistryMark span
		   carrying class="version"; its child .rm-prefix inherits color
		   and is restored to full opacity below so the version anchor
		   reads as a single tone, not the default RegistryMark prefix
		   subordination. The :global wrapper is required because the
		   span lives in a child component's DOM. */
		color: #64748b;
	}

	.manifest-label :global(.version .rm-prefix) {
		/* The version anchor is single-tone slate-500 in this surface; the
		   default RegistryMark prefix opacity would two-tone the @v glyphs. */
		opacity: 1;
	}

	.manifest-value {
		margin: 0;
		font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
		font-size: 13px;
		line-height: 20px;
		font-variant-numeric: tabular-nums;
		color: #0f172a;
		/* Hashes have no natural break points — `break-all` is appropriate.
		   Path strings get zero-width spaces injected during render so they
		   prefer to break at `/` and `.`; their wrap is governed there. */
		word-break: break-all;
		overflow-wrap: anywhere;
	}

	/* RegistryMark sha256 inside the manifest preserves the prior two-tone
	   register: prefix slate-500, value slate-900. We pin the prefix color
	   directly and lift opacity to 1 so the contrast matches the previous
	   <span class="prefix">/<span class="digits"> form. The mono register
	   and tabular-nums come from RegistryMark itself; word-break inherits
	   from .manifest-value above. */
	.manifest-value :global([data-mark-variant='sha256']) {
		color: #0f172a;
	}

	.manifest-value :global([data-mark-variant='sha256'] .rm-prefix) {
		color: #64748b;
		opacity: 1;
	}

	/* Section dividers — single thin slate-200 rule, no shadow, no gradient. */
	.rule {
		border: 0;
		border-top: 1px solid #e2e8f0;
		margin: 3rem 0;
	}

	.rule--strong {
		border-top-color: #cbd5e1; /* slate-300 */
	}

	/* Artifact label that introduces the constitution section. */
	.artifact-label {
		font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
		font-size: 12px;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #475569;
		margin: 0 0 1.5rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.artifact-label .ref {
		font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
		font-size: 12px;
		line-height: 1;
		text-transform: none;
		letter-spacing: 0;
		color: #0f172a;
	}

	.artifact-label :global(.version) {
		color: #64748b;
	}

	.artifact-label :global(.version .rm-prefix) {
		/* Version anchor stays single-tone in the artifact label header. */
		opacity: 1;
	}

	.artifact-label .sep {
		color: #94a3b8; /* slate-400 */
	}

	/* Inline shared element. */
	.ref {
		font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
		font-variant-numeric: tabular-nums;
	}

	/*
	 * Prose host.
	 *
	 * Marked emits standard HTML. We style its output here without using
	 * Tailwind @apply so the component is portable and the register stays
	 * deliberate. Structural primitives (Datum, Cite) are not used inside
	 * markdown-rendered prose because the markdown source is itself the
	 * canonical artifact — semantic primitives belong on surfaces where the
	 * citation behaviour survives plain-text export.
	 */
	.prose-host {
		font-size: 17px;
		line-height: 28px;
		color: #0f172a;
	}

	.prose-host :global(h2) {
		font-family: var(--font-sans, 'Satoshi', system-ui, sans-serif);
		font-size: 26px;
		line-height: 32px;
		font-weight: 700;
		letter-spacing: -0.005em;
		color: #0f172a;
		margin: 3rem 0 1rem;
	}

	.prose-host :global(h3) {
		font-family: var(--font-sans, 'Satoshi', system-ui, sans-serif);
		font-size: 21px;
		line-height: 28px;
		font-weight: 600;
		color: #0f172a;
		margin: 2.5rem 0 0.75rem;
	}

	.prose-host :global(h4) {
		font-family: var(--font-sans, 'Satoshi', system-ui, sans-serif);
		font-size: 17px;
		line-height: 26px;
		font-weight: 600;
		color: #0f172a;
		margin: 2rem 0 0.5rem;
	}

	.prose-host :global(h5),
	.prose-host :global(h6) {
		font-family: var(--font-sans, 'Satoshi', system-ui, sans-serif);
		font-size: 15px;
		line-height: 22px;
		font-weight: 600;
		color: #334155;
		margin: 1.5rem 0 0.5rem;
	}

	.prose-host :global(p) {
		margin: 0 0 1.25rem;
		color: #1e293b; /* slate-800 */
	}

	.prose-host :global(strong) {
		font-weight: 700;
		color: #0f172a;
	}

	.prose-host :global(em) {
		font-style: italic;
		color: #334155;
	}

	.prose-host :global(a) {
		color: #0f172a;
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-underline-offset: 2px;
	}

	.prose-host :global(a:hover),
	.prose-host :global(a:focus-visible) {
		text-decoration-thickness: 2px;
	}

	.prose-host :global(ul),
	.prose-host :global(ol) {
		margin: 0 0 1.25rem;
		padding-left: 1.5rem;
	}

	.prose-host :global(li) {
		margin: 0 0 0.5rem;
		color: #1e293b;
	}

	.prose-host :global(li > p) {
		margin: 0 0 0.5rem;
	}

	/* Inline code, fenced code, and any literal that is a verifiable claim
	   render in JetBrains Mono with tabular-nums. Path strings carry
	   zero-width spaces (injected at render) so they prefer to break at
	   `/` and `.`; long hex hashes get `overflow-wrap: anywhere` so the
	   line cannot overflow the measure. */
	.prose-host :global(code) {
		font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
		font-variant-numeric: tabular-nums;
		font-size: 0.9em;
		color: #0f172a;
		background: transparent;
		padding: 0;
		overflow-wrap: anywhere;
	}

	.prose-host :global(pre) {
		font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
		font-variant-numeric: tabular-nums;
		font-size: 14px;
		line-height: 22px;
		color: #0f172a;
		background: #ffffff;
		border: 1px solid #e2e8f0;
		padding: 1rem 1.25rem;
		margin: 0 0 1.5rem;
		overflow-x: auto;
	}

	.prose-host :global(pre code) {
		background: transparent;
		padding: 0;
		font-size: 14px;
	}

	.prose-host :global(blockquote) {
		margin: 0 0 1.25rem;
		padding: 0 0 0 1rem;
		border-left: 2px solid #cbd5e1;
		color: #334155;
	}

	.prose-host :global(blockquote p) {
		color: #334155;
	}

	.prose-host :global(hr) {
		border: 0;
		border-top: 1px solid #e2e8f0;
		margin: 2.5rem 0;
	}

	/*
	 * Tables (the issue markdown's hash manifest is one — though the
	 * loader strips the issue's own manifest, the registry table syntax
	 * may resurface in future amendments). The default <td> register is
	 * Satoshi at the table's body size; only inline <code> within a cell
	 * lifts to mono. The header row stays mono caps as a label register.
	 */
	.prose-host :global(table) {
		width: 100%;
		border-collapse: collapse;
		margin: 0 0 1.5rem;
		font-size: 14px;
		line-height: 22px;
	}

	.prose-host :global(thead) {
		border-bottom: 1px solid #cbd5e1;
	}

	.prose-host :global(tbody tr) {
		border-bottom: 1px solid #e2e8f0;
	}

	.prose-host :global(th) {
		font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		font-size: 12px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #475569;
		text-align: left;
		padding: 0.5rem 0.75rem 0.5rem 0;
		vertical-align: top;
	}

	.prose-host :global(td) {
		font-family: var(--font-sans, 'Satoshi', system-ui, sans-serif);
		font-size: 14px;
		line-height: 22px;
		color: #1e293b;
		padding: 0.625rem 0.75rem 0.625rem 0;
		vertical-align: top;
		overflow-wrap: anywhere;
	}

	.prose-host :global(td code) {
		/* Inline code within a cell is a verifiable claim — render mono. */
		font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
		font-variant-numeric: tabular-nums;
		font-size: 13px;
		color: #0f172a;
	}

	.prose-host :global(td:first-child),
	.prose-host :global(th:first-child) {
		padding-left: 0;
	}

	.prose-host :global(td:last-child),
	.prose-host :global(th:last-child) {
		padding-right: 0;
	}

	/*
	 * "Currently observed" / "Currently absent" gap markers.
	 *
	 * The constitution uses these italic openers as structural notes that
	 * compare what currently ships with what is still on the work-graph.
	 * Lifted from inline italic to a hung mono caps label so they read as
	 * a register, not as inline emphasis. The label hangs in the left
	 * margin via a negative-indent flow at desktop widths, and falls
	 * inline at mobile.
	 */
	.prose-host :global(.gap-row) {
		margin: 0 0 1.25rem;
		padding-left: 5.5rem;
		position: relative;
		color: #334155; /* slate-700 — same weight as <em> register */
	}

	.prose-host :global(.gap-label) {
		position: absolute;
		left: 0;
		top: 0.25rem;
		font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
		font-size: 11px;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		font-weight: 600;
		color: #475569;
	}

	.prose-host :global(.gap-row--observed .gap-label) {
		/* Slightly different tone marks "observed" as the affirmative
		   register without breaking the typographic discipline. */
		color: #475569;
	}

	.prose-host :global(.gap-row--absent .gap-label) {
		color: #64748b;
	}

	@media (max-width: 540px) {
		/* On narrow viewports the hung label collides with body copy.
		   Fall back to a leading inline label and remove the indent. */
		.prose-host :global(.gap-row) {
			padding-left: 0;
		}
		.prose-host :global(.gap-label) {
			position: static;
			display: inline-block;
			margin: 0 0.5em 0 0;
		}
	}

	/* Footer.
	   Body footer text reads at 13/20 to drop one register from the prose
	   measure — the footer is housekeeping, not body. Source filenames
	   render in mono because they are paths to files (verifiable claims),
	   surrounding prose is plain Satoshi at the smaller register. The
	   commit-SHA mark sits on the same line as the source links; it is
	   the registry mark per §2.3 that pins the displayed URLs to an
	   immutable revision. */
	.record-footer {
		margin-top: 3rem;
		padding-top: 2rem;
		border-top: 1px solid #e2e8f0;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.record-footer p {
		margin: 0;
		font-family: var(--font-sans, 'Satoshi', system-ui, sans-serif);
		font-size: 13px;
		line-height: 20px;
		color: #475569; /* slate-600 */
	}

	.record-footer__licence {
		color: #475569;
	}

	.record-footer__sources {
		color: #475569;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 0.375rem;
	}

	.record-footer__sources-label {
		font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
		font-size: 11px;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #64748b;
	}

	.record-footer .mono-path {
		font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
		font-variant-numeric: tabular-nums;
		font-size: 13px;
	}

	/* The commit-SHA registry mark renders inside RegistryMark's own DOM,
	   so the .mono / .record-footer__sha rules need :global() to escape the
	   parent component's CSS scope. RegistryMark already supplies font-mono
	   and tabular-nums via Tailwind utilities; we add font-size + color +
	   nowrap + the single-tone prefix override here. */
	.record-footer :global(.mono) {
		font-size: 13px;
	}

	.record-footer :global(.record-footer__sha) {
		color: #64748b;
		white-space: nowrap;
	}

	.record-footer :global(.record-footer__sha .rm-prefix) {
		/* Footer commit-SHA reads as a single-tone slate-500 line; the
		   RegistryMark default prefix subordination would two-tone the
		   "sha " label against the 12-char hash. */
		opacity: 1;
	}

	.record-footer__plain {
		color: #475569;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 0.375rem;
	}

	.record-footer__plain-label {
		font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
		font-size: 11px;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #64748b;
	}

	.record-footer a {
		color: #0f172a;
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-underline-offset: 2px;
	}

	.record-footer a:hover,
	.record-footer a:focus-visible {
		text-decoration-thickness: 2px;
	}

	.record-footer .sep {
		color: #cbd5e1; /* slate-300 — thinner divider than before */
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

	/* Honour reduced-motion preference: nothing animates here, but make the
	   intent explicit. */
	@media (prefers-reduced-motion: reduce) {
		.record-page,
		.record-page :global(*) {
			transition: none !important;
			animation: none !important;
		}
	}

	/*
	 * Print register.
	 *
	 * Drives the PDF export (`scripts/release/export-pdf.mjs` runs Playwright
	 * with `emulateMedia({ media: 'print' })` before saving the page as PDF).
	 * The PDF is a faithful presentation, not a separate design — the same
	 * typography, the same hierarchy, the same hash manifest. The print
	 * register only differs where the screen-only chrome (skip link, the
	 * web-form-only Plain Text / PDF download links) would mislead readers
	 * of a static print.
	 */
	@media print {
		.record-page {
			max-width: 100%;
			padding: 0;
			color: #000000;
			background: #ffffff;
		}

		/* Hide the skip-link target (it links inside the document, which is
		   meaningless on paper). */
		.sr-only-focusable {
			display: none !important;
		}

		/* The footer's "Also available" line links the PDF and TXT — but the
		   PDF *is* the rendered form being printed; pointing readers from a
		   PDF back to a PDF is circular. We hide the line in print and keep
		   the licence + source + commit-SHA registry mark, which are the
		   verifiability anchors that survive on paper. */
		.record-footer__plain {
			display: none !important;
		}

		/* Page-break discipline. Headings stay attached to following content;
		   the gap-row "Currently observed/absent" register prefers to stay
		   intact rather than splitting label off body; manifest rows do
		   likewise. Hashes themselves are not split because they sit on a
		   single mono line that wraps inside the cell. */
		.masthead,
		.manifest,
		.manifest-row,
		.fact {
			break-inside: avoid;
			page-break-inside: avoid;
		}
		.prose-host :global(h2),
		.prose-host :global(h3),
		.prose-host :global(h4),
		.prose-host :global(h5),
		.prose-host :global(h6) {
			break-after: avoid;
			page-break-after: avoid;
		}
		.prose-host :global(.gap-row) {
			break-inside: avoid;
			page-break-inside: avoid;
		}
		.prose-host :global(pre) {
			break-inside: avoid;
			page-break-inside: avoid;
		}

		/* Ensure links retain their underline + text in the print register;
		   the substrate-mark commit-SHA must also survive. */
		.record-footer a,
		.prose-host :global(a) {
			color: #000000;
			text-decoration: underline;
		}
	}
</style>
