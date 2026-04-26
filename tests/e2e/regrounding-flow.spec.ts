/**
 * Wave 4 — Browser E2E for the re-grounding flow.
 *
 * STATUS: skeleton. Marked `test.fixme()` because the prerequisites for
 * meaningful browser coverage are not present in this repo TODAY. Reporting
 * as `test.skip` (which prints "passed" in some output formats) would be
 * dishonest — these tests are NOT validating anything until the items in
 * "Prerequisites" land.
 *
 * What this file documents:
 *   - The selectors and data-testids the production UI exposes for E2E.
 *   - The phase transitions a real browser test must observe.
 *   - The three regression cases that unit tests cannot catch (browser-unique).
 *
 * Browser-unique value (why this can't be a vitest test):
 *   1. View Transitions API behavior — vitest runs in jsdom, no morph anim
 *   2. Real CSS grid layout transition (vertical-stack → 2-column)
 *   3. ESC keypress at the OS event level + page lifecycle (beforeunload)
 *
 * Existing unit/integration tests that already cover the LOGIC:
 *   - regrounding-cross-state.test.ts: state transitions, commitment swap
 *   - regrounding-attack-sims.test.ts: F1/F2/witness-commitment binding
 *   - credential-selector-invariant.test.ts: KG-4 ordering
 *   So the E2E suite intentionally does NOT duplicate phase-resolution
 *   logic — it only asserts the things only a browser can.
 *
 * ── Prerequisites (BLOCKED) ──
 *
 *   1. Auth fixture: `tests/e2e/auth.setup.ts` posts to a dev-only login
 *      endpoint, persists the resulting session as `storageState`, wired in
 *      `playwright.config.ts` via the `setup` project. Without this, the
 *      profile page redirects to /login.
 *
 *   2. Test build flag override: `FEATURES.SHADOW_ATLAS_VERIFICATION` is
 *      hardcoded `true`, which routes re-grounding through the map-pin path
 *      (not the address-input form). Either:
 *        (a) ship a test-only build with the flag forced to false, or
 *        (b) add map-pin selectors and drive the geocoded path,
 *      neither of which exists today.
 *
 *   3. Network mock contract validation: `page.route` mocks intercept by URL
 *      pattern. To survive refactors, add `expect(verifyAddressCalls).toBe(1)`
 *      assertions so a refactor that changes the URL fails LOUDLY, not silently.
 *
 *   4. Stable selectors:
 *      - AddressChangeFlow.svelte: `data-testid="prior-ground-pane"` (Wave 4b)
 *      - AddressVerificationFlow.svelte: `data-step="retire"|"attest"` +
 *        `data-state="pending"|"active"|"done"` on witnessing-list items
 *        (verified to exist in production code; FU-4.2 closed in Wave 7).
 */

import { test, expect, type Route } from '@playwright/test';

const NEW_ADDRESS = {
	street: '1 Apple Park Way',
	city: 'Cupertino',
	state: 'CA',
	zip: '95014'
};

const NEW_REPS = [
	{ name: 'Smith, Alex', chamber: 'house', party: 'R', state: 'CA', district: '17' },
	{ name: 'Padilla, Alex', chamber: 'senate', party: 'D', state: 'CA' },
	{ name: 'Schiff, Adam', chamber: 'senate', party: 'D', state: 'CA' }
];

async function installBaselineMocks(page: import('@playwright/test').Page) {
	await page.route('**/api/location/resolve-address', (route: Route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				resolved: true,
				address: { matched: '1 Apple Park Way, Cupertino, CA 95014' },
				coordinates: { lat: 37.3349, lng: -122.009 },
				officials: NEW_REPS
			})
		})
	);
	await page.route('**/api/identity/verify-address', (route: Route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ success: true, district: 'CA-17' })
		})
	);
	await page.route('**/api/proofs/revocation-witness', (route: Route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				path: Array(64).fill(null),
				pathBits: Array(64).fill(0),
				currentRoot: null,
				sequenceNumber: 0,
				computedEmptyRoot: '0x' + '0'.repeat(64)
			})
		})
	);
}

test.describe('Re-grounding flow — browser-unique coverage (Wave 4)', () => {
	test.beforeEach(async ({ page }) => {
		await installBaselineMocks(page);
	});

	test('view-transition: prior-ground pane retains identity across phase morph', async ({
		page
	}) => {
		// Browser-unique: vitest runs in jsdom and cannot observe View
		// Transitions API behavior or real CSS grid morphs. This is the ONE
		// test in this suite that genuinely needs Playwright.
		test.fixme(
			true,
			'requires PLAYWRIGHT_STORAGE_STATE auth + test-build with SHADOW_ATLAS_VERIFICATION=false. See file header for setup.'
		);

		await page.goto('/profile');
		await page.getByRole('button', { name: /^i moved$/i }).click();

		// data-testid stable across refactors (added in Wave 4b).
		const priorPane = page.getByTestId('prior-ground-pane');
		await expect(priorPane).toBeVisible();
		const before = await priorPane.boundingBox();
		expect(before).not.toBeNull();

		await page.getByLabel(/street/i).fill(NEW_ADDRESS.street);
		await page.getByLabel(/city/i).fill(NEW_ADDRESS.city);
		await page.getByLabel(/state/i).fill(NEW_ADDRESS.state);
		await page.getByLabel(/zip/i).fill(NEW_ADDRESS.zip);
		await page.getByRole('button', { name: /verify|find representatives/i }).click();

		// Phase=complete: the SAME element is still in the DOM, but the
		// layout has morphed (vertical → 2-column).
		await expect(page.getByText(/prior ground/i)).toBeVisible({ timeout: 15000 });
		const after = await priorPane.boundingBox();
		expect(after).not.toBeNull();

		// The pane was tracked across phases (single mount); position shifted.
		// In 2-column layout it's now narrower (left column ≈ half full width).
		expect(after!.width).toBeLessThan(before!.width + 50);
	});

	test('Former chip presence is gated to phase=complete (DOM-level)', async ({ page }) => {
		// Unit test asserts the conditional rendering logic. Browser-unique
		// value: catches a CSS leak (e.g., a stylesheet flash that briefly
		// shows the chip during phase transition) that jsdom can't observe.
		test.fixme(
			true,
			'requires auth fixture + test-build flag override (see file header)'
		);

		await page.goto('/profile');
		await page.getByRole('button', { name: /^i moved$/i }).click();

		// During capture, Former chip MUST NOT be in the DOM at all.
		await expect(page.getByText(/^former$/i)).toHaveCount(0);

		await page.getByLabel(/street/i).fill(NEW_ADDRESS.street);
		await page.getByLabel(/city/i).fill(NEW_ADDRESS.city);
		await page.getByLabel(/state/i).fill(NEW_ADDRESS.state);
		await page.getByLabel(/zip/i).fill(NEW_ADDRESS.zip);
		await page.getByRole('button', { name: /verify|find representatives/i }).click();

		// At phase=complete: chip appears.
		await expect(page.getByText(/^former$/i)).toBeVisible({ timeout: 15000 });
	});

	test('beforeunload + ESC are suppressed during witnessing', async ({ page }) => {
		// Browser-unique: page lifecycle events (beforeunload), keyboard
		// at OS level. The unit harness simulates phase changes; only a
		// real browser tests "user pressed ESC, browser tried to close".
		//
		// Wave 7 / FU-4.2 verified: AddressVerificationFlow witnessing items
		// already carry data-step="retire"|"attest" + data-state. Selector
		// uses those for tight phase assertion (no more text-match looseness).
		test.fixme(
			true,
			'requires PLAYWRIGHT_STORAGE_STATE auth fixture + test-build with SHADOW_ATLAS_VERIFICATION=false. See file header.'
		);

		// Slow the verify-address mock so witnessing is observable.
		await page.unroute('**/api/identity/verify-address');
		await page.route('**/api/identity/verify-address', async (route: Route) => {
			await new Promise((resolve) => setTimeout(resolve, 1500));
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ success: true, district: 'CA-17' })
			});
		});

		await page.goto('/profile');
		await page.getByRole('button', { name: /^i moved$/i }).click();
		await page.getByLabel(/street/i).fill(NEW_ADDRESS.street);
		await page.getByLabel(/city/i).fill(NEW_ADDRESS.city);
		await page.getByLabel(/state/i).fill(NEW_ADDRESS.state);
		await page.getByLabel(/zip/i).fill(NEW_ADDRESS.zip);
		await page.getByRole('button', { name: /verify|find representatives/i }).click();

		// PRECONDITION: witnessing phase is active and the attest step is
		// running. Tight assertion via the production data-step + data-state
		// anchors (FU-4.2). The slow verify-address mock keeps us in
		// data-state="active" for ~1500ms.
		await expect(
			page.locator('[data-step="attest"][data-state="active"]')
		).toBeVisible({ timeout: 5000 });

		// ESC during witnessing: flow MUST NOT dismiss.
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('prior-ground-pane')).toBeVisible();
		// Stronger assertion: the attest step is STILL active (not interrupted).
		await expect(
			page.locator('[data-step="attest"][data-state="active"]')
		).toBeVisible();
	});
});
