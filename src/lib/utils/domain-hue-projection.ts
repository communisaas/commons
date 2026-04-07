/**
 * Domain Hue Projection — embedding space → hue angle.
 *
 * Projects a template's topic embedding onto pre-computed anchor embeddings
 * to derive a semantically meaningful oklch hue angle. Semantically similar
 * templates get similar hues — "Water Quality" and "Drinking Water Safety"
 * both land near the environment anchor's green.
 *
 * Uses weighted circular interpolation of top-K anchors to produce smooth
 * color gradients across the civic domain space.
 */

import anchorsData from './domain-anchors.json';

interface Anchor {
	label: string;
	hue: number;
	embedding: number[];
}

const ANCHORS: Anchor[] = anchorsData as Anchor[];

/** Cosine similarity between two vectors of equal length. */
function cosine(a: number[], b: number[]): number {
	let dot = 0, magA = 0, magB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		magA += a[i] * a[i];
		magB += b[i] * b[i];
	}
	const denom = Math.sqrt(magA) * Math.sqrt(magB);
	return denom === 0 ? 0 : dot / denom;
}

/**
 * Circular weighted mean of hue angles.
 *
 * Hue is circular (0° = 360°), so naive averaging fails:
 * mean(350°, 10°) should be 0°, not 180°. This converts to
 * Cartesian coordinates, averages, and converts back.
 */
function circularWeightedMean(hues: number[], weights: number[]): number {
	let sinSum = 0, cosSum = 0, weightSum = 0;
	for (let i = 0; i < hues.length; i++) {
		const rad = (hues[i] * Math.PI) / 180;
		sinSum += weights[i] * Math.sin(rad);
		cosSum += weights[i] * Math.cos(rad);
		weightSum += weights[i];
	}
	if (weightSum === 0) return 0;
	const angle = (Math.atan2(sinSum / weightSum, cosSum / weightSum) * 180) / Math.PI;
	return ((angle % 360) + 360) % 360;
}

/**
 * Project a topic embedding onto the anchor space to derive a hue angle.
 *
 * @param embedding - 768-dimensional topic embedding from Gemini
 * @param topK - Number of closest anchors to interpolate (default 3)
 * @returns Hue angle 0-360
 */
export function projectToHue(embedding: number[], topK = 3): number {
	if (!embedding?.length || ANCHORS.length === 0) return 0;

	// Compute similarity to each anchor
	const scored = ANCHORS.map((anchor) => ({
		hue: anchor.hue,
		similarity: cosine(embedding, anchor.embedding),
	}));

	// Sort by similarity descending, take top K
	scored.sort((a, b) => b.similarity - a.similarity);
	const top = scored.slice(0, topK);

	// Weight by similarity (shift to positive range for weighting)
	const minSim = Math.min(...top.map((t) => t.similarity));
	const shifted = top.map((t) => ({
		hue: t.hue,
		weight: Math.max(0, t.similarity - minSim + 0.01),
	}));

	return circularWeightedMean(
		shifted.map((s) => s.hue),
		shifted.map((s) => s.weight)
	);
}
