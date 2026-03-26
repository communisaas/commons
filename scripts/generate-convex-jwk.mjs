#!/usr/bin/env node
/**
 * Generate an RSA key pair for the Convex auth bridge.
 *
 * Outputs:
 *   - CONVEX_JWT_PRIVATE_KEY: PEM-encoded PKCS#8 private key (add to .env.local)
 *   - Public JWK: for verification (served automatically via /.well-known/jwks.json)
 *
 * Usage:
 *   node scripts/generate-convex-jwk.mjs
 *
 * Then paste the CONVEX_JWT_PRIVATE_KEY value into your .env.local file.
 * The JWKS endpoint derives the public key from the private key at runtime.
 */

import { generateKeyPair, exportPKCS8, exportJWK } from 'jose';

async function main() {
	console.log('Generating RSA-2048 key pair for Convex auth bridge...\n');

	const { publicKey, privateKey } = await generateKeyPair('RS256', {
		modulusLength: 2048,
	});

	// Export private key as PEM (PKCS#8)
	const pem = await exportPKCS8(privateKey);

	// Export public key as JWK (for reference)
	const jwk = await exportJWK(publicKey);
	jwk.alg = 'RS256';
	jwk.use = 'sig';
	jwk.kid = 'commons-convex-1';

	// Format PEM for .env file (replace newlines with \n)
	const envPem = pem.trim().replace(/\n/g, '\\n');

	console.log('=== Add to .env.local ===\n');
	console.log(`CONVEX_JWT_PRIVATE_KEY="${envPem}"\n`);

	console.log('=== Public JWK (for reference — served automatically via JWKS endpoint) ===\n');
	console.log(JSON.stringify(jwk, null, 2));

	console.log('\n=== Next steps ===');
	console.log('1. Paste CONVEX_JWT_PRIVATE_KEY into .env.local');
	console.log('2. Deploy and verify /.well-known/jwks.json returns the public key');
	console.log('3. Run `npx convex dev` to push convex/auth.config.ts');
	console.log('4. Set CONVEX_AUTH_ISSUER env var in Convex dashboard if not using https://commons.email');
}

main().catch(console.error);
