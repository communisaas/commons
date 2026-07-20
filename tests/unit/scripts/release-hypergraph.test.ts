import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
	loadReleaseHypergraph,
	loadReleaseHypergraphFromGit,
	validateReleaseHypergraphDocuments
} from '../../../scripts/verify-release-hypergraph.mjs';

function currentGraph() {
	return loadReleaseHypergraph({ repoRoot: process.cwd() });
}

function readyProof() {
	return {
		verifiedAt: '2026-07-19T12:00:00Z',
		commands: ['npm test'],
		tests: ['tests/unit/scripts/release-hypergraph.test.ts'],
		artifacts: ['local verification output']
	};
}

function task(graph: ReturnType<typeof currentGraph>, id: string) {
	const found = graph.tasks.tasks.find((candidate: { id: string }) => candidate.id === id);
	if (!found) throw new Error(`Missing fixture task ${id}`);
	return found;
}

describe('release hypergraph verifier', () => {
	it('inert-parses fixed graph blobs from an exact commit instead of a candidate worktree', () => {
		const repository = mkdtempSync(join(tmpdir(), 'commons-release-graph-'));
		try {
			cpSync(
				'docs/strategy/public-discovery-release-hypergraph',
				join(repository, 'docs/strategy/public-discovery-release-hypergraph'),
				{ recursive: true }
			);
			execFileSync('git', ['init', '-q'], { cwd: repository });
			execFileSync('git', ['config', 'user.name', 'Release Gate Test'], { cwd: repository });
			execFileSync('git', ['config', 'user.email', 'release-gate@example.invalid'], {
				cwd: repository
			});
			execFileSync('git', ['add', '.'], { cwd: repository });
			execFileSync('git', ['commit', '-qm', 'graph fixture'], { cwd: repository });
			const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
				cwd: repository,
				encoding: 'utf8'
			}).trim();

			writeFileSync(
				join(repository, 'docs/strategy/public-discovery-release-hypergraph/topology.json'),
				'{"candidateWorktree":"must-not-be-read"}\n'
			);
			const documents = loadReleaseHypergraphFromGit(join(repository, '.git'), sha);
			expect(documents.topology.name).toBe('public-discovery-release-hypergraph');
			expect(() => validateReleaseHypergraphDocuments(documents)).not.toThrow();
			expect(() => loadReleaseHypergraphFromGit(join(repository, '.git'), 'main')).toThrow(
				/exact source SHA/
			);
		} finally {
			rmSync(repository, { recursive: true, force: true });
		}
	});

	it('accepts the repository graph while preserving honest open gates', () => {
		const result = validateReleaseHypergraphDocuments(currentGraph());
		expect(result.nodes).toBeGreaterThan(20);
		expect(result.launchProofState).toBe('pending');
		expect(result.containmentBootstrapSourceReady).toBe(true);
	});

	it('records executable proof for every implemented foundation and leaves detached authority open', () => {
		const graph = currentGraph();
		const foundations = graph.tasks.tasks.filter(
			(candidate: { id: string }) => candidate.id.startsWith('FND-') && candidate.id !== 'FND-60'
		);
		expect(
			foundations.filter((candidate: { status: string }) => candidate.status !== 'ready')
		).toEqual([]);

		for (const foundation of foundations.filter(
			(candidate: { status: string }) => candidate.status === 'ready'
		)) {
			expect(foundation.proof?.commands.length).toBeGreaterThan(0);
			expect(foundation.proof?.tests.length).toBeGreaterThan(1);
			expect(foundation.proof?.artifacts.length).toBeGreaterThan(1);
		}
		for (const id of ['FND-10', 'FND-30']) {
			expect(task(graph, id).proof?.commands).toContain(
				'node scripts/run-public-discovery-focused-tests.mjs'
			);
			expect(task(graph, id).proof?.commands).toContain('npm run check:convex-queries');
		}
		expect(task(graph, 'FND-35C').proof?.commands[0]).toContain(
			'tests/unit/scripts/trusted-containment-worker.test.ts'
		);

		expect(task(graph, 'FND-35').status).toBe('ready');
		expect(task(graph, 'FND-35C').status).toBe('ready');
		expect(task(graph, 'PD-05').status).toBe('operator_gate');
		expect(task(graph, 'PD-00').status).toBe('blocked_external');
		expect(task(graph, 'PD-50').acceptance).toContain(
			'`release.sha` equal to the exact source-verified SHA'
		);
		expect(task(graph, 'PD-70').acceptance).toContain(
			"`release.sha` equal to PD-50's exact source-verified SHA"
		);
		expect(task(graph, 'FND-60').status).toBe('pending');
	});

	it('rejects a ready exact-SHA gate without exact provenance proof', () => {
		const graph = currentGraph();
		task(graph, 'PD-10').status = 'ready';
		task(graph, 'PD-10').proof = readyProof();
		expect(() => validateReleaseHypergraphDocuments(graph)).toThrow(/PD-10.*dependency FND-60/);
	});

	it('rejects launch proof that outruns a foundation dependency', () => {
		const graph = currentGraph();
		task(graph, 'FND-10').status = 'in_progress';
		delete task(graph, 'FND-10').proof;
		const launchProof = task(graph, 'FND-60');
		launchProof.status = 'ready';
		launchProof.proof = {
			...readyProof(),
			reviewers: [
				{ name: 'agy', verdict: 'pass' },
				{ name: 'claude', verdict: 'pass' },
				{ name: 'codex', verdict: 'pass' }
			]
		};
		expect(() => validateReleaseHypergraphDocuments(graph)).toThrow(
			/FND-60 cannot be ready while dependency FND-/
		);
	});

	it('rejects source-owned launch proof even when it embeds reviewer claims', () => {
		const graph = currentGraph();
		for (const candidate of graph.tasks.tasks) {
			if (candidate.id.startsWith('FND-') && candidate.id !== 'FND-60') {
				candidate.status = 'ready';
				candidate.proof ??= readyProof();
			}
		}
		task(graph, 'FND-60').status = 'ready';
		task(graph, 'FND-60').proof = {
			...readyProof(),
			reviewers: [
				{ name: 'agy', verdict: 'pass' },
				{ name: 'codex', verdict: 'pass' }
			]
		};
		expect(() => validateReleaseHypergraphDocuments(graph)).toThrow(/must remain exactly pending/);
	});

	it('locks detached review and external operator gates out of source-owned status claims', () => {
		const launchOperatorGate = currentGraph();
		task(launchOperatorGate, 'FND-60').status = 'operator_gate';
		expect(() => validateReleaseHypergraphDocuments(launchOperatorGate)).toThrow(
			/FND-60 must remain exactly pending/
		);

		const externalClaim = currentGraph();
		task(externalClaim, 'PD-05').status = 'pending';
		expect(() => validateReleaseHypergraphDocuments(externalClaim)).toThrow(
			/PD-05 must remain operator_gate in source/
		);
	});

	it('rejects a ready foundation that still describes its source proof as pending', () => {
		const graph = currentGraph();
		task(graph, 'FND-10').proofPending = 'stale source-proof claim';
		expect(() => validateReleaseHypergraphDocuments(graph)).toThrow(
			/FND-10 is ready but still carries proofPending/
		);
	});

	it('rejects stale topology statistics and dependency cycles', () => {
		const stale = currentGraph();
		stale.topology.statistics.nodes += 1;
		expect(() => validateReleaseHypergraphDocuments(stale)).toThrow(/topology\.statistics\.nodes/);

		const cyclic = currentGraph();
		cyclic.edges.requires.edges.push({
			source: 'FND-60',
			target: 'FND-10',
			evidence: 'Invalid test cycle.'
		});
		cyclic.topology.statistics.requires_edges += 1;
		expect(() => validateReleaseHypergraphDocuments(cyclic)).toThrow(/dependency cycle/);
	});

	it('keeps source strict modes separate from detached review authority', () => {
		expect(() =>
			validateReleaseHypergraphDocuments(currentGraph(), {
				requireLaunchFoundationsReady: true
			})
		).toThrow(/forbidden: source cannot self-attest FND-60/);
		expect(
			validateReleaseHypergraphDocuments(currentGraph(), {
				requireLaunchFoundationsImplemented: true
			}).foundationsImplemented
		).toBe(true);

		const incompleteFoundationFixture = currentGraph();
		task(incompleteFoundationFixture, 'FND-36').status = 'pending';
		delete task(incompleteFoundationFixture, 'FND-36').proof;
		expect(() =>
			validateReleaseHypergraphDocuments(incompleteFoundationFixture, {
				requireLaunchFoundationsImplemented: true
			})
		).toThrow(/FND-36 is not ready/);
		expect(
			validateReleaseHypergraphDocuments(currentGraph(), {
				requireContainmentBootstrapSourceReady: true
			}).containmentBootstrapSourceReady
		).toBe(true);

		const containmentFixture = currentGraph();
		task(containmentFixture, 'FND-35C').status = 'pending';
		delete task(containmentFixture, 'FND-35C').proof;
		expect(() =>
			validateReleaseHypergraphDocuments(containmentFixture, {
				requireContainmentBootstrapSourceReady: true
			})
		).toThrow(/FND-35C is not ready/);
		expect(task(containmentFixture, 'FND-35').status).toBe('ready');
	});
});
