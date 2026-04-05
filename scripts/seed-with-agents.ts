#!/usr/bin/env npx tsx
/**
 * Agent-Powered Seed Script
 *
 * Generates template content by running each vibe through the full agent pipeline:
 *   subject line -> decision makers -> message -> moderation
 *
 * Writes output to scripts/seed-snapshot.json as { [slug]: TemplateSnapshot }.
 * Does NOT write to any database.
 *
 * Usage:
 *   npx tsx scripts/seed-with-agents.ts
 *   VIBE_LIMIT=3 npx tsx scripts/seed-with-agents.ts   # first N only
 *
 * Required: GEMINI_API_KEY
 * Optional: GROQ_API_KEY (moderation), EXA_API_KEY (source discovery), VIBE_LIMIT
 */

import 'dotenv/config';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

import { processVibe, sleep } from './lib/seed-pipeline';
import type { TemplateSnapshot } from './lib/seed-pipeline';
import { VIBES } from './seed-vibes';

// ============================================================================
// Main
// ============================================================================

async function main() {
	const startTime = Date.now();

	// ── Preflight checks ──────────────────────────────────────────────────

	if (!process.env.GEMINI_API_KEY) {
		console.error('ERROR: GEMINI_API_KEY environment variable is required.');
		console.error('Get a key from: https://aistudio.google.com/apikey');
		process.exit(1);
	}

	// VIBE_INDICES=0,5,7 processes only specific indices (1-based to match log labels)
	// VIBE_LIMIT=N processes first N. If neither, processes all.
	// When VIBE_INDICES is set, merges with existing seed-snapshot.json.
	const outputPath = join(import.meta.dirname || process.cwd(), 'seed-snapshot.json');
	const vibeIndicesEnv = process.env.VIBE_INDICES;
	let vibesToProcess: typeof VIBES;
	let mergeMode = false;

	if (vibeIndicesEnv) {
		const indices = vibeIndicesEnv.split(',').map((s) => parseInt(s.trim(), 10) - 1);
		vibesToProcess = indices.map((i) => VIBES[i]).filter(Boolean);
		mergeMode = true;
	} else {
		const vibeLimit = process.env.VIBE_LIMIT ? parseInt(process.env.VIBE_LIMIT, 10) : VIBES.length;
		vibesToProcess = VIBES.slice(0, vibeLimit);
	}

	console.log('=== Agent-Powered Seed Script ===');
	if (mergeMode) {
		console.log(`Retry mode: reprocessing ${vibesToProcess.length} vibes (indices: ${vibeIndicesEnv})`);
	}
	console.log(`Processing ${vibesToProcess.length} of ${VIBES.length} vibes`);
	console.log(`GEMINI_API_KEY: ${'*'.repeat(8)}...${process.env.GEMINI_API_KEY.slice(-4)}`);
	console.log(`GROQ_API_KEY: ${process.env.GROQ_API_KEY ? 'present' : 'missing (moderation will be skipped)'}`);
	console.log(`EXA_API_KEY: ${process.env.EXA_API_KEY ? 'present' : 'missing (source discovery limited)'}`);
	console.log('');

	// ── Process vibes sequentially ────────────────────────────────────────

	const snapshots: Record<string, TemplateSnapshot> = {};
	const failures: Array<{ index: number; vibe: string; error: string }> = [];

	for (let i = 0; i < vibesToProcess.length; i++) {
		const vibe = vibesToProcess[i];
		const label = `[${i + 1}/${vibesToProcess.length}]`;

		try {
			const snapshot = await processVibe({ vibe, label });

			if (snapshot) {
				snapshots[snapshot.slug] = snapshot;
			} else {
				failures.push({
					index: i,
					vibe: vibe.vibe.slice(0, 80),
					error: 'No subject line generated'
				});
			}
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			console.error(`\n${label} FAILED: ${errMsg}`);
			failures.push({
				index: i,
				vibe: vibe.vibe.slice(0, 80),
				error: errMsg
			});
		}

		// Rate limit between vibes (5s) — skip after last one
		if (i < vibesToProcess.length - 1) {
			console.log(`\n--- Sleeping 5s (rate limit) ---`);
			await sleep(5000);
		}
	}

	// ── Write snapshot file ───────────────────────────────────────────────

	// In merge mode, layer new snapshots over existing ones (removing old slugs
	// that correspond to the vibes being retried, since slugs may change)
	let finalSnapshots = snapshots;
	if (mergeMode && existsSync(outputPath)) {
		const existing: Record<string, TemplateSnapshot> = JSON.parse(readFileSync(outputPath, 'utf-8'));
		// Remove existing entries whose source vibe is being retried
		const retryVibeTexts = new Set(vibesToProcess.map((v) => v.vibe));
		const retained: Record<string, TemplateSnapshot> = {};
		for (const [slug, snap] of Object.entries(existing)) {
			// We can't perfectly match vibe→slug, so keep all that aren't in the new batch
			if (!(slug in snapshots)) {
				retained[slug] = snap;
			}
		}
		// Prune entries that were generated from the retry vibes (by title matching won't work,
		// so we use a simpler heuristic: drop the oldest matching slug by index)
		// For now, just merge: new snapshots overwrite by slug
		finalSnapshots = { ...retained, ...snapshots };
		console.log(`\nMerged ${Object.keys(snapshots).length} new + ${Object.keys(retained).length} retained = ${Object.keys(finalSnapshots).length} total`);
	}

	writeFileSync(outputPath, JSON.stringify(finalSnapshots, null, 2), 'utf-8');

	// ── Summary ───────────────────────────────────────────────────────────

	const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
	const successCount = Object.keys(snapshots).length;

	console.log('\n');
	console.log('='.repeat(60));
	console.log('  SEED SNAPSHOT COMPLETE');
	console.log('='.repeat(60));
	console.log(`  Output:     ${outputPath}`);
	console.log(`  Succeeded:  ${successCount} / ${vibesToProcess.length}`);
	console.log(`  Failed:     ${failures.length}`);
	console.log(`  Elapsed:    ${elapsed}s`);
	console.log('');

	if (successCount > 0) {
		console.log('  Slugs:');
		for (const slug of Object.keys(snapshots)) {
			const snap = snapshots[slug];
			const dmCount = snap.decisionMakers.length;
			const srcCount = snap.sources.length;
			const modTag = snap.approved ? 'approved' : 'REJECTED';
			console.log(`    - ${slug} (${dmCount} DMs, ${srcCount} sources, ${modTag})`);
		}
	}

	if (failures.length > 0) {
		console.log('');
		console.log('  Failures:');
		for (const f of failures) {
			console.log(`    [${f.index + 1}] ${f.vibe}...`);
			console.log(`        Error: ${f.error}`);
		}
	}

	console.log('');

	if (successCount === 0 && vibesToProcess.length > 0) {
		process.exit(1);
	}
}

// ============================================================================
// Run
// ============================================================================

main().catch((err) => {
	console.error('FATAL:', err);
	process.exit(1);
});
