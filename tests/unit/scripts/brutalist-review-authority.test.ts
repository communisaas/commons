import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
	BRUTALIST_AUTHORITY_PROTOCOL,
	REQUIRED_BRUTALIST_CODEOWNER_PATHS,
	buildBrutalistAuthorityAssertion,
	parseBrutalistAuthorityArgs,
	validateBrutalistAuthorityConfig,
	validateBrutalistReviewAuthority
} from '../../../scripts/verify-brutalist-review-authority.mjs';

const headSha = 'a'.repeat(40);
const proofSha = 'b'.repeat(40);
const reviewedAt = '2026-07-21T01:00:00.000Z';

function sshField(value: Buffer): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(value.length);
	return Buffer.concat([length, value]);
}

function signerFixture() {
	const blob = Buffer.concat([
		sshField(Buffer.from('ssh-ed25519', 'ascii')),
		sshField(Buffer.alloc(32, 7))
	]);
	return {
		publicKey: blob.toString('base64'),
		fingerprint: `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/u, '')}`
	};
}

function configFixture() {
	const signer = signerFixture();
	return {
		schemaVersion: 1,
		enrollmentState: 'enrolled',
		repository: {
			id: 599295397,
			slug: 'communisaas/commons',
			ownerId: 90685635,
			ownerLogin: 'communisaas',
			protectedBranch: 'main'
		},
		diagnostic: {
			workflowName: 'Brutalist Review (diagnostic)',
			githubActionsAppId: 15368
		},
		authoritativeCheck: {
			name: 'Commons Brutalist Launch Authority',
			protocol: 'commons-brutalist-authority-v1',
			appId: 424242,
			appSlug: 'commons-brutalist-authority',
			appOwnerId: 90685635,
			detailsUrlOrigin: 'https://review.commons.email',
			permissions: {
				checks: 'write',
				contents: 'read',
				metadata: 'read',
				pull_requests: 'read'
			},
			events: ['check_suite', 'pull_request', 'push']
		},
		codeOwnerTeam: {
			id: 8080,
			slug: 'brutalist-reviewers',
			memberUserIds: [701, 702],
			repositoryRole: 'write'
		},
		signer: {
			principal: 'commons-launch-operator',
			githubUserId: 700,
			keyFingerprint: signer.fingerprint,
			namespace: 'commons-brutalist-launch-v1'
		},
		separation: {
			launchSourceAuthorUserIds: [19658882]
		},
		proofRef: {
			prefix: 'brutalist-attestations/',
			requireAdministratorEnforcement: true,
			allowForcePushes: false,
			allowDeletions: false
		},
		requiredCodeOwnerPaths: [...REQUIRED_BRUTALIST_CODEOWNER_PATHS]
	};
}

function pullRequestReviews() {
	return {
		required_approving_review_count: 1,
		require_code_owner_reviews: true,
		dismiss_stale_reviews: true,
		require_last_push_approval: true,
		bypass_pull_request_allowances: { users: [], teams: [], apps: [] },
		dismissal_restrictions: { users: [], teams: [], apps: [] }
	};
}

function branchProtection() {
	return {
		required_status_checks: {
			strict: true,
			contexts: ['test', 'Commons Brutalist Launch Authority'],
			checks: [
				{ context: 'test', app_id: 15368 },
				{ context: 'Commons Brutalist Launch Authority', app_id: 424242 }
			]
		},
		required_pull_request_reviews: pullRequestReviews(),
		required_conversation_resolution: { enabled: true },
		enforce_admins: { enabled: true },
		allow_force_pushes: { enabled: false },
		allow_deletions: { enabled: false }
	};
}

function authorityInput() {
	const config = configFixture();
	const signer = signerFixture();
	const attestation = {
		schemaVersion: 3,
		reviewedAt,
		reviewedHeadSha: headSha,
		operatorPrincipal: config.signer.principal,
		signerKeyFingerprint: config.signer.keyFingerprint,
		findings: { openP0: 0, openP1: 0, openP2: 0, openP3: 0, total: 0 }
	};
	const assertion = buildBrutalistAuthorityAssertion(config, headSha, proofSha, attestation);
	const assertionJson = JSON.stringify(assertion);
	const assertionDigest = createHash('sha256').update(assertionJson).digest('hex');
	const owner = `@${config.repository.ownerLogin}/${config.codeOwnerTeam.slug}`;
	return {
		config,
		codeowners: [
			'# unrelated ownership may precede the trust-root suffix',
			'workers/atlas/ @ejmockler',
			...REQUIRED_BRUTALIST_CODEOWNER_PATHS.map((policyPath) => `/${policyPath} ${owner}`),
			''
		].join('\n'),
		allowedSigners: `${config.signer.principal} namespaces="commons-brutalist-launch-v1" ssh-ed25519 ${signer.publicKey}\n`,
		repository: {
			id: 599295397,
			full_name: 'communisaas/commons',
			default_branch: 'main',
			owner: { id: 90685635, login: 'communisaas' }
		},
		branchProtection: branchProtection(),
		proofBranch: { name: `brutalist-attestations/${headSha}`, commit: { sha: proofSha } },
		proofBranchProtection: {
			enforce_admins: { enabled: true },
			allow_force_pushes: { enabled: false },
			allow_deletions: { enabled: false }
		},
		authorityApp: {
			id: 424242,
			slug: 'commons-brutalist-authority',
			owner: { id: 90685635, type: 'Organization' },
			permissions: config.authoritativeCheck.permissions,
			events: config.authoritativeCheck.events
		},
		codeOwnerTeam: {
			id: 8080,
			slug: 'brutalist-reviewers',
			privacy: 'closed',
			organization: { id: 90685635, login: 'communisaas' }
		},
		codeOwnerTeamMembers: [
			{ id: 701, type: 'User', site_admin: false },
			{ id: 702, type: 'User', site_admin: false }
		],
		codeOwnerTeamRepository: {
			id: 599295397,
			full_name: 'communisaas/commons',
			role_name: 'write',
			permissions: {
				pull: true,
				triage: true,
				push: true,
				maintain: false,
				admin: false
			}
		},
		checkRuns: {
			total_count: 1,
			check_runs: [
				{
					name: 'Commons Brutalist Launch Authority',
					head_sha: headSha,
					status: 'completed',
					conclusion: 'success',
					app: { id: 424242, slug: 'commons-brutalist-authority' },
					external_id: `${BRUTALIST_AUTHORITY_PROTOCOL}:${assertionDigest}`,
					output: {
						title: 'Commons Brutalist launch authority: PASS',
						summary: assertionJson
					},
					details_url: 'https://review.commons.email/runs/17',
					started_at: '2026-07-21T01:01:00.000Z',
					completed_at: '2026-07-21T01:02:00.000Z'
				}
			]
		},
		attestation,
		expectedHeadSha: headSha,
		expectedProofSha: proofSha,
		now: new Date('2026-07-21T01:03:00.000Z')
	};
}

type AuthorityInput = ReturnType<typeof authorityInput>;

describe('independent Brutalist review authority', () => {
	it('accepts one exact independently owned source, proof, signer, team, and App assertion', () => {
		expect(validateBrutalistReviewAuthority(authorityInput())).toMatchObject({
			repositoryId: 599295397,
			reviewedHeadSha: headSha,
			proofCommitSha: proofSha,
			authorityAppId: 424242,
			codeOwnerTeamId: 8080,
			operatorPrincipal: 'commons-launch-operator'
		});
	});

	it('treats unordered GitHub permission objects and event sets semantically', () => {
		const input = authorityInput();
		input.authorityApp.permissions = {
			pull_requests: 'read',
			metadata: 'read',
			contents: 'read',
			checks: 'write'
		};
		input.authorityApp.events = ['push', 'check_suite', 'pull_request'];
		expect(validateBrutalistReviewAuthority(input).authorityAppId).toBe(424242);
	});

	it('keeps the committed policy explicitly blocked instead of fabricating identities', () => {
		const config = JSON.parse(readFileSync('config/brutalist-review-authority.json', 'utf8'));
		expect(config).toMatchObject({
			enrollmentState: 'pending-independent-enrollment',
			authoritativeCheck: { appId: null, appSlug: null, appOwnerId: null },
			codeOwnerTeam: { id: null, slug: null, memberUserIds: [], repositoryRole: 'write' },
			signer: { principal: null, githubUserId: null, keyFingerprint: null },
			separation: { launchSourceAuthorUserIds: [19658882] }
		});
		expect(() => validateBrutalistAuthorityConfig(config)).toThrow(/pending independent/i);
	});

	it('places the live independent authority verifier after proof verification and before release eligibility', () => {
		const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
		const sourceVerify = workflow.slice(
			workflow.indexOf('  source-verify:'),
			workflow.indexOf('  manual-verify:')
		);
		const proofVerifier = sourceVerify.indexOf('verify-brutalist-attestation.mjs');
		const authorityVerifier = sourceVerify.indexOf('verify-brutalist-review-authority.mjs');
		expect(proofVerifier).toBeGreaterThan(0);
		expect(authorityVerifier).toBeGreaterThan(proofVerifier);
		expect(sourceVerify).toContain(
			'RELEASE_AUTHORITY_TOKEN: ${{ secrets.PROTECTED_GITHUB_RELEASE_AUTHORITY_READ_TOKEN }}'
		);
		expect(sourceVerify).toContain('gate/config/brutalist-review-authority.json');
		expect(sourceVerify).toContain('--codeowners gate/.github/CODEOWNERS');
		expect(sourceVerify).toContain('--allowed-signers gate/.github/brutalist-allowed-signers');
		expect(sourceVerify).toContain('/branches/$encoded_proof_branch/protection');
		expect(sourceVerify).toContain('/teams/$codeowner_team_slug/repos/$REPOSITORY');
		expect(sourceVerify).toContain(
			'check_name=$encoded_check_name&app_id=$authority_app_id&filter=latest'
		);
		expect(sourceVerify.indexOf('attestation_verified=true')).toBeGreaterThan(authorityVerifier);
	});

	it.each([
		[
			'Actions-owned authority',
			(input: AuthorityInput): void => {
				input.config.authoritativeCheck.appId = 15368;
			},
			/GitHub Actions App/i
		],
		[
			'signer in reviewer team',
			(input: AuthorityInput): void => {
				input.config.codeOwnerTeam.memberUserIds.push(700);
			},
			/separate from every CODEOWNER/i
		],
		[
			'launch source author in reviewer team',
			(input: AuthorityInput): void => {
				input.config.codeOwnerTeam.memberUserIds.push(19658882);
			},
			/source author must be separate/i
		],
		[
			'missing CODEOWNERS suffix',
			(input: AuthorityInput): void => {
				input.codeowners = input.codeowners.replace(
					'/scripts/verify-brutalist-review-authority.mjs @communisaas/brutalist-reviewers\n',
					''
				);
			},
			/CODEOWNERS/i
		],
		[
			'extra allowed signer',
			(input: AuthorityInput): void => {
				input.allowedSigners += input.allowedSigners;
			},
			/Exactly one/i
		],
		[
			'non-strict base',
			(input: AuthorityInput): void => {
				input.branchProtection.required_status_checks.strict = false;
			},
			/latest base/i
		],
		[
			'missing App-bound authority',
			(input: AuthorityInput): void => {
				input.branchProtection.required_status_checks.checks.pop();
			},
			/distinct-App/i
		],
		[
			'no CODEOWNER review',
			(input: AuthorityInput): void => {
				input.branchProtection.required_pull_request_reviews.require_code_owner_reviews = false;
			},
			/CODEOWNER approval/i
		],
		[
			'stale approvals survive',
			(input: AuthorityInput): void => {
				input.branchProtection.required_pull_request_reviews.dismiss_stale_reviews = false;
			},
			/dismiss stale/i
		],
		[
			'latest pusher can approve',
			(input: AuthorityInput): void => {
				input.branchProtection.required_pull_request_reviews.require_last_push_approval = false;
			},
			/latest push/i
		],
		[
			'administrator bypass',
			(input: AuthorityInput): void => {
				input.branchProtection.enforce_admins.enabled = false;
			},
			/administrators/i
		],
		[
			'proof force pushes',
			(input: AuthorityInput): void => {
				input.proofBranchProtection.allow_force_pushes.enabled = true;
			},
			/force pushes/i
		],
		[
			'proof deletion',
			(input: AuthorityInput): void => {
				input.proofBranchProtection.allow_deletions.enabled = true;
			},
			/deletion/i
		],
		[
			'proof ref drift',
			(input: AuthorityInput): void => {
				input.proofBranch.commit.sha = 'c'.repeat(40);
			},
			/exact verified proof/i
		],
		[
			'App permission drift',
			(input: AuthorityInput): void => {
				input.authorityApp.permissions.contents = 'write';
			},
			/permissions/i
		],
		[
			'team membership drift',
			(input: AuthorityInput): void => {
				input.codeOwnerTeamMembers.pop();
			},
			/membership/i
		],
		[
			'secret CODEOWNER team',
			(input: AuthorityInput): void => {
				input.codeOwnerTeam.privacy = 'secret';
			},
			/team identity/i
		],
		[
			'CODEOWNER team admin access',
			(input: AuthorityInput): void => {
				input.codeOwnerTeamRepository.role_name = 'admin';
				input.codeOwnerTeamRepository.permissions.admin = true;
			},
			/write-only access/i
		],
		[
			'spoofed check App',
			(input: AuthorityInput): void => {
				input.checkRuns.check_runs[0].app.id = 15368;
			},
			/distinct-App/i
		],
		[
			'check assertion drift',
			(input: AuthorityInput): void => {
				input.checkRuns.check_runs[0].external_id = `${BRUTALIST_AUTHORITY_PROTOCOL}:${'0'.repeat(64)}`;
			},
			/not bound/i
		],
		[
			'check before review',
			(input: AuthorityInput): void => {
				input.checkRuns.check_runs[0].started_at = '2026-07-21T00:59:00.000Z';
			},
			/time ordering/i
		]
	] as const)('rejects %s', (_label, mutate, message) => {
		const input = authorityInput();
		mutate(input);
		expect(() => validateBrutalistReviewAuthority(input)).toThrow(message);
	});

	it('rejects the observed live trust posture', () => {
		const input = authorityInput();
		input.branchProtection.required_status_checks = {
			strict: false,
			contexts: ['test'],
			checks: [{ context: 'test', app_id: 15368 }]
		};
		input.branchProtection.required_pull_request_reviews = null as never;
		input.branchProtection.enforce_admins.enabled = false;
		input.codeOwnerTeamMembers = [];
		expect(() => validateBrutalistReviewAuthority(input)).toThrow();
	});

	it('parses only the five explicit trusted policy inputs', () => {
		const args = [
			'--config',
			'config.json',
			'--codeowners',
			'CODEOWNERS',
			'--allowed-signers',
			'allowed-signers',
			'--expected-head-sha',
			headSha,
			'--expected-proof-sha',
			proofSha
		];
		expect(parseBrutalistAuthorityArgs(args)).toEqual({
			configPath: 'config.json',
			codeownersPath: 'CODEOWNERS',
			allowedSignersPath: 'allowed-signers',
			expectedHeadSha: headSha,
			expectedProofSha: proofSha
		});
		expect(() => parseBrutalistAuthorityArgs([...args, '--unexpected', 'value'])).toThrow(
			/Unknown argument/i
		);
	});
});
