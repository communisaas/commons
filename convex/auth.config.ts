/**
 * Convex authentication configuration.
 *
 * Validates JWTs minted by SvelteKit's auth bridge (src/lib/server/convex-jwt.ts).
 * The JWKS endpoint serves the RSA public key at /.well-known/jwks.json.
 *
 * Flow:
 *   SvelteKit handleAuth → mintConvexToken(user) → locals.convexToken
 *   → serverQuery() sends JWT to Convex → Convex verifies via JWKS
 *   → ctx.auth.getUserIdentity() returns { sub, email, name }
 */

// Trailing slash is stripped on both `issuer` and JWKS URI to prevent
// operator-typo drift between the SvelteKit minter and the Convex consumer.
const ISSUER = (process.env.CONVEX_AUTH_ISSUER || "https://commons.email").replace(/\/$/, "");

export default {
	providers: [
		{
			type: "customJwt" as const,
			applicationID: "convex",
			issuer: ISSUER,
			jwks: ISSUER + "/.well-known/jwks.json",
			algorithm: "RS256" as const,
		},
	],
};
