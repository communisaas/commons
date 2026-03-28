/**
 * Cache Invalidation Utilities
 *
 * Handles clearing of client-side caches for:
 * 1. Address/location updates (invalidate ALL location-bearing state)
 * 2. Logout (clear all user-specific cached data)
 *
 * Caches managed:
 * - commons-session (IndexedDB): Live session credentials with district/tree state
 * - commons-sessions (IndexedDB): Legacy session cache (deprecated)
 * - commons-address (IndexedDB): Encrypted constituent address (6-month TTL)
 * - commons_location (IndexedDB): Location signals and inferred location
 * - commons_guest_template (localStorage): Guest state with address
 * - commons_bubble (localStorage): Postal bubble center/radius
 * - commons_location_scope (localStorage): Homepage scope filter
 */

import { z } from 'zod';
import { browser } from '$app/environment';

// IndexedDB database names
const SESSION_DB_NAME_LEGACY = 'commons-sessions';
const SESSION_DB_NAME = 'commons-session';
const ADDRESS_DB_NAME = 'commons-address';
const LOCATION_DB_NAME = 'commons_location';

// localStorage keys
const GUEST_STATE_KEY = 'commons_guest_template';
const BUBBLE_KEY = 'commons_bubble';
const SCOPE_KEY = 'commons_location_scope';

// =============================================================================
// ZOD SCHEMA
// =============================================================================

const GuestStateSchema = z.object({
	address: z.string().optional()
}).passthrough(); // Allow additional fields

/**
 * Clear ALL location-bearing client state.
 * Call when user updates their address.
 *
 * This clears every cache that could reassert a stale location:
 * - Location signals + inferred location (IndexedDB)
 * - Encrypted constituent address (IndexedDB, 6-month TTL)
 * - Session tree state with district (IndexedDB, 6-month TTL)
 * - Guest state address (localStorage)
 * - Bubble center/radius (localStorage)
 * - Location scope filter (localStorage)
 */
export async function invalidateLocationCaches(userId?: string): Promise<void> {
	if (!browser) return;

	console.debug('[CacheInvalidation] Clearing ALL location-bearing state...');

	// 1. Location signals + inferred location (IndexedDB)
	try {
		const { locationStorage } = await import('$lib/core/location/storage');
		await locationStorage.clearAll();
	} catch (error) {
		console.error('[CacheInvalidation] Failed to clear location storage:', error);
	}

	// 2. Encrypted constituent address (IndexedDB, 6-month TTL)
	// This is the #1 source of stale location reassertion for Tier 2+ users
	try {
		if (userId) {
			const { clearConstituentAddress } = await import('$lib/core/identity/constituent-address');
			await clearConstituentAddress(userId);
		} else {
			await clearDatabase(ADDRESS_DB_NAME);
		}
	} catch (error) {
		console.error('[CacheInvalidation] Failed to clear constituent address:', error);
	}

	// 3. Session tree state with district (IndexedDB, 6-month TTL)
	// Tree state holds congressionalDistrict — must be re-derived after address change
	try {
		if (userId) {
			const { clearTreeState } = await import('$lib/core/identity/session-credentials');
			await clearTreeState(userId);
		} else {
			// No userId — clear the entire live session DB
			await clearDatabase(SESSION_DB_NAME);
		}
	} catch (error) {
		console.error('[CacheInvalidation] Failed to clear session tree state:', error);
	}

	// 4. Guest state address (localStorage)
	try {
		const storedState = localStorage.getItem(GUEST_STATE_KEY);
		if (storedState) {
			const parsed = JSON.parse(storedState);
			const validationResult = GuestStateSchema.safeParse(parsed);

			if (!validationResult.success) {
				localStorage.removeItem(GUEST_STATE_KEY);
			} else if (validationResult.data.address) {
				delete validationResult.data.address;
				localStorage.setItem(GUEST_STATE_KEY, JSON.stringify(validationResult.data));
			}
		}
	} catch (error) {
		console.error('[CacheInvalidation] Failed to clear guest state address:', error);
	}

	// 5. Bubble center/radius (localStorage)
	try {
		localStorage.removeItem(BUBBLE_KEY);
	} catch (error) {
		console.error('[CacheInvalidation] Failed to clear bubble state:', error);
	}

	// 6. Location scope filter (localStorage)
	try {
		localStorage.removeItem(SCOPE_KEY);
	} catch (error) {
		console.error('[CacheInvalidation] Failed to clear location scope:', error);
	}

	console.debug('[CacheInvalidation] All location-bearing state cleared');
}

/**
 * Clear session credentials cache for a specific user
 * Call when user's verification/identity changes
 *
 * Clears BOTH the live session DB (commons-session) and
 * the legacy session DB (commons-sessions) to prevent stale
 * credentials from either store reasserting old state.
 */
export async function invalidateSessionCredentials(userId?: string): Promise<void> {
	if (!browser) return;

	console.debug('[CacheInvalidation] Clearing session credentials...');

	// Clear live session DB (commons-session)
	try {
		if (userId) {
			const { clearSessionCredential } = await import('$lib/core/identity/session-credentials');
			await clearSessionCredential(userId);
		} else {
			await clearDatabase(SESSION_DB_NAME);
		}
	} catch (error) {
		console.error('[CacheInvalidation] Failed to clear live session credentials:', error);
	}

	// Clear legacy session DB (commons-sessions) — may still exist on returning users
	try {
		await clearDatabase(SESSION_DB_NAME_LEGACY);
	} catch (error) {
		console.error('[CacheInvalidation] Failed to clear legacy session credentials:', error);
	}
}

/**
 * Clear all client-side caches (for logout)
 * Call before redirecting to /auth/logout
 */
export async function clearAllClientCaches(): Promise<void> {
	if (!browser) return;

	console.debug('[CacheInvalidation] Clearing ALL client caches...');

	// Clear location storage
	await invalidateLocationCaches();

	// Clear session credentials + derived key material from memory
	await invalidateSessionCredentials();
	try {
		const { discardDerivedKeys } = await import('./credential-encryption');
		discardDerivedKeys();
	} catch {
		// credential-encryption may not be loaded — safe to ignore
	}

	// Clear guest state entirely
	try {
		localStorage.removeItem(GUEST_STATE_KEY);
		console.debug('[CacheInvalidation] Cleared guest state');
	} catch (error) {
		console.error('[CacheInvalidation] Failed to clear guest state:', error);
	}

	// Clear any other localStorage items specific to the user
	try {
		// Only clear commons-prefixed items
		const keysToRemove: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key && key.startsWith('commons')) {
				keysToRemove.push(key);
			}
		}
		keysToRemove.forEach((key) => localStorage.removeItem(key));
		console.debug('[CacheInvalidation] Cleared localStorage items:', keysToRemove);
	} catch (error) {
		console.error('[CacheInvalidation] Failed to clear localStorage:', error);
	}

	console.debug('[CacheInvalidation] All client caches cleared');
}

/**
 * Helper to delete an entire IndexedDB database
 */
async function clearDatabase(dbName: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.deleteDatabase(dbName);
		request.onsuccess = () => {
			console.debug(`[CacheInvalidation] Deleted database: ${dbName}`);
			resolve();
		};
		request.onerror = () => {
			console.error(`[CacheInvalidation] Failed to delete database: ${dbName}`);
			reject(request.error);
		};
		request.onblocked = () => {
			console.warn(`[CacheInvalidation] Database deletion blocked: ${dbName}`);
			// Still resolve as the deletion will complete when connections close
			resolve();
		};
	});
}

/**
 * Logout with proper cache clearing
 * Use this instead of directly navigating to /auth/logout
 */
export async function performLogout(): Promise<void> {
	if (!browser) return;

	// Close held IndexedDB connections FIRST so deleteDatabase() isn't blocked.
	// The root layout's $effect holds commons-session open via getSessionCredential().
	try {
		const { closeDatabase } = await import('$lib/core/identity/session-credentials');
		closeDatabase();
	} catch {
		// Module may not be loaded yet — safe to skip
	}

	// Best-effort cache clearing with a hard timeout.
	// Navigation MUST happen even if IndexedDB ops hang.
	const cacheClearing = clearAllClientCaches();
	const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2000));
	await Promise.race([cacheClearing, timeout]);

	// Redirect to server-side logout
	window.location.href = '/auth/logout';
}
