/**
 * Analytics Snapshot Materialization
 *
 * Server-side differential privacy: materialize noisy snapshots from raw aggregates.
 * Called daily by cron at 00:05 UTC.
 *
 * CRITICAL: This file is used by:
 * 1. Convex cron (internal.analytics.materializeSnapshot) — server-side
 * 2. Client-side query validation (for quota/budget checks)
 *
 * Keep this file isomorphic (no Node.js-specific APIs).
 */

import { PRIVACY } from '$lib/types/analytics';
import { cryptoRandom } from './noise';

// =============================================================================
// TYPES
// =============================================================================

export interface NoiseConfig {
	epsilon: number;
	sensitivity: number;
}

// =============================================================================
// RNG SEEDING
// =============================================================================

/**
 * Generate a seed for deterministic noise generation
 *
 * For auditability: same seed produces same noise sequence
 * Uses crypto RNG to ensure unpredictable but reproducible results
 *
 * @returns 32-character hex string seed
 */
export function generateNoiseSeed(): string {
	const bytes: number[] = [];
	for (let i = 0; i < 16; i++) {
		bytes.push(Math.floor(cryptoRandom() * 256));
	}
	return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Seeded LCG (Linear Congruential Generator) for deterministic RNG
 *
 * Reproducible noise generation from a seed.
 * Input: seed (hex string)
 * Output: function that generates deterministic random numbers [0, 1)
 *
 * NOT cryptographically secure (not needed for noise generation after seed),
 * but deterministic for auditability.
 */
export function seededLaplace(
	seed: string,
	epsilon: number = PRIVACY.SERVER_EPSILON
): (count: number) => number {
	// Parse seed as initial state
	let state = parseInt(seed.substring(0, 8), 16) || 1;
	const scale = PRIVACY.SENSITIVITY / epsilon;

	return (count: number) => {
		// LCG: x_{n+1} = (a * x_n + c) mod m
		const a = 1664525;
		const c = 1013904223;
		const m = 2 ** 32;

		state = (a * state + c) >>> 0; // Keep in 32-bit range
		const u = state / m - 0.5;

		// Clamp |u| away from 0.5 to avoid log(0) singularity
		const uAbs = Math.min(Math.abs(u), 0.4999999);
		// Laplace: -λ * sign(u) * ln(1 - 2|u|)
		const noise = -scale * Math.sign(u) * Math.log(1 - 2 * uAbs);
		return Math.max(0, Math.round(count + noise));
	};
}

/**
 * Apply Laplace noise to a count using seeded RNG
 *
 * @param count True count
 * @param seed Noise seed
 * @param epsilon Privacy parameter
 * @returns Noisy count (clamped to >= 0)
 */
export function applySeededLaplaceNoise(
	count: number,
	seed: string,
	epsilon: number = PRIVACY.SERVER_EPSILON
): number {
	const noiseFn = seededLaplace(seed, epsilon);
	return noiseFn(count);
}

// =============================================================================
// SNAPSHOT MATERIALIZATION
// =============================================================================

/**
 * Materialize a noisy snapshot from raw aggregates
 *
 * IMPORTANT: This is for type definitions and client-side validation.
 * The actual snapshot materialization happens in Convex (convex/analytics.ts).
 *
 * @param aggregates Raw aggregate records
 * @param epsilon Privacy parameter
 * @returns Snapshot records with noise applied
 */
export interface AggregateRecord {
	metric: string;
	count: number;
	templateId?: string;
	jurisdiction?: string;
	deliveryMethod?: string;
	utmSource?: string;
	errorType?: string;
}

export interface SnapshotRecord extends AggregateRecord {
	noisyCount: number;
	noiseSeed: string;
	epsilon: number;
}

export function materializeNoisySnapshot(
	aggregates: AggregateRecord[],
	snapshotDate: number,
	epsilon: number = PRIVACY.SERVER_EPSILON
): SnapshotRecord[] {
	const seed = generateNoiseSeed();

	return aggregates.map((agg) => ({
		metric: agg.metric,
		count: agg.count,
		templateId: agg.templateId,
		jurisdiction: agg.jurisdiction,
		deliveryMethod: agg.deliveryMethod,
		utmSource: agg.utmSource,
		errorType: agg.errorType,
		noisyCount: applySeededLaplaceNoise(agg.count, seed, epsilon),
		noiseSeed: seed,
		epsilon,
	}));
}

// =============================================================================
// QUERY INTERFACE (Client-Side)
// =============================================================================

/**
 * Query noisy snapshots from the database
 *
 * NOTE: This function signature is defined here for type safety,
 * but the actual implementation is in Convex (internal.analytics.queryNoisySnapshots).
 *
 * @param metric Metric to query
 * @param startDate Start date (epoch ms)
 * @param endDate End date (epoch ms)
 * @returns Array of snapshot records
 */
export async function queryNoisySnapshots(
	metric: string,
	startDate: number,
	endDate: number
): Promise<SnapshotRecord[]> {
	// This is a type-only function
	// Implementation is in Convex query (internal.analytics.queryNoisySnapshots)
	throw new Error('queryNoisySnapshots must be called via Convex');
}

// =============================================================================
// BUDGET HELPERS (Client-Side)
// =============================================================================

/**
 * Get remaining privacy budget
 *
 * NOTE: Actual budget tracking is in privacyBudgets Convex table.
 * This is a type definition for client-side code.
 */
export async function getRemainingBudget(): Promise<number> {
	throw new Error('getRemainingBudget must be called via Convex query');
}

/**
 * Get full budget status
 *
 * NOTE: Actual status is fetched from Convex.
 * This is a type definition for client-side code.
 */
export interface BudgetStatus {
	metric: string;
	consumed: number;
	remaining: number;
	limit: number;
}

export async function getBudgetStatus(metric: string): Promise<BudgetStatus> {
	throw new Error('getBudgetStatus must be called via Convex query');
}
