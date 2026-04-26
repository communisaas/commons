/**
 * Wave 7 / FU-4.1 — Playwright authentication fixture.
 *
 * Run before all E2E tests to persist a session cookie as `storageState`,
 * which downstream tests load via `test.use({ storageState: 'auth.json' })`
 * to skip login.
 *
 * STATUS: skeleton — required dev-only endpoint not yet implemented in the
 * SvelteKit app. To activate this fixture:
 *
 *   1. Add `/api/internal/dev-login` in src/routes/api/internal/dev-login/+server.ts
 *      that accepts `{ email, principalName }` only when:
 *        - `process.env.NODE_ENV !== 'production'` AND
 *        - request header `X-Dev-Login-Token === process.env.DEV_LOGIN_TOKEN`
 *      and returns a session cookie via the same path as production OAuth.
 *
 *   2. Set `DEV_LOGIN_TOKEN` in `.env.local` for `npm run dev`.
 *
 *   3. Set `PLAYWRIGHT_DEV_LOGIN_TOKEN` in CI matching `DEV_LOGIN_TOKEN` so
 *      this fixture can authenticate on test runs.
 *
 *   4. In `playwright.config.ts`, declare a `setup` project that runs this
 *      file BEFORE the chromium project, and have chromium consume the
 *      resulting `tests/e2e/.auth/storageState.json`.
 *
 * Why a dev-only endpoint instead of replaying real OAuth: real OAuth
 * requires a live Auth0/Google flow which Playwright can't drive without
 * shipping test credentials. A dev-only endpoint short-circuits that —
 * it's safe in non-production builds because (a) `NODE_ENV` gates it and
 * (b) the token gates it within non-prod environments.
 *
 * Test-build flag override (for FEATURES.SHADOW_ATLAS_VERIFICATION=false):
 *   Add to `.env.test` (or set in playwright.config.ts webServer env):
 *     VITE_FORCE_SHADOW_ATLAS_OFF=1
 *   Then in src/lib/config/features.ts, add a runtime override:
 *     SHADOW_ATLAS_VERIFICATION:
 *       import.meta.env.VITE_FORCE_SHADOW_ATLAS_OFF === '1' ? false : true
 *   This lets the E2E spec drive the address-input form (vs map-pin) without
 *   touching production behavior. Requires a fresh build for the test run.
 */

import { test as setup, expect } from '@playwright/test';
import path from 'node:path';

const STORAGE_STATE_PATH = path.join(__dirname, '.auth', 'storageState.json');

setup('authenticate as test user via dev-login endpoint', async ({ page, request }) => {
	const devLoginToken = process.env.PLAYWRIGHT_DEV_LOGIN_TOKEN;

	// Skip silently when the operator hasn't wired the dev-login endpoint
	// yet — Playwright reports `setup` as skipped (visible signal, not a
	// silent pass). Tests that depend on this fixture will themselves skip
	// because PLAYWRIGHT_STORAGE_STATE won't be present.
	setup.skip(
		!devLoginToken,
		'PLAYWRIGHT_DEV_LOGIN_TOKEN not set — dev-login endpoint not configured. See file header for setup.'
	);

	// Hit the dev-only login endpoint. Returns a Set-Cookie header with
	// the session ID; Playwright's `request` context preserves it on the
	// underlying browser context.
	const response = await request.post('/api/internal/dev-login', {
		headers: { 'X-Dev-Login-Token': devLoginToken! },
		data: {
			email: 'regrounding-e2e@example.test',
			principalName: 'E2E Test User'
		}
	});
	expect(response.ok(), 'dev-login endpoint must return 2xx').toBe(true);

	// Verify the session is active by hitting an authenticated route.
	await page.goto('/profile');
	await expect(page).not.toHaveURL(/\/login/);

	// Persist for downstream tests.
	await page.context().storageState({ path: STORAGE_STATE_PATH });
});
