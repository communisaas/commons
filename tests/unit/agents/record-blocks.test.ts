import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
	CONSUMER_MAILBOX_DOMAINS,
	createBlockAccumulator,
	htmlRewriterTokenizer,
	regexTokenizer,
	segmentRecordBlocks,
	type SegmentResult
} from '$lib/core/agents/record-blocks';

const FIXTURE_DIRECTORY = resolve(process.cwd(), 'tests/fixtures/record-blocks');
const FIXTURES = [
	'directory-rows.html',
	'two-in-one-cell.html',
	'shared-address.html',
	'script-only.html',
	'mismatch.html',
	'consumer.html',
	'role-address.html',
	'nested.html',
	'office-titles.html',
	'void-elements.html'
] as const;

const TEST_VOID_ELEMENT_TAGS = new Set([
	'area',
	'base',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'source',
	'track',
	'wbr'
]);

function fixture(name: (typeof FIXTURES)[number]): string {
	return readFileSync(resolve(FIXTURE_DIRECTORY, name), 'utf8');
}

function segmentWithRegex(html: string): SegmentResult {
	const accumulator = createBlockAccumulator();
	regexTokenizer(html, accumulator);
	return accumulator.finish();
}

type RewriterHandlers = {
	element?: (element: {
		tagName: string;
		getAttribute(name: string): string | null;
		onEndTag(callback: () => void): void;
	}) => void;
	text?: (chunk: { text: string }) => void;
};

/**
 * Independent jsdom-backed implementation of the tiny HTMLRewriter surface the
 * production tokenizer consumes. It deliberately does not call regexTokenizer:
 * a throw or event-order defect in htmlRewriterTokenizer must kill the parity
 * test instead of comparing the regex path with itself.
 */
class TestHTMLRewriter {
	private readonly registrations: Array<{ selector: string; handlers: RewriterHandlers }> = [];

	on(selector: string, handlers: RewriterHandlers): this {
		this.registrations.push({ selector, handlers });
		return this;
	}

	transform(response: Response): Response {
		const registrations = this.registrations;
		const stream = new ReadableStream<Uint8Array>({
			async start(controller) {
				const source = await response.text();
				const template = document.createElement('template');
				template.innerHTML = source;

				const walk = (node: Node): void => {
					if (node.nodeType === Node.TEXT_NODE) {
						const parent = node.parentElement;
						if (!parent) return;
						for (const registration of registrations) {
							if (parent.matches(registration.selector)) {
								registration.handlers.text?.({ text: node.textContent ?? '' });
							}
						}
						return;
					}
					if (!(node instanceof Element)) return;

					const endCallbacks: Array<() => void> = [];
					const element = {
						tagName: node.tagName,
						getAttribute: (name: string) => node.getAttribute(name),
						onEndTag: (callback: () => void) => endCallbacks.push(callback)
					};
					for (const registration of registrations) {
						if (node.matches(registration.selector)) registration.handlers.element?.(element);
					}
					for (const child of node.childNodes) walk(child);
					// Cloudflare HTMLRewriter never invokes onEndTag for void elements.
					// Keeping the test double honest makes the production immediate-close
					// branch observable instead of silently supplying a fictional callback.
					if (!TEST_VOID_ELEMENT_TAGS.has(node.localName)) {
						for (const callback of endCallbacks.reverse()) callback();
					}
				};

				for (const child of template.content.childNodes) walk(child);
				controller.enqueue(new TextEncoder().encode(source));
				controller.close();
			}
		});
		return new Response(stream, { headers: { 'content-type': 'text/html' } });
	}
}

async function segmentWithHtmlRewriter(html: string): Promise<SegmentResult> {
	const accumulator = createBlockAccumulator();
	await htmlRewriterTokenizer(html, accumulator, TestHTMLRewriter as never);
	return accumulator.finish();
}

describe('record-block segmentation', () => {
	it('keeps the independently executed Workers tokenizer byte-identical to regex for every fixture', async () => {
		for (const name of FIXTURES) {
			const html = fixture(name);
			expect(await segmentWithHtmlRewriter(html), name).toEqual(segmentWithRegex(html));
		}
	});

	it('selects the HTMLRewriter branch when the Workers global exists', async () => {
		const previous = Reflect.get(globalThis, 'HTMLRewriter');
		Reflect.set(globalThis, 'HTMLRewriter', TestHTMLRewriter);
		try {
			await expect(segmentRecordBlocks(fixture('nested.html'))).resolves.toEqual(
				segmentWithRegex(fixture('nested.html'))
			);
		} finally {
			if (previous === undefined) Reflect.deleteProperty(globalThis, 'HTMLRewriter');
			else Reflect.set(globalThis, 'HTMLRewriter', previous);
		}
	});

	it('keeps the Workers frame stack aligned when void elements have no end callback', async () => {
		const expected = segmentWithRegex(fixture('void-elements.html'));
		await expect(segmentWithHtmlRewriter(fixture('void-elements.html'))).resolves.toEqual(expected);
		expect(expected.blocks).toEqual([
			expect.objectContaining({
				address: 'iris.west@city.gov',
				names: ['Iris West'],
				bindingScope: 'office',
				titleLine: 'Public Works'
			})
		]);
	});

	it('emits one same-frame observation for each directory record without asserting person scope', async () => {
		const result = await segmentRecordBlocks(fixture('directory-rows.html'));
		expect(result.truncated).toBe(false);
		expect(result.institutionBoundAddresses).toEqual([]);
		expect(result.blocks).toHaveLength(6);
		expect(result.blocks.map(({ address, names, bindingScope }) => ({
			address,
			names,
			bindingScope
		}))).toEqual([
			{ address: 'alice.johnson@city.gov', names: ['Alice Johnson'], bindingScope: 'office' },
			{ address: 'brian.chen@city.gov', names: ['Brian Chen'], bindingScope: 'office' },
			{ address: 'carla.gomez@city.gov', names: ['Carla Gomez'], bindingScope: 'office' },
			{ address: 'daniel.ortiz@city.gov', names: ['Daniel Ortiz'], bindingScope: 'office' },
			{ address: 'elena.park@city.gov', names: ['Elena Park'], bindingScope: 'office' },
			{ address: 'faisal.khan@city.gov', names: ['Faisal Khan'], bindingScope: 'office' }
		]);
		expect(result.blocks.every((block) => block.addressOrigin === 'mailto')).toBe(true);
	});

	it('rejects an ambiguous multi-name container to institution scope without grading pairings', async () => {
		const result = await segmentRecordBlocks(fixture('two-in-one-cell.html'));
		expect(result.blocks).toEqual([]);
		expect(result.institutionBoundAddresses).toEqual([
			'alice.stone@city.gov',
			'bob.jones@city.gov'
		]);
	});

	it('forces an address shared across blocks to office scope and clears every name', async () => {
		const result = await segmentRecordBlocks(fixture('shared-address.html'));
		expect(result.blocks).toHaveLength(3);
		for (const block of result.blocks) {
			expect(block.address).toBe('board@city.gov');
			expect(block.bindingScope).toBe('office');
			expect(block.names).toEqual([]);
			expect(block.bindingRejectedReason).toBeUndefined();
		}
	});

	it('discards script, JSON-LD, and non-mailto attribute addresses at every tier', async () => {
		await expect(segmentRecordBlocks(fixture('script-only.html'))).resolves.toEqual({
			blocks: [],
			institutionBoundAddresses: [],
			truncated: false
		});
	});

	it('keeps a mismatched person-form address but rejects the person binding', async () => {
		const result = await segmentRecordBlocks(fixture('mismatch.html'));
		expect(result.blocks).toHaveLength(1);
		expect(result.blocks[0]).toMatchObject({
			address: 'jsmith@city.gov',
			bindingScope: 'office',
			names: [],
			bindingRejectedReason: 'local-part-name-mismatch'
		});
	});

	it('rejects consumer mailboxes before either the block or institution tier', async () => {
		expect(CONSUMER_MAILBOX_DOMAINS.has('gmail.com')).toBe(true);
		await expect(segmentRecordBlocks(fixture('consumer.html'))).resolves.toEqual({
			blocks: [],
			institutionBoundAddresses: [],
			truncated: false
		});

		const ambiguous = await segmentRecordBlocks(`
			<div>
				<span>Alice Stone</span><a href="mailto:alice.stone@city.gov">Email</a>
				<span>Bob Jones</span><a href="mailto:bob.jones@city.gov">Email</a>
				<span>Consumer Person</span><a href="mailto:consumer@gmail.com">Email</a>
			</div>
		`);
		expect(ambiguous.blocks).toEqual([]);
		expect(ambiguous.institutionBoundAddresses).toEqual([
			'alice.stone@city.gov',
			'bob.jones@city.gov'
		]);
	});

	it('keeps role-form local parts office-scoped without calling them a mismatch', async () => {
		const result = await segmentRecordBlocks(fixture('role-address.html'));
		expect(result.blocks).toHaveLength(1);
		expect(result.blocks[0]).toMatchObject({
			address: 'superintendent@pgcps.org',
			bindingScope: 'office',
			names: []
		});
		expect(result.blocks[0].bindingRejectedReason).toBeUndefined();
	});

	it('does not mint person bindings from office titles in bare or punctuated local-part costumes', async () => {
		const result = await segmentRecordBlocks(fixture('office-titles.html'));
		expect(result.blocks).toHaveLength(24);
		expect(result.blocks.map((block) => block.address)).toEqual([
			'attorney@city.gov',
			'marshal@city.gov',
			'inspector@townname.gov',
			'ranger@fs.usda.gov',
			'specialist@county.gov',
			'planner@city.gov',
			'aide@senate.gov',
			'attorney@state.gov',
			'city.attorney@townname.gov',
			'fire.marshal@county.gov',
			'building.inspector@borough.gov',
			'district.ranger@parks.gov',
			'code.enforcement@city.gov',
			'animal.control@county.gov',
			'water.quality@county.gov',
			'parks.recreation@city.gov',
			'legislative.aide@assembly.gov',
			'program.specialist@district.gov',
			'emergency.management@county.gov',
			'historic.preservation@city.gov',
			'fire-marshal@district.gov',
			'city_attorney@borough.gov',
			'code+enforcement@town.gov',
			'parks-recreation@county.gov'
		]);
		expect(result.blocks.map((block) => block.names)).toEqual([
			['City Attorney'],
			['Fire Marshal'],
			['Building Inspector'],
			['District Ranger'],
			['Program Specialist'],
			['City Planner'],
			['Legislative Aide'],
			['State Attorney'],
			['City Attorney'],
			['Fire Marshal'],
			['Building Inspector'],
			['District Ranger'],
			['Code Enforcement'],
			['Animal Control'],
			['Water Quality'],
			['Parks Recreation'],
			['Legislative Aide'],
			['Program Specialist'],
			['Emergency Management'],
			['Historic Preservation'],
			['Fire Marshal'],
			['City Attorney'],
			['Code Enforcement'],
			['Parks Recreation']
		]);
		for (const block of result.blocks) {
			expect(block.bindingScope).toBe('office');
			expect(block.bindingRejectedReason).toBe('person-evidence-insufficient');
		}
	});

	it('keeps field labels, honorifics, and self-matching office titles from attesting personhood', async () => {
		const officeOnlyRows = [
			['City Attorney', 'city.attorney@townname.gov'],
			['Fire Marshal', 'fire.marshal@county.gov'],
			['Building Inspector', 'building.inspector@borough.gov'],
			['District Ranger', 'district.ranger@parks.gov'],
			['Code Enforcement', 'code.enforcement@city.gov'],
			['Animal Control', 'animal.control@county.gov'],
			['Water Quality', 'water.quality@county.gov'],
			['Parks Recreation', 'parks.recreation@city.gov'],
			['Legislative Aide', 'legislative.aide@assembly.gov'],
			['Program Specialist', 'program.specialist@district.gov'],
			['Emergency Management', 'emergency.management@county.gov'],
			['Historic Preservation', 'historic.preservation@city.gov'],
			['Fire Marshal', 'fire-marshal@district.gov'],
			['City Attorney', 'city_attorney@borough.gov'],
			['Code Enforcement', 'code+enforcement@town.gov'],
			['Parks Recreation', 'parks-recreation@county.gov'],
			['IT Helpdesk', 'it.helpdesk@city.gov'],
			['HR Department', 'hr.department@city.gov'],
			['Human Resources', 'human.resources@city.gov'],
			['Public Works', 'public.works@city.gov']
		] as const;

		for (const [label, address] of officeOnlyRows) {
			const result = await segmentRecordBlocks(
				`<div><span>Name: ${label}</span><a href="mailto:${address}">${address}</a></div>`
			);
				expect(result.blocks[0], `Name: ${label}`).toMatchObject({
					address,
					bindingScope: 'office',
					names: [label]
				});
		}

		for (const [label, address] of [
			['Dr. Fire Marshal', 'fire.marshal@city.gov'],
			['Ms. Code Enforcement', 'code.enforcement@city.gov']
		] as const) {
			const result = await segmentRecordBlocks(
				`<div><span>${label}</span><a href="mailto:${address}">${address}</a></div>`
			);
				expect(result.blocks[0], label).toMatchObject({
					address,
					bindingScope: 'office',
					names: [label]
				});
		}

		const repeated = await segmentRecordBlocks(`
			<div>
				<span>Name: Taylor Morgan</span><span>Taylor Morgan</span>
				<a href="mailto:taylor.morgan@city.gov">taylor.morgan@city.gov</a>
			</div>
		`);
		expect(repeated.blocks[0]).toMatchObject({
			address: 'taylor.morgan@city.gov',
			bindingScope: 'office',
			names: ['Taylor Morgan'],
			bindingRejectedReason: 'person-evidence-insufficient'
		});
	});

	it('retains possible-person observations while deliberately under-binding every row at extraction', async () => {
		const matrix = [
			{
				shape: 'possible person: honorific name plus distinct title',
				name: 'Dr. Jane Smith',
				title: 'County Health Officer',
				address: 'jane.smith@county.gov',
				tradeoff: 'deliberate under-bind: extractor retains evidence but makes no semantic claim'
			},
			{
				shape: 'possible person: Name field plus distinct title',
				name: 'Name: Dana Reyes',
				title: 'Public Works Director',
				address: 'dana.reyes@city.gov',
				tradeoff: 'deliberate under-bind: extractor retains evidence but makes no semantic claim'
			},
			{
				shape: 'possible person: unmarked name plus distinct title',
				name: 'Alice Johnson',
				title: 'Planning Director',
				address: 'alice.johnson@city.gov',
				tradeoff: 'deliberate under-bind: extractor retains evidence but makes no semantic claim'
			},
			{
				shape: 'Name field with no distinct title',
				name: 'Name: Jane Smith',
				title: undefined,
				address: 'jane.smith@city.gov',
				tradeoff: 'deliberate under-bind: a label alone is only an observation'
			},
			{
				shape: 'honorific with no distinct title',
				name: 'Dr. Karen Wu',
				title: undefined,
				address: 'karen.wu@county.gov',
				tradeoff: 'deliberate under-bind: an honorific alone is only an observation'
			}
		] as const;

		for (const row of matrix) {
			const title = row.title ? `<span>${row.title}</span>` : '';
			const result = await segmentRecordBlocks(
				`<div><span>${row.name}</span>${title}<a href="mailto:${row.address}">${row.address}</a></div>`
			);
			expect(result.blocks[0], `${row.shape}: ${row.tradeoff}`).toMatchObject({
				address: row.address,
				bindingScope: 'office',
				names: [row.name.replace(/^Name:\s*/u, '')],
				bindingRejectedReason: 'person-evidence-insufficient'
			});
			if (row.title) expect(result.blocks[0].titleLine).toBe(row.title);
		}
	});

	it('self-attacks six ordinary second-field costumes without minting a person binding', async () => {
		const officeRows = [
			['Fire Marshal', '(555) 555-1212', 'fire.marshal@county.gov'],
			['Code Enforcement', 'Room 214', 'code.enforcement@city.gov'],
			['Public Works', 'Mon-Fri 8:00-4:30', 'public.works@city.gov'],
			['City Attorney', 'Legal Department', 'city.attorney@townname.gov'],
			['Building Inspector', '123 Main Street', 'building.inspector@borough.gov'],
			['District Ranger', 'Fax: (555) 555-0100', 'district.ranger@parks.gov']
		] as const;

		for (const [officeTitle, ordinaryField, address] of officeRows) {
			const result = await segmentRecordBlocks(
				`<div><span>${officeTitle}</span><span>${ordinaryField}</span><a href="mailto:${address}">${address}</a></div>`
			);
			expect(result.blocks[0], `${officeTitle} plus ${ordinaryField}`).toMatchObject({
				address,
				bindingScope: 'office',
				names: [officeTitle],
				titleLine: ordinaryField,
				bindingRejectedReason: 'person-evidence-insufficient'
			});
		}
	});

	it('never lets an honorific bypass address-to-name correspondence', async () => {
		const mismatches = [
			['Dr. Jane Smith', 'bkennedy@city.gov'],
			['Dr. Jane Smith', 'publichealth@county.gov'],
			['Ms. Karen Wu', 'frontdesk@city.gov'],
			['Prof. Alan Turing', 'admissions2@univ.edu'],
			['Dr. Monica Goldson', 'pgcpsboard2@pgcps.org']
		] as const;
		for (const [label, address] of mismatches) {
			const result = await segmentRecordBlocks(
				`<div><span>${label}</span><a href="mailto:${address}">${address}</a></div>`
			);
			expect(result.blocks[0], address).toMatchObject({
				address,
				bindingScope: 'office',
				names: [],
				bindingRejectedReason: 'local-part-name-mismatch'
			});
		}
	});

	it('emits the nested list item once, under-binds without a title, and never emits its list', async () => {
		const result = await segmentRecordBlocks(fixture('nested.html'));
		expect(result.blocks).toHaveLength(1);
		expect(result.blocks[0]).toMatchObject({
			address: 'nora.patel@city.gov',
			names: ['Nora Patel'],
			bindingScope: 'office',
			bindingRejectedReason: 'person-evidence-insufficient'
		});
	});

	it('never carries a name across a sibling frame boundary', async () => {
		const result = await segmentRecordBlocks(`
			<section><span>Name: Bob Right</span></section>
			<section><span>Public Works</span><a href="mailto:bob.right@city.gov">bob.right@city.gov</a></section>
		`);
		expect(result.blocks).toHaveLength(1);
		expect(result.blocks[0]).toMatchObject({
			address: 'bob.right@city.gov',
			bindingScope: 'office',
			names: [],
			bindingRejectedReason: 'local-part-name-mismatch'
		});
		expect(result.blocks[0].names).not.toContain('Bob Right');
	});

	it('drives the accumulator with the Workers event shape, including immediate void close', () => {
		const accumulator = createBlockAccumulator();
		accumulator.openElement('div');
		accumulator.text('Name: Iris West');
		accumulator.openElement('br');
		accumulator.closeElement();
		accumulator.text('Public Works Director');
		accumulator.openElement('a');
		accumulator.mailto('mailto:iris.west@city.gov', 'Email Iris');
		accumulator.text('iris.west@city.gov');
		accumulator.closeElement();
		accumulator.closeElement();

		expect(accumulator.finish().blocks).toEqual([
				expect.objectContaining({
					address: 'iris.west@city.gov',
					addressOrigin: 'mailto',
					names: ['Iris West'],
					bindingScope: 'office'
				})
		]);
	});

	it('reports truncation in the producer units: scanned characters and emitted blocks', async () => {
		const html = `
			<div>Alice Stone <a href="mailto:alice.stone@city.gov">Email</a></div>
			<div>Bob Jones <a href="mailto:bob.jones@city.gov">Email</a></div>
		`;
		const blockBound = await segmentRecordBlocks(html, { maxBlocks: 1 });
		expect(blockBound.blocks).toHaveLength(1);
		expect(blockBound.truncated).toBe(true);

		const scanBound = await segmentRecordBlocks(html, { maxScanChars: 30 });
		expect(scanBound.truncated).toBe(true);
	});

});
