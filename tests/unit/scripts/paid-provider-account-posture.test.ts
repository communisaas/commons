import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
	PAID_PROVIDER_POSTURE_SIGNATURE_NAMESPACE,
	canonicalProviderAccountPostureBytes,
	fingerprintProviderPostureBinding,
	validatePaidProviderAccountAuthority,
	validateProviderAccountPostureReceipt
} from '../../../scripts/paid-provider-account-posture.mjs';
import {
	PAID_PROVIDER_PAGES_SECRET_NAMES,
	assertPaidProviderPagesSecretsAbsent,
	clearPaidProviderPagesSecrets,
	materializePaidProviderPagesSecrets,
	verifyPaidProviderPagesDeploymentBindings
} from '../../../scripts/materialize-paid-provider-pages-secrets.mjs';
import { signProviderAccountPosture } from '../../../scripts/sign-paid-provider-account-posture.mjs';
import {
	parsePaidProviderAccountPostureArgs,
	readProviderPostureBindingsFromEnvironment,
	verifySignedProviderAccountPosture
} from '../../../scripts/verify-paid-provider-account-posture.mjs';

const SOURCE_SHA = 'a'.repeat(40);
const OPERATOR = 'provider-operator';
const WITNESS = 'independent-provider-witness';
const NOW_MS = Date.parse('2026-07-21T00:10:00.000Z');
const AUTHORITY_PATH = path.resolve('config/paid-provider-account-authority.json');
const pendingAuthority = JSON.parse(readFileSync(AUTHORITY_PATH, 'utf8'));
let authority: typeof pendingAuthority;
const bindings = {
	exa: { accountId: 'exa-account-opaque-01', credential: 'exa-key-0123456789abcdef' },
	firecrawl: {
		accountId: 'firecrawl-account-opaque-01',
		credential: 'firecrawl-key-0123456789abcdef'
	},
	gemini: { accountId: 'gemini-account-opaque-01', credential: 'gemini-key-0123456789abcdef' },
	groq: { accountId: 'groq-account-opaque-01', credential: 'groq-key-0123456789abcdef' }
};

let temporaryDirectory: string;
let signingKeyPath: string;
let allowedSignersPath: string;
let enrolledAuthorityPath: string;

beforeAll(() => {
	temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'provider-posture-test-'));
	signingKeyPath = path.join(temporaryDirectory, 'witness');
	allowedSignersPath = path.join(temporaryDirectory, 'allowed-signers');
	execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', signingKeyPath]);
	const publicKey = readFileSync(`${signingKeyPath}.pub`, 'utf8')
		.trim()
		.split(/\s+/u)
		.slice(0, 2)
		.join(' ');
	writeFileSync(
		allowedSignersPath,
		`${WITNESS} namespaces="${PAID_PROVIDER_POSTURE_SIGNATURE_NAMESPACE}" ${publicKey}\n`
	);
	const fingerprint = execFileSync('ssh-keygen', ['-lf', `${signingKeyPath}.pub`, '-E', 'sha256'], {
		encoding: 'utf8'
	}).match(/\b(SHA256:[A-Za-z0-9+/]{43})\b/u)?.[1];
	if (!fingerprint) throw new Error('Test Ed25519 fingerprint is unavailable.');
	authority = structuredClone(pendingAuthority);
	authority.enrollmentState = 'enrolled';
	authority.independentSigner = {
		principal: WITNESS,
		githubUserId: 700,
		keyFingerprint: fingerprint
	};
	enrolledAuthorityPath = path.join(temporaryDirectory, 'enrolled-authority.json');
	writeFileSync(enrolledAuthorityPath, JSON.stringify(authority));
});

afterAll(() => rmSync(temporaryDirectory, { force: true, recursive: true }));

function fixture() {
	const limitations = [...authority.requiredLimitations];
	const common = {
		consumer: {
			primary: 'cloudflare-pages:communique-site:production',
			siblingConsumers: [] as string[],
			siblingInventoryExhaustive: true
		},
		evidence: {
			accountBindingAssertion: true,
			runtimeBindingAssertion: true,
			source: 'manual-provider-console'
		}
	};
	const provider = (
		providerName: keyof typeof bindings,
		credentialName: string,
		metric: string,
		current: string,
		windowLimit: string,
		remaining: string
	) => {
		const payg = providerName === 'exa' || providerName === 'firecrawl';
		return {
			provider: providerName,
			credential: {
				deploymentBinding: `cloudflare-pages:communique-site:production:secret:${credentialName}`,
				fingerprint: fingerprintProviderPostureBinding({
					kind: 'credential',
					provider: providerName,
					secret: bindings[providerName].credential
				}),
				fingerprintAlgorithm: 'sha256-domain-separated-v1',
				runtimeEnvironmentVariable: credentialName
			},
			account: {
				billingControl: payg ? 'payg-platform-monthly-ceiling' : 'free-no-payg',
				billingControlPersistence: payg
					? 'commons-durable-object-enforced-until-policy-mutation'
					: 'provider-enforced-until-account-mutation',
				billingEnabled: payg,
				fingerprint: fingerprintProviderPostureBinding({
					kind: 'account',
					provider: providerName,
					secret: bindings[providerName].accountId
				}),
				fingerprintAlgorithm: 'sha256-domain-separated-v1',
				monthlyTechnicalCeiling: payg ? windowLimit : '0',
				payAsYouGoEnabled: payg,
				plan: payg ? 'pay-as-you-go' : 'free'
			},
			usage: {
				current,
				headroomRole: 'observation-time-availability-within-reviewed-billing-control',
				metric,
				observedAt: '2026-07-21T00:04:00.000Z',
				remaining,
				windowLimit,
				windowResetsAt: '2026-08-01T00:00:00.000Z',
				windowStartsAt: '2026-07-01T00:00:00.000Z'
			},
			...structuredClone(common)
		};
	};
	return {
		schemaVersion: 1,
		namespace: PAID_PROVIDER_POSTURE_SIGNATURE_NAMESPACE,
		release: {
			cloudflarePagesProject: 'communique-site',
			environment: 'production',
			repository: 'communisaas/commons',
			sourceAuthorGithubUserId: 19658882,
			sourceSha: SOURCE_SHA
		},
		capturedAt: '2026-07-21T00:05:00.000Z',
		validFrom: '2026-07-21T00:05:00.000Z',
		expiresAt: '2026-07-21T06:05:00.000Z',
		operator: {
			assertionMethod: 'manual-provider-console-and-runtime-secret-custody',
			githubUserId: 19658882,
			independentWitnessPrincipal: WITNESS,
			limitations,
			principal: OPERATOR
		},
		providers: [
			provider(
				'exa',
				'EXA_API_KEY',
				'monthly-spend-microusd',
				'1000000',
				'100000000',
				'99000000'
			),
			provider('firecrawl', 'FIRECRAWL_API_KEY', 'monthly-credits', '100', '6000', '5900'),
			provider('gemini', 'GEMINI_API_KEY', 'current-period-requests', '10', '1000', '990'),
			provider('groq', 'GROQ_API_KEY', 'current-period-requests', '10', '1000', '990')
		]
	};
}

function signature(receipt = fixture()): Buffer {
	return execFileSync(
		'ssh-keygen',
		['-Y', 'sign', '-f', signingKeyPath, '-n', PAID_PROVIDER_POSTURE_SIGNATURE_NAMESPACE, '-'],
		{ input: canonicalProviderAccountPostureBytes(receipt) }
	);
}

function verify(receipt = fixture(), overrides = {}) {
	return verifySignedProviderAccountPosture({
		allowedSignersPath,
		authority,
		bindings,
		expectedSourceSha: SOURCE_SHA,
		expectedSourceAuthorGithubUserId: 19658882,
		nowMs: NOW_MS,
		receiptBytes: canonicalProviderAccountPostureBytes(receipt),
		signatureBytes: signature(receipt),
		...overrides
	});
}

function pagesProject(providerSecrets = false) {
	const providerEnv = providerSecrets
		? Object.fromEntries(
				PAID_PROVIDER_PAGES_SECRET_NAMES.map((name) => [name, { type: 'secret_text' }])
			)
		: {};
	return {
		success: true,
		result: {
			name: 'communique-site',
			canonical_deployment: { id: '11111111-1111-4111-8111-111111111111' },
			deployment_configs: {
				production: {
					compatibility_date: '2026-07-19',
					durable_object_namespaces: { CONVEX_WORK_BUDGET: { namespace_id: 'namespace' } },
					env_vars: {
						PUBLIC_CONVEX_URL: {
							type: 'plain_text',
							value: 'https://example.convex.cloud'
						},
						...providerEnv
					},
					wrangler_config_hash: 'config-hash-0123456789abcdef'
				},
				preview: {
					compatibility_date: '2026-07-19',
					durable_object_namespaces: {},
					env_vars: {
						PUBLIC_CONVEX_URL: {
							type: 'plain_text',
							value: 'https://preview.convex.cloud'
						}
					},
					wrangler_config_hash: 'preview-config-hash-0123456789'
				}
			}
		}
	};
}

function pagesDeployment(providerSecrets = false) {
	return {
		success: true,
		result: {
			id: '11111111-1111-4111-8111-111111111111',
			environment: 'production',
			env_vars: {
				PUBLIC_CONVEX_URL: {
					type: 'plain_text',
					value: 'https://old.convex.cloud'
				},
				...(providerSecrets
					? Object.fromEntries(
							PAID_PROVIDER_PAGES_SECRET_NAMES.map((name) => [name, { type: 'secret_text' }])
						)
					: {})
			}
		}
	};
}

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		headers: { 'content-type': 'application/json' },
		status
	});
}

describe('paid-provider account posture authority', () => {
	it('accepts one canonical, exact-SHA, independently signed bounded billing posture', () => {
		const result = verify();
		expect(result).toMatchObject({
			providerCount: 4,
			sourceSha: SOURCE_SHA,
			witnessPrincipal: WITNESS,
			signature: { namespace: PAID_PROVIDER_POSTURE_SIGNATURE_NAMESPACE, principal: WITNESS }
		});
		expect(result.remainingValiditySeconds).toBe(21_300);
	});

	it('pins the mixed billing authority and exact Exa/Firecrawl draw envelopes', () => {
		const checked = validatePaidProviderAccountAuthority(pendingAuthority);
		expect(checked.enrollmentState).toBe('pending-independent-signer');
		expect(checked.independentSigner).toEqual({
			principal: null,
			githubUserId: null,
			keyFingerprint: null
		});
		expect(checked.providers.map((entry: { provider: string }) => entry.provider)).toEqual([
			'exa',
			'firecrawl',
			'gemini',
			'groq'
		]);
		expect(checked.providers[0]).toMatchObject({
			allowedBillingControls: ['payg-platform-monthly-ceiling'],
			minimumRemaining: '0',
			windowLimit: '100000000'
		});
		expect(checked.providers[1]).toMatchObject({
			allowedBillingControls: ['payg-platform-monthly-ceiling'],
			minimumRemaining: '0',
			windowLimit: '6000'
		});
		expect(checked.providers[2].minimumRemaining).toBe('16');
		expect(checked.providers[3].minimumRemaining).toBe('9');
		expect(checked.minimumReleaseValiditySeconds).toBe(10_800);
	});

	it('domain-separates credential and account fingerprints without serializing raw values', () => {
		const credential = fingerprintProviderPostureBinding({
			kind: 'credential',
			provider: 'exa',
			secret: bindings.exa.credential
		});
		const account = fingerprintProviderPostureBinding({
			kind: 'account',
			provider: 'exa',
			secret: bindings.exa.credential
		});
		expect(credential).toMatch(/^[a-f0-9]{64}$/u);
		expect(credential).not.toBe(account);
		expect(canonicalProviderAccountPostureBytes(fixture()).toString('utf8')).not.toContain(
			bindings.exa.credential
		);
	});

	it('rejects a receipt for a different release SHA', () => {
		const receipt = fixture();
		receipt.release.sourceSha = 'b'.repeat(40);
		expect(() => verify(receipt)).toThrow(/release_binding/u);
	});

	it('binds the exact associated merged-PR author and separates the signer', () => {
		expect(() => verify(fixture(), { expectedSourceAuthorGithubUserId: 999 })).toThrow(
			/release_source_author_binding/u
		);
		const unapproved = fixture();
		unapproved.release.sourceAuthorGithubUserId = 999;
		expect(() => verify(unapproved)).toThrow(/release_source_author_identity/u);
		const signerAuthored = fixture();
		signerAuthored.release.sourceAuthorGithubUserId = authority.independentSigner.githubUserId;
		expect(() => verify(signerAuthored)).toThrow(/release_source_author_identity/u);
	});

	it.each([
		['credential', 'credential_fingerprint'],
		['accountId', 'account_fingerprint']
	])('rejects a mismatched protected %s binding', (field, error) => {
		const changed = structuredClone(bindings);
		if (field === 'credential') changed.exa.credential = 'different-exa-key-0123456789';
		else changed.exa.accountId = 'different-exa-account';
		expect(() => verify(fixture(), { bindings: changed })).toThrow(new RegExp(error, 'u'));
	});

	it('requires all four providers exactly once and in canonical order', () => {
		const missing = fixture();
		missing.providers.pop();
		expect(() => verify(missing)).toThrow(/provider_order/u);
		const reordered = fixture();
		[reordered.providers[0], reordered.providers[1]] = [
			reordered.providers[1],
			reordered.providers[0]
		];
		expect(() => verify(reordered)).toThrow(/provider_order/u);
	});

	it('rejects non-exhaustive or non-empty sibling consumption', () => {
		const nonExhaustive = fixture();
		nonExhaustive.providers[0].consumer.siblingInventoryExhaustive = false;
		expect(() => verify(nonExhaustive)).toThrow(/exclusive_consumer/u);
		const sibling = fixture();
		sibling.providers[0].consumer.siblingConsumers.push('other-project');
		expect(() => verify(sibling)).toThrow(/exclusive_consumer/u);
	});

	it('requires PAYG for Exa/Firecrawl and free/no-PAYG for Gemini/Groq', () => {
		const disabledPayg = fixture();
		disabledPayg.providers[0].account.payAsYouGoEnabled = false;
		expect(() => verify(disabledPayg)).toThrow(/exa_payg_posture/u);
		const freeProviderPayg = fixture();
		freeProviderPayg.providers[2].account.payAsYouGoEnabled = true;
		expect(() => verify(freeProviderPayg)).toThrow(/gemini_free_posture/u);
		const fakeFreePlan = fixture();
		fakeFreePlan.providers[3].account.plan = 'pro';
		expect(() => verify(fakeFreePlan)).toThrow(/groq_free_posture/u);
	});

	it('rejects unreviewed billing controls and technical-ceiling drift', () => {
		for (const provider of ['exa', 'firecrawl', 'gemini', 'groq']) {
			const changed = fixture();
			changed.providers.find((entry) => entry.provider === provider)!.account.billingControl =
				'unreviewed-billing-control';
			expect(() => verify(changed)).toThrow(new RegExp(`${provider}_billing_control`, 'u'));
		}
		const raisedExa = fixture();
		raisedExa.providers[0].account.monthlyTechnicalCeiling = '999999999999';
		expect(() => verify(raisedExa)).toThrow(/exa_payg_posture/u);
		const raisedFirecrawl = fixture();
		raisedFirecrawl.providers[1].account.monthlyTechnicalCeiling = '99999999';
		expect(() => verify(raisedFirecrawl)).toThrow(/firecrawl_payg_posture/u);
	});

	it('reconciles current usage, reset windows, and launch headroom', () => {
		const arithmetic = fixture();
		arithmetic.providers[0].usage.remaining = '98999999';
		expect(() => verify(arithmetic)).toThrow(/usage_reconciliation/u);
		const driftedLimit = fixture();
		driftedLimit.providers[0].usage.current = '1000000';
		driftedLimit.providers[0].usage.remaining = '998999999';
		driftedLimit.providers[0].usage.windowLimit = '999999999';
		expect(() => verify(driftedLimit)).toThrow(/exa_limit/u);
		const reset = fixture();
		reset.providers[0].usage.windowResetsAt = reset.providers[0].usage.observedAt;
		expect(() => verify(reset)).toThrow(/usage_window/u);
	});

	it('rejects stale, future, overlong, or nearly expired evidence', () => {
		expect(() => verify(fixture(), { nowMs: Date.parse('2026-07-21T00:21:00.000Z') })).toThrow(
			/receipt_freshness/u
		);
		const overlong = fixture();
		overlong.expiresAt = '2026-07-21T06:05:01.000Z';
		expect(() => verify(overlong)).toThrow(/receipt_freshness/u);
		const nearExpiry = fixture();
		nearExpiry.expiresAt = '2026-07-21T02:10:00.000Z';
		expect(() => verify(nearExpiry)).toThrow(/receipt_remaining_validity/u);
	});

	it('requires a distinct independent witness and the exact limitations', () => {
		const selfSigned = fixture();
		selfSigned.operator.independentWitnessPrincipal = OPERATOR;
		expect(() =>
			validateProviderAccountPostureReceipt({
				authority,
				bindings,
				expectedSourceSha: SOURCE_SHA,
				nowMs: NOW_MS,
				receipt: selfSigned
			})
		).toThrow(/independent_witness/u);
		const omittedLimitation = fixture();
		omittedLimitation.operator.limitations.pop();
		expect(() => verify(omittedLimitation)).toThrow(/operator_limitations/u);
	});

	it('rejects the same human as operator and signer even under different principals', () => {
		const samePerson = fixture();
		samePerson.operator.githubUserId = authority.independentSigner.githubUserId;
		expect(() => verify(samePerson)).toThrow(/operator_signer_identity_separation/u);
		expect(() => verify(fixture(), { expectedOperatorGithubUserId: 999 })).toThrow(
			/operator_github_identity/u
		);
	});

	it('fails closed while the checked-in independent-signer enrollment is empty', () => {
		const enrollment = readFileSync('.github/paid-provider-posture-allowed-signers', 'utf8');
		expect(
			enrollment
				.split(/\r?\n/u)
				.map((line) => line.trim())
				.filter((line) => line && !line.startsWith('#'))
		).toEqual([]);
		expect(() =>
			verify(fixture(), {
				allowedSignersPath: '.github/paid-provider-posture-allowed-signers'
			})
		).toThrow(/independent_signer_enrollment/u);
	});

	it('rejects launch semantics while the authority enrollment is pending', () => {
		expect(() =>
			validateProviderAccountPostureReceipt({
				authority: pendingAuthority,
				bindings,
				expectedSourceSha: SOURCE_SHA,
				nowMs: NOW_MS,
				receipt: fixture()
			})
		).toThrow(/independent_signer_not_enrolled/u);
	});

	it('rejects multiple active posture signers instead of silently widening trust', () => {
		const multiple = path.join(temporaryDirectory, 'multiple-signers');
		const one = readFileSync(allowedSignersPath, 'utf8');
		writeFileSync(multiple, `${one}${one.replace(WITNESS, 'second-independent-witness')}`);
		expect(() => verify(fixture(), { allowedSignersPath: multiple })).toThrow(
			/independent_signer_enrollment/u
		);
	});

	it('rejects a non-Ed25519 or wrong-namespace trust-root entry before OpenSSH', () => {
		const invalidAllowedSigners = path.join(temporaryDirectory, 'invalid-allowed-signers');
		writeFileSync(
			invalidAllowedSigners,
			`${WITNESS} namespaces="wrong" ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCtest\n`
		);
		expect(() => verify(fixture(), { allowedSignersPath: invalidAllowedSigners })).toThrow(
			/allowed_signer_ed25519_shape/u
		);
	});

	it('rejects noncanonical JSON and any post-signature mutation', () => {
		const receipt = fixture();
		expect(() =>
			verifySignedProviderAccountPosture({
				allowedSignersPath,
				authority,
				bindings,
				expectedSourceSha: SOURCE_SHA,
				nowMs: NOW_MS,
				receiptBytes: Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8'),
				signatureBytes: signature(receipt)
			})
		).toThrow(/canonical_bytes/u);
		const original = fixture();
		const tampered = fixture();
		tampered.providers[0].usage.current = '999999';
		tampered.providers[0].usage.remaining = '99000001';
		expect(() =>
			verifySignedProviderAccountPosture({
				allowedSignersPath,
				authority,
				bindings,
				expectedSourceSha: SOURCE_SHA,
				nowMs: NOW_MS,
				receiptBytes: canonicalProviderAccountPostureBytes(tampered),
				signatureBytes: signature(original)
			})
		).toThrow(/signature_verification/u);
	});

	it('signer helper validates bindings and emits an independently verifiable signature', () => {
		const receiptPath = path.join(temporaryDirectory, 'receipt.json');
		const signaturePath = path.join(temporaryDirectory, 'receipt.sig');
		const receipt = fixture();
		writeFileSync(receiptPath, canonicalProviderAccountPostureBytes(receipt));
		const signed = signProviderAccountPosture({
			allowedSignersPath,
			authorityPath: enrolledAuthorityPath,
			bindings,
			expectedSourceSha: SOURCE_SHA,
			nowMs: NOW_MS,
			receiptPath,
			signaturePath,
			signingKey: signingKeyPath
		});
		expect(signed.principal).toBe(WITNESS);
		expect(() =>
			verifySignedProviderAccountPosture({
				allowedSignersPath,
				authority,
				bindings,
				expectedSourceSha: SOURCE_SHA,
				nowMs: NOW_MS,
				receiptBytes: readFileSync(receiptPath),
				signatureBytes: readFileSync(signaturePath)
			})
		).not.toThrow();
	});

	it('reads all eight protected inputs without logging or fallback aliases', () => {
		const environment = Object.fromEntries(
			Object.entries(bindings).flatMap(([provider, value]) => [
				[`PROVIDER_POSTURE_${provider.toUpperCase()}_CREDENTIAL`, value.credential],
				[`PROVIDER_POSTURE_${provider.toUpperCase()}_ACCOUNT_ID`, value.accountId]
			])
		);
		expect(readProviderPostureBindingsFromEnvironment(environment)).toEqual(bindings);
		delete environment.PROVIDER_POSTURE_GROQ_ACCOUNT_ID;
		expect(() => readProviderPostureBindingsFromEnvironment(environment)).toThrow(
			/groq_account_environment/u
		);
	});

	it('requires the exact bounded verifier CLI surface', () => {
		const args = [
			'--authority',
			'authority.json',
			'--receipt',
			'receipt.json',
			'--signature',
			'receipt.sig',
			'--allowed-signers',
			'allowed-signers',
			'--source-sha',
			SOURCE_SHA,
			'--min-validity-seconds',
			'10800'
		];
		expect(parsePaidProviderAccountPostureArgs(args)).toMatchObject({
			minimumRemainingValiditySeconds: 10_800,
			sourceSha: SOURCE_SHA
		});
		expect(() => parsePaidProviderAccountPostureArgs([...args, '--unknown', 'x'])).toThrow(
			/cli_key_value_pairs/u
		);
	});

	it('binds source identity and confines provider defaults to the exact Pages upload seam', () => {
		const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
		const runner = readFileSync('scripts/run-public-template-og-release-phase.mjs', 'utf8');
		const externalRecovery = readFileSync(
			'.github/workflows/public-template-og-release-recovery.yml',
			'utf8'
		);
		const firstProof = workflow.indexOf(
			'Prove fresh signed bounded provider posture before production eligibility'
		);
		const preflightMutation = workflow.indexOf(
			'Deploy and prove exact team-global Convex work-budget Worker'
		);
		const preparationProof = workflow.indexOf(
			'Re-prove posture and clean provider project defaults before production preparation'
		);
		const pagesActivation = workflow.indexOf(
			'Execute fresh-receipt production activation transaction',
			preparationProof
		);
		const authorizePages = runner.indexOf(
			"await authorizeMutation('consumer-paused', 'compatible', 'paused')"
		);
		const secretWrite = runner.indexOf('await materializePaidProviderPagesSecrets', authorizePages);
		const pagesUpload = runner.indexOf('pagesOutput = run(', secretWrite);
		const immutableDeploymentProof = runner.indexOf(
			'await verifyPaidProviderPagesDeploymentBindings',
			pagesUpload
		);
		const projectCleanup = runner.indexOf('await clearPaidProviderPagesSecrets', pagesUpload);
		const nestedRecovery = runner.indexOf('await recoverPublicTemplateOgReleasePhase', pagesUpload);
		expect(firstProof).toBeGreaterThan(0);
		expect(firstProof).toBeLessThan(preflightMutation);
		expect(preparationProof).toBeGreaterThan(preflightMutation);
		expect(preparationProof).toBeLessThan(pagesActivation);
		expect(authorizePages).toBeGreaterThan(0);
		expect(secretWrite).toBeGreaterThan(authorizePages);
		expect(pagesUpload).toBeGreaterThan(secretWrite);
		expect(immutableDeploymentProof).toBeGreaterThan(pagesUpload);
		expect(projectCleanup).toBeGreaterThan(immutableDeploymentProof);
		expect(nestedRecovery).toBeGreaterThan(projectCleanup);
		expect(runner).toContain("!name.startsWith('PROVIDER_POSTURE_')");
		expect(
			workflow.match(
				/PROVIDER_POSTURE_EXA_CREDENTIAL: \$\{\{ secrets\.PROTECTED_EXA_API_KEY \}\}/gu
			)
		).toHaveLength(3);
		expect(
			workflow.match(
				/PROVIDER_POSTURE_FIRECRAWL_CREDENTIAL: \$\{\{ secrets\.PROTECTED_FIRECRAWL_API_KEY \}\}/gu
			)
		).toHaveLength(3);
		expect(
			workflow.match(
				/PROVIDER_POSTURE_GEMINI_CREDENTIAL: \$\{\{ secrets\.PROTECTED_GEMINI_API_KEY \}\}/gu
			)
		).toHaveLength(3);
		expect(
			workflow.match(
				/PROVIDER_POSTURE_GROQ_CREDENTIAL: \$\{\{ secrets\.PROTECTED_GROQ_API_KEY \}\}/gu
			)
		).toHaveLength(3);
		expect(
			workflow.match(/PROVIDER_POSTURE_OPERATOR_GITHUB_USER_ID: \$\{\{ github\.actor_id \}\}/gu)
		).toHaveLength(3);
		expect(
			workflow.match(
				/PROVIDER_POSTURE_SOURCE_AUTHOR_GITHUB_USER_ID: \$\{\{ needs\.source-verify\.outputs\.source_author_github_user_id \}\}/gu
			)
		).toHaveLength(3);
		expect(workflow).toContain('/commits/$verified_sha/pulls?per_page=100&page=1');
		expect(workflow).toContain('Reconcile provider project defaults before any outer recovery');
		expect(externalRecovery.indexOf('clear-staged')).toBeLessThan(
			externalRecovery.indexOf('Recover only the exact live transaction')
		);
		expect(workflow).not.toContain('wrangler pages secret bulk');
		expect(workflow).not.toContain('PROTECTED_PROVIDER_POSTURE_EXA_CREDENTIAL');
	});

	it('PATCHes only production with the exact verified values and proves the poststate', async () => {
		const before = pagesProject(false);
		const after = pagesProject(true);
		const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
		const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
			calls.push({ input, init });
			if (calls.length === 1) return jsonResponse(before);
			if (calls.length === 2) return jsonResponse(pagesDeployment());
			if (calls.length === 3) return jsonResponse({ success: true, result: {} });
			if (calls.length === 4) return jsonResponse(after);
			return jsonResponse(pagesDeployment());
		};
		await expect(
			materializePaidProviderPagesSecrets({
				accountId: 'a'.repeat(32),
				apiToken: 'cloudflare-token-0123456789',
				bindings,
				fetchFn: fetchFn as typeof fetch
			})
		).resolves.toEqual({
			baselineDeploymentId: '11111111-1111-4111-8111-111111111111',
			environment: 'production',
			project: 'communique-site',
			secretBindings: PAID_PROVIDER_PAGES_SECRET_NAMES
		});
		expect(calls.map((call) => call.init?.method)).toEqual(['GET', 'GET', 'PATCH', 'GET', 'GET']);
		expect(String(calls[0].input)).toBe(
			`https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/pages/projects/communique-site`
		);
		expect(String(calls[1].input)).toContain('/deployments/11111111-1111-4111-8111-111111111111');
		const patch = JSON.parse(String(calls[2].init?.body));
		expect(Object.keys(patch)).toEqual(['deployment_configs']);
		expect(Object.keys(patch.deployment_configs)).toEqual(['production']);
		expect(patch.deployment_configs.production.wrangler_config_hash).toBe(
			'config-hash-0123456789abcdef'
		);
		expect(patch.deployment_configs.production.env_vars).toEqual({
			EXA_API_KEY: { type: 'secret_text', value: bindings.exa.credential },
			FIRECRAWL_API_KEY: { type: 'secret_text', value: bindings.firecrawl.credential },
			GEMINI_API_KEY: { type: 'secret_text', value: bindings.gemini.credential },
			GROQ_API_KEY: { type: 'secret_text', value: bindings.groq.credential }
		});
		expect(JSON.stringify(patch)).not.toContain(bindings.exa.accountId);
		expect(calls[2].init?.headers).toMatchObject({
			Accept: 'application/json',
			Authorization: 'Bearer cloudflare-token-0123456789',
			'Content-Type': 'application/json'
		});
	});

	it.each(['production', 'preview'] as const)(
		'fails before mutation if %s project defaults already have a provider capability',
		async (environment) => {
			const before = pagesProject(false);
			Object.assign(before.result.deployment_configs[environment].env_vars, {
				EXA_API_KEY: { type: 'secret_text' }
			});
			const calls: RequestInit[] = [];
			await expect(
				materializePaidProviderPagesSecrets({
					accountId: 'a'.repeat(32),
					apiToken: 'cloudflare-token-0123456789',
					bindings,
					fetchFn: (async (_input: RequestInfo | URL, init?: RequestInit) => {
						calls.push(init ?? {});
						return jsonResponse(before);
					}) as typeof fetch
				})
			).rejects.toThrow(
				new RegExp(`stage_before_${environment}_provider_capability_EXA_API_KEY`, 'u')
			);
			expect(calls.map((call) => call.method)).toEqual(['GET']);
		}
	);

	it.each([
		[
			'preview config',
			(after: ReturnType<typeof pagesProject>) => {
				after.result.deployment_configs.preview.compatibility_date = '2026-07-20';
			},
			/preview_config_changed/u
		],
		[
			'non-provider production config',
			(after: ReturnType<typeof pagesProject>) => {
				after.result.deployment_configs.production.compatibility_date = '2026-07-20';
			},
			/non_provider_production_config_changed/u
		],
		[
			'missing provider secret',
			(after: ReturnType<typeof pagesProject>) => {
				Reflect.deleteProperty(after.result.deployment_configs.production.env_vars, 'EXA_API_KEY');
			},
			/stage_after_production_secret_binding_EXA_API_KEY/u
		]
	])('rejects post-PATCH drift in %s', async (label, mutate, error) => {
		const before = pagesProject(false);
		const after = pagesProject(true);
		mutate(after);
		const cleaned = structuredClone(after);
		for (const name of PAID_PROVIDER_PAGES_SECRET_NAMES) {
			Reflect.deleteProperty(cleaned.result.deployment_configs.production.env_vars, name);
		}
		let call = 0;
		await expect(
			materializePaidProviderPagesSecrets({
				accountId: 'a'.repeat(32),
				apiToken: 'cloudflare-token-0123456789',
				bindings,
				fetchFn: (async () => {
					call += 1;
					if (call === 1) return jsonResponse(before);
					if (call === 2) return jsonResponse(pagesDeployment());
					if (call === 3) return jsonResponse({ success: true, result: {} });
					if (call === 4) return jsonResponse(after);
					if (label !== 'missing provider secret') {
						if (call === 5) return jsonResponse(pagesDeployment());
						if (call === 6) return jsonResponse(after);
						if (call === 7) return jsonResponse(pagesDeployment());
						if (call === 8) return jsonResponse({ success: true, result: {} });
						if (call === 9) return jsonResponse(cleaned);
					} else {
						if (call === 5) return jsonResponse(after);
						if (call === 6) return jsonResponse(pagesDeployment());
						if (call === 7) return jsonResponse({ success: true, result: {} });
						if (call === 8) return jsonResponse(cleaned);
					}
					return jsonResponse(pagesDeployment());
				}) as typeof fetch
			})
		).rejects.toThrow(error);
		expect(call).toBe(label === 'missing provider secret' ? 9 : 10);
	});

	it('reconciles an ambiguous stage PATCH to absence without retrying the secret write', async () => {
		let call = 0;
		const methods: Array<string | undefined> = [];
		await expect(
			materializePaidProviderPagesSecrets({
				accountId: 'a'.repeat(32),
				apiToken: 'cloudflare-token-0123456789',
				bindings,
				fetchFn: (async (_input: RequestInfo | URL, init?: RequestInit) => {
					call += 1;
					methods.push(init?.method);
					if (call === 1) return jsonResponse(pagesProject(false));
					if (call === 2) return jsonResponse(pagesDeployment());
					if (call === 3) throw new Error('ambiguous transport failure');
					if (call === 4) return jsonResponse(pagesProject(true));
					if (call === 5) return jsonResponse(pagesDeployment());
					if (call === 6) return jsonResponse({ success: true, result: {} });
					if (call === 7) return jsonResponse(pagesProject(false));
					return jsonResponse(pagesDeployment());
				}) as typeof fetch
			})
		).rejects.toThrow(/ambiguous transport failure/u);
		expect(call).toBe(8);
		expect(methods.filter((method) => method === 'PATCH')).toHaveLength(2);
	});

	it('proves the previously active immutable deployment did not gain or rotate bindings', async () => {
		const liveAfter = pagesDeployment();
		Object.assign(liveAfter.result.env_vars, { EXA_API_KEY: { type: 'secret_text' } });
		const staged = pagesProject(true);
		let call = 0;
		await expect(
			materializePaidProviderPagesSecrets({
				accountId: 'a'.repeat(32),
				apiToken: 'cloudflare-token-0123456789',
				bindings,
				fetchFn: (async () => {
					call += 1;
					if (call === 1) return jsonResponse(pagesProject(false));
					if (call === 2) return jsonResponse(pagesDeployment());
					if (call === 3) return jsonResponse({ success: true, result: {} });
					if (call === 4) return jsonResponse(staged);
					if (call === 5) return jsonResponse(liveAfter);
					if (call === 6) return jsonResponse(staged);
					if (call === 7) return jsonResponse(liveAfter);
					if (call === 8) return jsonResponse({ success: true, result: {} });
					if (call === 9) return jsonResponse(pagesProject(false));
					return jsonResponse(liveAfter);
				}) as typeof fetch
			})
		).rejects.toThrow(/active_deployment_bindings_changed/u);
		expect(call).toBe(10);
	});

	it('uses an idempotent null-delete shape and preserves the immutable deployment', async () => {
		const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
		const result = await clearPaidProviderPagesSecrets({
			accountId: 'a'.repeat(32),
			apiToken: 'cloudflare-token-0123456789',
			expectedDeploymentId: '11111111-1111-4111-8111-111111111111',
			fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
				calls.push({ input, init });
				if (calls.length === 1) return jsonResponse(pagesProject(true));
				if (calls.length === 2) return jsonResponse(pagesDeployment(true));
				if (calls.length === 3) return jsonResponse({ success: true, result: {} });
				if (calls.length === 4) return jsonResponse(pagesProject(false));
				return jsonResponse(pagesDeployment(true));
			}) as typeof fetch
		});
		expect(result.deleteAttempts).toBe(1);
		expect(calls.map((call) => call.init?.method)).toEqual(['GET', 'GET', 'PATCH', 'GET', 'GET']);
		const patch = JSON.parse(String(calls[2].init?.body));
		expect(patch.deployment_configs.production.env_vars).toEqual(
			Object.fromEntries(PAID_PROVIDER_PAGES_SECRET_NAMES.map((name) => [name, null]))
		);
		expect(patch.deployment_configs.production.wrangler_config_hash).toBe(
			'config-hash-0123456789abcdef'
		);
	});

	it('self-recovers a preview-only leak with preview own hash and preserves non-provider config', async () => {
		const contaminated = pagesProject(false);
		Object.assign(contaminated.result.deployment_configs.preview.env_vars, {
			EXA_API_KEY: { type: 'secret_text' }
		});
		const cleaned = pagesProject(false);
		const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
		await expect(
			clearPaidProviderPagesSecrets({
				accountId: 'a'.repeat(32),
				apiToken: 'cloudflare-token-0123456789',
				fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
					calls.push({ input, init });
					if (calls.length === 1) return jsonResponse(contaminated);
					if (calls.length === 2) return jsonResponse(pagesDeployment());
					if (calls.length === 3) return jsonResponse({ success: true, result: {} });
					if (calls.length === 4) return jsonResponse(cleaned);
					return jsonResponse(pagesDeployment());
				}) as typeof fetch
			})
		).resolves.toMatchObject({ environment: 'production-and-preview' });
		const patch = JSON.parse(String(calls[2].init?.body));
		expect(Object.keys(patch.deployment_configs)).toEqual(['preview']);
		expect(patch.deployment_configs.preview).toEqual({
			env_vars: Object.fromEntries(PAID_PROVIDER_PAGES_SECRET_NAMES.map((name) => [name, null])),
			wrangler_config_hash: 'preview-config-hash-0123456789'
		});
	});

	it('retries only the idempotent null-delete after an ambiguous clear and proves absence', async () => {
		let call = 0;
		const methods: Array<string | undefined> = [];
		await expect(
			clearPaidProviderPagesSecrets({
				accountId: 'a'.repeat(32),
				apiToken: 'cloudflare-token-0123456789',
				fetchFn: (async (_input: RequestInfo | URL, init?: RequestInit) => {
					call += 1;
					methods.push(init?.method);
					if (call === 1) return jsonResponse(pagesProject(true));
					if (call === 2) return jsonResponse(pagesDeployment());
					if (call === 3) throw new Error('ambiguous clear');
					if (call === 4) return jsonResponse(pagesProject(true));
					if (call === 5) return jsonResponse({ success: true, result: {} });
					if (call === 6) return jsonResponse(pagesProject(false));
					return jsonResponse(pagesDeployment());
				}) as typeof fetch
			})
		).resolves.toMatchObject({ deleteAttempts: 2 });
		expect(methods.filter((method) => method === 'PATCH')).toHaveLength(2);
		expect(call).toBe(7);
	});

	it('proves project-default absence without mutation', async () => {
		const calls: RequestInit[] = [];
		await expect(
			assertPaidProviderPagesSecretsAbsent({
				accountId: 'a'.repeat(32),
				apiToken: 'cloudflare-token-0123456789',
				fetchFn: (async (_input: RequestInfo | URL, init?: RequestInit) => {
					calls.push(init ?? {});
					return jsonResponse(pagesProject(false));
				}) as typeof fetch
			})
		).resolves.toMatchObject({ environment: 'production-and-preview' });
		expect(calls.map((call) => call.method)).toEqual(['GET']);
	});

	it('proves the newly created immutable deployment captured all four bindings', async () => {
		const deployment = pagesDeployment(true);
		const result = await verifyPaidProviderPagesDeploymentBindings({
			accountId: 'a'.repeat(32),
			apiToken: 'cloudflare-token-0123456789',
			deploymentId: deployment.result.id,
			fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
				expect(String(input)).toContain(`/deployments/${deployment.result.id}`);
				expect(init?.method).toBe('GET');
				return jsonResponse(deployment);
			}) as typeof fetch
		});
		expect(result).toMatchObject({
			deploymentId: deployment.result.id,
			environment: 'production',
			secretBindings: PAID_PROVIDER_PAGES_SECRET_NAMES
		});
		Reflect.deleteProperty(deployment.result.env_vars, 'GROQ_API_KEY');
		await expect(
			verifyPaidProviderPagesDeploymentBindings({
				accountId: 'a'.repeat(32),
				apiToken: 'cloudflare-token-0123456789',
				deploymentId: deployment.result.id,
				fetchFn: (async () => jsonResponse(deployment)) as typeof fetch
			})
		).rejects.toThrow(/created_deployment_secret_binding_GROQ_API_KEY/u);
	});
});
