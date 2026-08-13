import { describe, expect, it } from 'vitest';

import {
	parseGitHubReleaseAuthorityArgs,
	validateGitHubReleaseAuthority
} from '../../../scripts/verify-github-release-authority.mjs';

function environment(overrides: Record<string, unknown> = {}) {
	return {
		name: 'Production',
		can_admins_bypass: false,
		protection_rules: [
			{
				id: 1,
				type: 'required_reviewers',
				prevent_self_review: true,
				reviewers: [{ type: 'Team', reviewer: { id: 17, slug: 'release-operators' } }]
			},
			{ id: 2, type: 'branch_policy' }
		],
		deployment_branch_policy: {
			protected_branches: false,
			custom_branch_policies: true
		},
		...overrides
	};
}

function branchPolicies(overrides: Record<string, unknown> = {}) {
	return {
		total_count: 1,
		branch_policies: [{ id: 23, name: 'main', type: 'branch' }],
		...overrides
	};
}

function pullRequestReviews(overrides: Record<string, unknown> = {}) {
	return {
		required_approving_review_count: 1,
		require_code_owner_reviews: true,
		dismiss_stale_reviews: true,
		require_last_push_approval: true,
		bypass_pull_request_allowances: { users: [], teams: [], apps: [] },
		dismissal_restrictions: { users: [], teams: [], apps: [] },
		...overrides
	};
}

function branchProtection(overrides: Record<string, unknown> = {}) {
	return {
		required_status_checks: {
			strict: true,
			contexts: ['test'],
			checks: [{ context: 'test', app_id: 15368 }]
		},
		required_pull_request_reviews: pullRequestReviews(),
		required_conversation_resolution: { enabled: true },
		enforce_admins: { enabled: true },
		allow_force_pushes: { enabled: false },
		allow_deletions: { enabled: false },
		...overrides
	};
}

function valid(
	overrides: {
		environmentName?: string;
		environment?: unknown;
		branchPolicies?: unknown;
		branchProtection?: unknown;
		protectedBranch?: unknown;
		requiredStatusCheck?: unknown;
	} = {}
) {
	return {
		environmentName: overrides.environmentName ?? 'Production',
		environment: overrides.environment ?? environment(),
		branchPolicies: overrides.branchPolicies ?? branchPolicies(),
		branchProtection: overrides.branchProtection ?? branchProtection(),
		...(overrides.protectedBranch === undefined
			? {}
			: { protectedBranch: overrides.protectedBranch }),
		...(overrides.requiredStatusCheck === undefined
			? {}
			: { requiredStatusCheck: overrides.requiredStatusCheck })
	};
}

describe('GitHub release authority verifier', () => {
	it.each(['Production', 'Staging'])('accepts exact protected release authority for %s', (name) => {
		const result = validateGitHubReleaseAuthority(
			valid({ environmentName: name, environment: environment({ name }) })
		);
		expect(result).toMatchObject({
			environment: name,
			administratorBypass: false,
			reviewerCount: 1,
			deploymentBranches: ['main'],
			protectedBranch: 'main',
			requiredStatusChecks: ['test'],
			requiredStatusCheckAppId: 15368,
			requiredApprovals: 1,
			codeOwnerApproval: true,
			dismissStaleApprovals: true,
			requireLastPushApproval: true,
			pullRequestBypassActors: 0,
			reviewDismissalActors: 0,
			conversationResolution: true,
			administratorEnforcement: true
		});
	});

	it('accepts the modern checks representation without a duplicate contexts entry', () => {
		const result = validateGitHubReleaseAuthority(
			valid({
				branchProtection: branchProtection({
					required_status_checks: {
						strict: true,
						contexts: [],
						checks: [{ context: 'test', app_id: 15368 }]
					}
				})
			})
		);
		expect(result.requiredStatusChecks).toEqual(['test']);
	});

	it('accepts an additional uniquely app-bound independent review authority', () => {
		const result = validateGitHubReleaseAuthority(
			valid({
				branchProtection: branchProtection({
					required_status_checks: {
						strict: true,
						contexts: ['test', 'Commons Brutalist Launch Authority'],
						checks: [
							{ context: 'test', app_id: 15368 },
							{ context: 'Commons Brutalist Launch Authority', app_id: 424242 }
						]
					}
				})
			})
		);
		expect(result.requiredStatusChecks).toEqual(['test', 'Commons Brutalist Launch Authority']);
	});

	it.each([
		['unknown environment', valid({ environmentName: 'production' }), /Production or Staging/i],
		[
			'environment identity drift',
			valid({ environment: environment({ name: 'Staging' }) }),
			/does not match/i
		],
		[
			'administrator bypass',
			valid({ environment: environment({ can_admins_bypass: true }) }),
			/disable administrator/i
		],
		[
			'missing administrator posture',
			valid({ environment: environment({ can_admins_bypass: undefined }) }),
			/disable administrator/i
		],
		['candidate branch selection', valid({ protectedBranch: 'production' }), /branch main/i],
		['candidate check selection', valid({ requiredStatusCheck: 'lint' }), /exactly test/i]
	] as const)('rejects %s', (_label, input, message) => {
		expect(() => validateGitHubReleaseAuthority(input)).toThrow(message);
	});

	it.each([
		['no reviewer rule', [{ id: 2, type: 'branch_policy' }], /exactly one required-reviewers/i],
		[
			'multiple reviewer rules',
			[
				{
					type: 'required_reviewers',
					prevent_self_review: true,
					reviewers: [{ type: 'User', reviewer: { id: 1 } }]
				},
				{
					type: 'required_reviewers',
					prevent_self_review: true,
					reviewers: [{ type: 'User', reviewer: { id: 2 } }]
				},
				{ type: 'branch_policy' }
			],
			/exactly one required-reviewers/i
		],
		[
			'self review',
			[
				{ type: 'required_reviewers', prevent_self_review: false, reviewers: [] },
				{ type: 'branch_policy' }
			],
			/prevent self-review/i
		],
		[
			'empty reviewers',
			[
				{ type: 'required_reviewers', prevent_self_review: true, reviewers: [] },
				{ type: 'branch_policy' }
			],
			/at least one reviewer/i
		],
		[
			'malformed reviewer',
			[
				{
					type: 'required_reviewers',
					prevent_self_review: true,
					reviewers: [{ type: 'User', reviewer: { id: 0 } }]
				},
				{ type: 'branch_policy' }
			],
			/reviewer identity is malformed/i
		],
		[
			'missing branch rule',
			[
				{
					type: 'required_reviewers',
					prevent_self_review: true,
					reviewers: [{ type: 'User', reviewer: { id: 1 } }]
				}
			],
			/branch-policy protection rule/i
		]
	] as const)('rejects reviewer protection drift: %s', (_label, protection_rules, message) => {
		expect(() =>
			validateGitHubReleaseAuthority(valid({ environment: environment({ protection_rules }) }))
		).toThrow(message);
	});

	it('rejects duplicated reviewer identities', () => {
		const protection_rules = [
			{
				type: 'required_reviewers',
				prevent_self_review: true,
				reviewers: [
					{ type: 'User', reviewer: { id: 1 } },
					{ type: 'User', reviewer: { id: 1 } }
				]
			},
			{ type: 'branch_policy' }
		];
		expect(() =>
			validateGitHubReleaseAuthority(valid({ environment: environment({ protection_rules }) }))
		).toThrow(/duplicated/i);
	});

	it.each([
		[
			'no branch restriction',
			environment({ deployment_branch_policy: null }),
			branchPolicies(),
			/explicit custom/i
		],
		[
			'all protected branches',
			environment({
				deployment_branch_policy: { protected_branches: true, custom_branch_policies: false }
			}),
			branchPolicies(),
			/explicit custom/i
		],
		[
			'extra branch pattern',
			environment(),
			branchPolicies({
				total_count: 2,
				branch_policies: [
					{ id: 1, name: 'main', type: 'branch' },
					{ id: 2, name: 'release/*', type: 'branch' }
				]
			}),
			/exactly one deployment branch/i
		],
		[
			'tag named main',
			environment(),
			branchPolicies({ branch_policies: [{ id: 1, name: 'main', type: 'tag' }] }),
			/only the exact branch main/i
		],
		[
			'policy count mismatch',
			environment(),
			branchPolicies({ total_count: 2 }),
			/count is inconsistent/i
		]
	] as const)('rejects deployment policy drift: %s', (_label, env, policies, message) => {
		expect(() =>
			validateGitHubReleaseAuthority(valid({ environment: env, branchPolicies: policies }))
		).toThrow(message);
	});

	it.each([
		[
			'non-strict status',
			{
				required_status_checks: {
					strict: false,
					contexts: ['test'],
					checks: [{ context: 'test', app_id: 15368 }]
				}
			},
			/strict/i
		],
		[
			'legacy context drift',
			{
				required_status_checks: {
					strict: true,
					contexts: ['lint'],
					checks: [{ context: 'test', app_id: 15368 }]
				}
			},
			/legacy context/i
		],
		[
			'legacy context duplication',
			{
				required_status_checks: {
					strict: true,
					contexts: ['test', 'test'],
					checks: [{ context: 'test', app_id: 15368 }]
				}
			},
			/legacy status contexts/i
		],
		[
			'context-only unbound check',
			{ required_status_checks: { strict: true, contexts: ['test'] } },
			/app-bound status checks/i
		],
		[
			'wrong app-bound check',
			{
				required_status_checks: {
					strict: true,
					contexts: ['test'],
					checks: [{ context: 'test', app_id: 1 }]
				}
			},
			/GitHub Actions App/i
		],
		[
			'any-app status check',
			{
				required_status_checks: {
					strict: true,
					contexts: ['test'],
					checks: [{ context: 'test', app_id: -1 }]
				}
			},
			/identity is malformed/i
		],
		[
			'null-app status check',
			{
				required_status_checks: {
					strict: true,
					contexts: ['test'],
					checks: [{ context: 'test', app_id: null }]
				}
			},
			/identity is malformed/i
		],
		[
			'duplicate context across Apps',
			{
				required_status_checks: {
					strict: true,
					contexts: ['test'],
					checks: [
						{ context: 'test', app_id: 15368 },
						{ context: 'test', app_id: 424242 }
					]
				}
			},
			/contexts must be unique/i
		],
		['no reviews', { required_pull_request_reviews: null }, /approving pull-request review/i],
		[
			'zero approvals',
			{ required_pull_request_reviews: { required_approving_review_count: 0 } },
			/approving pull-request review/i
		],
		[
			'no CODEOWNER approval',
			{
				required_pull_request_reviews: pullRequestReviews({
					require_code_owner_reviews: false
				})
			},
			/CODEOWNER/i
		],
		[
			'retained stale approvals',
			{
				required_pull_request_reviews: {
					required_approving_review_count: 1,
					dismiss_stale_reviews: false,
					require_last_push_approval: true
				}
			},
			/dismiss stale/i
		],
		[
			'missing stale-approval posture',
			{
				required_pull_request_reviews: {
					required_approving_review_count: 1,
					require_last_push_approval: true
				}
			},
			/dismiss stale/i
		],
		[
			'last pusher may self-approve',
			{
				required_pull_request_reviews: {
					required_approving_review_count: 1,
					dismiss_stale_reviews: true,
					require_last_push_approval: false
				}
			},
			/last push/i
		],
		[
			'pull-request user bypass',
			{
				required_pull_request_reviews: pullRequestReviews({
					bypass_pull_request_allowances: {
						users: [{ id: 1 }],
						teams: [],
						apps: []
					}
				})
			},
			/must not contain any actor/i
		],
		[
			'missing pull-request bypass posture',
			{
				required_pull_request_reviews: pullRequestReviews({
					bypass_pull_request_allowances: undefined
				})
			},
			/bypass allowances must be an explicit actor object/i
		],
		[
			'null pull-request bypass posture',
			{
				required_pull_request_reviews: pullRequestReviews({
					bypass_pull_request_allowances: null
				})
			},
			/bypass allowances must be an explicit actor object/i
		],
		[
			'malformed pull-request bypass posture',
			{
				required_pull_request_reviews: pullRequestReviews({
					bypass_pull_request_allowances: { users: [], teams: [] }
				})
			},
			/exactly users, teams, and apps/i
		],
		[
			'missing dismissal restrictions',
			{
				required_pull_request_reviews: pullRequestReviews({
					dismissal_restrictions: undefined
				})
			},
			/dismissal restrictions must be an explicit actor object/i
		],
		[
			'null dismissal restrictions',
			{
				required_pull_request_reviews: pullRequestReviews({ dismissal_restrictions: null })
			},
			/dismissal restrictions must be an explicit actor object/i
		],
		[
			'malformed dismissal restrictions',
			{
				required_pull_request_reviews: pullRequestReviews({
					dismissal_restrictions: { users: [], teams: [], apps: [], unexpected: [] }
				})
			},
			/exactly users, teams, and apps/i
		],
		[
			'review dismissal actor',
			{
				required_pull_request_reviews: pullRequestReviews({
					dismissal_restrictions: { users: [], teams: [{ id: 2 }], apps: [] }
				})
			},
			/must not contain any actor/i
		],
		[
			'unresolved conversations',
			{ required_conversation_resolution: { enabled: false } },
			/resolve conversations/i
		],
		['admin exemption', { enforce_admins: { enabled: false } }, /apply to administrators/i],
		['force pushes', { allow_force_pushes: { enabled: true } }, /disable force pushes/i],
		['branch deletion', { allow_deletions: { enabled: true } }, /disable deletion/i]
	] as const)('rejects protected-main drift: %s', (_label, override, message) => {
		expect(() =>
			validateGitHubReleaseAuthority(valid({ branchProtection: branchProtection(override) }))
		).toThrow(message);
	});

	it('rejects the observed unprotected live-state shape', () => {
		expect(() =>
			validateGitHubReleaseAuthority(
				valid({
					environment: {
						name: 'Production',
						can_admins_bypass: true,
						protection_rules: [],
						deployment_branch_policy: null
					},
					branchProtection: {
						required_status_checks: { strict: false, contexts: ['test'] },
						required_pull_request_reviews: null,
						required_conversation_resolution: { enabled: false },
						enforce_admins: { enabled: false },
						allow_force_pushes: { enabled: true },
						allow_deletions: { enabled: true }
					}
				})
			)
		).toThrow();
	});

	it('parses only one trusted release environment', () => {
		expect(parseGitHubReleaseAuthorityArgs(['--environment', 'Production'])).toEqual({
			environmentName: 'Production'
		});
		expect(() => parseGitHubReleaseAuthorityArgs([])).toThrow(/Production or Staging/i);
		expect(() =>
			parseGitHubReleaseAuthorityArgs(['--environment', 'Production', '--environment', 'Staging'])
		).toThrow(/only once/i);
	});
});
