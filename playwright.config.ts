import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: 'tests/e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: 'html',
	use: {
		baseURL: process.env.CI ? 'http://localhost:4173' : 'http://localhost:5173',
		trace: 'on-first-retry'
	},
	projects: [
		// Wave 7 / FU-4.1 — auth setup project. Runs `auth.setup.ts` before
		// the main chromium project to persist a session cookie. The setup
		// itself skips when `PLAYWRIGHT_DEV_LOGIN_TOKEN` is unset, so this
		// project is a no-op until the operator wires the dev-login endpoint.
		{
			name: 'setup',
			testMatch: /auth\.setup\.ts/
		},
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
			dependencies: ['setup']
		}
	],
	webServer: process.env.CI
		? {
				command: 'npm run build && npm run preview',
				port: 4173,
				reuseExistingServer: false,
				timeout: 120000
			}
		: {
				command: 'npm run dev',
				port: 5173,
				reuseExistingServer: true,
				timeout: 120000
			}
});
