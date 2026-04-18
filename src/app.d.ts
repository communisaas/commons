// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Error {
			message: string;
			code?: string;
			status?: number;
		}
		interface Locals {
			/** RS256 JWT for authenticating server-side Convex queries via convex-sveltekit's serverQuery(). */
			convexToken?: string;
			user: {
				id: string;
				email: string;
				name: string | null;
				avatar: string | null;
				// PII custody — server-computed HMAC for lookups
				email_hash?: string | null;
				// Verification status
				is_verified: boolean;
				verification_method: string | null;
				verified_at: Date | null;
				// Graduated trust
				trust_tier: number;
				// Passkey (security upgrade within Tier 1)
				passkey_credential_id: string | null;
				// did:key identifier derived from WebAuthn public key
				did_key: string | null;
				// Cryptographic identity commitment (Semaphore/ZK)
				identity_commitment: string | null;
				// Privacy-preserving district (hash only, no PII)
				district_hash: string | null;
				district_verified: boolean;
				// Profile fields
				role: string | null;
				organization: string | null;
				location: string | null;
				connection: string | null;
				profile_completed_at: Date | null;
				profile_visibility: string;
				// Reputation
				trust_score: number;
				reputation_tier: string;
				// Wallet integration
				wallet_address: string | null;
				wallet_type: string | null;
				near_account_id: string | null;
				near_derived_scroll_address: string | null;
				// Timestamps
				createdAt: Date;
				updatedAt: Date;
			} | null;
			session: {
				id: string;
				createdAt: Date;
				userId: string;
				expiresAt: Date;
			} | null;
		}
		// eslint-disable-next-line @typescript-eslint/no-empty-object-type
		interface PageData {}
		// eslint-disable-next-line @typescript-eslint/no-empty-object-type
		interface PageState {}
		interface Platform {
			env?: {
				HYPERDRIVE?: { connectionString: string };
				DC_SESSION_KV?: KVNamespace;
				REGISTRATION_RETRY_KV?: KVNamespace;
				REJECTION_MONITOR_KV?: KVNamespace;
				VICAL_KV?: KVNamespace;
				PACKET_CACHE_KV?: KVNamespace;
				PUBLIC_APP_URL?: string;
			};
			context?: {
				waitUntil: (promise: Promise<unknown>) => void;
				passThroughOnException: () => void;
			};
		}
	}

	interface Window {
		analytics?: {
			track: (_event: string, properties?: Record<string, unknown>) => void;
			identify: (userId: string, traits?: Record<string, unknown>) => void;
			page: (name?: string, properties?: Record<string, unknown>) => void;
			// Specialized tracking methods
			trackAuthCompleted: (templateId: string, provider: string, userId: string) => void;
			trackTemplateUsed: (templateId: string, deliveryMethod: string, userId?: string) => void;
			trackInteraction: (
				element: string,
				action: string,
				properties?: Record<string, unknown>
			) => void;
		};
	}
}

declare global {
	namespace NodeJS {
		interface ProcessEnv {
			// Core Environment
			NODE_ENV: 'development' | 'production' | 'test';
			ORIGIN?: string;

			// Security & Authentication
			JWT_SECRET?: string; // Used for token signing
			EMAIL_VERIFICATION_SECRET?: string; // Optional, falls back to JWT_SECRET
			IDENTITY_HASH_SALT?: string; // Sybil-resistant identity hashing (NEVER regenerate in production)
			IP_HASH_SALT?: string; // Privacy-preserving IP anonymization (daily rotation)
			OAUTH_ENCRYPTION_KEY?: string; // AES-256-GCM key for OAuth token encryption at rest
			BRIDGE_ENCRYPTION_KEY?: string; // AES-256-GCM key for bridge session encryption
			CONVEX_JWT_PRIVATE_KEY?: string; // RSA private key (PKCS#8 PEM) for minting Convex auth JWTs
			CONVEX_AUTH_ISSUER?: string; // JWT issuer URL (defaults to https://commons.email)

			// Analytics Configuration
			USE_SNAPSHOT_ONLY?: string; // 'true' = use privacy-preserving snapshots only (production default)

			// Rate Limiting
			RATE_LIMIT_USE_DB?: string; // 'true' = use database for rate limit state

			// Cron Jobs
			CRON_SECRET?: string; // Authenticate cron endpoints

			// OAuth Configuration
			OAUTH_REDIRECT_BASE_URL?: string;
			GOOGLE_CLIENT_ID?: string;
			GOOGLE_CLIENT_SECRET?: string;
			FACEBOOK_CLIENT_ID?: string;
			FACEBOOK_CLIENT_SECRET?: string;
			LINKEDIN_CLIENT_ID?: string;
			LINKEDIN_CLIENT_SECRET?: string;
			TWITTER_CLIENT_ID?: string;
			TWITTER_CLIENT_SECRET?: string;
			DISCORD_CLIENT_ID?: string;
			DISCORD_CLIENT_SECRET?: string;

			// Congressional Integration (CWC)
			CWC_API_KEY?: string;
			CWC_API_BASE_URL?: string;
			CWC_CAMPAIGN_ID?: string;
			CWC_DELIVERY_AGENT_ID?: string;
			CWC_DELIVERY_AGENT_NAME?: string;
			CWC_DELIVERY_AGENT_CONTACT?: string;
			CWC_DELIVERY_AGENT_ACKNOWLEDGEMENT_EMAIL?: string;
			CWC_DELIVERY_AGENT_ACK?: 'Y' | 'N';

			// CWC production toggle (set 'true' to use /messages/ instead of /testing-messages/)
			CWC_PRODUCTION?: string;

			// GCP Proxy (for House CWC API - requires IP whitelisting)
			GCP_PROXY_URL?: string;
			GCP_PROXY_AUTH_TOKEN?: string;

			// AI Services
			GEMINI_API_KEY?: string; // Used for quality assessment and AI agents
			GROQ_API_KEY?: string; // Used for Llama Guard 4 safety moderation

			// Identity Verification (mDL via Digital Credentials API — no provider API keys needed)
			// District resolution via Shadow Atlas H3 mapping (no external API keys needed)

			// Shadow Atlas content sources
			ATLAS_BASE_URL?: string; // R2 custom domain (primary reads)
			IPFS_CID_ROOT?: string; // IPFS root CID (activates IPFS source layer)
			IPFS_CID_MERKLE_SNAPSHOT?: string; // Separate Merkle snapshot CID (legacy)
			IPFS_GATEWAYS?: string; // Comma-separated IPFS gateway URLs

			// Witness Encryption (X25519 keypair for witness encryption/decryption)
			// Generate with: npx tsx scripts/generate-witness-keypair.ts
			WITNESS_ENCRYPTION_PUBLIC_KEY?: string;
			WITNESS_ENCRYPTION_PRIVATE_KEY?: string;

			// Logging and Monitoring
			LOG_LEVEL?: string;
		}
	}
}

export {};
