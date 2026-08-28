export const PAID_PROVIDER_API_SECRET_BINDINGS = Object.freeze([
	'EXA_API_KEY',
	'FIRECRAWL_API_KEY',
	'GEMINI_API_KEY',
	'GROQ_API_KEY'
] as const);
export const PAID_PROVIDER_OPERATOR_ALLOWLIST_BINDING = 'PAID_PROVIDER_OPERATOR_USER_IDS' as const;

export type PaidProviderRuntimeEnv = Partial<
	Record<
		| (typeof PAID_PROVIDER_API_SECRET_BINDINGS)[number]
		| typeof PAID_PROVIDER_OPERATOR_ALLOWLIST_BINDING,
		string
	>
>;

function configuredSecret(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length >= 8 &&
		value.length <= 4_096 &&
		value === value.trim() &&
		!/\p{Cc}/u.test(value)
	);
}

export function parsePaidProviderOperatorAllowlist(value: unknown): readonly string[] | null {
	if (typeof value !== 'string' || value.length < 1 || value.length > 4_096) return null;
	const identifiers = value.split(',');
	if (identifiers.length < 1 || identifiers.length > 32) return null;
	for (const identifier of identifiers) {
		if (
			identifier !== identifier.trim() ||
			identifier.length < 1 ||
			identifier.length > 128 ||
			/\p{Cc}/u.test(identifier)
		) {
			return null;
		}
	}
	if (new Set(identifiers).size !== identifiers.length) return null;
	return Object.freeze([...identifiers]);
}

export function paidProviderOperatorConfigured(
	env: PaidProviderRuntimeEnv | undefined,
	userId: string | null
): boolean {
	if (!userId) return false;
	return (
		parsePaidProviderOperatorAllowlist(env?.PAID_PROVIDER_OPERATOR_USER_IDS)?.includes(userId) ??
		false
	);
}

export function paidProviderRuntimeReadiness(env: PaidProviderRuntimeEnv | undefined) {
	const missingBindings: string[] = PAID_PROVIDER_API_SECRET_BINDINGS.filter(
		(name) => !configuredSecret(env?.[name])
	);
	const operatorAllowlistConfigured =
		parsePaidProviderOperatorAllowlist(env?.PAID_PROVIDER_OPERATOR_USER_IDS) !== null;
	if (!operatorAllowlistConfigured) missingBindings.push(PAID_PROVIDER_OPERATOR_ALLOWLIST_BINDING);
	return Object.freeze({
		ready: missingBindings.length === 0,
		operatorAllowlistConfigured,
		providerSecretsConfigured: missingBindings.every(
			(name) => name === PAID_PROVIDER_OPERATOR_ALLOWLIST_BINDING
		),
		missingBindings: Object.freeze([...missingBindings].sort())
	});
}
