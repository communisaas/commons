#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const BRUTALIST_AUTHORITY_REPOSITORY = Object.freeze({
	id: 599295397,
	slug: 'communisaas/commons',
	ownerId: 90685635,
	ownerLogin: 'communisaas',
	protectedBranch: 'main'
});
export const GITHUB_ACTIONS_APP_ID = 15368;
export const BRUTALIST_AUTHORITY_CHECK_NAME = 'Commons Brutalist Launch Authority';
export const BRUTALIST_AUTHORITY_PROTOCOL = 'commons-brutalist-authority-v1';
export const BRUTALIST_SIGNATURE_NAMESPACE = 'commons-brutalist-launch-v1';
export const BRUTALIST_PROOF_REF_PREFIX = 'brutalist-attestations/';
export const LAUNCH_SOURCE_AUTHOR_USER_IDS = Object.freeze([19658882]);
export const REQUIRED_BRUTALIST_CODEOWNER_PATHS = Object.freeze([
	'.github/CODEOWNERS',
	'.github/brutalist-allowed-signers',
	'.github/paid-provider-posture-allowed-signers',
	'.github/workflows/brutalist-review.yml',
	'.github/workflows/deploy.yml',
	'.github/workflows/public-template-og-release-recovery.yml',
	'config/brutalist-review-authority.json',
	'config/paid-provider-account-authority.json',
	'docs/strategy/public-discovery-release-hypergraph/docs/BRUTALIST-ATTESTATION.md',
	'scripts/finalize-brutalist-launch-review.mjs',
	'scripts/materialize-paid-provider-pages-secrets.mjs',
	'scripts/paid-provider-account-posture.mjs',
	'scripts/run-public-template-og-release-phase.mjs',
	'scripts/run-brutalist-launch-review.mjs',
	'scripts/sign-brutalist-evidence.mjs',
	'scripts/sign-paid-provider-account-posture.mjs',
	'scripts/verify-brutalist-attestation.mjs',
	'scripts/verify-brutalist-review-authority.mjs',
	'scripts/verify-paid-provider-account-posture.mjs',
	'scripts/verify-pages-containment-bindings.mjs',
	'scripts/verify-pages-durable-object-binding.mjs',
	'scripts/verify-convex-work-budget-deployment.mjs',
	'scripts/verify-release-gate-blobs.mjs'
]);

const SHA_RE = /^[a-f0-9]{40}$/u;
const FINGERPRINT_RE = /^SHA256:[A-Za-z0-9+/]{43}$/u;
const PRINCIPAL_RE = /^[A-Za-z0-9._@+-]{1,120}$/u;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/u;
const EXPECTED_APP_PERMISSIONS = Object.freeze({
	checks: 'write',
	contents: 'read',
	metadata: 'read',
	pull_requests: 'read'
});
const EXPECTED_APP_EVENTS = Object.freeze(['check_suite', 'pull_request', 'push']);
const MAX_STDIN_BYTES = 2 * 1024 * 1024;
const MAX_POLICY_BYTES = 128 * 1024;

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {Record<string, any> | null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** @param {unknown} left @param {unknown} right */
function sameJson(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

/** @param {unknown} left @param {readonly string[]} right */
function sameStringSet(left, right) {
	return (
		Array.isArray(left) &&
		left.every((value) => typeof value === 'string') &&
		new Set(left).size === left.length &&
		sameJson([...left].sort(), [...right].sort())
	);
}

/** @param {unknown} value @param {readonly string[]} keys @param {string} label */
function requireExactKeys(value, keys, label) {
	const item = record(value);
	invariant(item !== null, `${label} must be an object.`);
	invariant(
		sameJson(Object.keys(item).sort(), [...keys].sort()),
		`${label} has missing or unexpected fields.`
	);
	return item;
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
	const actors = requireExactKeys(value, ['apps', 'teams', 'users'], label);
	for (const kind of ['apps', 'teams', 'users']) {
		invariant(Array.isArray(actors[kind]) && actors[kind].length === 0, `${label} is not empty.`);
	}
}

/** @param {Buffer} bytes */
function sshEd25519Fingerprint(bytes) {
	let offset = 0;
	const readField = () => {
		invariant(offset + 4 <= bytes.length, 'Allowed signer key blob is truncated.');
		const length = bytes.readUInt32BE(offset);
		offset += 4;
		invariant(offset + length <= bytes.length, 'Allowed signer key blob is truncated.');
		const field = bytes.subarray(offset, offset + length);
		offset += length;
		return field;
	};
	invariant(readField().toString('ascii') === 'ssh-ed25519', 'Allowed signer is not Ed25519.');
	invariant(readField().length === 32, 'Allowed signer Ed25519 public key has the wrong size.');
	invariant(offset === bytes.length, 'Allowed signer key blob has trailing data.');
	return `SHA256:${createHash('sha256').update(bytes).digest('base64').replace(/=+$/u, '')}`;
}

/** @param {string} contents */
export function parseSingleBrutalistAllowedSigner(contents) {
	invariant(
		typeof contents === 'string' && Buffer.byteLength(contents) <= MAX_POLICY_BYTES,
		'Allowed-signers policy is missing or too large.'
	);
	const active = contents
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith('#'));
	invariant(
		active.length === 1,
		'Exactly one independently enrolled Brutalist signer is required.'
	);
	const match =
		/^([A-Za-z0-9._@+-]{1,120}) namespaces="commons-brutalist-launch-v1" ssh-ed25519 ([A-Za-z0-9+/]+={0,2})$/u.exec(
			active[0]
		);
	invariant(
		match,
		'Brutalist allowed signer must use the exact principal, namespace, and Ed25519 format.'
	);
	const keyBytes = Buffer.from(match[2], 'base64');
	invariant(
		keyBytes.toString('base64') === match[2],
		'Allowed signer public key is not canonical base64.'
	);
	return {
		principal: match[1],
		namespace: BRUTALIST_SIGNATURE_NAMESPACE,
		keyFingerprint: sshEd25519Fingerprint(keyBytes)
	};
}

/** @param {unknown} config */
export function validateBrutalistAuthorityConfig(config) {
	const root = requireExactKeys(
		config,
		[
			'authoritativeCheck',
			'codeOwnerTeam',
			'diagnostic',
			'enrollmentState',
			'proofRef',
			'repository',
			'requiredCodeOwnerPaths',
			'schemaVersion',
			'separation',
			'signer'
		],
		'Brutalist authority config'
	);
	invariant(root.schemaVersion === 1, 'Brutalist authority config must use schemaVersion=1.');
	invariant(
		root.enrollmentState === 'enrolled',
		'Brutalist authority is pending independent App, CODEOWNER team, and signer enrollment.'
	);
	const repository = requireExactKeys(
		root.repository,
		['id', 'ownerId', 'ownerLogin', 'protectedBranch', 'slug'],
		'Brutalist repository identity'
	);
	invariant(
		sameJson(repository, BRUTALIST_AUTHORITY_REPOSITORY),
		'Brutalist authority repository identity is not the pinned Commons repository.'
	);
	const diagnostic = requireExactKeys(
		root.diagnostic,
		['githubActionsAppId', 'workflowName'],
		'Brutalist diagnostic identity'
	);
	invariant(
		diagnostic.githubActionsAppId === GITHUB_ACTIONS_APP_ID &&
			diagnostic.workflowName === 'Brutalist Review (diagnostic)',
		'Brutalist diagnostic identity drifted.'
	);
	const check = requireExactKeys(
		root.authoritativeCheck,
		[
			'appId',
			'appOwnerId',
			'appSlug',
			'detailsUrlOrigin',
			'events',
			'name',
			'permissions',
			'protocol'
		],
		'Brutalist authoritative check'
	);
	invariant(
		check.name === BRUTALIST_AUTHORITY_CHECK_NAME,
		'Brutalist authoritative check name drifted.'
	);
	invariant(
		check.protocol === BRUTALIST_AUTHORITY_PROTOCOL,
		'Brutalist authority protocol drifted.'
	);
	invariant(
		Number.isSafeInteger(check.appId) && check.appId > 0,
		'Brutalist authority App ID is not enrolled.'
	);
	invariant(
		check.appId !== GITHUB_ACTIONS_APP_ID,
		'The GitHub Actions App cannot own authoritative Brutalist approval.'
	);
	invariant(
		typeof check.appSlug === 'string' && SLUG_RE.test(check.appSlug),
		'Brutalist authority App slug is not enrolled.'
	);
	invariant(
		Number.isSafeInteger(check.appOwnerId) && check.appOwnerId > 0,
		'Brutalist authority App owner is not enrolled.'
	);
	let detailsOrigin;
	try {
		detailsOrigin = new URL(check.detailsUrlOrigin);
	} catch {
		throw new Error('Brutalist authority details URL origin is not enrolled.');
	}
	invariant(
		detailsOrigin.protocol === 'https:' && detailsOrigin.origin === check.detailsUrlOrigin,
		'Brutalist authority details URL must be one exact HTTPS origin.'
	);
	invariant(
		sameJson(check.permissions, EXPECTED_APP_PERMISSIONS),
		'Brutalist authority App permissions are not least-privilege exact.'
	);
	invariant(
		sameJson(check.events, EXPECTED_APP_EVENTS),
		'Brutalist authority App events are not exact.'
	);

	const team = requireExactKeys(
		root.codeOwnerTeam,
		['id', 'memberUserIds', 'repositoryRole', 'slug'],
		'Brutalist CODEOWNER team'
	);
	invariant(
		Number.isSafeInteger(team.id) && team.id > 0,
		'Independent Brutalist CODEOWNER team is not enrolled.'
	);
	invariant(
		typeof team.slug === 'string' && SLUG_RE.test(team.slug),
		'Independent Brutalist CODEOWNER team slug is not enrolled.'
	);
	invariant(
		Array.isArray(team.memberUserIds) &&
			team.memberUserIds.length >= 1 &&
			team.memberUserIds.length <= 16,
		'Brutalist CODEOWNER team must pin one to sixteen independent members.'
	);
	invariant(
		team.memberUserIds.every((id) => Number.isSafeInteger(id) && id > 0),
		'Brutalist CODEOWNER member IDs are malformed.'
	);
	invariant(
		new Set(team.memberUserIds).size === team.memberUserIds.length,
		'Brutalist CODEOWNER member IDs are duplicated.'
	);
	invariant(
		team.repositoryRole === 'write',
		'Independent Brutalist CODEOWNER team must have exact write-only repository access.'
	);

	const signer = requireExactKeys(
		root.signer,
		['githubUserId', 'keyFingerprint', 'namespace', 'principal'],
		'Brutalist signer'
	);
	invariant(
		typeof signer.principal === 'string' && PRINCIPAL_RE.test(signer.principal),
		'Brutalist signer principal is not enrolled.'
	);
	invariant(
		Number.isSafeInteger(signer.githubUserId) && signer.githubUserId > 0,
		'Brutalist signer GitHub identity is not enrolled.'
	);
	invariant(
		typeof signer.keyFingerprint === 'string' && FINGERPRINT_RE.test(signer.keyFingerprint),
		'Brutalist signer fingerprint is not enrolled.'
	);
	invariant(
		signer.namespace === BRUTALIST_SIGNATURE_NAMESPACE,
		'Brutalist signer namespace drifted.'
	);
	invariant(
		!team.memberUserIds.includes(signer.githubUserId),
		'Offline signer must be separate from every CODEOWNER reviewer.'
	);
	invariant(
		check.appOwnerId !== signer.githubUserId,
		'Offline signer must not own the authoritative review App.'
	);
	const separation = requireExactKeys(
		root.separation,
		['launchSourceAuthorUserIds'],
		'Brutalist identity-separation policy'
	);
	invariant(
		sameJson(separation.launchSourceAuthorUserIds, LAUNCH_SOURCE_AUTHOR_USER_IDS),
		'Brutalist launch source-author identity closure drifted.'
	);
	invariant(
		LAUNCH_SOURCE_AUTHOR_USER_IDS.every(
			(userId) => !team.memberUserIds.includes(userId) && signer.githubUserId !== userId
		),
		'Launch source author must be separate from every CODEOWNER reviewer and the offline signer.'
	);

	const proofRef = requireExactKeys(
		root.proofRef,
		['allowDeletions', 'allowForcePushes', 'prefix', 'requireAdministratorEnforcement'],
		'Brutalist proof-ref policy'
	);
	invariant(
		proofRef.prefix === BRUTALIST_PROOF_REF_PREFIX &&
			proofRef.requireAdministratorEnforcement === true &&
			proofRef.allowForcePushes === false &&
			proofRef.allowDeletions === false,
		'Brutalist proof-ref immutability policy drifted.'
	);
	invariant(
		sameJson(root.requiredCodeOwnerPaths, REQUIRED_BRUTALIST_CODEOWNER_PATHS),
		'Brutalist CODEOWNER path closure drifted.'
	);
	return root;
}

/** @param {string} contents @param {Record<string, any>} config */
export function validateBrutalistCodeowners(contents, config) {
	invariant(
		typeof contents === 'string' && Buffer.byteLength(contents) <= MAX_POLICY_BYTES,
		'CODEOWNERS is missing or too large.'
	);
	const owner = `@${config.repository.ownerLogin}/${config.codeOwnerTeam.slug}`;
	const requiredSuffix = REQUIRED_BRUTALIST_CODEOWNER_PATHS.map(
		(requiredPath) => `/${requiredPath} ${owner}`
	);
	const active = contents
		.split(/\r?\n/u)
		.map((line) => line.trim().replace(/\s+/gu, ' '))
		.filter((line) => line && !line.startsWith('#'));
	invariant(
		active.length >= requiredSuffix.length,
		'CODEOWNERS does not cover the Brutalist trust root.'
	);
	invariant(
		sameJson(active.slice(-requiredSuffix.length), requiredSuffix),
		'Brutalist trust-root paths must be the final exact CODEOWNERS rules owned only by the enrolled independent team.'
	);
	return { owner, paths: [...REQUIRED_BRUTALIST_CODEOWNER_PATHS] };
}

/** @param {Record<string, any>} branch @param {Record<string, any>} config */
function validateMainProtection(branch, config) {
	const requiredChecks = record(branch.required_status_checks);
	invariant(requiredChecks !== null, 'Protected main status checks are missing.');
	invariant(
		requiredChecks.strict === true,
		'Protected main status checks must require the latest base.'
	);
	invariant(Array.isArray(requiredChecks.checks), 'Protected main app-bound checks are missing.');
	/** @type {Record<string, any>[]} */
	const checks = [];
	for (const rawCheck of requiredChecks.checks) {
		const check = record(rawCheck);
		invariant(check !== null, 'Protected main app-bound check is malformed.');
		checks.push(check);
	}
	const identities = checks.map((entry) => `${entry.context}:${entry.app_id}`);
	invariant(
		new Set(identities).size === identities.length,
		'Protected main app-bound checks are duplicated.'
	);
	invariant(
		checks.filter((entry) => entry.context === 'test' && entry.app_id === GITHUB_ACTIONS_APP_ID)
			.length === 1,
		'Protected main must retain the exact GitHub Actions test check.'
	);
	invariant(
		checks.filter(
			(entry) =>
				entry.context === config.authoritativeCheck.name &&
				entry.app_id === config.authoritativeCheck.appId
		).length === 1,
		'Protected main must require the exact distinct-App Brutalist authority check.'
	);
	invariant(
		checks.filter((entry) => entry.context === config.authoritativeCheck.name).length === 1,
		'Brutalist authority context is ambiguous across Apps.'
	);
	const contexts = requiredChecks.contexts;
	invariant(
		Array.isArray(contexts) && new Set(contexts).size === contexts.length,
		'Protected main legacy status contexts are malformed.'
	);
	invariant(
		contexts.every((context) => checks.some((entry) => entry.context === context)),
		'Protected main contains an unbound legacy status context.'
	);
	const reviews = record(branch.required_pull_request_reviews);
	invariant(
		reviews !== null &&
			Number.isSafeInteger(reviews.required_approving_review_count) &&
			reviews.required_approving_review_count >= 1,
		'Protected main must require an approving pull-request review.'
	);
	invariant(
		reviews.require_code_owner_reviews === true,
		'Protected main must require CODEOWNER approval.'
	);
	invariant(reviews.dismiss_stale_reviews === true, 'Protected main must dismiss stale approvals.');
	invariant(
		reviews.require_last_push_approval === true,
		'Protected main must require independent approval after the latest push.'
	);
	requireEmptyActorSet(
		reviews.bypass_pull_request_allowances,
		'Protected main pull-request bypass allowances'
	);
	requireEmptyActorSet(
		reviews.dismissal_restrictions,
		'Protected main review dismissal restrictions'
	);
	invariant(
		enabled(branch.enforce_admins),
		'Protected main protections must apply to administrators.'
	);
	invariant(
		enabled(branch.required_conversation_resolution),
		'Protected main must require conversation resolution.'
	);
	invariant(disabled(branch.allow_force_pushes), 'Protected main must disable force pushes.');
	invariant(disabled(branch.allow_deletions), 'Protected main must disable deletion.');
}

/** @param {Record<string, any>} protection */
function validateProofProtection(protection) {
	invariant(
		enabled(protection.enforce_admins),
		'Attestation-ref protection must apply to administrators.'
	);
	invariant(disabled(protection.allow_force_pushes), 'Attestation refs must disable force pushes.');
	invariant(disabled(protection.allow_deletions), 'Attestation refs must disable deletion.');
}

/** @param {Record<string, any>} config @param {string} headSha @param {string} proofSha @param {Record<string, any>} attestation */
export function buildBrutalistAuthorityAssertion(config, headSha, proofSha, attestation) {
	return {
		schemaVersion: 1,
		protocol: BRUTALIST_AUTHORITY_PROTOCOL,
		repositoryId: config.repository.id,
		reviewedHeadSha: headSha,
		proofCommitSha: proofSha,
		operatorPrincipal: attestation.operatorPrincipal,
		signerKeyFingerprint: attestation.signerKeyFingerprint,
		codeOwnerTeamId: config.codeOwnerTeam.id
	};
}

/**
 * Verify live independent authority after the cryptographic proof itself has
 * passed `verify-brutalist-attestation.mjs`. API responses are inert JSON.
 *
 * @param {{config:unknown;codeowners:string;allowedSigners:string;repository:unknown;branchProtection:unknown;proofBranch:unknown;proofBranchProtection:unknown;authorityApp:unknown;codeOwnerTeam:unknown;codeOwnerTeamMembers:unknown;codeOwnerTeamRepository:unknown;checkRuns:unknown;attestation:unknown;expectedHeadSha:string;expectedProofSha:string;now?:Date}} input
 */
export function validateBrutalistReviewAuthority(input) {
	invariant(SHA_RE.test(input.expectedHeadSha), 'Expected reviewed head SHA is invalid.');
	invariant(SHA_RE.test(input.expectedProofSha), 'Expected proof commit SHA is invalid.');
	const config = validateBrutalistAuthorityConfig(input.config);
	const signer = parseSingleBrutalistAllowedSigner(input.allowedSigners);
	invariant(
		signer.principal === config.signer.principal &&
			signer.namespace === config.signer.namespace &&
			signer.keyFingerprint === config.signer.keyFingerprint,
		'Allowed signer does not match the independently enrolled signer identity.'
	);
	validateBrutalistCodeowners(input.codeowners, config);

	const repository = record(input.repository);
	invariant(repository !== null, 'Live GitHub repository identity is missing.');
	invariant(
		repository.id === config.repository.id &&
			repository.full_name === config.repository.slug &&
			repository.default_branch === config.repository.protectedBranch &&
			repository.owner?.id === config.repository.ownerId &&
			repository.owner?.login === config.repository.ownerLogin,
		'Live GitHub repository identity drifted.'
	);
	validateMainProtection(record(input.branchProtection) ?? {}, config);

	const proofBranchName = `${config.proofRef.prefix}${input.expectedHeadSha}`;
	const proofBranch = record(input.proofBranch);
	invariant(
		proofBranch?.name === proofBranchName && proofBranch.commit?.sha === input.expectedProofSha,
		'Live attestation ref does not resolve to the exact verified proof commit.'
	);
	validateProofProtection(record(input.proofBranchProtection) ?? {});

	const app = record(input.authorityApp);
	invariant(app !== null, 'Live Brutalist authority App identity is missing.');
	invariant(
		app.id === config.authoritativeCheck.appId &&
			app.slug === config.authoritativeCheck.appSlug &&
			app.owner?.id === config.authoritativeCheck.appOwnerId &&
			app.owner?.type === 'Organization',
		'Live Brutalist authority App identity drifted.'
	);
	const appPermissions = requireExactKeys(
		app.permissions,
		Object.keys(EXPECTED_APP_PERMISSIONS),
		'Live Brutalist authority App permissions'
	);
	invariant(
		Object.entries(EXPECTED_APP_PERMISSIONS).every(
			([permission, access]) => appPermissions[permission] === access
		),
		'Live Brutalist authority App permissions drifted.'
	);
	invariant(
		sameStringSet(app.events, config.authoritativeCheck.events),
		'Live Brutalist authority App webhook events drifted.'
	);

	const team = record(input.codeOwnerTeam);
	invariant(team !== null, 'Live independent CODEOWNER team identity is missing.');
	invariant(
		team.id === config.codeOwnerTeam.id &&
			team.slug === config.codeOwnerTeam.slug &&
			team.privacy === 'closed' &&
			team.organization?.id === config.repository.ownerId &&
			team.organization?.login === config.repository.ownerLogin,
		'Live independent CODEOWNER team identity drifted.'
	);
	const teamMembers = input.codeOwnerTeamMembers;
	invariant(Array.isArray(teamMembers), 'Live CODEOWNER team members are missing.');
	const memberIds = teamMembers.map((member) => record(member)?.id);
	invariant(
		teamMembers.every(
			(member) => record(member)?.type === 'User' && record(member)?.site_admin === false
		) &&
			sameJson(
				[...memberIds].sort((a, b) => a - b),
				[...config.codeOwnerTeam.memberUserIds].sort((a, b) => a - b)
			),
		'Live CODEOWNER team membership is not the exact enrolled independent set.'
	);
	invariant(
		!memberIds.includes(config.signer.githubUserId),
		'Offline signer is a member of the CODEOWNER reviewer team.'
	);
	const teamRepository = record(input.codeOwnerTeamRepository);
	invariant(
		teamRepository !== null &&
			teamRepository.id === config.repository.id &&
			teamRepository.full_name === config.repository.slug &&
			teamRepository.role_name === config.codeOwnerTeam.repositoryRole &&
			teamRepository.permissions?.pull === true &&
			teamRepository.permissions?.triage === true &&
			teamRepository.permissions?.push === true &&
			teamRepository.permissions?.maintain === false &&
			teamRepository.permissions?.admin === false,
		'Independent CODEOWNER team must have exact write-only access to the Commons repository.'
	);

	const attestation = record(input.attestation);
	invariant(
		attestation?.schemaVersion === 3 &&
			attestation.reviewedHeadSha === input.expectedHeadSha &&
			attestation.operatorPrincipal === config.signer.principal &&
			attestation.signerKeyFingerprint === config.signer.keyFingerprint,
		'Verified attestation is not bound to the enrolled signer and exact source head.'
	);
	invariant(
		attestation.findings?.openP0 === 0 && attestation.findings?.openP1 === 0,
		'Verified attestation still has launch-severity findings.'
	);

	const checkRuns = record(input.checkRuns);
	invariant(checkRuns !== null, 'Distinct-App Brutalist authority check response is missing.');
	invariant(
		Number.isSafeInteger(checkRuns.total_count) &&
			checkRuns.total_count === 1 &&
			Array.isArray(checkRuns.check_runs) &&
			checkRuns.check_runs.length === 1,
		'Expected exactly one latest distinct-App Brutalist authority check.'
	);
	const checkRun = record(checkRuns.check_runs[0]);
	invariant(checkRun !== null, 'Distinct-App Brutalist authority check is malformed.');
	const assertion = buildBrutalistAuthorityAssertion(
		config,
		input.expectedHeadSha,
		input.expectedProofSha,
		attestation
	);
	const assertionJson = JSON.stringify(assertion);
	const assertionDigest = createHash('sha256').update(assertionJson).digest('hex');
	const expectedExternalId = `${config.authoritativeCheck.protocol}:${assertionDigest}`;
	invariant(
		checkRun.name === config.authoritativeCheck.name &&
			checkRun.head_sha === input.expectedHeadSha &&
			checkRun.status === 'completed' &&
			checkRun.conclusion === 'success' &&
			checkRun.app?.id === config.authoritativeCheck.appId &&
			checkRun.app?.slug === config.authoritativeCheck.appSlug,
		'Distinct-App Brutalist authority check did not pass for the exact reviewed head.'
	);
	invariant(
		checkRun.external_id === expectedExternalId,
		'Brutalist authority check is not bound to the exact source, proof, team, and signer assertion.'
	);
	invariant(
		checkRun.output?.title === 'Commons Brutalist launch authority: PASS' &&
			checkRun.output?.summary === assertionJson,
		'Brutalist authority check output does not carry the canonical assertion.'
	);
	let detailsUrl;
	try {
		detailsUrl = new URL(checkRun.details_url);
	} catch {
		throw new Error('Brutalist authority check details URL is invalid.');
	}
	invariant(
		detailsUrl.origin === config.authoritativeCheck.detailsUrlOrigin,
		'Brutalist authority check details URL has the wrong origin.'
	);
	const reviewedAt = Date.parse(attestation.reviewedAt);
	const startedAt = Date.parse(checkRun.started_at);
	const completedAt = Date.parse(checkRun.completed_at);
	const nowMs = (input.now ?? new Date()).getTime();
	invariant(
		Number.isFinite(reviewedAt) && Number.isFinite(startedAt) && Number.isFinite(completedAt),
		'Brutalist authority timestamps are invalid.'
	);
	invariant(
		startedAt >= reviewedAt && completedAt >= startedAt && completedAt <= nowMs + 5 * 60 * 1000,
		'Brutalist authority check time ordering is invalid.'
	);

	return {
		schemaVersion: 1,
		repositoryId: config.repository.id,
		reviewedHeadSha: input.expectedHeadSha,
		proofCommitSha: input.expectedProofSha,
		authorityAppId: config.authoritativeCheck.appId,
		codeOwnerTeamId: config.codeOwnerTeam.id,
		operatorPrincipal: config.signer.principal,
		signerKeyFingerprint: config.signer.keyFingerprint,
		assertionDigest
	};
}

/** @param {string[]} argv */
export function parseBrutalistAuthorityArgs(argv) {
	/** @type {Record<string, string>} */
	const values = {};
	const allowed = new Set([
		'--allowed-signers',
		'--codeowners',
		'--config',
		'--expected-head-sha',
		'--expected-proof-sha'
	]);
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		invariant(allowed.has(flag), `Unknown argument: ${flag}`);
		invariant(value && !value.startsWith('--'), `${flag} requires a value.`);
		invariant(values[flag] === undefined, `${flag} may be supplied only once.`);
		values[flag] = value;
	}
	for (const flag of allowed) invariant(values[flag] !== undefined, `${flag} is required.`);
	return {
		allowedSignersPath: values['--allowed-signers'],
		codeownersPath: values['--codeowners'],
		configPath: values['--config'],
		expectedHeadSha: values['--expected-head-sha'],
		expectedProofSha: values['--expected-proof-sha']
	};
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const args = parseBrutalistAuthorityArgs(process.argv.slice(2));
		const stdin = readFileSync(0);
		invariant(
			stdin.byteLength <= MAX_STDIN_BYTES,
			'Brutalist authority API evidence is too large.'
		);
		/** @param {string} policyPath */
		const readPolicy = (policyPath) => {
			const bytes = readFileSync(policyPath);
			invariant(bytes.byteLength <= MAX_POLICY_BYTES, `Trusted policy is too large: ${policyPath}`);
			return bytes.toString('utf8');
		};
		const envelope = JSON.parse(stdin.toString('utf8'));
		const result = validateBrutalistReviewAuthority({
			...envelope,
			config: JSON.parse(readPolicy(args.configPath)),
			codeowners: readPolicy(args.codeownersPath),
			allowedSigners: readPolicy(args.allowedSignersPath),
			expectedHeadSha: args.expectedHeadSha,
			expectedProofSha: args.expectedProofSha
		});
		console.log(JSON.stringify(result));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
