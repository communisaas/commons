#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const RELEASE_AUTHORITY_BRANCH = 'main';
export const RELEASE_AUTHORITY_STATUS_CHECK = 'test';
// GitHub's public App record for github-actions is stable release authority.
// Pinning the provider closes the legacy status-context spoofing path where an
// unrelated App or commit-status writer reports the same context name.
export const RELEASE_AUTHORITY_STATUS_CHECK_APP_ID = 15368;
export const RELEASE_AUTHORITY_ENVIRONMENTS = Object.freeze(['Production', 'Staging']);

const MAX_STDIN_BYTES = 1024 * 1024;

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {Record<string, any> | null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** @param {unknown} value */
function enabled(value) {
	return value === true || record(value)?.enabled === true;
}

/** @param {unknown} value */
function disabled(value) {
	return value === false || record(value)?.enabled === false;
}

/** @param {unknown} value @param {string} label */
function requireEmptyActorSet(value, label) {
	const actors = record(value);
	invariant(actors !== null, `${label} must be an explicit actor object.`);
	invariant(
		JSON.stringify(Object.keys(actors).sort()) === JSON.stringify(['apps', 'teams', 'users']),
		`${label} must contain exactly users, teams, and apps.`
	);
	for (const actorType of ['users', 'teams', 'apps']) {
		invariant(
			Array.isArray(actors[actorType]) && actors[actorType].length === 0,
			`${label} must not contain any actor.`
		);
	}
}

/**
 * Pure verification of three GitHub REST responses fetched before a job may
 * request a credential-bearing Environment. Candidate source never selects
 * the environment, protected branch, status check, or policy interpretation.
 *
 * @param {{environmentName: unknown, environment: unknown, branchPolicies: unknown, branchProtection: unknown, protectedBranch?: unknown, requiredStatusCheck?: unknown}} input
 */
export function validateGitHubReleaseAuthority({
	environmentName,
	environment,
	branchPolicies,
	branchProtection,
	protectedBranch = RELEASE_AUTHORITY_BRANCH,
	requiredStatusCheck = RELEASE_AUTHORITY_STATUS_CHECK
}) {
	invariant(
		typeof environmentName === 'string' && RELEASE_AUTHORITY_ENVIRONMENTS.includes(environmentName),
		'Release authority environment must be exactly Production or Staging.'
	);
	invariant(
		protectedBranch === RELEASE_AUTHORITY_BRANCH,
		'Release authority branch must be the protected default branch main.'
	);
	invariant(
		requiredStatusCheck === RELEASE_AUTHORITY_STATUS_CHECK,
		'Release authority status check must be exactly test.'
	);

	const environmentRecord = record(environment);
	invariant(environmentRecord !== null, 'GitHub Environment response must be an object.');
	invariant(
		environmentRecord.name === environmentName,
		'GitHub Environment response does not match the selected release environment.'
	);
	invariant(
		environmentRecord.can_admins_bypass === false,
		'GitHub Environment must disable administrator protection-rule bypass.'
	);
	const protectionRules = environmentRecord.protection_rules;
	invariant(
		Array.isArray(protectionRules),
		'GitHub Environment protection_rules must be an array.'
	);
	const reviewerRules = protectionRules.filter(
		(rule) => record(rule)?.type === 'required_reviewers'
	);
	invariant(
		reviewerRules.length === 1,
		'GitHub Environment must have exactly one required-reviewers rule.'
	);
	const reviewerRule = record(reviewerRules[0]);
	invariant(
		reviewerRule?.prevent_self_review === true,
		'GitHub Environment required reviewers must prevent self-review.'
	);
	const reviewers = reviewerRule?.reviewers;
	invariant(
		Array.isArray(reviewers) && reviewers.length > 0,
		'GitHub Environment required-reviewers rule must contain at least one reviewer.'
	);
	const reviewerIds = new Set();
	for (const entry of reviewers) {
		const reviewerEntry = record(entry);
		const reviewer = record(reviewerEntry?.reviewer);
		invariant(
			reviewerEntry?.type === 'User' || reviewerEntry?.type === 'Team',
			'GitHub Environment reviewer identity is malformed.'
		);
		invariant(
			reviewer !== null && Number.isSafeInteger(reviewer.id) && reviewer.id > 0,
			'GitHub Environment reviewer identity is malformed.'
		);
		const identity = `${reviewerEntry.type}:${reviewer.id}`;
		invariant(!reviewerIds.has(identity), 'GitHub Environment reviewer identity is duplicated.');
		reviewerIds.add(identity);
	}
	const branchPolicyRules = protectionRules.filter(
		(rule) => record(rule)?.type === 'branch_policy'
	);
	invariant(
		branchPolicyRules.length === 1,
		'GitHub Environment must expose exactly one branch-policy protection rule.'
	);

	const deploymentBranchPolicy = record(environmentRecord.deployment_branch_policy);
	invariant(
		deploymentBranchPolicy?.protected_branches === false &&
			deploymentBranchPolicy?.custom_branch_policies === true,
		'GitHub Environment must use only explicit custom deployment branch policies.'
	);
	const branchPolicyResponse = record(branchPolicies);
	invariant(
		branchPolicyResponse !== null,
		'GitHub deployment branch policy response must be an object.'
	);
	const policies = branchPolicyResponse.branch_policies;
	invariant(Array.isArray(policies), 'GitHub deployment branch policies must be an array.');
	invariant(
		Number.isSafeInteger(branchPolicyResponse?.total_count) &&
			branchPolicyResponse.total_count === policies.length,
		'GitHub deployment branch policy count is inconsistent.'
	);
	invariant(
		policies.length === 1,
		'GitHub Environment must allow exactly one deployment branch policy.'
	);
	const policy = record(policies[0]);
	invariant(policy !== null, 'GitHub Environment deployment branch policy is malformed.');
	invariant(
		Number.isSafeInteger(policy.id) && policy.id > 0,
		'GitHub deployment branch policy id is malformed.'
	);
	invariant(
		policy?.name === protectedBranch && policy?.type === 'branch',
		'GitHub Environment deployment policy must target only the exact branch main.'
	);

	const branch = record(branchProtection);
	invariant(branch !== null, 'Protected-main response must be an object.');
	const requiredChecks = record(branch.required_status_checks);
	invariant(requiredChecks !== null, 'Protected main must require status checks.');
	invariant(requiredChecks.strict === true, 'Protected main status checks must be strict.');
	const contexts = requiredChecks.contexts;
	invariant(
		Array.isArray(contexts) &&
			contexts.length <= 16 &&
			contexts.every((context) => typeof context === 'string' && context.length > 0) &&
			new Set(contexts).size === contexts.length,
		'Protected main legacy status contexts must be bounded and unique.'
	);
	const checks = requiredChecks.checks;
	invariant(
		Array.isArray(checks) && checks.length >= 1 && checks.length <= 16,
		'Protected main must require one to sixteen app-bound status checks.'
	);
	/** @type {Record<string, any>[]} */
	const checkRecords = [];
	for (const rawCheck of checks) {
		const check = record(rawCheck);
		invariant(
			check !== null &&
				typeof check.context === 'string' &&
				check.context.length > 0 &&
				Number.isSafeInteger(check.app_id) &&
				check.app_id > 0,
			'Protected main app-bound status check identity is malformed.'
		);
		checkRecords.push(check);
	}
	const checkContexts = checkRecords.map((check) => check.context);
	invariant(
		new Set(checkContexts).size === checkContexts.length,
		'Protected main app-bound status check contexts must be unique across Apps.'
	);
	invariant(
		contexts.every((context) => checkContexts.includes(context)),
		'Protected main contains a legacy context without an app-bound check.'
	);
	const releaseChecks = checkRecords.filter((check) => check.context === requiredStatusCheck);
	invariant(
		releaseChecks.length === 1 &&
			releaseChecks[0]?.app_id === RELEASE_AUTHORITY_STATUS_CHECK_APP_ID,
		'Protected main must bind the exact test status check to the GitHub Actions App.'
	);
	const pullRequestReviews = record(branch.required_pull_request_reviews);
	invariant(
		pullRequestReviews !== null,
		'Protected main must require at least one approving pull-request review.'
	);
	invariant(
		Number.isSafeInteger(pullRequestReviews.required_approving_review_count) &&
			pullRequestReviews.required_approving_review_count >= 1,
		'Protected main must require at least one approving pull-request review.'
	);
	invariant(
		pullRequestReviews.dismiss_stale_reviews === true,
		'Protected main must dismiss stale pull-request approvals after every new push.'
	);
	invariant(
		pullRequestReviews.require_last_push_approval === true,
		'Protected main must require the last push to be approved by someone other than its pusher.'
	);
	invariant(
		pullRequestReviews.require_code_owner_reviews === true,
		'Protected main must require approval from a CODEOWNER.'
	);
	requireEmptyActorSet(
		pullRequestReviews.bypass_pull_request_allowances,
		'Protected main pull-request bypass allowances'
	);
	requireEmptyActorSet(
		pullRequestReviews.dismissal_restrictions,
		'Protected main review dismissal restrictions'
	);
	invariant(
		enabled(branch.required_conversation_resolution),
		'Protected main must resolve conversations.'
	);
	invariant(
		enabled(branch.enforce_admins),
		'Protected main protections must apply to administrators.'
	);
	invariant(disabled(branch.allow_force_pushes), 'Protected main must disable force pushes.');
	invariant(disabled(branch.allow_deletions), 'Protected main must disable deletion.');

	return {
		schemaVersion: 1,
		environment: environmentName,
		administratorBypass: false,
		reviewerCount: reviewers.length,
		deploymentBranches: [protectedBranch],
		protectedBranch,
		requiredStatusChecks: checkContexts,
		requiredStatusCheckAppId: RELEASE_AUTHORITY_STATUS_CHECK_APP_ID,
		requiredApprovals: pullRequestReviews.required_approving_review_count,
		codeOwnerApproval: true,
		dismissStaleApprovals: true,
		requireLastPushApproval: true,
		pullRequestBypassActors: 0,
		reviewDismissalActors: 0,
		conversationResolution: true,
		administratorEnforcement: true
	};
}

/** @param {string[]} argv */
export function parseGitHubReleaseAuthorityArgs(argv) {
	let environmentName;
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		invariant(flag === '--environment', `Unknown argument: ${flag}`);
		invariant(environmentName === undefined, '--environment may be supplied only once.');
		environmentName = argv[index + 1];
		invariant(
			environmentName !== undefined && !environmentName.startsWith('--'),
			'--environment requires a value.'
		);
		index += 1;
	}
	invariant(
		typeof environmentName === 'string' && RELEASE_AUTHORITY_ENVIRONMENTS.includes(environmentName),
		'--environment must be exactly Production or Staging.'
	);
	return { environmentName };
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const { environmentName } = parseGitHubReleaseAuthorityArgs(process.argv.slice(2));
		const input = readFileSync(0);
		invariant(input.byteLength <= MAX_STDIN_BYTES, 'GitHub release authority input is too large.');
		const envelope = JSON.parse(input.toString('utf8'));
		const result = validateGitHubReleaseAuthority({
			environmentName,
			environment: envelope?.environment,
			branchPolicies: envelope?.branchPolicies,
			branchProtection: envelope?.branchProtection
		});
		console.log(JSON.stringify(result));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
