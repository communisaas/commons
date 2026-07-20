#!/usr/bin/env node

import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';
const PUBLIC_TEMPLATE_OG_RELEASE_REPOSITORY = 'communisaas/commons';
const PUBLIC_TEMPLATE_OG_RELEASE_REPOSITORY_ID = '599295397';
const WORKFLOW_NAME = 'Deploy to Cloudflare Pages';
const WORKFLOW_PATH = '.github/workflows/deploy.yml';
const DEFAULT_BRANCH = 'main';
const MAX_EVENT_BYTES = 1024 * 1024;
const POSITIVE_DECIMAL = /^[1-9][0-9]{0,19}$/u;

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {Record<string,any>|null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** @param {string} runId @param {string} runAttempt */
function releaseTransactionId(runId, runAttempt) {
	invariant(POSITIVE_DECIMAL.test(runId), 'Source workflow run id is invalid.');
	invariant(/^[1-9][0-9]{0,9}$/u.test(runAttempt), 'Source workflow run attempt is invalid.');
	return `${runId}-${runAttempt}`;
}

/** @param {string} eventPath */
function readEvent(eventPath) {
	const target = path.resolve(eventPath);
	const stat = lstatSync(target);
	invariant(
		stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= MAX_EVENT_BYTES,
		'Recovery event payload must be a bounded ordinary file.'
	);
	try {
		return JSON.parse(readFileSync(target, 'utf8'));
	} catch {
		throw new Error('Recovery event payload is not JSON.');
	}
}

/**
 * @param {{eventName:'workflow_run'|'workflow_dispatch',event:unknown,manualRunId?:string,manualRunAttempt?:string,manualRealm?:'all'|'preview'|'production',githubToken:string,fetchFn?:typeof fetch}} input
 */
export async function resolvePublicTemplateOgReleaseRecoveryRun({
	eventName,
	event,
	manualRunId,
	manualRunAttempt,
	manualRealm,
	githubToken,
	fetchFn = fetch
}) {
	invariant(
		eventName === 'workflow_run' || eventName === 'workflow_dispatch',
		'Recovery trigger is invalid.'
	);
	invariant(typeof githubToken === 'string' && githubToken.length > 0, 'GitHub token is required.');
	const payload = record(event);
	invariant(payload !== null, 'Recovery event is invalid.');
	const automatic = eventName === 'workflow_run';
	const workflowRun = automatic ? record(payload.workflow_run) : null;
	const runId = automatic ? String(workflowRun?.id ?? '') : String(manualRunId ?? '');
	const runAttempt = automatic
		? String(workflowRun?.run_attempt ?? '')
		: String(manualRunAttempt ?? '');
	const transactionId = releaseTransactionId(runId, runAttempt);
	const realm = automatic ? 'all' : manualRealm;
	invariant(
		realm === 'all' || realm === 'preview' || realm === 'production',
		'Recovery realm selection is invalid.'
	);
	const response = await fetchFn(
		`https://api.github.com/repos/${PUBLIC_TEMPLATE_OG_RELEASE_REPOSITORY}/actions/runs/${runId}/attempts/${runAttempt}`,
		{
			headers: {
				Accept: 'application/vnd.github+json',
				Authorization: `Bearer ${githubToken}`,
				'X-GitHub-Api-Version': '2022-11-28'
			},
			redirect: 'error',
			signal: AbortSignal.timeout(20_000)
		}
	);
	invariant(
		response.ok && response.status === 200,
		`Source workflow attempt returned HTTP ${response.status}.`
	);
	const run = record(
		await readBoundedResponseJson(response, 'Source workflow attempt', 256 * 1024)
	);
	const repository = record(run?.repository);
	const headRepository = record(run?.head_repository);
	invariant(
		String(run?.id) === runId &&
			String(run?.run_attempt) === runAttempt &&
			run?.name === WORKFLOW_NAME &&
			run?.path === WORKFLOW_PATH &&
			run?.head_branch === DEFAULT_BRANCH &&
			run?.status === 'completed' &&
			typeof run?.conclusion === 'string' &&
			run.conclusion.length > 0 &&
			(run.event === 'workflow_dispatch' || run.event === 'workflow_run') &&
			typeof run?.head_sha === 'string' &&
			/^[a-f0-9]{40}$/u.test(run.head_sha) &&
			repository?.full_name === PUBLIC_TEMPLATE_OG_RELEASE_REPOSITORY &&
			String(repository.id) === PUBLIC_TEMPLATE_OG_RELEASE_REPOSITORY_ID &&
			headRepository?.full_name === PUBLIC_TEMPLATE_OG_RELEASE_REPOSITORY &&
			String(headRepository.id) === PUBLIC_TEMPLATE_OG_RELEASE_REPOSITORY_ID,
		'Source workflow attempt is not the exact protected deploy run.'
	);
	if (automatic) {
		invariant(
			workflowRun?.name === run.name &&
				workflowRun?.path === run.path &&
				workflowRun?.head_sha === run.head_sha &&
				workflowRun?.head_branch === run.head_branch &&
				workflowRun?.status === run.status &&
				workflowRun?.conclusion === run.conclusion &&
				record(workflowRun?.repository)?.full_name === repository.full_name &&
				String(record(workflowRun?.repository)?.id) === String(repository.id) &&
				record(workflowRun?.head_repository)?.full_name === headRepository.full_name &&
				String(record(workflowRun?.head_repository)?.id) === String(headRepository.id),
			'workflow_run payload crossed the source attempt API record.'
		);
	}
	return {
		repository: PUBLIC_TEMPLATE_OG_RELEASE_REPOSITORY,
		repositoryId: PUBLIC_TEMPLATE_OG_RELEASE_REPOSITORY_ID,
		runId,
		runAttempt,
		transactionId,
		realm,
		trustedGateSha: run.head_sha,
		conclusion: run.conclusion,
		force: !automatic || run.conclusion !== 'success'
	};
}

/** @param {string[]} argv */
function parseArgs(argv) {
	const flags = ['--event-name', '--event-path', '--run-id', '--run-attempt', '--realm'];
	const allowed = new Set(flags);
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		invariant(
			allowed.has(flag) && value && !value.startsWith('--') && !values.has(flag),
			`Invalid recovery resolver argument: ${flag}.`
		);
		values.set(flag, value);
	}
	invariant(values.size === flags.length, 'Every recovery resolver argument is required.');
	return Object.fromEntries(flags.map((flag) => [flag.slice(2), values.get(flag)]));
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const args = parseArgs(process.argv.slice(2));
		const result = await resolvePublicTemplateOgReleaseRecoveryRun({
			eventName: args['event-name'],
			event: readEvent(args['event-path']),
			manualRunId: args['run-id'] === 'automatic' ? undefined : args['run-id'],
			manualRunAttempt: args['run-attempt'] === 'automatic' ? undefined : args['run-attempt'],
			manualRealm: args.realm === 'automatic' ? undefined : args.realm,
			githubToken: process.env.GITHUB_TOKEN
		});
		console.log(JSON.stringify(result));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
