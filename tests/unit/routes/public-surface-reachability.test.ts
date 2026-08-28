import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layout = readFileSync('src/routes/+layout.svelte', 'utf8');
const footer = readFileSync('src/lib/components/layout/Footer.svelte', 'utf8');

/**
 * Two failures that a rendering test would never catch, because both pages
 * rendered perfectly:
 *
 *  - The footer carries the privacy disclosure and states, in its own source,
 *    that the disclosure "must be discoverable from every page". The layout
 *    omitted it from the homepage and from verification certificates — the
 *    front door, and the page an outside party lands on. Measured live before
 *    the fix: the homepage served zero links to /about/integrity while /browse
 *    served two.
 *  - /browse and /developers returned 200 with no inbound link anywhere in the
 *    app, so they were reachable only by typing the URL.
 */
describe('the disclosure reaches every page', () => {
	const branches = ['isHomepage', 'isVerificationPage', 'isProfilePage'];

	for (const branch of branches) {
		it(`renders the footer in the ${branch} branch`, () => {
			// Anchor on the TEMPLATE branch, not the `$derived` declaration of the
			// same name at the top of the file.
			const marker = `{:else if ${branch}}`;
			const start = layout.indexOf(marker);
			expect(start, `${marker} not found`).toBeGreaterThan(-1);
			// Read only to the next branch, so a footer belonging to a later one
			// cannot satisfy this assertion.
			const rest = layout.slice(start + marker.length);
			const nextBranch = rest.search(/\{:else/);
			const block = nextBranch > -1 ? rest.slice(0, nextBranch) : rest;
			expect(block, `${branch} block has no <Footer />`).toContain('<Footer />');
		});
	}

	it('keeps the disclosure links the footer promises', () => {
		expect(footer).toContain('/about/integrity#data-practices');
		expect(footer).toContain('href="/about/integrity"');
	});
});

describe('working public pages can be reached by clicking', () => {
	for (const path of ['/browse', '/developers']) {
		it(`${path} has an inbound link`, () => {
			expect(footer, `${path} is orphaned`).toContain(`href="${path}"`);
		});
	}

	it('does not link to /directory while it errors', () => {
		// Reachability is not the only property that matters — a link to a broken
		// page spends the reader's trust. Re-add this when /directory serves 200.
		expect(footer).not.toContain('href="/directory"');
	});
});
