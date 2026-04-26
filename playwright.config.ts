import { defineConfig, devices } from '@playwright/test';

const STORAGE_STATE_PATH = 'tests/e2e/.auth/storageState.json';
const hasDevLoginToken = Boolean(process.env.PLAYWRIGHT_DEV_LOGIN_TOKEN);
const webServerEnv: Record<string, string> = {};

function setEnv(key: string, value: string | undefined) {
	if (typeof value === 'string' && value.length > 0) webServerEnv[key] = value;
}

webServerEnv.VITE_FORCE_SHADOW_ATLAS_OFF = '1';
webServerEnv.VITE_ENVIRONMENT = 'test';
webServerEnv.ENVIRONMENT = 'test';
webServerEnv.NODE_ENV = 'test';
setEnv('CI', process.env.CI);
setEnv('PUBLIC_CONVEX_URL', process.env.PUBLIC_CONVEX_URL);
setEnv('SESSION_CREATION_SECRET', process.env.SESSION_CREATION_SECRET);
setEnv('CONVEX_JWT_PRIVATE_KEY', process.env.CONVEX_JWT_PRIVATE_KEY);
setEnv('CONVEX_AUTH_ISSUER', process.env.CONVEX_AUTH_ISSUER);
setEnv('JWT_SECRET', process.env.JWT_SECRET);
setEnv('IDENTITY_HASH_SALT', process.env.IDENTITY_HASH_SALT);
setEnv('IP_HASH_SALT', process.env.IP_HASH_SALT);
if (process.env.PLAYWRIGHT_DEV_LOGIN_TOKEN) {
	webServerEnv.ENABLE_DEV_LOGIN = '1';
	webServerEnv.DEV_LOGIN_TOKEN = process.env.PLAYWRIGHT_DEV_LOGIN_TOKEN;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sanitizedCommand(command: string): string {
	const cleanEnv: Record<string, string> = {
		PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
		HOME: process.env.HOME ?? process.cwd(),
		TMPDIR: process.env.TMPDIR ?? '/tmp',
		...webServerEnv
	};
	const assignments = Object.entries(cleanEnv)
		.map(([key, value]) => `${key}=${shellQuote(value)}`)
		.join(' ');
	return `env -i ${assignments} sh -c ${shellQuote(command)}`;
}

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
			use: {
				...devices['Desktop Chrome'],
				storageState: hasDevLoginToken ? STORAGE_STATE_PATH : undefined
			},
			dependencies: ['setup']
		}
	],
	webServer: process.env.CI
		? {
				command: sanitizedCommand('npm run build && npm run preview'),
				port: 4173,
				reuseExistingServer: false,
				timeout: 120000
			}
		: {
				command: sanitizedCommand('npm run dev'),
				port: 5173,
				reuseExistingServer: true,
				timeout: 120000
			}
});
