/**
 * Every element of the signed preimage must have a named reader outside the
 * module that signs it.
 *
 * This is a registry, not a behavioural test — it proves a reader was NAMED,
 * not that the value changes an outcome. The behavioural counterparts live in
 * `tests/unit/moderation/audience-reach.test.ts` (the reach census) and
 * `tests/unit/moderation/audience-attested-reach.test.ts` (what a roster's own
 * evidence may and may not buy); this file only refuses to let a signed field
 * exist with nobody on the other end of it.
 *
 * It has fired once for real. A `reaches` claim was signed into this preimage,
 * crossed to the public detail and was carried to the policy, where nothing read
 * it; when that carrier was deleted, the anchor below — then pinned on `reaches`
 * — went red and had to be moved, which is the gate working rather than the gate
 * being in the way.
 *
 * The claim list is DERIVED from the `canonicalPayload` source text rather than
 * hand-typed, so a future node that adds a preimage element inherits this gate
 * instead of walking past it. A hand-typed list cannot fail on a field it was
 * never told about.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const PROVENANCE_MODULE = 'convex/lib/publicRecipientProvenance.ts';

/** Reader claimed for a preimage element: the file, and the symbol inside it. */
type ClaimReader = { file: string; symbol: string };

/**
 * Hand-maintained. Adding a row here is a deliberate assertion that the named
 * symbol consumes the claim; it is not derived from the code, so it cannot
 * drift into agreeing with whatever the code happens to do.
 */
const CLAIM_READERS: Record<string, readonly ClaimReader[]> = {
	email: [
		{
			file: 'convex/lib/publicTemplateDiscoverySource.ts',
			symbol: 'publicDecisionMakerFromClaims'
		}
	],
	emailSource: [
		{
			file: 'convex/lib/publicTemplateDiscoverySource.ts',
			symbol: 'publicDecisionMakerFromClaims'
		}
	],
	name: [
		{
			file: 'convex/lib/publicTemplateDiscoverySource.ts',
			symbol: 'publicDecisionMakerFromClaims'
		}
	],
	title: [
		{
			file: 'convex/lib/publicTemplateDiscoverySource.ts',
			symbol: 'publicDecisionMakerFromClaims'
		}
	],
	organization: [
		{
			file: 'convex/lib/publicTemplateDiscoverySource.ts',
			symbol: 'publicDecisionMakerFromClaims'
		}
	],
	role: [
		{
			file: 'convex/lib/publicTemplateDiscoverySource.ts',
			symbol: 'publicDecisionMakerFromClaims'
		}
	],
	shortName: [
		{
			file: 'convex/lib/publicTemplateDiscoverySource.ts',
			symbol: 'publicDecisionMakerFromClaims'
		}
	],
	roleCategory: [
		{
			file: 'convex/lib/publicTemplateDiscoverySource.ts',
			symbol: 'publicDecisionMakerFromClaims'
		}
	]
};

/** The `canonicalPayload` body, sliced out of the module text by brace column. */
function canonicalPayloadBody(): string {
	const module = src(PROVENANCE_MODULE);
	const start = module.indexOf('function canonicalPayload(');
	expect(start, `${PROVENANCE_MODULE} no longer declares canonicalPayload`).toBeGreaterThanOrEqual(
		0
	);
	const end = module.indexOf('\n}', start);
	expect(end, 'canonicalPayload has no column-0 closing brace').toBeGreaterThan(start);
	return module.slice(start, end + 2);
}

/**
 * Every property the preimage reads off the claims object.
 *
 * Not just `claims.<ident>`: the body's ONLY receiver is the claims object
 * (`JSON.stringify` is stripped first), so every remaining property access is a
 * claim however it is spelled. A narrower `claims\.` match is evaded by a
 * single cast — `(claims as Record<string, unknown>).someDroppedField` — which
 * is exactly the shape a future node reaching for a field the claims type no
 * longer declares would have to write. Measured: the narrow match stayed green
 * on that form, the sweep below goes red on it.
 */
function preimageClaims(): string[] {
	const body = canonicalPayloadBody().replaceAll('JSON.stringify', '');
	const matches = body.matchAll(/\.([A-Za-z0-9_$]+)/g);
	return [...new Set([...matches].map((match) => match[1]))];
}

describe('attested claim readers', () => {
	it('derives the preimage claim list from the module source, not from a hand list', () => {
		const claims = preimageClaims();
		expect(claims.length).toBeGreaterThan(0);
		// Anchor the parse on the LAST element of the preimage array. If the brace
		// slice ever truncates early, or stops matching property accesses at all,
		// this is the claim it loses first — and without the anchor every other
		// assertion here would pass vacuously on a short list.
		expect(claims).toContain('roleCategory');
	});

	it('names a production reader file and symbol for every signed claim', () => {
		for (const claim of preimageClaims()) {
			const readers = CLAIM_READERS[claim];
			expect(
				readers,
				`${claim} is in the signature preimage with no reader registered in this file`
			).toBeDefined();
			expect(readers!.length).toBeGreaterThan(0);

			for (const { file, symbol } of readers!) {
				expect(file, `${claim}: a reader may not be the module that signs it`).not.toBe(
					PROVENANCE_MODULE
				);
				expect(existsSync(resolve(process.cwd(), file)), `${claim}: ${file} does not exist`).toBe(
					true
				);
				expect(src(file).includes(symbol), `${claim}: ${file} no longer names ${symbol}`).toBe(
					true
				);
			}
		}
	});
});
