import type { IntegrityMetrics } from '$lib/types/verification-packet';

/** Burst velocity above this reads as a rate spike worth a second look. */
export const BURST_VELOCITY_REVIEW_THRESHOLD = 5;

export function hasBurstWarning(metrics: IntegrityMetrics): boolean {
	return (
		metrics.burstVelocity !== null && metrics.burstVelocity > BURST_VELOCITY_REVIEW_THRESHOLD
	);
}

/**
 * One-line, plain-language reading of the coordination metrics.
 *
 * Privacy model (see docs/design/READER-PRIVACY-MODEL.md): this prose is the
 * only integrity surface shown by default. We render qualitative thresholds
 * ("spread across multiple areas") instead of raw numeric values (0.71, 0.84)
 * because a 0.71 → 0.72 increment is a polling oracle — an adversary watching
 * the value tick by one can attribute that increment to a single new action,
 * defeating per-campaign K-anonymity. The output never contains numerals.
 */
export function assessIntegrity(metrics: IntegrityMetrics): string {
	if (hasBurstWarning(metrics)) return 'Unusual activity spike detected. May warrant review.';
	const parts: string[] = [];
	if (metrics.gds !== null && metrics.gds >= 0.7) parts.push('spread across multiple areas');
	else if (metrics.gds !== null) parts.push('concentrated in a few areas');
	if (metrics.ald !== null && metrics.ald >= 0.7) parts.push('most messages are distinct');
	else if (metrics.ald !== null) parts.push('many messages are similar');
	if (metrics.temporalEntropy !== null && metrics.temporalEntropy >= 2)
		parts.push('submitted over time');
	if (parts.length === 0) return 'Accumulating data.';
	const sentence = parts.join(', ') + '.';
	return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
