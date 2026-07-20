import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const files = [
	'.github/workflows/deploy.yml',
	'scripts/qualify-public-discovery-generation.mjs',
	'scripts/run-public-template-og-release-phase.mjs',
	'src/app.d.ts',
	'src/lib/server/production-host-authority.ts',
	'workers/public-discovery-manifest-refresh-gate.ts',
	'workers/trusted-pages-release-edge.ts'
] as const;
const sources = Object.fromEntries(files.map((file) => [file, readFileSync(file, 'utf8')])) as Record<
	(typeof files)[number],
	string
>;
const workflow = sources['.github/workflows/deploy.yml'];
const qualifier = sources['scripts/qualify-public-discovery-generation.mjs'];

describe('release-control secret boundary', () => {
	it('keeps release control entirely out of candidate Pages runtime authority', () => {
		for (const [file, source] of Object.entries(sources)) {
			expect(source, file).not.toMatch(/\bPUBLIC_RELEASE_CONTROL_SECRET(?:_PREVIOUS)?\b/u);
		}
		expect(
			existsSync('src/routes/api/internal/public-template-og-release-authority/+server.ts')
		).toBe(false);
		const platform = sources['src/app.d.ts'].slice(
			sources['src/app.d.ts'].indexOf('interface Platform'),
			sources['src/app.d.ts'].indexOf('declare module', sources['src/app.d.ts'].indexOf('interface Platform'))
		);
		expect(platform).not.toContain('RELEASE_CONTROL_SECRET');
		expect(sources['workers/trusted-pages-release-edge.ts']).not.toContain(
			'RELEASE_CONTROL_SECRET'
		);
		expect(sources['workers/trusted-pages-release-edge.ts']).not.toContain('loadCandidate');
		expect(sources['src/lib/server/production-host-authority.ts']).toContain(
			'RETIRED_RELEASE_CONTROL_PATH'
		);
	});

	it('maps distinct protected realm capabilities only into trusted workflows and gate hosts', () => {
		expect(workflow).toContain('PROTECTED_RELEASE_CONTROL_SECRET_PREVIEW');
		expect(workflow).toContain('PROTECTED_RELEASE_CONTROL_SECRET_PRODUCTION');
		expect(workflow).toContain(
			'[ "$RELEASE_CONTROL_SECRET" = "$PREVIEW_RELEASE_CONTROL_SECRET" ]'
		);
		expect(workflow).not.toMatch(/echo[^\n]*\$\{?(?:PREVIEW_)?RELEASE_CONTROL_SECRET/u);
		expect(qualifier).toContain('https://release-control-staging.commons.email');
		expect(qualifier).toContain('https://release-control.commons.email');
		expect(qualifier).not.toContain('/api/internal/public-template-og-release-authority');
	});

	it('uses purpose-only candidate and control bearers on disjoint requests', () => {
		const control = qualifier.slice(
			qualifier.indexOf('async function mutateReleaseAuthority'),
			qualifier.indexOf('function defaultSleep')
		);
		const previewRuntime = qualifier.slice(
			qualifier.indexOf('export async function qualifyPublicDiscoveryGeneration'),
			qualifier.indexOf('export async function qualifyProductionReleaseAuthority')
		);
		expect(control).toContain("'x-public-release-control-secret': releaseControlSecret");
		expect(control).not.toContain("'x-release-probe-secret'");
		expect(control).not.toContain("'x-internal-secret'");
		expect(previewRuntime).toContain("'x-release-probe-secret': releaseProbeSecret");
		expect(previewRuntime).not.toContain("'x-internal-secret'");
		expect(previewRuntime).not.toContain('DISCOVERY_MANIFEST_REFRESH_SECRET');
	});

	it('makes the Durable Object independently authenticate every control mutation', () => {
		const gate = sources['workers/public-discovery-manifest-refresh-gate.ts'];
		const control = gate.slice(
			gate.indexOf('async #controlOgReleaseAuthority'),
			gate.indexOf('#releaseAuthorized')
		);
		expect(control.indexOf('hasReleaseControlAuthority')).toBeGreaterThan(-1);
		expect(control.indexOf('hasReleaseControlAuthority')).toBeLessThan(
			control.indexOf("request.headers.get('content-type')")
		);
		expect(control.indexOf('hasReleaseControlAuthority')).toBeLessThan(
			control.indexOf('transactionSync')
		);
	});
});
