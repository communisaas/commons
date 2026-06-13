/**
 * Public Record — Volume 1, Issue 1.
 *
 * Loads the canonical markdown sources (CONSTITUTION.md and
 * docs/record/vol-1/issue-1.md) and renders them to HTML for the route.
 * Markdown is the authoritative form; the route is a faithful presentation.
 *
 * The source markdown is inlined at build time via Vite's `?raw` query so the
 * SSR'd page does not depend on a runtime filesystem (the project deploys on
 * the Cloudflare adapter, where `node:fs` is unavailable).
 *
 * The first-publication sha256 values for both sources are recorded in this
 * loader so the masthead can display them in the JetBrains-Mono register
 * without depending on a runtime hash recomputation. These values match the
 * "as committed" source-file hashes promulgated with this issue and are
 * load-bearing: any drift between source content and these literals is a
 * publication-integrity event, not a rendering nuisance.
 */

import { marked } from 'marked';
// Vite `?raw` import — bundled at build time. The path is relative to this
// file: ../../../../../ takes us from src/routes/record/vol-1/issue-1/ back
// to the project root.
// eslint-disable-next-line import/no-relative-parent-imports
import constitutionMd from '../../../../../CONSTITUTION.md?raw';
// eslint-disable-next-line import/no-relative-parent-imports
import issueMd from '../../../../../docs/record/vol-1/issue-1.md?raw';
import type { PageServerLoad } from './$types';

// Source sha256 for the currently committed files. These are the as-committed
// hashes; the canonical first-publication hash freezes when the v1.0.0 release
// tag is cut. The release tooling that pins that frozen hash is not built yet,
// so until then any further edit to either source file requires re-computing
// and updating these literals.
const CANONICAL_HASHES = {
	constitution: '6f707fec2ff3be443eca2a871754654af1218280b3dd699707d24cfc04c9d93c',
	issue: 'f8e2f2e7c6a0e317e06a8ee5da778eeeb8c02a5756fb57a754d15c6a9c569dfe'
} as const;

// Build-time commit SHA, inlined by Vite `define` (see vite.config.ts). The
// 12-char short form pins source links to an immutable revision rather than
// the moving `main` branch, which would be affordance dishonesty: clicking
// the rendered "source markdown" link must land on the bytes that hashed to
// the masthead's sha256, not on a future edit.
//
// If the build environment had no git context, the inline value is the
// literal string `'main'`; the rendered footer surfaces that fact directly
// (the registry mark reads `main`, not a 12-char hash) so drift is visible.
const COMMIT_SHA: string =
	(import.meta.env.VITE_COMMIT_SHA as string | undefined) ?? 'main';

// Configure marked for predictable, faithful rendering.
marked.setOptions({
	gfm: true,
	breaks: false
});

/**
 * Lift the markdown's italic "Currently observed:" / "Currently absent:"
 * paragraphs into a structural register. The constitution uses these as
 * gap markers — paragraphs that compare what currently ships with what is
 * still on the work-graph. In flat italic flow they vanish by the second
 * occurrence; lifted to a hung mono label they read as a register on the
 * page, not as inline emphasis.
 *
 * Match shape: `<p><em>Currently observed:</em> body</p>`. We rewrite to a
 * `<p class="gap-row gap-row--{observed|absent}">` with a leading
 * `<span class="gap-label">{OBSERVED|ABSENT}</span>` and the trailing body
 * preserved verbatim. The class hook is consumed by the page CSS to align
 * the label as a hanging mono caps token.
 *
 * We deliberately scope the regex to `<p><em>` rather than any italic so
 * we don't catch arbitrary emphasis elsewhere in the constitution.
 */
function liftGapMarkers(html: string): string {
	return html
		.replace(
			/<p><em>Currently observed:<\/em>\s*([\s\S]*?)<\/p>/g,
			'<p class="gap-row gap-row--observed"><span class="gap-label">OBSERVED</span>$1</p>'
		)
		.replace(
			/<p><em>Currently absent:<\/em>\s*([\s\S]*?)<\/p>/g,
			'<p class="gap-row gap-row--absent"><span class="gap-label">ABSENT</span>$1</p>'
		);
}

/**
 * Inject zero-width spaces after `/` and `.` inside path-like inline-code so
 * long path strings break at segment boundaries rather than mid-segment.
 * Hash strings (40+ hex chars) are left alone — they have no natural break
 * points and the prose CSS uses `overflow-wrap: anywhere` for them.
 *
 * Heuristic: a `<code>` whose textual content contains `/` or `.` and is
 * NOT a long hex run gets zero-width spaces injected. We only operate on
 * the inner text of `<code>...</code>`, never on attribute values or other
 * elements. We also skip code that contains tags (e.g. nested formatting),
 * which is rare in our markdown.
 */
function softenPathBreaks(html: string): string {
	const HEX_LONG = /^[0-9a-f]{40,}$/i;
	return html.replace(/<code>([^<>]+)<\/code>/g, (match, inner: string) => {
		// Hash-like content: leave to overflow-wrap.
		if (HEX_LONG.test(inner.trim())) return match;
		// Path-like content: insert ZWSP after `/` and `.` (but not in front
		// of a trailing `.` like an end-of-sentence period followed by space).
		if (/[/.]/.test(inner)) {
			const softened = inner
				.replace(/\//g, '/​')
				.replace(/\.(?=\S)/g, '.​');
			return `<code>${softened}</code>`;
		}
		return match;
	});
}

/**
 * Render markdown to HTML with a structural shift: the markdown's own H1
 * (the document's internal title) is demoted so that the page-level <h1>
 * in +page.svelte remains the only level-1 heading. Subsequent headings
 * shift down one level (h2 -> h3, etc.). This preserves the document
 * outline while keeping the page's heading hierarchy honest.
 *
 * The shift is performed in a single pass — chained sequential replaces
 * would re-shift each heading on every step (h1 -> h2 -> h3 -> ... -> h5),
 * collapsing the whole hierarchy.
 */
function renderShifted(md: string): string {
	const html = marked.parse(md, { async: false }) as string;
	const shifted = html.replace(/<(\/?)(h[1-5])(\b[^>]*)>/g, (_match, slash, tag, rest) => {
		const fromLevel = Number(tag[1]);
		const toLevel = Math.min(fromLevel + 1, 6);
		return `<${slash}h${toLevel}${rest}>`;
	});
	return softenPathBreaks(liftGapMarkers(shifted));
}

/**
 * The issue markdown opens with content structurally equivalent to the
 * page's masthead chrome: an H1 ("# Public Record · Volume 1 · Issue 1"),
 * a meta-paragraph (Date / Status / Maintainer / Licence lines), and a
 * "## Hash manifest" table. The chrome wins; rendering the markdown's copy
 * inline produces a duplicate masthead and lectures the reader twice.
 *
 * We strip everything from the start of the file through the line *before*
 * `## §A Promulgation`. That heading is the first preserved heading; under
 * `renderShifted` it lands in the page as `<h3>§A Promulgation</h3>`.
 *
 * We do NOT modify the constitution markdown — its H1 ("# Commons Design
 * Constitution") is the labelled "Promulgated artifact" and is intentional.
 */
function stripIssuePreamble(md: string): string {
	const lines = md.split('\n');
	const cutIndex = lines.findIndex((line) => /^##\s+§A\s+Promulgation\b/.test(line));
	if (cutIndex < 0) {
		// Defensive: if the marker shifts in a future amendment we render
		// the full markdown rather than silently chopping prose.
		return md;
	}
	return lines.slice(cutIndex).join('\n');
}

export const load: PageServerLoad = async () => {
	const repoUrl = 'https://github.com/communisaas/commons';
	const constitutionSourceUrl = `${repoUrl}/blob/${COMMIT_SHA}/CONSTITUTION.md`;
	const issueSourceUrl = `${repoUrl}/blob/${COMMIT_SHA}/docs/record/vol-1/issue-1.md`;

	return {
		issue: {
			html: renderShifted(stripIssuePreamble(issueMd)),
			hash: CANONICAL_HASHES.issue
		},
		constitution: {
			html: renderShifted(constitutionMd),
			hash: CANONICAL_HASHES.constitution
		},
		meta: {
			volume: 1,
			issue: 1,
			date: '2026-05-06',
			status: 'Inaugural',
			maintainer: 'Communiqué PBC',
			licence: "at the recipient's choice, CC-BY-4.0 or Apache-2.0",
			version: 'v1.0.0',
			commitSha: COMMIT_SHA
		},
		sources: {
			repoUrl,
			constitution: constitutionSourceUrl,
			issue: issueSourceUrl
		}
	};
};
