const MIN_UNSUBSCRIBE_SECRET_BYTES = 32;

type RuntimeEnv = {
	AWS_ACCESS_KEY_ID?: string;
	AWS_SECRET_ACCESS_KEY?: string;
	UNSUBSCRIBE_SECRET?: string;
	PUBLIC_BASE_URL?: string;
};

export type EmailServerDispatchReadiness = {
	ready: boolean;
	missing: string[];
	dependency: string;
	message: string;
};

export const EMAIL_SERVER_DISPATCH_DEPENDENCY =
	'AWS SES credentials + org key + UNSUBSCRIBE_SECRET + valid PUBLIC_BASE_URL';

export function getEmailServerDispatchReadiness(
	env: RuntimeEnv,
	options: { orgKeyConfigured?: boolean | null } = {}
): EmailServerDispatchReadiness {
	const missing: string[] = [];

	if (!env.AWS_ACCESS_KEY_ID) missing.push('AWS_ACCESS_KEY_ID');
	if (!env.AWS_SECRET_ACCESS_KEY) missing.push('AWS_SECRET_ACCESS_KEY');

	const unsubscribeSecretBytes = env.UNSUBSCRIBE_SECRET
		? new TextEncoder().encode(env.UNSUBSCRIBE_SECRET).byteLength
		: 0;
	if (unsubscribeSecretBytes < MIN_UNSUBSCRIBE_SECRET_BYTES) {
		missing.push(`UNSUBSCRIBE_SECRET >= ${MIN_UNSUBSCRIBE_SECRET_BYTES} bytes`);
	}

	if (options.orgKeyConfigured === false) missing.push('org key verifier');

	if (!env.PUBLIC_BASE_URL) {
		missing.push('PUBLIC_BASE_URL http(s) URL');
	} else {
		try {
			const parsed = new URL(env.PUBLIC_BASE_URL);
			if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
				missing.push('PUBLIC_BASE_URL http(s) URL');
			}
		} catch {
			missing.push('PUBLIC_BASE_URL http(s) URL');
		}
	}

	const ready = missing.length === 0;
	return {
		ready,
		missing,
		dependency: EMAIL_SERVER_DISPATCH_DEPENDENCY,
		message: ready
			? 'Server-side email dispatch runtime is ready.'
			: `Server-side email dispatch is dependency-bound. Preserved the delivery draft; configure ${missing.join(
					', '
				)} before queueing server send.`
	};
}
