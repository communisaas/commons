import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Plugin } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function componentTestStubsPlugin(): Plugin {
	const stubPath = path.join(__dirname, 'tests/mocks/AddressVerificationFlowStub.svelte');

	return {
		name: 'component-test-stubs',
		enforce: 'pre',
		resolveId(source, importer) {
			if (
				source === './AddressVerificationFlow.svelte' &&
				importer?.endsWith('/src/lib/components/auth/AddressChangeFlow.svelte')
			) {
				return stubPath;
			}
		}
	};
}

export default defineConfig({
	plugins: [
		componentTestStubsPlugin(),
		sveltekit(),
		svelteTesting({
			resolveBrowser: true,
			autoCleanup: true,
			noExternal: false
		})
	],
	resolve: {
		conditions: ['browser', 'module', 'import', 'default']
	},
	test: {
		include: ['tests/unit/components/**/*.{test,spec}.{js,ts}'],
		environment: 'jsdom',
		setupFiles: ['tests/config/setup.ts', '@testing-library/svelte/vitest'],
		globals: true,
		clearMocks: true,
		restoreMocks: true,
		pool: 'forks',
		fileParallelism: false,
		testTimeout: 10000,
		hookTimeout: 10000
	}
});
