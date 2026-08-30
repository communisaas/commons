import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const raw = readFileSync('.github/workflows/deploy-direct.yml', 'utf8');
const wf = parse(raw) as {
	concurrency: { group: string };
	jobs: Record<string, { steps: Array<Record<string, unknown>>; needs?: unknown }>;
};
const step = (job: string, needle: string) =>
	wf.jobs[job].steps.find((s) => String(s.name ?? '').includes(needle));
const run = (job: string, needle: string) => String(step(job, needle)?.run ?? '');

/**
 * This is the workflow that actually publishes commons.email. Until now the only
 * deployment contract test read `deploy.yml` — a pipeline that has never
 * completed a run — so every property below could be deleted without a single
 * test noticing. Each case corresponds to a defect that reached production or
 * was one review away from doing so.
 */
describe('the shipping deploy workflow keeps its trust boundary', () => {
	it('runs the package lifecycle in a job holding no credentials', () => {
		// A dependency executing during `npm ci` must not share a process with the
		// Cloudflare deploy token.
		const build = JSON.stringify(wf.jobs.build);
		for (const secret of [
			'CLOUDFLARE_API_TOKEN',
			'INTERNAL_API_SECRET',
			'RELEASE_CONTROL_SECRET'
		]) {
			expect(build, `build job must not see ${secret}`).not.toContain(secret);
		}
		expect(JSON.stringify(wf.jobs.deploy)).toContain('CLOUDFLARE_API_TOKEN');

		// The deploy job does install app dependencies — wrangler bundles the
		// Worker there and must resolve every import. The property that survives
		// is that no dependency's install-time code runs beside the credential,
		// so the flag is the boundary and must not be dropped.
		const install = wf.jobs.deploy.steps.find((step) =>
			String(step.run ?? '').includes('npm ci')
		);
		expect(install, 'deploy installs dependencies for bundling').toBeTruthy();
		expect(String(install?.run)).toContain('--ignore-scripts');
	});

	it('extracts the artifact where the verification looks for it', () => {
		// download-artifact nests contents in a per-artifact subdirectory unless
		// told otherwise, which made every path in the verification step resolve
		// to nothing and fail silently under `set -e`. The id binding must stay —
		// it ties the download to this run's build rather than to a reusable name.
		expect(raw).toContain('artifact-ids: ${{ needs.build.outputs.artifact_id }}');
		expect(raw).toContain('merge-multiple: true');
	});

	it('carries the worker’s sibling closure across the job boundary', () => {
		// _worker.js imports ../output/server/index.js and
		// ../cloudflare-tmp/manifest.js. In one job those siblings just existed;
		// split across jobs they must be uploaded, or wrangler fails to bundle
		// with "Could not resolve" after the deployment has already been recorded.
		expect(raw).toContain('for sibling in output/server cloudflare-tmp; do');
		expect(raw).toContain('the worker closure would be incomplete');
	});

	it('publishes the trusted wrangler config, never the artifact’s copy', () => {
		// Cloudflare treats wrangler.toml as the whole project configuration —
		// bindings, compatibility flags, every var. Shipping the build job's copy
		// would hand a compromised dependency the deploy token's authority even
		// though it never sees the token itself.
		expect(raw).toContain('cp "$GITHUB_WORKSPACE/gate/wrangler.toml" "$ARTIFACT_ROOT/wrangler.toml"');
	});

	it('binds liveness to this exact release, not merely to a healthy answer', () => {
		// A stale bundle answers "ok". The six-week outage passed a status check
		// every single time.
		expect(run('deploy', 'Verify immutable release liveness')).toContain(
			'$DEPLOY_HEALTH_URL/api/live'
		);
		expect(run('deploy', 'Probe production domain health')).toContain(
			'$DEPLOY_PUBLIC_URL/api/live'
		);
		for (const probe of [
			run('deploy', 'Verify immutable release liveness'),
			run('deploy', 'Probe production domain health')
		]) {
			expect(probe).toContain('.status == "ok"');
			expect(probe).toContain('.release.sha == $sha');
			// SHA alone cannot separate two runs of the same commit.
			expect(probe).toContain('.release.transactionId == $tx');
			expect(probe).toContain('for attempt in {1..12}');
			expect(probe).toContain('sleep 10');
			expect(probe).toContain(
				'[ "$served_sha" != "$DEPLOY_SHA" ] || [ "$served_transaction" != "$PUBLIC_RELEASE_TRANSACTION_ID" ]'
			);
			expect(probe).toContain('waiting for propagation');
		}
	});

	it('keeps the internal API credential out of the publishing workflow', () => {
		// Candidate code must never receive the credential that unlocks internal
		// SvelteKit routes and secret-gated Convex functions.
		expect(raw).not.toContain('INTERNAL_API_SECRET');
		expect(raw.toLowerCase()).not.toContain('x-internal-secret');
		expect(raw).not.toMatch(/\$DEPLOY_(?:HEALTH|PUBLIC)_URL\/api\/health/);
		expect(raw).not.toContain('/api/internal/identity/mdl-readiness');
		// Deep dependency readiness did not disappear silently: its new ownership is
		// explicit at the workflow/runbook boundary.
		expect(raw).toContain('RUNBOOK COVERAGE NOTE: authenticated /api/health dependency readiness');
		expect(raw).toContain('now run outside CI from');
	});

	it('fetches the immutable HTML shell and one referenced built asset', () => {
		const smoke = run('deploy', 'Verify immutable application shell and asset');
		expect(smoke).toContain('"${DEPLOY_HEALTH_URL}/"');
		expect(smoke).toContain('content-type:');
		expect(smoke).toContain('/_app/immutable/');
		expect(smoke).toContain('"${DEPLOY_HEALTH_URL}${asset_path}"');
		expect(smoke.match(/expected 200/g)?.length).toBeGreaterThanOrEqual(2);
		expect(smoke).not.toContain('DEPLOY_PUBLIC_URL');
	});


	it('uses committed Shadow Atlas pins and fails on live Pages drift', () => {
		const validation = run(
			'resolve-build-vars',
			'Validate committed Shadow Atlas vars against Pages'
		);
		const committedRead = validation.indexOf("with open('wrangler.toml', 'rb')");
		const liveRead = validation.indexOf('response=$(curl');
		expect(committedRead).toBeGreaterThan(-1);
		expect(liveRead).toBeGreaterThan(committedRead);
		for (const key of [
			'ATLAS_BASE_URL',
			'VITE_ATLAS_BASE_URL',
			'EXPECTED_CELL_MAP_ROOT',
			'EXPECTED_CELL_MAP_DEPTH'
		]) {
			expect(validation).toContain(`Cloudflare Pages config drift for ${key}`);
		}
		expect(validation).toContain('Committed wrangler.toml is authoritative');
		expect(validation).toContain('echo "atlas_base_url=$atlas_url"');
		expect(validation).not.toContain('echo "atlas_base_url=$live_atlas_url"');
		expect(validation).not.toContain('vite_atlas_url="$atlas_url"');

		const materialize = run('build', 'Materialize per-release Wrangler vars');
		expect(materialize).not.toContain('ATLAS_BASE_URL: process.env.ATLAS_BASE_URL');
		expect(materialize).not.toContain('EXPECTED_CELL_MAP_ROOT: process.env.EXPECTED_CELL_MAP_ROOT');
	});

	it('can restore the previous deployment when a gate fails', () => {
		// Publication precedes every gate, so without this a red run just means a
		// bad build is live and nobody has done anything about it.
		expect(step('deploy', 'Record the deployment we are about to replace')).toBeTruthy();
		const rollback = step('deploy', 'Roll back to the last verified deployment');
		expect(rollback).toBeTruthy();
		expect(String(rollback?.if)).toContain('failure()');
		expect(raw).toContain('/rollback');
	});

	it('finalizes the release authority only after the gates have passed', () => {
		const names = wf.jobs.deploy.steps.map((s) => String(s.name ?? ''));
		const finalize = names.findIndex((n) => n.includes('Finalize the public-discovery'));
		const immutable = names.findIndex((n) => n.includes('Verify immutable release liveness'));
		const browser = names.findIndex((n) => n.includes('Verify immutable application shell'));
		const canonical = names.findIndex((n) => n.includes('Probe production domain health'));
		expect(finalize).toBeGreaterThan(-1);
		// Committing an authority for an unobserved build means a later rollback
		// leaves the tuple mismatched and discovery 503s hours afterwards.
		expect(finalize).toBeGreaterThan(immutable);
		expect(finalize).toBeGreaterThan(browser);
		expect(finalize).toBeGreaterThan(canonical);
	});

	it('gates production on the branch it actually deploys from', () => {
		// The lane is `main`; `branch=production` names the Cloudflare Pages branch
		// that owns commons.email, not the git source. An ancestry check against
		// origin/production refuses every deploy this pipeline performs, because
		// that branch has not moved and does not contain main's history — a gate
		// that blocks all legitimate use is worse than the hole it closes.
		expect(raw).toContain('source_ref=refs/remotes/origin/main');
		expect(raw).toContain('git merge-base --is-ancestor "$deploy_sha" "$source_ref"');
		expect(raw).not.toContain('refs/remotes/origin/production');
	});

	it('shares one publication mutex with every workflow touching this project', () => {
		// deploy.yml and pages-exposure-guard.yml both use this group. Keying on
		// the branch instead meant there was no mutex at all.
		expect(wf.concurrency.group).toBe('cloudflare-pages-publication');
	});

	it('treats an unobserved canonical release as a failure, not a pass', () => {
		expect(raw).toContain('::error::Production domain health could not be observed');
	});
});
