import { describe, expect, it } from 'vitest';

import type { CachedPublicTemplateDetail } from '$lib/server/public-template-detail-cache';
import {
	PUBLIC_TEMPLATE_OG_IMAGE_HEIGHT,
	PUBLIC_TEMPLATE_OG_IMAGE_BIT_DEPTH,
	PUBLIC_TEMPLATE_OG_IMAGE_MAX_GLYPHS,
	PUBLIC_TEMPLATE_OG_IMAGE_MAX_BYTES,
	PUBLIC_TEMPLATE_OG_IMAGE_MAX_RECT_ROW_WRITES,
	PUBLIC_TEMPLATE_OG_IMAGE_PACKED_ROW_BYTES,
	PUBLIC_TEMPLATE_OG_IMAGE_PACKED_SURFACE_BYTES,
	PUBLIC_TEMPLATE_OG_IMAGE_RENDER_LIMITS,
	PUBLIC_TEMPLATE_OG_IMAGE_SCANLINE_BYTES,
	PUBLIC_TEMPLATE_OG_IMAGE_WIDTH,
	readPublicTemplateOgImage,
	renderPublicTemplateOgImage,
	renderPublicTemplateOgImageWithWork
} from '$lib/server/public-template-og-image';

function chunks(bytes: Uint8Array): Array<{ data: Uint8Array; type: string }> {
	const result: Array<{ data: Uint8Array; type: string }> = [];
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = 8;
	while (offset < bytes.byteLength) {
		const length = view.getUint32(offset);
		const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
		result.push({ data: bytes.slice(offset + 8, offset + 8 + length), type });
		offset += 12 + length;
	}
	return result;
}

function detail(
	patch: Partial<CachedPublicTemplateDetail> = {}
): CachedPublicTemplateDetail {
	return {
		id: 'template-clean-water',
		slug: 'clean-water',
		title: 'Protect clean water for every neighborhood',
		description: 'Ask the agency to protect drinking water and publish accountable results.',
		domain: 'environment',
		type: 'email',
		deliveryMethod: 'email',
		subject: 'Protect clean water',
		message_body: 'Please protect clean water.',
		sources: [],
		research_log: [],
		preview: 'Please protect clean water.',
		is_public: true,
		verified_sends: 1_234,
		unique_districts: 12,
		send_count: 1_234,
		delivery_config: {},
		cwc_config: null,
		recipient_config: { emails: [] },
		recipient_count: 0,
		recipientEmails: [],
		topics: ['water'],
		createdAt: '2026-07-18T00:00:00.000Z',
		author: { name: 'Commons', avatar: null },
		...patch
	} as CachedPublicTemplateDetail;
}

describe('public template OG image producer renderer', () => {
	it('produces one deterministic, bounded 1200x630 indexed PNG with Web APIs only', async () => {
		const first = await renderPublicTemplateOgImage(detail());
		const second = await renderPublicTemplateOgImage(detail());
		expect([...first]).toEqual([...second]);
		expect(first.byteLength).toBeGreaterThan(100);
		expect(first.byteLength).toBeLessThan(PUBLIC_TEMPLATE_OG_IMAGE_MAX_BYTES);
		expect([...first.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
		const view = new DataView(first.buffer, first.byteOffset, first.byteLength);
		expect(view.getUint32(16)).toBe(PUBLIC_TEMPLATE_OG_IMAGE_WIDTH);
		expect(view.getUint32(20)).toBe(PUBLIC_TEMPLATE_OG_IMAGE_HEIGHT);
		expect(first[24]).toBe(PUBLIC_TEMPLATE_OG_IMAGE_BIT_DEPTH);
		expect(first[25]).toBe(3);
		expect(chunks(first).map(({ type }) => type)).toEqual(['IHDR', 'PLTE', 'IDAT', 'IEND']);
		expect(readPublicTemplateOgImage(first)).toEqual(first);
	});

	it('binds visible IDAT pixels—not ancillary metadata—to title, domain, and count', async () => {
		const environmental = await renderPublicTemplateOgImage(detail());
		const variants = await Promise.all([
			renderPublicTemplateOgImage(detail({ title: 'Build abundant homes near transit' })),
			renderPublicTemplateOgImage(detail({ domain: 'housing' })),
			renderPublicTemplateOgImage(detail({ verified_sends: 987_654 }))
		]);
		const baselineIdat = chunks(environmental).find(({ type }) => type === 'IDAT')!.data;
		for (const variant of variants) {
			expect(
				chunks(variant).find(({ type }) => type === 'IDAT')!.data
			).not.toEqual(baselineIdat);
			expect(chunks(variant).map(({ type }) => type)).toEqual([
				'IHDR',
				'PLTE',
				'IDAT',
				'IEND'
			]);
		}
	});

	it('enforces glyph, rectangle-row, scanline, and compression-input ceilings while rendering', async () => {
		expect(PUBLIC_TEMPLATE_OG_IMAGE_PACKED_ROW_BYTES).toBe(300);
		expect(PUBLIC_TEMPLATE_OG_IMAGE_PACKED_SURFACE_BYTES).toBe(189_000);
		expect(PUBLIC_TEMPLATE_OG_IMAGE_SCANLINE_BYTES).toBe(189_630);
		expect(PUBLIC_TEMPLATE_OG_IMAGE_MAX_RECT_ROW_WRITES).toBeLessThan(85_000);
		const maximum = detail({
			description: 'A'.repeat(280),
			domain: 'A'.repeat(28),
			title: 'A'.repeat(180),
			verified_sends: Number.MAX_SAFE_INTEGER
		});
		const { image, work } = await renderPublicTemplateOgImageWithWork(maximum);
		expect(readPublicTemplateOgImage(image)).toEqual(image);
		expect(work).toEqual({
			compressionInputBytes: PUBLIC_TEMPLATE_OG_IMAGE_SCANLINE_BYTES,
			glyphs: PUBLIC_TEMPLATE_OG_IMAGE_MAX_GLYPHS,
			rectRowWrites: 24_315,
			scanlineRows: PUBLIC_TEMPLATE_OG_IMAGE_HEIGHT
		});

		await expect(
			renderPublicTemplateOgImageWithWork(maximum, {
				...PUBLIC_TEMPLATE_OG_IMAGE_RENDER_LIMITS,
				glyphs: PUBLIC_TEMPLATE_OG_IMAGE_MAX_GLYPHS - 1
			})
		).rejects.toThrow('PUBLIC_TEMPLATE_OG_RENDER_BUDGET_EXCEEDED:glyphs');
		await expect(
			renderPublicTemplateOgImageWithWork(maximum, {
				...PUBLIC_TEMPLATE_OG_IMAGE_RENDER_LIMITS,
				rectRowWrites: 0
			})
		).rejects.toThrow('PUBLIC_TEMPLATE_OG_RENDER_BUDGET_EXCEEDED:rectRowWrites');
		await expect(
			renderPublicTemplateOgImageWithWork(maximum, {
				...PUBLIC_TEMPLATE_OG_IMAGE_RENDER_LIMITS,
				scanlineRows: PUBLIC_TEMPLATE_OG_IMAGE_HEIGHT - 1
			})
		).rejects.toThrow('PUBLIC_TEMPLATE_OG_RENDER_BUDGET_EXCEEDED:scanlineRows');
		await expect(
			renderPublicTemplateOgImageWithWork(maximum, {
				...PUBLIC_TEMPLATE_OG_IMAGE_RENDER_LIMITS,
				compressionInputBytes: PUBLIC_TEMPLATE_OG_IMAGE_SCANLINE_BYTES - 1
			})
		).rejects.toThrow('PUBLIC_TEMPLATE_OG_RENDER_BUDGET_EXCEEDED:compressionInputBytes');
	});

	it('rejects corrupt, malformed, and oversized binaries at the shared boundary', async () => {
		const valid = await renderPublicTemplateOgImage(detail());
		const corrupt = valid.slice();
		corrupt[40] ^= 0xff;
		expect(() => readPublicTemplateOgImage(corrupt)).toThrow(
			'PUBLIC_TEMPLATE_OG_IMAGE_INVALID'
		);
		const wrongSignature = valid.slice();
		wrongSignature[0] = 0;
		expect(() => readPublicTemplateOgImage(wrongSignature)).toThrow(
			'PUBLIC_TEMPLATE_OG_IMAGE_INVALID:container'
		);
		expect(() =>
			readPublicTemplateOgImage(new Uint8Array(PUBLIC_TEMPLATE_OG_IMAGE_MAX_BYTES + 1))
		).toThrow('PUBLIC_TEMPLATE_OG_IMAGE_INVALID:container');
	});
});
