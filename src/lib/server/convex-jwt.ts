/**
 * Convex Auth Bridge — JWT minting for SvelteKit → Convex authentication.
 *
 * Architecture:
 *   1. SvelteKit validates session cookie → gets user (existing handleAuth)
 *   2. This module mints an RS256 JWT with user claims (sub, email, name)
 *   3. The JWT is stored in event.locals.convexToken
 *   4. convex-sveltekit's serverQuery() reads locals.convexToken and sends it to Convex
 *   5. Convex verifies the JWT via the JWKS endpoint at /.well-known/jwks.json
 *   6. Convex queries access claims via ctx.auth.getUserIdentity()
 *
 * Key management:
 *   - CONVEX_JWT_PRIVATE_KEY: PEM-encoded RSA private key (PKCS#8)
 *   - The corresponding public key is derived and served via JWKS endpoint
 *   - Generate with: node scripts/generate-convex-jwk.mjs
 *
 * Runtime: Works on Cloudflare Workers (uses Web Crypto via jose).
 */

import { SignJWT, importPKCS8, exportJWK, type JWK } from 'jose';

type ConvexJwtPrivateKey = Awaited<ReturnType<typeof importPKCS8>>;

// ─── Configuration ───
//
// Env vars MUST be read lazily (inside functions), NOT captured at
// module-evaluation time. On Cloudflare Workers, this module is imported by
// `hooks.server.ts` at boot, before `event.platform.env` exists. The env
// shim in handlePlatformEnv populates `process.env` at request time — but
// any module-level `const X = process.env.Y` would have already captured
// `undefined` before the shim ran. Reading inside `getIssuer()` / `getKid()`
// guarantees the latest value (and the shim only runs once per isolate, so
// the cost is negligible).

const ALG = 'RS256';
const AUDIENCE = 'convex';
const TOKEN_TTL_SECONDS = 3600; // 1 hour
const DEFAULT_ISSUER = 'https://commons.email';
const DEFAULT_KID = 'commons-convex-1';

/**
 * JWT issuer URL. MUST match `convex/auth.config.ts` and `convex/authOps.ts`
 * `tokenIdentifier` prefix. Defaults to the reference commons.email
 * deployment; peer implementations override via CONVEX_AUTH_ISSUER.
 * Trailing slash is stripped to prevent operator-typo drift between
 * SvelteKit-minted `iss` and Convex-stored tokenIdentifier.
 */
function getIssuer(): string {
	return (process.env.CONVEX_AUTH_ISSUER || DEFAULT_ISSUER).replace(/\/$/, '');
}

/**
 * JWKS key id. Default `commons-convex-1` preserves current behavior;
 * peer implementations may override via CONVEX_JWT_KID. Changing the kid
 * invalidates active sessions because Convex caches JWKS by kid.
 */
function getKid(): string {
	return process.env.CONVEX_JWT_KID || DEFAULT_KID;
}

// ─── Cached key material ───

let _privateKey: ConvexJwtPrivateKey | null = null;
let _publicJwk: JWK | null = null;

/**
 * Import the RSA private key from PEM string (cached after first call).
 * Returns null if CONVEX_JWT_PRIVATE_KEY is not set.
 */
async function getPrivateKey(): Promise<ConvexJwtPrivateKey | null> {
	if (_privateKey) return _privateKey;

	const pem = process.env.CONVEX_JWT_PRIVATE_KEY;
	if (!pem) return null;

	// The env var may have literal \n instead of newlines (common in .env files)
	const normalizedPem = pem.replace(/\\n/g, '\n');
	// extractable: true required on CF Workers so exportJWK can derive the public key for JWKS
	_privateKey = await importPKCS8(normalizedPem, ALG, { extractable: true });
	return _privateKey;
}

/**
 * Get the public JWK for the JWKS endpoint.
 * Derives it from the private key (RSA key pairs share the public components).
 */
export async function getPublicJwk(): Promise<JWK | null> {
	if (_publicJwk) return _publicJwk;

	const privateKey = await getPrivateKey();
	if (!privateKey) return null;

	// exportJWK on a private CryptoKey exports ALL components (public + private).
	// We explicitly pick only the public RSA fields (kty, n, e) to serve via JWKS.
	const jwk = await exportJWK(privateKey);

	// SECURITY: Strip private key components (d, p, q, dp, dq, qi) — only serve public material
	_publicJwk = {
		kty: jwk.kty,
		n: jwk.n,
		e: jwk.e,
		alg: ALG,
		use: 'sig',
		kid: getKid(),
	};

	return _publicJwk;
}

/**
 * Mint a short-lived JWT for authenticating server-side Convex queries.
 *
 * Claims:
 *   - sub: user ID (maps to tokenIdentifier in Convex)
 *   - email: user's email
 *   - name: user's display name
 *   - iss: https://commons.email
 *   - aud: convex
 *   - iat/exp: standard timestamps
 *
 * Returns empty string if the private key is not configured.
 */
export async function mintConvexToken(user: {
	id: string;
	email: string;
	name?: string | null;
}): Promise<string> {
	const privateKey = await getPrivateKey();
	if (!privateKey) return '';

	const jwt = await new SignJWT({
		sub: user.id,
		email: user.email,
		name: user.name ?? undefined,
	})
		.setProtectedHeader({ alg: ALG, kid: getKid() })
		.setIssuer(getIssuer())
		.setAudience(AUDIENCE)
		.setIssuedAt()
		.setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
		.sign(privateKey);

	return jwt;
}
