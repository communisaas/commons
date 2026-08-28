/**
 * Vitest does not run SvelteKit's browser bootstrap, so the generated
 * `$env/dynamic/public` module cannot read `globalThis.__sveltekit_dev.env`
 * under jsdom. Keep the test contract dynamic without exposing private env
 * variables: callers observe current PUBLIC_* values from `process.env`.
 */
export const env: Record<string, string | undefined> = new Proxy(
	Object.create(null) as Record<string, string | undefined>,
	{
		get(_target, property) {
			if (typeof property !== 'string' || !property.startsWith('PUBLIC_')) {
				return undefined;
			}

			return process.env[property];
		}
	}
);
