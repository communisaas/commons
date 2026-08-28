#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const PAID_PROVIDER_POSTURE_SIGNATURE_NAMESPACE = 'commons-paid-provider-posture-v1';
export const PAID_PROVIDER_POSTURE_FINGERPRINT_ALGORITHM = 'sha256-domain-separated-v1';
export const PAID_PROVIDER_POSTURE_PROVIDERS = Object.freeze([
	'exa',
	'firecrawl',
	'gemini',
	'groq'
]);

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(`PAID_PROVIDER_POSTURE_INVALID:${message}`);
}

/** @param {unknown} value @returns {Record<string, any> | null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** @param {Record<string, any>} value @param {readonly string[]} keys @param {string} label */
function exactKeys(value, keys, label) {
	invariant(
		JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()),
		`${label}_shape`
	);
}

/** @param {unknown} value @param {string} label */
function canonicalInstant(value, label) {
	invariant(typeof value === 'string', `${label}_instant`);
	const parsed = Date.parse(value);
	invariant(
		Number.isFinite(parsed) && new Date(parsed).toISOString() === value,
		`${label}_canonical_utc`
	);
	return parsed;
}

/** @param {unknown} value @param {string} label */
function decimalBigInt(value, label) {
	invariant(typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value), `${label}_integer`);
	return BigInt(value);
}

/** @param {unknown} value @param {string} label @param {number} maximum */
function boundedString(value, label, maximum) {
	invariant(
		typeof value === 'string' &&
			value.length > 0 &&
			value.length <= maximum &&
			!/[\0\r\n]/u.test(value),
		`${label}_string`
	);
	return value;
}

/** @param {unknown} value @returns {string} */
export function canonicalProviderPostureJson(value) {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') {
		return JSON.stringify(value);
	}
	if (typeof value === 'number') {
		invariant(Number.isSafeInteger(value), 'canonical_number');
		return String(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((entry) => canonicalProviderPostureJson(entry)).join(',')}]`;
	}
	const object = record(value);
	invariant(object, 'canonical_value');
	return `{${Object.keys(object)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalProviderPostureJson(object[key])}`)
		.join(',')}}`;
}

/** @param {Record<string, any>} receipt */
export function canonicalProviderAccountPostureBytes(receipt) {
	return Buffer.from(`${canonicalProviderPostureJson(receipt)}\n`, 'utf8');
}

/**
 * Produce an opaque, domain-separated binding for one exact credential or
 * account identifier. Inputs stay operator-side and are never serialized.
 * @param {{kind:'account'|'credential', provider:string, secret:string}} input
 */
export function fingerprintProviderPostureBinding({ kind, provider, secret }) {
	invariant(kind === 'account' || kind === 'credential', 'fingerprint_kind');
	invariant(PAID_PROVIDER_POSTURE_PROVIDERS.includes(provider), 'fingerprint_provider');
	invariant(
		typeof secret === 'string' &&
			secret.length >= (kind === 'credential' ? 16 : 3) &&
			secret.length <= 4096,
		`fingerprint_${provider}_${kind}_input`
	);
	return createHash('sha256')
		.update(PAID_PROVIDER_POSTURE_SIGNATURE_NAMESPACE, 'utf8')
		.update('\0', 'utf8')
		.update(kind, 'utf8')
		.update('\0', 'utf8')
		.update(provider, 'utf8')
		.update('\0', 'utf8')
		.update(secret, 'utf8')
		.digest('hex');
}

/** @param {unknown} rawAuthority */
export function validatePaidProviderAccountAuthority(rawAuthority) {
	const authority = record(rawAuthority);
	invariant(authority, 'authority_object');
	exactKeys(
		authority,
		[
			'cloudflarePagesProject',
			'enrollmentState',
			'environment',
			'independentSigner',
			'maximumAllowedSignersBytes',
			'maximumBillingWindowSeconds',
			'maximumCaptureAgeSeconds',
			'maximumFutureSkewSeconds',
			'maximumLifetimeSeconds',
			'maximumObservationLagSeconds',
			'maximumReceiptBytes',
			'maximumSignatureBytes',
			'minimumReleaseValiditySeconds',
			'providers',
			'repository',
			'requiredLimitations',
			'schemaVersion',
			'signatureNamespace',
			'sourceAuthorGithubUserIds'
		],
		'authority'
	);
	invariant(authority.schemaVersion === 1, 'authority_schema');
	invariant(
		authority.signatureNamespace === PAID_PROVIDER_POSTURE_SIGNATURE_NAMESPACE,
		'authority_namespace'
	);
	invariant(authority.repository === 'communisaas/commons', 'authority_repository');
	invariant(authority.environment === 'production', 'authority_environment');
	invariant(authority.cloudflarePagesProject === 'communique-site', 'authority_pages_project');
	invariant(
		authority.enrollmentState === 'pending-independent-signer' ||
			authority.enrollmentState === 'enrolled',
		'authority_enrollment_state'
	);
	invariant(
		JSON.stringify(authority.sourceAuthorGithubUserIds) === JSON.stringify([19658882]),
		'authority_source_authors'
	);
	const independentSigner = record(authority.independentSigner);
	invariant(independentSigner, 'authority_independent_signer');
	exactKeys(
		independentSigner,
		['githubUserId', 'keyFingerprint', 'principal'],
		'authority_independent_signer'
	);
	if (authority.enrollmentState === 'pending-independent-signer') {
		invariant(
			independentSigner.principal === null &&
				independentSigner.githubUserId === null &&
				independentSigner.keyFingerprint === null,
			'authority_pending_signer'
		);
	} else {
		invariant(
			typeof independentSigner.principal === 'string' &&
				/^[A-Za-z0-9._@+-]{1,120}$/.test(independentSigner.principal) &&
				Number.isSafeInteger(independentSigner.githubUserId) &&
				independentSigner.githubUserId > 0 &&
				!authority.sourceAuthorGithubUserIds.includes(independentSigner.githubUserId) &&
				typeof independentSigner.keyFingerprint === 'string' &&
				/^SHA256:[A-Za-z0-9+/]{43}$/.test(independentSigner.keyFingerprint),
			'authority_enrolled_signer'
		);
	}
	const exactIntegers = {
		maximumReceiptBytes: 32_768,
		maximumSignatureBytes: 16_384,
		maximumAllowedSignersBytes: 8_192,
		maximumLifetimeSeconds: 21_600,
		maximumCaptureAgeSeconds: 900,
		maximumFutureSkewSeconds: 60,
		maximumObservationLagSeconds: 300,
		minimumReleaseValiditySeconds: 10_800,
		maximumBillingWindowSeconds: 2_764_800
	};
	for (const [key, expected] of Object.entries(exactIntegers)) {
		invariant(authority[key] === expected, `authority_${key}`);
	}
	const requiredLimitations = [
		'Provider console/account facts are operator assertions countersigned by the independent posture signer; this verifier does not query provider billing APIs.',
		'Cloudflare does not reveal deployed secret values; the operator and signer assert the protected credential inputs are the exact production Pages secrets.',
		"Current usage may lag provider billing; Exa and Firecrawl pay-as-you-go authority is bounded by Commons' monthly Durable Object ceilings, while Gemini and Groq remain on Free plans with billing and pay-as-you-go disabled."
	];
	invariant(
		JSON.stringify(authority.requiredLimitations) === JSON.stringify(requiredLimitations),
		'authority_limitations'
	);
	invariant(Array.isArray(authority.providers), 'authority_providers');
	invariant(
		JSON.stringify(authority.providers.map((provider) => record(provider)?.provider)) ===
			JSON.stringify(PAID_PROVIDER_POSTURE_PROVIDERS),
		'authority_provider_order'
	);
	/** @type {Record<string,{credentialSecretName:string,usageMetric:string,windowLimit:string|null,minimumRemaining:string,allowedBillingControls:string[]}>} */
	const expected = {
		exa: {
			credentialSecretName: 'EXA_API_KEY',
			usageMetric: 'monthly-spend-microusd',
			windowLimit: '100000000',
			minimumRemaining: '0',
			allowedBillingControls: ['payg-platform-monthly-ceiling']
		},
		firecrawl: {
			credentialSecretName: 'FIRECRAWL_API_KEY',
			usageMetric: 'monthly-credits',
			windowLimit: '6000',
			minimumRemaining: '0',
			allowedBillingControls: ['payg-platform-monthly-ceiling']
		},
		gemini: {
			credentialSecretName: 'GEMINI_API_KEY',
			usageMetric: 'current-period-requests',
			windowLimit: null,
			minimumRemaining: '16',
			allowedBillingControls: ['free-no-payg']
		},
		groq: {
			credentialSecretName: 'GROQ_API_KEY',
			usageMetric: 'current-period-requests',
			windowLimit: null,
			minimumRemaining: '9',
			allowedBillingControls: ['free-no-payg']
		}
	};
	for (const rawProvider of authority.providers) {
		const provider = record(rawProvider);
		invariant(provider, 'authority_provider_object');
		exactKeys(
			provider,
			[
				'allowedBillingControls',
				'credentialBinding',
				'credentialSecretName',
				'minimumRemaining',
				'provider',
				'usageMetric',
				'windowLimit'
			],
			`authority_${provider.provider}`
		);
		const providerExpected = expected[provider.provider];
		invariant(providerExpected, `authority_provider_${provider.provider}`);
		invariant(
			provider.credentialBinding ===
				`cloudflare-pages:communique-site:production:secret:${providerExpected.credentialSecretName}`,
			`authority_${provider.provider}_binding`
		);
		invariant(
			provider.credentialSecretName === providerExpected.credentialSecretName &&
				provider.usageMetric === providerExpected.usageMetric &&
				provider.windowLimit === providerExpected.windowLimit &&
				provider.minimumRemaining === providerExpected.minimumRemaining,
			`authority_${provider.provider}_provider_policy`
		);
		invariant(
			JSON.stringify(provider.allowedBillingControls) ===
				JSON.stringify(providerExpected.allowedBillingControls),
			`authority_${provider.provider}_controls`
		);
	}
	return authority;
}

/**
 * @param {{authority:unknown,bindings:Record<string,{accountId:string,credential:string}>,expectedOperatorGithubUserId?:number,expectedSourceAuthorGithubUserId?:number,expectedSourceSha:string,minimumRemainingValiditySeconds?:number,nowMs?:number,receipt:unknown}} input
 */
export function validateProviderAccountPostureReceipt({
	authority: rawAuthority,
	bindings,
	expectedOperatorGithubUserId,
	expectedSourceAuthorGithubUserId,
	expectedSourceSha,
	minimumRemainingValiditySeconds,
	nowMs = Date.now(),
	receipt: rawReceipt
}) {
	const authority = validatePaidProviderAccountAuthority(rawAuthority);
	invariant(/^[a-f0-9]{40}$/.test(expectedSourceSha), 'expected_source_sha');
	invariant(Number.isSafeInteger(nowMs) && nowMs >= 0, 'verification_clock');
	const requiredValidity =
		minimumRemainingValiditySeconds ?? authority.minimumReleaseValiditySeconds;
	invariant(
		Number.isSafeInteger(requiredValidity) &&
			requiredValidity >= authority.minimumReleaseValiditySeconds &&
			requiredValidity <= authority.maximumLifetimeSeconds,
		'minimum_validity'
	);
	invariant(authority.enrollmentState === 'enrolled', 'independent_signer_not_enrolled');
	const receipt = record(rawReceipt);
	invariant(receipt, 'receipt_object');
	exactKeys(
		receipt,
		[
			'capturedAt',
			'expiresAt',
			'namespace',
			'operator',
			'providers',
			'release',
			'schemaVersion',
			'validFrom'
		],
		'receipt'
	);
	invariant(receipt.schemaVersion === 1, 'receipt_schema');
	invariant(receipt.namespace === authority.signatureNamespace, 'receipt_namespace');

	const release = record(receipt.release);
	invariant(release, 'release_object');
	exactKeys(
		release,
		[
			'cloudflarePagesProject',
			'environment',
			'repository',
			'sourceAuthorGithubUserId',
			'sourceSha'
		],
		'release'
	);
	invariant(
		release.repository === authority.repository &&
			release.environment === authority.environment &&
			release.cloudflarePagesProject === authority.cloudflarePagesProject &&
			release.sourceSha === expectedSourceSha,
		'release_binding'
	);
	invariant(
		Number.isSafeInteger(release.sourceAuthorGithubUserId) &&
			release.sourceAuthorGithubUserId > 0 &&
			authority.sourceAuthorGithubUserIds.includes(release.sourceAuthorGithubUserId) &&
			release.sourceAuthorGithubUserId !== authority.independentSigner.githubUserId,
		'release_source_author_identity'
	);
	if (expectedSourceAuthorGithubUserId !== undefined) {
		invariant(
			Number.isSafeInteger(expectedSourceAuthorGithubUserId) &&
				expectedSourceAuthorGithubUserId > 0 &&
				release.sourceAuthorGithubUserId === expectedSourceAuthorGithubUserId,
			'release_source_author_binding'
		);
	}

	const operator = record(receipt.operator);
	invariant(operator, 'operator_object');
	exactKeys(
		operator,
		['assertionMethod', 'githubUserId', 'independentWitnessPrincipal', 'limitations', 'principal'],
		'operator'
	);
	const principalPattern = /^[A-Za-z0-9._@+-]{1,120}$/;
	invariant(principalPattern.test(operator.principal), 'operator_principal');
	invariant(
		Number.isSafeInteger(operator.githubUserId) &&
			operator.githubUserId > 0 &&
			operator.githubUserId !== authority.independentSigner.githubUserId,
		'operator_signer_identity_separation'
	);
	if (expectedOperatorGithubUserId !== undefined) {
		invariant(
			Number.isSafeInteger(expectedOperatorGithubUserId) &&
				expectedOperatorGithubUserId > 0 &&
				operator.githubUserId === expectedOperatorGithubUserId,
			'operator_github_identity'
		);
	}
	invariant(
		principalPattern.test(operator.independentWitnessPrincipal) &&
			operator.independentWitnessPrincipal !== operator.principal &&
			operator.independentWitnessPrincipal === authority.independentSigner.principal,
		'independent_witness_principal'
	);
	invariant(
		operator.assertionMethod === 'manual-provider-console-and-runtime-secret-custody',
		'assertion_method'
	);
	invariant(
		JSON.stringify(operator.limitations) === JSON.stringify(authority.requiredLimitations),
		'operator_limitations'
	);

	const capturedAtMs = canonicalInstant(receipt.capturedAt, 'captured_at');
	const validFromMs = canonicalInstant(receipt.validFrom, 'valid_from');
	const expiresAtMs = canonicalInstant(receipt.expiresAt, 'expires_at');
	invariant(validFromMs === capturedAtMs, 'valid_from_binding');
	invariant(
		capturedAtMs <= nowMs + authority.maximumFutureSkewSeconds * 1000 &&
			nowMs - capturedAtMs <= authority.maximumCaptureAgeSeconds * 1000 &&
			expiresAtMs > capturedAtMs &&
			expiresAtMs - capturedAtMs <= authority.maximumLifetimeSeconds * 1000 &&
			nowMs >= validFromMs - authority.maximumFutureSkewSeconds * 1000 &&
			nowMs <= expiresAtMs,
		'receipt_freshness'
	);
	invariant(expiresAtMs - nowMs >= requiredValidity * 1000, 'receipt_remaining_validity');

	invariant(Array.isArray(receipt.providers), 'providers_array');
	invariant(
		JSON.stringify(receipt.providers.map((provider) => record(provider)?.provider)) ===
			JSON.stringify(PAID_PROVIDER_POSTURE_PROVIDERS),
		'provider_order'
	);
	const credentialFingerprints = new Set();
	for (let index = 0; index < authority.providers.length; index += 1) {
		const providerPolicy = authority.providers[index];
		const provider = record(receipt.providers[index]);
		invariant(provider, `provider_${providerPolicy.provider}_object`);
		exactKeys(
			provider,
			['account', 'consumer', 'credential', 'evidence', 'provider', 'usage'],
			`provider_${providerPolicy.provider}`
		);
		invariant(provider.provider === providerPolicy.provider, `provider_${index}_identity`);
		const binding = record(bindings?.[provider.provider]);
		invariant(binding, `${provider.provider}_protected_binding`);

		const credential = record(provider.credential);
		invariant(credential, `${provider.provider}_credential_object`);
		exactKeys(
			credential,
			['deploymentBinding', 'fingerprint', 'fingerprintAlgorithm', 'runtimeEnvironmentVariable'],
			`${provider.provider}_credential`
		);
		invariant(
			credential.runtimeEnvironmentVariable === providerPolicy.credentialSecretName &&
				credential.deploymentBinding === providerPolicy.credentialBinding &&
				credential.fingerprintAlgorithm === PAID_PROVIDER_POSTURE_FINGERPRINT_ALGORITHM &&
				/^[a-f0-9]{64}$/.test(credential.fingerprint),
			`${provider.provider}_credential_binding`
		);
		invariant(
			credential.fingerprint ===
				fingerprintProviderPostureBinding({
					kind: 'credential',
					provider: provider.provider,
					secret: binding.credential
				}),
			`${provider.provider}_credential_fingerprint`
		);
		invariant(!credentialFingerprints.has(credential.fingerprint), 'duplicate_credential');
		credentialFingerprints.add(credential.fingerprint);

		const account = record(provider.account);
		invariant(account, `${provider.provider}_account_object`);
		exactKeys(
			account,
			[
				'billingControl',
				'billingControlPersistence',
				'billingEnabled',
				'fingerprint',
				'fingerprintAlgorithm',
				'monthlyTechnicalCeiling',
				'payAsYouGoEnabled',
				'plan'
			],
			`${provider.provider}_account`
		);
		boundedString(account.plan, `${provider.provider}_plan`, 64);
		invariant(
			account.fingerprintAlgorithm === PAID_PROVIDER_POSTURE_FINGERPRINT_ALGORITHM &&
				/^[a-f0-9]{64}$/.test(account.fingerprint) &&
				account.fingerprint ===
					fingerprintProviderPostureBinding({
						kind: 'account',
						provider: provider.provider,
						secret: binding.accountId
					}),
			`${provider.provider}_account_fingerprint`
		);
		invariant(
			providerPolicy.allowedBillingControls.includes(account.billingControl),
			`${provider.provider}_billing_control`
		);
		const monthlyTechnicalCeiling = decimalBigInt(
			account.monthlyTechnicalCeiling,
			`${provider.provider}_monthly_technical_ceiling`
		);
		if (account.billingControl === 'payg-platform-monthly-ceiling') {
			invariant(
				account.billingEnabled === true &&
					account.payAsYouGoEnabled === true &&
					account.plan !== 'free' &&
					account.billingControlPersistence ===
						'commons-durable-object-enforced-until-policy-mutation' &&
					providerPolicy.windowLimit !== null &&
					monthlyTechnicalCeiling === BigInt(providerPolicy.windowLimit),
				`${provider.provider}_payg_posture`
			);
		} else {
			invariant(
				account.billingControl === 'free-no-payg' &&
					account.plan === 'free' &&
					account.billingEnabled === false &&
					account.payAsYouGoEnabled === false &&
					monthlyTechnicalCeiling === 0n &&
					account.billingControlPersistence === 'provider-enforced-until-account-mutation',
				`${provider.provider}_free_posture`
			);
		}

		const usage = record(provider.usage);
		invariant(usage, `${provider.provider}_usage_object`);
		exactKeys(
			usage,
			[
				'current',
				'headroomRole',
				'metric',
				'observedAt',
				'remaining',
				'windowLimit',
				'windowResetsAt',
				'windowStartsAt'
			],
			`${provider.provider}_usage`
		);
		invariant(
			usage.metric === providerPolicy.usageMetric &&
				usage.headroomRole === 'observation-time-availability-within-reviewed-billing-control',
			`${provider.provider}_usage_metric`
		);
		const current = decimalBigInt(usage.current, `${provider.provider}_usage_current`);
		const windowLimit = decimalBigInt(usage.windowLimit, `${provider.provider}_usage_window_limit`);
		const remaining = decimalBigInt(usage.remaining, `${provider.provider}_usage_remaining`);
		invariant(
			windowLimit > 0n && current + remaining === windowLimit,
			`${provider.provider}_usage_reconciliation`
		);
		if (providerPolicy.windowLimit !== null) {
			invariant(usage.windowLimit === providerPolicy.windowLimit, `${provider.provider}_limit`);
		}
		invariant(
			remaining >= BigInt(providerPolicy.minimumRemaining),
			`${provider.provider}_remaining_headroom`
		);
		const windowStartsAtMs = canonicalInstant(
			usage.windowStartsAt,
			`${provider.provider}_window_starts_at`
		);
		const windowResetsAtMs = canonicalInstant(
			usage.windowResetsAt,
			`${provider.provider}_window_resets_at`
		);
		const observedAtMs = canonicalInstant(usage.observedAt, `${provider.provider}_observed_at`);
		invariant(
			windowStartsAtMs <= observedAtMs &&
				observedAtMs < windowResetsAtMs &&
				windowResetsAtMs - windowStartsAtMs <= authority.maximumBillingWindowSeconds * 1000 &&
				observedAtMs <= capturedAtMs &&
				capturedAtMs - observedAtMs <= authority.maximumObservationLagSeconds * 1000,
			`${provider.provider}_usage_window`
		);

		const consumer = record(provider.consumer);
		invariant(consumer, `${provider.provider}_consumer_object`);
		exactKeys(
			consumer,
			['primary', 'siblingConsumers', 'siblingInventoryExhaustive'],
			`${provider.provider}_consumer`
		);
		invariant(
			consumer.primary === 'cloudflare-pages:communique-site:production' &&
				consumer.siblingInventoryExhaustive === true &&
				Array.isArray(consumer.siblingConsumers) &&
				consumer.siblingConsumers.length === 0,
			`${provider.provider}_exclusive_consumer`
		);

		const evidence = record(provider.evidence);
		invariant(evidence, `${provider.provider}_evidence_object`);
		exactKeys(
			evidence,
			['accountBindingAssertion', 'runtimeBindingAssertion', 'source'],
			`${provider.provider}_evidence`
		);
		invariant(
			evidence.source === 'manual-provider-console' &&
				evidence.accountBindingAssertion === true &&
				evidence.runtimeBindingAssertion === true,
			`${provider.provider}_manual_assertions`
		);
	}

	return {
		capturedAt: receipt.capturedAt,
		expiresAt: receipt.expiresAt,
		providerCount: receipt.providers.length,
		remainingValiditySeconds: Math.floor((expiresAtMs - nowMs) / 1000),
		sourceSha: release.sourceSha,
		sourceAuthorGithubUserId: release.sourceAuthorGithubUserId,
		witnessPrincipal: operator.independentWitnessPrincipal
	};
}

/**
 * @param {{allowedSignersPath:string,authority:unknown,receipt:Record<string,any>,signature:Buffer|string}} input
 */
export function verifyProviderAccountPostureSignature({
	allowedSignersPath,
	authority: rawAuthority,
	receipt,
	signature
}) {
	const authority = validatePaidProviderAccountAuthority(rawAuthority);
	const witnessPrincipal = receipt.operator?.independentWitnessPrincipal;
	invariant(
		typeof witnessPrincipal === 'string' && /^[A-Za-z0-9._@+-]{1,120}$/.test(witnessPrincipal),
		'signature_witness_principal'
	);
	const signatureBytes = Buffer.isBuffer(signature) ? signature : Buffer.from(signature, 'utf8');
	invariant(
		signatureBytes.length > 0 && signatureBytes.length <= authority.maximumSignatureBytes,
		'signature_size'
	);
	const absoluteAllowedSigners = path.resolve(allowedSignersPath);
	const allowedStats = statSync(absoluteAllowedSigners);
	invariant(
		allowedStats.isFile() && allowedStats.size <= authority.maximumAllowedSignersBytes,
		'allowed_signers_file'
	);
	const allowedText = readFileSync(absoluteAllowedSigners, 'utf8');
	const activeLines = allowedText
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith('#'));
	invariant(activeLines.length === 1, 'independent_signer_enrollment');
	const enrolled = [];
	for (const line of activeLines) {
		const match =
			/^([A-Za-z0-9._@+-]{1,120}) namespaces="commons-paid-provider-posture-v1" ssh-ed25519 ([A-Za-z0-9+/=]{40,2048})(?: [^\r\n]{1,120})?$/u.exec(
				line
			);
		invariant(match, 'allowed_signer_ed25519_shape');
		enrolled.push({ key: match[2], principal: match[1] });
	}
	invariant(
		new Set(enrolled.map((entry) => entry.principal)).size === enrolled.length &&
			new Set(enrolled.map((entry) => entry.key)).size === enrolled.length,
		'allowed_signer_duplicates'
	);
	invariant(
		enrolled.filter((entry) => entry.principal === witnessPrincipal).length === 1,
		'witness_not_enrolled'
	);
	const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'commons-provider-posture-'));
	const signaturePath = path.join(temporaryDirectory, 'provider-posture.sig');
	try {
		writeFileSync(signaturePath, signatureBytes, { mode: 0o600 });
		const result = spawnSync(
			'ssh-keygen',
			[
				'-Y',
				'verify',
				'-f',
				absoluteAllowedSigners,
				'-I',
				witnessPrincipal,
				'-n',
				authority.signatureNamespace,
				'-s',
				signaturePath
			],
			{
				input: canonicalProviderAccountPostureBytes(receipt),
				encoding: 'buffer',
				maxBuffer: 1024 * 1024
			}
		);
		invariant(result.status === 0, 'signature_verification');
		const output = Buffer.from(result.stdout ?? '')
			.toString('utf8')
			.trim();
		const fingerprint = /\bkey (SHA256:[A-Za-z0-9+/=]+)/u.exec(output)?.[1];
		invariant(fingerprint, 'signature_fingerprint');
		invariant(
			fingerprint === authority.independentSigner.keyFingerprint,
			'signature_fingerprint_enrollment'
		);
		return {
			keyFingerprint: fingerprint,
			namespace: authority.signatureNamespace,
			principal: witnessPrincipal
		};
	} finally {
		rmSync(temporaryDirectory, { force: true, recursive: true });
	}
}
