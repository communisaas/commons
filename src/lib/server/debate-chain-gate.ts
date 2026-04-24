/**
 * Production gate for debate chain misconfig.
 *
 * The debate argument/cosign/reveal routes write state off-chain via Convex and
 * additionally post to the DebateMarket contract on-chain. When the chain is
 * unconfigured (env vars missing), dev builds proceed off-chain only; production
 * builds must fail-closed because on-chain is the authority for resolution and
 * silently accepting off-chain state creates an integrity gap.
 *
 * Use this helper in any route whose off-chain write must be paired with an
 * on-chain write in production.
 */
import { env } from '$env/dynamic/private';

export interface ChainGateOptions {
	/** Short label used in the thrown error. */
	op: string;
	/** Allow memory-only fallback in prod via explicit opt-in env flag. */
	allowEnvVar?: string;
}

/**
 * Decide whether an unconfigured-blockchain result is acceptable.
 * Returns `true` to proceed (dev / explicit opt-in), throws in production.
 *
 * @throws {Error} with status 503 when chain is required but unconfigured.
 */
export function allowChainMisconfig(options: ChainGateOptions): true {
	const nodeEnv = env.NODE_ENV ?? process.env.NODE_ENV;
	const allowKey = options.allowEnvVar ?? 'DEBATE_ALLOW_OFFCHAIN_FALLBACK';
	const optIn =
		env[allowKey as keyof typeof env] === '1' || process.env[allowKey] === '1';

	if (nodeEnv === 'production' && !optIn) {
		const err = new Error(
			`[${options.op}] Blockchain is required in production but is not configured. ` +
				`Set the DebateMarket env vars, or ${allowKey}=1 to explicitly accept off-chain-only operation.`
		) as Error & { status?: number };
		err.status = 503;
		throw err;
	}
	return true;
}
