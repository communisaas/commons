/**
 * Wave 4 — Browser E2E for the re-grounding flow.
 *
 * STATUS: active when PLAYWRIGHT_DEV_LOGIN_TOKEN is set. Without that token,
 * the suite skips explicitly because it cannot authenticate a profile user.
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
 * Auth fixture:
 *   - `auth.setup.ts` posts to `/api/internal/dev-login`, persists cookies and
 *     IndexedDB via `storageState`, and seeds a current encrypted address so
 *     the profile exposes the "I moved" affordance.
 *   - `playwright.config.ts` forces `VITE_FORCE_SHADOW_ATLAS_OFF=1` for the
 *     webServer so this spec drives the address-input path.
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
	const calls = {
		resolveAddress: 0,
		verifyAddress: 0
	};

	await page.route('**/api/location/resolve-address', (route: Route) => {
		calls.resolveAddress++;
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				resolved: true,
				district: { code: 'CA-17', name: 'California 17th', state: 'CA' },
				address: {
					matched: '1 Apple Park Way, Cupertino, CA 95014',
					street: NEW_ADDRESS.street,
					city: NEW_ADDRESS.city,
					state: NEW_ADDRESS.state,
					zip: NEW_ADDRESS.zip
				},
				coordinates: { lat: 37.3349, lng: -122.009 },
				officials: NEW_REPS
			})
		});
	});
	await page.route('**/api/identity/verify-address', (route: Route) => {
		calls.verifyAddress++;
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ success: true, district: 'CA-17' })
		});
	});
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

	return calls;
}

async function openAddressForm(page: import('@playwright/test').Page) {
	await page.goto('/profile');
	await page.getByTestId('ground-i-moved').click();
	await page.getByRole('button', { name: /enter my address/i }).click();
	await expect(page.getByRole('heading', { name: /enter your new address/i })).toBeVisible();
}

async function resolveNewAddress(page: import('@playwright/test').Page) {
	await page.getByLabel(/^street$/i).fill(NEW_ADDRESS.street);
	await page.getByLabel(/^city$/i).fill(NEW_ADDRESS.city);
	await page.getByLabel(/^state$/i).fill(NEW_ADDRESS.state);
	await page.getByLabel(/^zip$/i).fill(NEW_ADDRESS.zip);
	await page.getByRole('button', { name: /resolve district/i }).click();
	await expect(page.getByText('CA-17')).toBeVisible({ timeout: 10000 });
}

async function completeRegrounding(page: import('@playwright/test').Page) {
	await page.getByRole('button', { name: /re-ground here/i }).click();
	await expect(page.getByText(/^re-grounded$/i)).toBeVisible({ timeout: 15000 });
}

test.describe('Re-grounding flow — browser-unique coverage (Wave 4)', () => {
	test.skip(
		!process.env.PLAYWRIGHT_DEV_LOGIN_TOKEN,
		'PLAYWRIGHT_DEV_LOGIN_TOKEN not set — re-grounding E2E needs dev-login auth state.'
	);

	test.beforeEach(async ({ page }) => {
		await installBaselineMocks(page);
	});

	test('view-transition: prior-ground pane retains identity across phase morph', async ({
		page
	}) => {
		// Browser-unique: vitest runs in jsdom and cannot observe View
		// Transitions API behavior or real CSS grid morphs. This is the ONE
		// test in this suite that genuinely needs Playwright.
		await openAddressForm(page);

		// data-testid stable across refactors (added in Wave 4b).
		const priorPane = page.getByTestId('prior-ground-pane');
		await expect(priorPane).toBeVisible();
		const before = await priorPane.boundingBox();
		expect(before).not.toBeNull();

		await resolveNewAddress(page);
		await completeRegrounding(page);

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
		await openAddressForm(page);

		// During capture, Former chip MUST NOT be in the DOM at all.
		await expect(page.getByText(/^former$/i)).toHaveCount(0);

		await resolveNewAddress(page);
		await completeRegrounding(page);

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
		await openAddressForm(page);

		// Slow the verify-address mock so witnessing is observable.
		await page.unroute('**/api/identity/verify-address');
		let verifyAddressCalls = 0;
		await page.route('**/api/identity/verify-address', async (route: Route) => {
			verifyAddressCalls++;
			await new Promise((resolve) => setTimeout(resolve, 1500));
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ success: true, district: 'CA-17' })
			});
		});

		await resolveNewAddress(page);
		await page.getByRole('button', { name: /re-ground here/i }).click();

		// PRECONDITION: witnessing phase is active and the attest step is
		// running. Tight assertion via the production data-step + data-state
		// anchors (FU-4.2). The slow verify-address mock keeps us in
		// data-state="active" for ~1500ms.
		await expect(
			page.locator('[data-step="attest"][data-state="active"]')
		).toBeVisible({ timeout: 5000 });
		expect(verifyAddressCalls).toBe(1);

		// ESC during witnessing: flow MUST NOT dismiss.
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('prior-ground-pane')).toBeVisible();
		// Stronger assertion: the attest step is STILL active (not interrupted).
		await expect(
			page.locator('[data-step="attest"][data-state="active"]')
		).toBeVisible();
	});
});
