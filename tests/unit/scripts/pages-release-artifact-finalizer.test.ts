import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// This suite runs the real finalizer, which bundles an actual Svelte sibling
// closure — measured at 10-28s per case. The global budget in vitest.config.ts
// is 10s locally and 15s in CI, so every one of these timed out rather than
// failed. It went unnoticed because the CI step ahead of this one had been
// failing for five days, so the job never reached it. Bundling cost is real
// work, not a hang: give it headroom here rather than loosening the global
// budget that every other suite is held to.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
import {
	PAGES_FINALIZATION_RECORD,
	PAGES_WORKER_PLATFORM_GZIP_LIMIT_BYTES,
	PAGES_WORKER_RELEASE_GZIP_LIMIT_BYTES,
	TRUSTED_PAGES_CANDIDATE_ADAPTER_PATH,
	TRUSTED_PAGES_CANDIDATE_BOOTSTRAP_PROTOCOL_PATH,
	TRUSTED_PAGES_CANDIDATE_BOOTSTRAP_RUNTIME_PATH,
	TRUSTED_PAGES_CANDIDATE_ENTRY_ID,
	TRUSTED_PAGES_CANDIDATE_SOURCE_INPUT_PATHS,
	TRUSTED_PAGES_ROUTES_FILE,
	TRUSTED_PAGES_ROUTES_SOURCE,
	assertSelfContainedWranglerMetafile,
	finalizePagesReleaseArtifact,
	measureFinalizedPagesWorker,
	parsePagesFinalizerArgs,
	validateFinalizedPagesWorker,
	verifyOptionalDependencyStubSemantics,
	verifyPinnedPagesFinalizerWrangler,
	verifyWranglerInputClosure
} from '../../../scripts/finalize-pages-release-artifact.mjs';

const roots: string[] = [];
const wranglerPackageRoot = '.github/release-gate/node_modules/wrangler';
const wranglerLockfile = '.github/release-gate/package-lock.json';

function fixture() {
	const root = mkdtempSync(join(tmpdir(), 'commons-pages-finalizer-test-'));
	roots.push(root);
	const artifactRoot = join(root, 'release-artifact');
	const buildRoot = join(root, '.svelte-kit');
	mkdirSync(join(artifactRoot, 'pages'), { recursive: true });
	mkdirSync(join(buildRoot, 'cloudflare'), { recursive: true });
	mkdirSync(join(buildRoot, 'output/server'), { recursive: true });
	mkdirSync(join(buildRoot, 'cloudflare-tmp'), { recursive: true });
	writeFileSync(
		join(artifactRoot, 'release-metadata.json'),
		`${JSON.stringify({ schemaVersion: 1, mode: 'normal', sourceSha: 'a'.repeat(40) })}\n`
	);
	writeFileSync(
		join(buildRoot, 'cloudflare/_worker.js'),
		[
			"import server from '../output/server/index.js';",
			"import manifest from '../cloudflare-tmp/manifest.js';",
			'export default {',
			'  async fetch() {',
			'    return new Response(`${server}:${manifest}`);',
			'  }',
			'};',
			''
		].join('\n')
	);
	writeFileSync(
		join(buildRoot, 'output/server/index.js'),
		[
			'export class Server {',
			'  constructor(manifest) { this.manifest = manifest; }',
			'  init() {}',
			'  async respond(request) {',
			'    return new Response(`trusted-adapter-server:${new URL(request.url).hostname}`);',
			'  }',
			'}',
			''
		].join('\n')
	);
	writeFileSync(
		join(buildRoot, 'cloudflare-tmp/manifest.js'),
		[
			"export const manifest = { appPath: '_app', assets: new Set(), _: { server_assets: {} } };",
			'export const prerendered = new Set();',
			"export const base_path = '';",
			''
		].join('\n')
	);
	writeFileSync(join(buildRoot, 'cloudflare/static.txt'), 'static asset\n');
	writeFileSync(
		join(buildRoot, 'cloudflare/_routes.json'),
		'{"version":1,"include":["/*"],"exclude":["/*"]}\n'
	);
	writeFileSync(join(buildRoot, 'cloudflare/_redirects'), '/* /candidate-bypass 302\n');
	return { root, artifactRoot, buildRoot };
}

function finalize(input: ReturnType<typeof fixture>) {
	return finalizeWithTrustedSource(input, '.');
}

function finalizeWithTrustedSource(input: ReturnType<typeof fixture>, trustedSourceRoot: string) {
	return finalizePagesReleaseArtifact({
		artifactRoot: input.artifactRoot,
		svelteBuildRoot: input.buildRoot,
		candidateNodeModules: 'node_modules',
		candidateLockfile: 'package-lock.json',
		wranglerPackageRoot,
		wranglerLockfile,
		trustedSourceRoot
	});
}

function copyTrustedSourceInputs(destinationRoot: string) {
	for (const sourcePath of TRUSTED_PAGES_CANDIDATE_SOURCE_INPUT_PATHS) {
		const destination = join(destinationRoot, sourcePath);
		mkdirSync(dirname(destination), { recursive: true });
		writeFileSync(destination, readFileSync(sourcePath));
	}
}

afterEach(() => {
	while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('trusted Pages release-artifact finalizer', () => {
	it(
		'bundles the exact Svelte sibling closure and emits only finalized Pages output',
		() => {
			const input = fixture();
			const result = finalize(input);
			const worker = readFileSync(join(input.artifactRoot, 'pages/_worker.js'), 'utf8');
		expect(result.bundle.selfContained).toBe(true);
		expect(result.bundle.gzipBytes).toBeLessThan(PAGES_WORKER_RELEASE_GZIP_LIMIT_BYTES);
		expect(result.isolation).toEqual({
			candidateArtifact: 'pages/_worker.js',
			cacheApi: 'forbidden-access-boundary',
			releaseAuthority: 'separate-trusted-edge-worker',
			runtimeAdapterPath: TRUSTED_PAGES_CANDIDATE_ADAPTER_PATH,
			runtimeAdapterSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
			runtimeSourceInputs: [
				TRUSTED_PAGES_CANDIDATE_ADAPTER_PATH,
				TRUSTED_PAGES_CANDIDATE_BOOTSTRAP_RUNTIME_PATH,
				TRUSTED_PAGES_CANDIDATE_BOOTSTRAP_PROTOCOL_PATH
			].map((sourcePath) => {
				const bytes = readFileSync(sourcePath);
				return {
					path: sourcePath,
					bytes: bytes.byteLength,
					sha256: createHash('sha256').update(bytes).digest('hex')
				};
			}),
			runtimeEntrypoint: TRUSTED_PAGES_CANDIDATE_ENTRY_ID,
			runtimeEntrypointSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
			trustedEdgeImported: false
		});
		expect(result.routing).toEqual({
			path: `pages/${TRUSTED_PAGES_ROUTES_FILE}`,
			sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
			include: ['/*'],
			exclude: []
		});
		expect(result.bundle.optionalDependencyStubs).toEqual([
			{
				specifier: 'redis',
				behavior: 'throw-on-dynamic-module-initialization',
				sha256: '47fb88b0281300ebaa9ca924718b73017283d381e5713589bde36f921461f171',
				content:
					'throw new Error("Optional dependency redis is unavailable in this canonical Pages artifact.");\nexport {};\n'
			},
			{
				specifier: '@voter-protocol/ai-evaluator',
				behavior: 'throw-on-dynamic-module-initialization',
				sha256: 'd7dd0ebc286a7a4fadb6e51b680a93343c166080afffad20d9212aeb577c092a',
				content:
					'throw new Error("Optional dependency @voter-protocol/ai-evaluator is unavailable in this canonical Pages artifact.");\nexport {};\n'
			}
		]);
		expect(worker).not.toContain('../output/server/index.js');
		expect(worker).not.toContain('../cloudflare-tmp/manifest.js');
		expect(worker).not.toContain('sourceMappingURL=');
		expect(worker).toContain('trusted-adapter-server:');
		expect(worker).toContain('ACCESS_SAFE_PAGES_ASSETS_BINDING_UNAVAILABLE');
		expect(worker).not.toContain('RELEASE_AUTHORITY_UNAVAILABLE');
		expect(worker).not.toContain('PAGES_ORIGIN_ACCESS_TOKEN');
		expect(readFileSync(join(input.artifactRoot, 'pages/static.txt'), 'utf8')).toBe(
			'static asset\n'
		);
		expect(
			readFileSync(join(input.artifactRoot, 'pages', TRUSTED_PAGES_ROUTES_FILE), 'utf8')
		).toBe(TRUSTED_PAGES_ROUTES_SOURCE);
		expect(() => readFileSync(join(input.artifactRoot, 'pages/_redirects'))).toThrow();
		expect(() => readFileSync(join(input.artifactRoot, 'output/server/index.js'))).toThrow();
		expect(() => readFileSync(join(input.artifactRoot, 'cloudflare-tmp/manifest.js'))).toThrow();
			expect(validateFinalizedPagesWorker(input.artifactRoot)).toEqual(result);
		},
		20_000
	);

	it('binds the exact trusted runtime source closure and rejects missing or drifted T inputs', () => {
		const missing = fixture();
		const missingTrustedRoot = join(missing.root, 'trusted-source');
		copyTrustedSourceInputs(missingTrustedRoot);
		rmSync(join(missingTrustedRoot, TRUSTED_PAGES_CANDIDATE_BOOTSTRAP_PROTOCOL_PATH));
		expect(() => finalizeWithTrustedSource(missing, missingTrustedRoot)).toThrow(
			/Trusted Pages runtime source input/u
		);
		expect(() => readFileSync(join(missing.artifactRoot, 'pages/_worker.js'))).toThrow();
		expect(() => readFileSync(join(missing.artifactRoot, PAGES_FINALIZATION_RECORD))).toThrow();

		const drifted = fixture();
		const driftedTrustedRoot = join(drifted.root, 'trusted-source');
		copyTrustedSourceInputs(driftedTrustedRoot);
		finalizeWithTrustedSource(drifted, driftedTrustedRoot);
		const runtimePath = join(
			driftedTrustedRoot,
			TRUSTED_PAGES_CANDIDATE_BOOTSTRAP_RUNTIME_PATH
		);
		writeFileSync(runtimePath, Buffer.concat([readFileSync(runtimePath), Buffer.from('\n// drift\n')]));
		expect(() => validateFinalizedPagesWorker(drifted.artifactRoot, driftedTrustedRoot)).toThrow(
			/isolate boundary drifted|canonical Worker bytes/u
		);
	});

	it.each([
		'api/release-origin',
		'api/release-origin.html',
		'api/release-candidate/index.html'
	])('rejects a physical static proof-route artifact in source output: %s', (relativePath) => {
		const input = fixture();
		const physicalPath = join(input.buildRoot, 'cloudflare', relativePath);
		mkdirSync(dirname(physicalPath), { recursive: true });
		writeFileSync(physicalPath, 'must never shadow the dynamic proof route\n');

		expect(() => finalize(input)).toThrow(/physical static proof-route artifact.*source/u);
		expect(() => readFileSync(join(input.artifactRoot, 'pages/_worker.js'))).toThrow();
		expect(() => readFileSync(join(input.artifactRoot, PAGES_FINALIZATION_RECORD))).toThrow();
	});

	it('rejects a physical static proof-route artifact added to finalized output', () => {
		const input = fixture();
		finalize(input);
		const physicalPath = join(
			input.artifactRoot,
			'pages/api/release-candidate/index.html'
		);
		mkdirSync(dirname(physicalPath), { recursive: true });
		writeFileSync(physicalPath, 'post-finalization shadow\n');

		expect(() => validateFinalizedPagesWorker(input.artifactRoot)).toThrow(
			/physical static proof-route artifact.*finalized/u
		);
	});

	it.each([
		['output/server', 'output/server'],
		['cloudflare-tmp/manifest.js', 'cloudflare-tmp/manifest.js']
	])('fails closed when required sibling closure %s is absent', (relativePath) => {
		const input = fixture();
		rmSync(join(input.buildRoot, relativePath), { recursive: true, force: true });
		expect(() => finalize(input)).toThrow();
		expect(() => readFileSync(join(input.artifactRoot, 'pages/_worker.js'))).toThrow();
		expect(() => readFileSync(join(input.artifactRoot, PAGES_FINALIZATION_RECORD))).toThrow();
	});

	it(
		'is byte-deterministic across independent isolated finalizations',
		() => {
			const primary = fixture();
			const replica = fixture();
			finalize(primary);
			finalize(replica);
			expect(readFileSync(join(primary.artifactRoot, 'pages/_worker.js'), 'utf8')).toBe(
				readFileSync(join(replica.artifactRoot, 'pages/_worker.js'), 'utf8')
			);
			expect(readFileSync(join(primary.artifactRoot, PAGES_FINALIZATION_RECORD), 'utf8')).toBe(
				readFileSync(join(replica.artifactRoot, PAGES_FINALIZATION_RECORD), 'utf8')
			);
		},
		// Two independent finalizations to compare bytes, so roughly double the
		// single-run cost. Measured at ~34s; 30s was under the floor.
		180_000
	);

	it('ignores the stock candidate entry and never embeds the trusted edge authority', () => {
		const input = fixture();
		writeFileSync(
			join(input.buildRoot, 'cloudflare/_worker.js'),
			[
				"import server from '../output/server/index.js';",
				"import manifest from '../cloudflare-tmp/manifest.js';",
				'const isolatedCandidateMarker = "candidate-origin-only";',
				'export default {',
				'  async fetch() {',
				'    return new Response(`${isolatedCandidateMarker}:${server}:${manifest}`);',
				'  }',
				'};',
				''
			].join('\n')
		);
		const result = finalize(input);
		const worker = readFileSync(join(input.artifactRoot, 'pages/_worker.js'), 'utf8');

		expect(result.isolation.releaseAuthority).toBe('separate-trusted-edge-worker');
		expect(worker).not.toContain('candidate-origin-only');
		expect(worker).toContain('trusted-adapter-server:');
		expect(worker).not.toContain('createTrustedPagesReleaseEdge');
		expect(worker).not.toContain('RELEASE_PROBE_SECRET');
		expect(worker).not.toContain('PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE');
	});

	it('rejects a candidate link before pinned Wrangler can traverse it', () => {
		const input = fixture();
		symlinkSync('/etc/passwd', join(input.buildRoot, 'output/server/leak'));
		expect(() => finalize(input)).toThrow(/forbids symbolic links/);
	});

	it('enforces the safety ceiling below the three-million-byte platform limit', () => {
		expect(PAGES_WORKER_RELEASE_GZIP_LIMIT_BYTES).toBeLessThan(
			PAGES_WORKER_PLATFORM_GZIP_LIMIT_BYTES
		);
		const bytes = Buffer.alloc(PAGES_WORKER_RELEASE_GZIP_LIMIT_BYTES);
		let state = 0x6d2b79f5;
		for (let index = 0; index < bytes.length; index += 1) {
			state ^= state << 13;
			state ^= state >>> 17;
			state ^= state << 5;
			bytes[index] = state & 0xff;
		}
		expect(() => measureFinalizedPagesWorker(bytes)).toThrow(/release ceiling/);
	});

	it('accepts only one self-contained output with approved runtime imports', () => {
		expect(
			assertSelfContainedWranglerMetafile({
				inputs: { 'input.js': { bytes: 1, imports: [] } },
				outputs: {
					'output.js': {
						bytes: 10,
						entryPoint: 'input.js',
						imports: [{ path: 'node:crypto', kind: 'import-statement', external: true }]
					}
				}
			})
		).toEqual({ bytes: 10, externalRuntimeModules: ['node:crypto'] });
		expect(() =>
			assertSelfContainedWranglerMetafile({
				inputs: {},
				outputs: {
					'output.js': {
						bytes: 10,
						entryPoint: 'input.js',
						imports: [{ path: './chunk.js', kind: 'import-statement', external: true }]
					}
				}
			})
		).toThrow(/unapproved runtime module dependency/);
	});

	it('pins both the lock entry and installed Wrangler package identity', () => {
		expect(verifyPinnedPagesFinalizerWrangler(wranglerLockfile, wranglerPackageRoot).version).toBe(
			'4.112.0'
		);
		const input = fixture();
		const lock = JSON.parse(readFileSync(wranglerLockfile, 'utf8'));
		lock.packages['node_modules/wrangler'].version = '4.112.1';
		const driftedLock = join(input.root, 'package-lock.json');
		writeFileSync(driftedLock, JSON.stringify(lock));
		expect(() => verifyPinnedPagesFinalizerWrangler(driftedLock, wranglerPackageRoot)).toThrow(
			/lock entry/
		);
	});

	it('fails closed if a trusted absence stub becomes lock-backed', () => {
		const input = fixture();
		const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
		lock.packages['node_modules/redis'] = { version: '5.0.0' };
		const driftedLock = join(input.root, 'candidate-package-lock.json');
		writeFileSync(driftedLock, JSON.stringify(lock));
		expect(() =>
			finalizePagesReleaseArtifact({
				artifactRoot: input.artifactRoot,
				svelteBuildRoot: input.buildRoot,
				candidateNodeModules: 'node_modules',
				candidateLockfile: driftedLock,
				wranglerPackageRoot,
				wranglerLockfile,
				trustedSourceRoot: '.'
			})
		).toThrow(/now lock-backed/);
	});

	it('fails closed on static optional imports or changed caught-failure semantics', () => {
		const input = fixture();
		const redisInput = 'input/.svelte-kit/output/server/chunks/rate-limiter.js';
		const evaluatorInput =
			'input/.svelte-kit/output/server/entries/endpoints/api/debates/_debateId_/evaluate/_server.ts.js';
		mkdirSync(join(input.buildRoot, 'output/server/chunks'), { recursive: true });
		mkdirSync(
			join(
				input.buildRoot,
				'output/server/entries/endpoints/api/debates/_debateId_/evaluate'
			),
			{ recursive: true }
		);
		const redisContract =
			'\tasync connect() {\n\t\ttry {\n\t\t\tconst client = (await import("redis")).createClient({ url: this.redisUrl });\n\t\t\tclient.on("error", (err) => {\n\t\t\t\tconsole.error("[RateLimiter] Redis error:", err);\n\t\t\t\tcaptureWithContext(err, { action: "redis-rate-limiter" });\n\t\t\t});\n\t\t\tawait client.connect();\n\t\t\tconsole.debug("[RateLimiter] Redis connected for rate limiting");\n\t\t\tthis.client = client;\n\t\t\treturn this.client;\n\t\t} catch (error) {\n\t\t\tconsole.error("[RateLimiter] Failed to connect to Redis:", error);\n\t\t\tcaptureWithContext(error, { action: "redis-connect" });\n\t\t\tthrow error;\n\t\t}\n\t}';
		writeFileSync(
			join(input.buildRoot, 'output/server/chunks/rate-limiter.js'),
			`${redisContract}\n\tasync reserve() {}`
		);
		writeFileSync(
			join(
				input.buildRoot,
				'output/server/entries/endpoints/api/debates/_debateId_/evaluate/_server.ts.js'
			),
			'\t\tlet aiEvaluator;\n\t\ttry {\n\t\t\taiEvaluator = await import("@voter-protocol/ai-evaluator");\n\t\t} catch {\n\t\t\tthrow error(503, "AI evaluator service not available.");\n\t\t}\n\t\tlet modelConfigs;'
		);
		const metafile = {
			inputs: {
				[redisInput]: {
					imports: [
						{
							path: 'input/.svelte-kit/trusted-finalizer-stubs/redis.mjs',
							kind: 'dynamic-import',
							original: 'redis'
						}
					]
				},
				[evaluatorInput]: {
					imports: [
						{
							path: 'input/.svelte-kit/trusted-finalizer-stubs/ai-evaluator.mjs',
							kind: 'dynamic-import',
							original: '@voter-protocol/ai-evaluator'
						}
					]
				}
			}
		};
		expect(() =>
			verifyOptionalDependencyStubSemantics(metafile, {
				isolatedBuildRoot: input.buildRoot
			})
		).not.toThrow();
		const staticImport = structuredClone(metafile);
		staticImport.inputs[redisInput].imports[0].kind = 'import-statement';
		expect(() =>
			verifyOptionalDependencyStubSemantics(staticImport, {
				isolatedBuildRoot: input.buildRoot
			})
		).toThrow(/reviewed dynamic import site/);
		writeFileSync(
			join(input.buildRoot, 'output/server/chunks/rate-limiter.js'),
			`${redisContract.replace('throw error;', 'return this.client;')}\n\tasync reserve() {}`
		);
		expect(() =>
			verifyOptionalDependencyStubSemantics(metafile, {
				isolatedBuildRoot: input.buildRoot
			})
		).toThrow(/reviewed failure semantics/);
	});

	it('accepts only the pinned Wrangler virtual namespace closure', () => {
		const input = fixture();
		const trusted = verifyPinnedPagesFinalizerWrangler(wranglerLockfile, wranglerPackageRoot);
		const options = {
			workspace: input.root,
			isolatedBuildRoot: input.buildRoot,
			candidate: {
				lockfile: JSON.parse(readFileSync('package-lock.json', 'utf8')),
				nodeModulesRoot: realpathSync('node_modules')
			},
			trusted: {
				lockfile: trusted.lockfile,
				nodeModulesRoot: trusted.nodeModulesRoot
			}
		};
		const disabledPostcss = `(disabled):${relative(
			input.root,
			resolve('node_modules/postcss/lib/terminal-highlight')
		)}`;
		expect(
			verifyWranglerInputClosure(
				{
					inputs: {
						'node-built-in-modules:buffer': { bytes: 61, imports: [], format: 'cjs' },
						[disabledPostcss]: { bytes: 0, imports: [] }
					}
				},
				options
			)
		).toMatchObject({ files: 2, bytes: 61 });
		expect(() =>
			verifyWranglerInputClosure(
				{
					inputs: {
						'node-built-in-modules:child_process': {
							bytes: 64,
							imports: [],
							format: 'cjs'
						}
					}
				},
				options
			)
		).toThrow(/not one ordinary allowlisted file/);
		const driftedLockfile = structuredClone(options.candidate.lockfile);
		driftedLockfile.packages['node_modules/postcss'].version = '0.0.0-drifted';
		expect(() =>
			verifyWranglerInputClosure(
				{
					inputs: {
						[disabledPostcss]: { bytes: 0, imports: [] }
					}
				},
				{
					...options,
					candidate: { ...options.candidate, lockfile: driftedLockfile }
				}
			)
		).toThrow(/not backed by an exact installed lock entry/);
	});

	it('cannot be invoked for containment or with caller-selected budget semantics', () => {
		const input = fixture();
		writeFileSync(
			join(input.artifactRoot, 'release-metadata.json'),
			`${JSON.stringify({ schemaVersion: 1, mode: 'containment' })}\n`
		);
		expect(() => finalize(input)).toThrow(/normal-mode only/);
		expect(() =>
			parsePagesFinalizerArgs([
				'--artifact-root',
				input.artifactRoot,
				'--svelte-build-root',
				input.buildRoot,
				'--candidate-node-modules',
				'node_modules',
				'--candidate-lockfile',
				'package-lock.json',
				'--wrangler-package-root',
				wranglerPackageRoot,
				'--wrangler-lockfile',
				wranglerLockfile,
				'--trusted-source-root',
				'.',
				'--max-gzip-bytes',
				'2999999'
			])
		).toThrow(/Unknown argument/);
	});
});
