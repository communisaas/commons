/**
 * The send lane in the template modal composes the recipient-visible attestation.
 * It once read a district off the user object — a key no caller supplies — so the
 * footer the recipient received silently lost the district the sender had just
 * been shown in the preview.
 *
 * The fix reads the district from the page data the route already resolved. That
 * only holds while three files agree on one key name, so the first case pins the
 * producer, the preview consumer and the send lane together: a rename on any one
 * side goes red. The second case proves the dropped value carried real
 * information rather than decoration.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildAttestation } from '$lib/core/identity/tier-display';

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('template modal attestation reads the district the route resolved', () => {
	it('producer, preview and send lane all name the same page-data key', () => {
		// Producer: the route server load emits the district onto page data.
		expect(src('src/routes/s/[slug]/+page.server.ts')).toContain('userDistrictCode');

		// Preview: the surface that shows the sender their own footer reads it.
		expect(src('src/routes/s/[slug]/+page.svelte')).toContain('data.userDistrictCode');

		// Send lane: the modal reads the same key, and the phantom user field is gone.
		const modal = src('src/lib/components/template/TemplateModal.svelte');
		expect(modal).toContain('userDistrictCode');
		expect(modal).not.toContain('district_code');
	});

	it('a dropped district is lost information, not cosmetics', () => {
		const withDistrict = buildAttestation({
			trustTier: 2,
			method: 'civic_api',
			districtCode: 'CA-12'
		});
		const withoutDistrict = buildAttestation({
			trustTier: 2,
			method: 'civic_api',
			districtCode: null
		});

		expect(withoutDistrict.line).not.toBeNull();
		expect(withDistrict.line).toBe(`${withoutDistrict.line} · CA-12`);
	});
});
