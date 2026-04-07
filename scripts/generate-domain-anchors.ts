/**
 * Generate domain anchor embeddings for the topic hue color system.
 *
 * Each anchor is a representative phrase for a civic domain, embedded via Gemini.
 * The resulting vectors are the fixed points of the color space — template embeddings
 * are projected onto these anchors to derive a semantically meaningful hue angle.
 *
 * Usage: npx tsx scripts/generate-domain-anchors.ts
 * Output: src/lib/utils/domain-anchors.json
 */

import { generateBatchEmbeddings } from '../src/lib/core/search/gemini-embeddings.js';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

// Each anchor: a short phrase that represents the civic domain, plus its pinned hue.
// Phrases are richer than keywords — they give the embedding model enough context
// to place the vector in the right region of semantic space.
const ANCHORS = [
	{ label: 'Healthcare', phrase: 'healthcare and medical access, public health, telehealth', hue: 240 },
	{ label: 'Environment', phrase: 'environment, climate change, clean energy, conservation, parks', hue: 150 },
	{ label: 'Housing', phrase: 'housing affordability, zoning reform, homelessness, urban development', hue: 55 },
	{ label: 'Education', phrase: 'education, schools, childcare, preschool, libraries, tuition', hue: 290 },
	{ label: 'Labor', phrase: 'labor rights, wages, workers, employment, unions, pay equity', hue: 180 },
	{ label: 'Immigration', phrase: 'immigration, human rights, refugees, asylum, green cards, visas', hue: 270 },
	{ label: 'Justice', phrase: 'criminal justice, policing, incarceration, sentencing, prison reform', hue: 320 },
	{ label: 'Governance', phrase: 'government, legislation, congress, public policy, veterans affairs', hue: 85 },
	{ label: 'Technology', phrase: 'digital privacy, technology regulation, artificial intelligence, cybersecurity', hue: 160 },
	{ label: 'Transportation', phrase: 'transportation, transit, infrastructure, roads, parking, bike lanes, highways', hue: 35 },
	{ label: 'Indigenous Rights', phrase: 'indigenous rights, tribal sovereignty, reconciliation, First Nations, revenue sharing', hue: 25 },
];

async function main() {
	console.log(`Generating embeddings for ${ANCHORS.length} domain anchors...`);

	const phrases = ANCHORS.map((a) => a.phrase);
	const embeddings = await generateBatchEmbeddings(phrases, { taskType: 'RETRIEVAL_DOCUMENT' });

	const anchors = ANCHORS.map((a, i) => ({
		label: a.label,
		hue: a.hue,
		embedding: embeddings[i],
	}));

	// Sanity check: cosine similarity between related anchors
	function cosine(a: number[], b: number[]): number {
		let dot = 0, magA = 0, magB = 0;
		for (let i = 0; i < a.length; i++) {
			dot += a[i] * b[i];
			magA += a[i] * a[i];
			magB += b[i] * b[i];
		}
		return dot / (Math.sqrt(magA) * Math.sqrt(magB));
	}

	console.log('\nSanity check — cosine similarities between anchors:');
	console.log(`  Healthcare ↔ Education: ${cosine(anchors[0].embedding, anchors[3].embedding).toFixed(3)}`);
	console.log(`  Housing ↔ Environment: ${cosine(anchors[2].embedding, anchors[1].embedding).toFixed(3)}`);
	console.log(`  Healthcare ↔ Transportation: ${cosine(anchors[0].embedding, anchors[9].embedding).toFixed(3)}`);
	console.log(`  Justice ↔ Immigration: ${cosine(anchors[6].embedding, anchors[5].embedding).toFixed(3)}`);
	console.log(`  Labor ↔ Technology: ${cosine(anchors[4].embedding, anchors[8].embedding).toFixed(3)}`);

	const outPath = resolve(import.meta.dirname ?? '.', '../src/lib/utils/domain-anchors.json');
	writeFileSync(outPath, JSON.stringify(anchors, null, 2));
	console.log(`\nWrote ${outPath} (${anchors.length} anchors × 768 dimensions)`);
}

main().catch((err) => {
	console.error('Failed:', err);
	process.exit(1);
});
