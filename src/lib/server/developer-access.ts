import { parsePaidProviderOperatorAllowlist } from '$lib/server/paid-provider-runtime-readiness';

/**
 * Accounts exempt from every per-request limit Commons imposes: the paid-provider
 * budget (per-actor caps, the public pool, and the global ceiling) and the
 * generic route limiter. Provider-side quotas and billing still apply, and org
 * plan quotas are product billing, not abuse limits, so they are untouched.
 *
 * Keyed by the Convex user id carried in the verified session, never by a
 * request field, so the exemption cannot be claimed by presenting an address.
 */
export const DEVELOPER_UNLIMITED_BINDING = 'DEVELOPER_UNLIMITED_USER_IDS' as const;

export function isUnlimitedDeveloper(
	env: Partial<Record<typeof DEVELOPER_UNLIMITED_BINDING, unknown>> | undefined,
	userId: string | null | undefined
): boolean {
	if (!userId) return false;
	return (
		parsePaidProviderOperatorAllowlist(env?.[DEVELOPER_UNLIMITED_BINDING])?.includes(userId) ??
		false
	);
}
