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

export default {
	providers: [
		{
			type: "customJwt" as const,
			applicationID: "convex",
			issuer: process.env.CONVEX_AUTH_ISSUER || "https://commons.email",
			jwks:
				(process.env.CONVEX_AUTH_ISSUER || "https://commons.email") +
				"/.well-known/jwks.json",
			algorithm: "RS256" as const,
		},
	],
};
