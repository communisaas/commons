/**
 * Analytics Client
 *
 * Browser-side analytics with:
 * - Single public method: increment()
 * - Batched fire-and-forget sending
 * - Local differential privacy
 *
 * No sessions. No user tracking. No device fingerprinting.
 */

import { z } from 'zod';
import { browser } from '$app/environment';
import {
	PRIVACY,
	METRICS,
	type Metric,
	type Dimensions,
	type DeliveryMethod,
	type Increment,
	isMetric
} from '$lib/types/analytics';
import { sanitizeDimensions, categorizeError } from './sanitize';
import { applyKaryRR } from './noise';

// =============================================================================
// CONFIGURATION
// =============================================================================

const DEBOUNCE_MS = 500;
const ENDPOINT = '/api/analytics/increment';

// =============================================================================
// ZOD SCHEMA
// =============================================================================

const ContributionsSchema = z.record(z.string(), z.number());

// =============================================================================
// CONTRIBUTION TRACKER
// =============================================================================

/**
 * Track per-metric daily contributions in localStorage
 * Prevents client from exceeding MAX_DAILY_CONTRIBUTIONS
 */
class ContributionTracker {
	private readonly storageKey = 'analytics_contributions';
	private readonly maxDaily: number;

	constructor(maxDaily: number = PRIVACY.MAX_DAILY_CONTRIBUTIONS) {
		this.maxDaily = maxDaily;
	}

	canContribute(metric: Metric): boolean {
		const today = this.getTodayKey();
		const contributions = this.getContributions();
		const key = `${today}:${metric}`;
		return (contributions[key] ?? 0) < this.maxDaily;
	}

	recordContribution(metric: Metric): void {
		const today = this.getTodayKey();
		const contributions = this.getContributions();
		const key = `${today}:${metric}`;
		contributions[key] = (contributions[key] ?? 0) + 1;
		// Prune old dates while saving
		this.saveContributions(this.pruneOldDates(contributions, today));
	}

	private getTodayKey(): string {
		// Use UTC to match server bucketing
		return new Date().toISOString().split('T')[0];
	}

	private getContributions(): Record<string, number> {
		try {
			const stored = localStorage.getItem(this.storageKey);
			if (!stored) return {};

			const parsed = JSON.parse(stored);
			const result = ContributionsSchema.safeParse(parsed);

			if (!result.success) {
				console.warn('[analytics] Invalid contributions data, resetting:', result.error.flatten());
				return {};
			}

			return result.data;
		} catch (error) {
			console.warn('[analytics] Failed to parse contributions:', error);
			return {};
		}
	}

	private saveContributions(contributions: Record<string, number>): void {
		try {
			localStorage.setItem(this.storageKey, JSON.stringify(contributions));
		} catch {
			// localStorage unavailable - fail open
		}
	}

	private pruneOldDates(
		contributions: Record<string, number>,
		today: string
	): Record<string, number> {
		return Object.fromEntries(Object.entries(contributions).filter(([k]) => k.startsWith(today)));
	}
}

// =============================================================================
// CLIENT CLASS
// =============================================================================

class AnalyticsClient {
	private queue: Increment[] = [];
	private debounceTimeout: ReturnType<typeof setTimeout> | null = null;
	private readonly ldpEnabled: boolean;
	private readonly contributionTracker: ContributionTracker;

	constructor() {
		// LDP state is IMMUTABLE after construction
		// LDP is OFF by default — enable via VITE_ANALYTICS_DP_ENABLED=true when DAU > ~100
		this.ldpEnabled = import.meta.env.VITE_ANALYTICS_DP_ENABLED === 'true';

		// Initialize contribution tracker
		this.contributionTracker = new ContributionTracker();

		if (browser) {
			// Flush on page visibility change
			document.addEventListener('visibilitychange', () => {
				if (document.visibilityState === 'hidden') {
					this.flush();
				}
			});

			// Flush on page unload
			window.addEventListener('beforeunload', () => {
				this.flush();
			});
		}
	}

	/**
	 * Increment a metric counter
	 *
	 * This is the ONLY public method for recording analytics.
	 */
	increment(metric: Metric, dimensions?: Dimensions): void {
		if (!browser) return;

		// Validate metric
		if (!isMetric(metric)) {
			return; // Silently drop invalid metrics
		}

		// Check contribution limit
		if (!this.contributionTracker.canContribute(metric)) {
			return; // Silently drop - limit exceeded
		}

		// Record contribution
		this.contributionTracker.recordContribution(metric);

		// Sanitize dimensions
		const sanitized = sanitizeDimensions(dimensions);

		// Create increment
		const increment: Increment = {
			metric,
			dimensions: sanitized
		};

		// Apply local differential privacy (k-ary Randomized Response)
		if (!this.ldpEnabled) {
			this.queue.push(increment);
		} else {
			const noisyMetric = applyKaryRR(increment.metric);
			if (noisyMetric !== null) {
				this.queue.push({ metric: noisyMetric, dimensions: increment.dimensions });
			}
		}

		// Flush if batch size reached
		if (this.queue.length >= PRIVACY.MAX_BATCH_SIZE) {
			this.flush();
			return;
		}

		// Schedule debounced flush
		this.scheduleDebouncedFlush();
	}

	/**
	 * Flush queued increments to server
	 */
	flush(): void {
		if (!browser || this.queue.length === 0) return;

		// Clear debounce
		if (this.debounceTimeout) {
			clearTimeout(this.debounceTimeout);
			this.debounceTimeout = null;
		}

		// Take current queue
		const batch = [...this.queue];
		this.queue = [];

		// Fire and forget — no retry, no error handling
		this.send(batch);
	}

	private scheduleDebouncedFlush(): void {
		if (this.debounceTimeout) {
			clearTimeout(this.debounceTimeout);
		}

		this.debounceTimeout = setTimeout(() => {
			this.flush();
		}, DEBOUNCE_MS);
	}

	private send(increments: Increment[]): void {
		// Fire and forget
		fetch(ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ increments }),
			keepalive: true // Survive page unload
		}).catch(() => {
			// Silently ignore failures — privacy > completeness
		});
	}
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const analytics = new AnalyticsClient();

// =============================================================================
// CONVENIENCE METHODS
// =============================================================================

/**
 * Track template view (deduplicated: 1 view per template per browser per day)
 */
export function trackTemplateView(templateId: string, jurisdiction?: string): void {
	if (!browser) return;

	const today = new Date().toISOString().split('T')[0];
	const key = `viewed:${today}`;

	try {
		const seen = JSON.parse(localStorage.getItem(key) || '[]') as string[];
		if (seen.includes(templateId)) return;
		seen.push(templateId);
		localStorage.setItem(key, JSON.stringify(seen));

		// Prune yesterday's key
		const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
		localStorage.removeItem(`viewed:${yesterday}`);
	} catch {
		// localStorage unavailable — fire anyway, server rate-limit catches repeats
	}

	analytics.increment(METRICS.template_view, {
		template_id: templateId,
		jurisdiction
	});
}

/**
 * Track template use (conversion)
 */
export function trackTemplateUse(templateId: string, deliveryMethod: DeliveryMethod): void {
	analytics.increment(METRICS.template_use, {
		template_id: templateId,
		delivery_method: deliveryMethod
	});
}

/**
 * Track template share
 */
export function trackTemplateShare(templateId: string, utmSource?: string): void {
	analytics.increment(METRICS.template_share, {
		template_id: templateId,
		utm_source: utmSource
	});
}

/**
 * Track delivery attempt (deduplicated: 1 action per template per browser per day)
 *
 * Whether someone writes to 1 recipient or 10, individually or via "Write to all",
 * it counts as a single person acting on this template.
 */
export function trackDeliveryAttempt(templateId: string, deliveryMethod: DeliveryMethod): void {
	if (!browser) return;

	const today = new Date().toISOString().split('T')[0];
	const key = `acted:${today}`;

	try {
		const acted = JSON.parse(localStorage.getItem(key) || '[]') as string[];
		if (acted.includes(templateId)) return;
		acted.push(templateId);
		localStorage.setItem(key, JSON.stringify(acted));

		const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
		localStorage.removeItem(`acted:${yesterday}`);
	} catch {
		// localStorage unavailable — fire anyway
	}

	analytics.increment(METRICS.delivery_attempt, {
		template_id: templateId,
		delivery_method: deliveryMethod
	});
}

/**
 * Track delivery success
 */
export function trackDeliverySuccess(templateId: string, deliveryMethod: DeliveryMethod): void {
	analytics.increment(METRICS.delivery_success, {
		template_id: templateId,
		delivery_method: deliveryMethod
	});
}

/**
 * Track delivery failure
 */
export function trackDeliveryFailure(templateId: string, deliveryMethod: DeliveryMethod): void {
	analytics.increment(METRICS.delivery_fail, {
		template_id: templateId,
		delivery_method: deliveryMethod
	});
}

/**
 * Track error (categorized)
 */
export function trackError(error: string | Error): void {
	const errorType = categorizeError(error);
	analytics.increment(errorType as Metric);
}

/**
 * Track auth start
 */
export function trackAuthStart(): void {
	analytics.increment(METRICS.auth_start);
}

/**
 * Track auth complete
 */
export function trackAuthComplete(): void {
	analytics.increment(METRICS.auth_complete);
}

/**
 * Track funnel step
 */
export function trackFunnelStep(step: 1 | 2 | 3 | 4 | 5, templateId?: string): void {
	const metric = `funnel_${step}` as Metric;
	analytics.increment(metric, { template_id: templateId });
}

/**
 * Track a constituent re-grounding (address change after initial verification).
 *
 * The server never sees old or new district identifiers. Only two boolean flags
 * are emitted, encoded into the `utm_source` dimension as a compact tag matching
 * the sanitizer's alphanumeric-only allowlist:
 *   - `d1_s1` — district changed AND state changed
 *   - `d1_s0` — district changed, state unchanged
 *   - `d0_s0` — neither changed (shouldn't happen in practice; benign if it does)
 */
export function trackAddressChanged(districtChanged: boolean, stateChanged: boolean): void {
	analytics.increment(METRICS.address_changed, {
		utm_source: `d${districtChanged ? 1 : 0}_s${stateChanged ? 1 : 0}`
	});
}
