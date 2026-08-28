import { absent, present, withheld, type Fact } from '$lib/core/fact';
import type { IntegrityMetrics } from '$lib/types/verification-packet';

/** Burst velocity above this reads as a rate spike worth a second look. */
export const BURST_VELOCITY_REVIEW_THRESHOLD = 5;

/**
 * Action count below which the coordination audit renders no ratio at all.
 *
 * This is a declared display floor, not a fitted statistic — it carries no
 * significance level, no power calculation, and no confidence interval. Its
 * only claim is the plain one: under this many actions a sameness ratio or a
 * peak-versus-average ratio is decided by a handful of rows, so printing it
 * would show a figure that reads as a measurement without being one.
 */
export const DIAGNOSTIC_ACTION_FLOOR = 25;

export const ACTION_FLOOR_WITHHELD_REASON = 'Not enough actions to read a pattern.';
export const TEMPORAL_WINDOW_WITHHELD_REASON =
	'Actions arrived within an hour of each other. Timing readings are withheld until the observed window spans at least one hour.';

/**
 * Apply the display floor to an already-classified fact. Only a present value
 * can become withheld; absent, blocked, and already-withheld facts keep their
 * original meaning and reason.
 */
export function floorGatedReading(reading: Fact<number>, actionCount: number): Fact<number> {
	if (reading.state !== 'present') return reading;
	if (actionCount < DIAGNOSTIC_ACTION_FLOOR) return withheld(ACTION_FLOOR_WITHHELD_REASON);
	return reading;
}

export interface CoordinationReadingFacts {
	gds: Fact<number>;
	sameness: Fact<number>;
	timing: Fact<number>;
	arrival: Fact<number>;
	cai: Fact<number>;
}

function observedReading(value: number | null): Fact<number> {
	return value === null ? absent() : present(value);
}

function temporalReading(value: number | null, actionCount: number): Fact<number> {
	if (value !== null) return present(value);
	if (actionCount < 2) return absent();
	return withheld(TEMPORAL_WINDOW_WITHHELD_REASON);
}

/**
 * Convert nullable packet fields into facts at the component boundary. A
 * temporal null after two actions means the observed window is too short to
 * publish, while a null before two actions means no reading was computed.
 */
export function coordinationReadingFacts(
	metrics: IntegrityMetrics,
	actionCount: number
): CoordinationReadingFacts {
	return {
		gds: observedReading(metrics.gds),
		sameness: floorGatedReading(
			observedReading(metrics.ald === null ? null : 1 - metrics.ald),
			actionCount
		),
		timing: temporalReading(metrics.temporalEntropy, actionCount),
		arrival: floorGatedReading(temporalReading(metrics.burstVelocity, actionCount), actionCount),
		cai: observedReading(metrics.cai)
	};
}

export function factStatusLabel(reading: Fact<unknown>): string {
	switch (reading.state) {
		case 'present':
			return 'Available';
		case 'absent':
			return 'Not computed';
		case 'withheld':
			return 'Withheld';
		case 'blocked':
			return 'Blocked';
	}
}

export function factExplanation(reading: Fact<unknown>): string | null {
	switch (reading.state) {
		case 'present':
			return null;
		case 'absent':
			return 'No reading was computed from the recorded fields.';
		case 'withheld':
			return reading.why;
		case 'blocked':
			return `Reading blocked before computation: ${reading.why}`;
	}
}

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
