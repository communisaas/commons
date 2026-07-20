#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const DEFAULT_HYPERGRAPH_ROOT = 'docs/strategy/public-discovery-release-hypergraph';

const EDGE_FILES = ['blocks', 'requires', 'rollback'];
const READY_PROOF_ARRAYS = ['commands', 'tests', 'artifacts'];
const MAX_GRAPH_DOCUMENT_BYTES = 2 * 1024 * 1024;
const GRAPH_DOCUMENT_PATHS = {
	topology: 'topology.json',
	tasks: 'nodes/tasks.json',
	blocks: 'edges/blocks.json',
	requires: 'edges/requires.json',
	rollback: 'edges/rollback.json'
};
const SHA_RE = /^[a-f0-9]{40}$/;

/** @typedef {{ source: string, target: string, [key: string]: unknown }} GraphEdge */
/** @typedef {{ type: string, edges: GraphEdge[] }} EdgeDocument */
/** @typedef {{ id: string, type: string, status: string, name: string, owner: string, description: string, acceptance: string, proof?: Record<string, any>, [key: string]: any }} GraphTask */
/** @typedef {{ topology: Record<string, any>, tasks: { type: string, tasks: GraphTask[] }, edges: Record<string, EdgeDocument> }} HypergraphDocuments */
/** @typedef {{ repoRoot?: string, graphRoot?: string, repositoryGitDir?: string, sourceCommitSha?: string, requireLaunchFoundationsReady?: boolean, requireLaunchFoundationsImplemented?: boolean, requireContainmentBootstrapSourceReady?: boolean }} VerifyOptions */

/**
 * @param {unknown} condition
 * @param {string} message
 * @returns {asserts condition}
 */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value */
function nonEmptyStrings(value) {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.every((entry) => typeof entry === 'string' && entry.trim().length > 0)
	);
}

/** @param {string} file */
function readJson(file) {
	return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * Read a fixed graph document as an inert blob from an exact commit. Candidate
 * worktrees and candidate-owned verifier code are never materialized or run by
 * the release authority.
 *
 * @param {string} repositoryGitDir
 * @param {string} sourceCommitSha
 * @param {string} documentPath
 */
function readGitJson(repositoryGitDir, sourceCommitSha, documentPath) {
	const graphPath = `${DEFAULT_HYPERGRAPH_ROOT}/${documentPath}`;
	const gitDir = path.resolve(repositoryGitDir);
	const tree = spawnSync(
		'git',
		['--git-dir', gitDir, 'ls-tree', '-z', sourceCommitSha, '--', graphPath],
		{ encoding: 'buffer', maxBuffer: 64 * 1024 }
	);
	invariant(tree.status === 0, `Unable to inspect ${graphPath} at source commit.`);
	const record = Buffer.from(tree.stdout ?? Buffer.alloc(0));
	const match = /^100644 blob ([a-f0-9]{40})\t([^\0]+)\0$/u.exec(record.toString('utf8'));
	invariant(match?.[2] === graphPath, `${graphPath} must be one ordinary non-executable blob.`);

	const blob = spawnSync('git', ['--git-dir', gitDir, 'cat-file', 'blob', match[1]], {
		encoding: 'buffer',
		maxBuffer: MAX_GRAPH_DOCUMENT_BYTES + 1
	});
	invariant(blob.status === 0, `Unable to read ${graphPath} at source commit.`);
	const bytes = Buffer.from(blob.stdout ?? Buffer.alloc(0));
	invariant(
		bytes.length <= MAX_GRAPH_DOCUMENT_BYTES,
		`${graphPath} exceeds the inert parse limit.`
	);
	return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

/** @param {string} repositoryGitDir @param {string} sourceCommitSha */
export function loadReleaseHypergraphFromGit(repositoryGitDir, sourceCommitSha) {
	invariant(SHA_RE.test(sourceCommitSha), 'Inert graph verification requires an exact source SHA.');
	const documents = Object.fromEntries(
		Object.entries(GRAPH_DOCUMENT_PATHS).map(([name, documentPath]) => [
			name,
			readGitJson(repositoryGitDir, sourceCommitSha, documentPath)
		])
	);
	return {
		topology: documents.topology,
		tasks: documents.tasks,
		edges: {
			blocks: documents.blocks,
			requires: documents.requires,
			rollback: documents.rollback
		}
	};
}

/** @param {VerifyOptions} [options] */
export function loadReleaseHypergraph({
	repoRoot = process.cwd(),
	graphRoot,
	repositoryGitDir,
	sourceCommitSha
} = {}) {
	if (repositoryGitDir !== undefined || sourceCommitSha !== undefined) {
		invariant(
			typeof repositoryGitDir === 'string' && typeof sourceCommitSha === 'string',
			'--repository-git-dir and --source-commit-sha must be supplied together.'
		);
		return loadReleaseHypergraphFromGit(repositoryGitDir, sourceCommitSha);
	}
	const root = path.resolve(repoRoot, graphRoot ?? DEFAULT_HYPERGRAPH_ROOT);
	return {
		topology: readJson(path.join(root, 'topology.json')),
		tasks: readJson(path.join(root, 'nodes/tasks.json')),
		edges: Object.fromEntries(
			EDGE_FILES.map((kind) => [kind, readJson(path.join(root, `edges/${kind}.json`))])
		)
	};
}

/** @param {GraphEdge[]} edges */
function assertAcyclic(edges) {
	/** @type {Map<string, string[]>} */
	const adjacency = new Map();
	for (const edge of edges) {
		const targets = adjacency.get(edge.source) ?? [];
		targets.push(edge.target);
		adjacency.set(edge.source, targets);
	}

	const visiting = new Set();
	const visited = new Set();
	/** @param {string} node */
	function visit(node) {
		if (visiting.has(node)) throw new Error(`Release dependency cycle reaches ${node}.`);
		if (visited.has(node)) return;
		visiting.add(node);
		for (const target of adjacency.get(node) ?? []) visit(target);
		visiting.delete(node);
		visited.add(node);
	}
	for (const node of adjacency.keys()) visit(node);
}

/** @param {GraphTask} task */
function validateReadyProof(task) {
	const proof = task.proof;
	invariant(proof && typeof proof === 'object', `${task.id} is ready without a proof object.`);
	invariant(
		typeof proof.verifiedAt === 'string' &&
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(proof.verifiedAt),
		`${task.id} ready proof needs an ISO-8601 UTC verifiedAt timestamp.`
	);
	for (const field of READY_PROOF_ARRAYS) {
		invariant(nonEmptyStrings(proof[field]), `${task.id} ready proof needs non-empty ${field}.`);
	}
}

/**
 * @param {HypergraphDocuments} documents
 * @param {{ requireLaunchFoundationsReady?: boolean, requireLaunchFoundationsImplemented?: boolean, requireContainmentBootstrapSourceReady?: boolean }} [options]
 */
export function validateReleaseHypergraphDocuments(
	documents,
	{
		requireLaunchFoundationsReady = false,
		requireLaunchFoundationsImplemented = false,
		requireContainmentBootstrapSourceReady = false
	} = {}
) {
	invariant(
		[
			requireLaunchFoundationsReady,
			requireLaunchFoundationsImplemented,
			requireContainmentBootstrapSourceReady
		].filter(Boolean).length <= 1,
		'Release hypergraph strict modes are mutually exclusive.'
	);
	const { topology, tasks: taskDocument, edges: edgeDocuments } = documents;
	invariant(topology && typeof topology === 'object', 'Missing topology document.');
	invariant(taskDocument?.type === 'tasks', 'nodes/tasks.json must declare type=tasks.');
	invariant(Array.isArray(taskDocument.tasks), 'nodes/tasks.json must contain a tasks array.');

	const tasks = taskDocument.tasks;
	/** @type {Map<string, GraphTask>} */
	const taskById = new Map();
	const allowedStatuses = new Set(topology.statuses ?? []);
	const allowedNodeTypes = new Set(
		/** @type {Array<{ id: string }>} */ (topology.node_types ?? []).map((entry) => entry.id)
	);
	for (const task of tasks) {
		invariant(task && typeof task === 'object', 'Every task must be an object.');
		invariant(
			typeof task.id === 'string' && /^[A-Z]+-\d+[A-Z]?$/.test(task.id),
			`Invalid task id: ${String(task.id)}.`
		);
		invariant(!taskById.has(task.id), `Duplicate task id: ${task.id}.`);
		invariant(allowedNodeTypes.has(task.type), `${task.id} has unknown node type ${task.type}.`);
		invariant(allowedStatuses.has(task.status), `${task.id} has unknown status ${task.status}.`);
		for (const field of ['name', 'owner', 'description', 'acceptance']) {
			invariant(
				typeof task[field] === 'string' && task[field].trim().length > 0,
				`${task.id} is missing ${field}.`
			);
		}
		if (task.status === 'ready') {
			validateReadyProof(task);
			invariant(
				task.proofPending === undefined,
				`${task.id} is ready but still carries proofPending; external facts belong in externalEvidencePending and PD gates.`
			);
		}
		taskById.set(task.id, task);
	}

	/** @type {Array<GraphEdge & { kind: string }>} */
	const allEdges = [];
	/** @type {GraphEdge[]} */
	const dependencyEdges = [];
	const seenEdges = new Set();
	for (const kind of EDGE_FILES) {
		const document = edgeDocuments?.[kind];
		invariant(document?.type === kind, `edges/${kind}.json must declare type=${kind}.`);
		invariant(Array.isArray(document.edges), `edges/${kind}.json must contain an edges array.`);
		for (const edge of document.edges) {
			invariant(taskById.has(edge.source), `${kind} edge has unknown source ${edge.source}.`);
			invariant(taskById.has(edge.target), `${kind} edge has unknown target ${edge.target}.`);
			invariant(edge.source !== edge.target, `${kind} edge ${edge.source} cannot target itself.`);
			const key = `${kind}:${edge.source}:${edge.target}`;
			invariant(!seenEdges.has(key), `Duplicate edge ${key}.`);
			seenEdges.add(key);
			allEdges.push({ ...edge, kind });
			if (kind !== 'rollback') dependencyEdges.push(edge);
		}
	}
	assertAcyclic(dependencyEdges);

	const expectedStatistics = {
		nodes: tasks.length,
		release_nodes: tasks.filter((task) => !task.id.startsWith('RB-')).length,
		rollback_nodes: tasks.filter((task) => task.id.startsWith('RB-')).length,
		blocks_edges: edgeDocuments.blocks.edges.length,
		requires_edges: edgeDocuments.requires.edges.length,
		rollback_edges: edgeDocuments.rollback.edges.length
	};
	for (const [field, expected] of Object.entries(expectedStatistics)) {
		invariant(
			topology.statistics?.[field] === expected,
			`topology.statistics.${field} is ${String(topology.statistics?.[field])}; expected ${expected}.`
		);
	}

	for (const task of tasks.filter((candidate) => candidate.status === 'ready')) {
		const blockers = dependencyEdges.filter((edge) => edge.target === task.id);
		for (const edge of blockers) {
			invariant(
				taskById.get(edge.source)?.status === 'ready',
				`${task.id} cannot be ready while dependency ${edge.source} is ${taskById.get(edge.source)?.status}.`
			);
		}
	}

	const foundationTasks = tasks.filter(
		(task) => task.id.startsWith('FND-') && task.id !== 'FND-60'
	);
	for (const task of foundationTasks) {
		for (const kind of ['blocks', 'requires']) {
			invariant(
				edgeDocuments[kind].edges.some(
					(edge) => edge.source === task.id && edge.target === 'FND-60'
				),
				`${task.id} must have a ${kind} edge to FND-60.`
			);
		}
	}

	const launchProof = taskById.get('FND-60');
	invariant(launchProof, 'Missing FND-60 adversarial launch proof node.');
	// Review authority cannot live in the tree it approves. FND-60 stays open in
	// source S; a trusted release job separately verifies signed detached proof
	// commit A whose sole parent and reviewed-head fields are exactly S.
	invariant(
		launchProof.status === 'pending',
		'FND-60 must remain exactly pending in source; detached attestation supplies review authority.'
	);
	invariant(
		launchProof.proof === undefined,
		'FND-60 must not embed self-attested review proof in the source graph.'
	);

	const fixedSourceGateStatuses = new Map([
		['PD-05', 'operator_gate'],
		['PD-00', 'blocked_external'],
		['PD-10', 'pending'],
		['PD-20', 'operator_gate'],
		['PD-30', 'operator_gate'],
		['PD-40', 'operator_gate'],
		['PD-50', 'operator_gate'],
		['PD-60', 'operator_gate'],
		['PD-70', 'operator_gate']
	]);
	for (const [id, status] of fixedSourceGateStatuses) {
		invariant(
			taskById.get(id)?.status === status,
			`${id} must remain ${status} in source; only external operator evidence can advance it.`
		);
	}

	const exactSha = taskById.get('PD-10');
	invariant(exactSha, 'Missing PD-10 exact-SHA gate.');
	if (exactSha.status === 'ready') {
		invariant(
			/^[a-f0-9]{40}$/.test(exactSha.proof?.sha ?? ''),
			'PD-10 ready proof needs an exact 40-character lowercase Git SHA.'
		);
		invariant(
			exactSha.proof?.originContainsSha === true,
			'PD-10 ready proof must confirm the production branch contains the SHA.'
		);
	}

	if (requireLaunchFoundationsReady) {
		throw new Error(
			'--require-launch-foundations-ready is forbidden: source cannot self-attest FND-60; verify detached attestation A for exact source S.'
		);
	}
	if (requireLaunchFoundationsImplemented) {
		for (const task of foundationTasks) {
			invariant(task.status === 'ready', `${task.id} is not ready as a launch foundation.`);
		}
	}

	const containmentBootstrap = taskById.get('PD-05');
	const externalReactivation = taskById.get('PD-00');
	invariant(containmentBootstrap, 'Missing PD-05 containment bootstrap node.');
	invariant(externalReactivation, 'Missing PD-00 external reactivation node.');
	const containmentDependencies = dependencyEdges.filter((edge) => edge.target === 'PD-05');
	const containmentDependencyIds = new Set(containmentDependencies.map((edge) => edge.source));
	invariant(
		containmentDependencyIds.size === 2 &&
			containmentDependencyIds.has('FND-35C') &&
			containmentDependencyIds.has('FND-60'),
		'PD-05 must depend exactly on containment source FND-35C and detached review FND-60.'
	);
	for (const kind of ['blocks', 'requires']) {
		invariant(
			edgeDocuments[kind].edges.some((edge) => edge.source === 'PD-05' && edge.target === 'PD-00'),
			`PD-05 must have a ${kind} edge to PD-00.`
		);
	}

	const containmentSourceDependenciesReady = containmentDependencies.every(
		(edge) => edge.source === 'FND-60' || taskById.get(edge.source)?.status === 'ready'
	);
	const containmentBootstrapSourceReady =
		taskById.get('FND-35C')?.status === 'ready' &&
		(launchProof.status === 'pending' || launchProof.status === 'operator_gate') &&
		containmentSourceDependenciesReady &&
		containmentBootstrap.status === 'operator_gate' &&
		externalReactivation.status === 'blocked_external';
	if (requireContainmentBootstrapSourceReady) {
		invariant(
			taskById.get('FND-35C')?.status === 'ready',
			'FND-35C is not ready for containment bootstrap.'
		);
		for (const edge of containmentDependencies) {
			if (edge.source === 'FND-60') continue;
			invariant(
				taskById.get(edge.source)?.status === 'ready',
				`PD-05 dependency ${edge.source} is ${taskById.get(edge.source)?.status}; expected ready.`
			);
		}
		invariant(
			containmentBootstrap.status === 'operator_gate',
			`PD-05 must remain operator_gate before containment deployment; found ${containmentBootstrap.status}.`
		);
		invariant(
			externalReactivation.status === 'blocked_external',
			`PD-00 must remain blocked_external before containment deployment; found ${externalReactivation.status}.`
		);
	}

	return {
		nodes: tasks.length,
		edges: allEdges.length,
		ready: tasks.filter((task) => task.status === 'ready').map((task) => task.id),
		foundationsImplemented: foundationTasks.every((task) => task.status === 'ready'),
		launchProofState: launchProof.status,
		containmentBootstrapSourceReady
	};
}

/** @param {VerifyOptions} [options] */
export function verifyReleaseHypergraph(options = {}) {
	return validateReleaseHypergraphDocuments(loadReleaseHypergraph(options), options);
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const requireLaunchFoundationsReady = process.argv.includes(
			'--require-launch-foundations-ready'
		);
		const requireLaunchFoundationsImplemented = process.argv.includes(
			'--require-launch-foundations-implemented'
		);
		const requireContainmentBootstrapSourceReady = process.argv.includes(
			'--require-containment-bootstrap-source-ready'
		);
		const valueOptions = new Map();
		const booleanOptions = new Set([
			'--require-launch-foundations-ready',
			'--require-launch-foundations-implemented',
			'--require-containment-bootstrap-source-ready'
		]);
		for (let index = 2; index < process.argv.length; index += 1) {
			const argument = process.argv[index];
			if (booleanOptions.has(argument)) continue;
			if (argument === '--repository-git-dir' || argument === '--source-commit-sha') {
				invariant(!valueOptions.has(argument), `Duplicate argument: ${argument}.`);
				const value = process.argv[index + 1];
				invariant(value && !value.startsWith('--'), `${argument} requires a value.`);
				valueOptions.set(argument, value);
				index += 1;
				continue;
			}
			throw new Error(`Unknown argument: ${argument}.`);
		}
		const result = verifyReleaseHypergraph({
			repositoryGitDir: valueOptions.get('--repository-git-dir'),
			sourceCommitSha: valueOptions.get('--source-commit-sha'),
			requireLaunchFoundationsReady,
			requireLaunchFoundationsImplemented,
			requireContainmentBootstrapSourceReady
		});
		console.log(
			`Release hypergraph: ${result.nodes} nodes, ${result.edges} edges; ` +
				`${result.ready.length} ready; foundations=${result.foundationsImplemented ? 'implemented' : 'open'}; ` +
				`launch-proof=${result.launchProofState}-external; ` +
				`containment-source=${result.containmentBootstrapSourceReady ? 'ready' : 'held'}.`
		);
	} catch (error) {
		console.error(
			`Release hypergraph verification failed: ${error instanceof Error ? error.message : String(error)}`
		);
		process.exit(1);
	}
}
