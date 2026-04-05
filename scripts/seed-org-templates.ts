#!/usr/bin/env npx tsx
/**
 * Org-Scoped Agent-Powered Seed Script
 *
 * Generates org-specific template content using the full agent pipeline:
 *   subject line -> decision makers -> message -> moderation -> snapshot entry
 *
 * Pure JSON output — does NOT write to any database.
 * Output: scripts/seed-org-snapshot.json  (keyed by orgSlug)
 *
 * Usage:
 *   npx tsx scripts/seed-org-templates.ts
 *
 * Environment:
 *   GEMINI_API_KEY  — required (subject-line, decision-maker, message-writer agents)
 *   GROQ_API_KEY    — required (moderation pipeline)
 *   EXA_API_KEY     — optional (source discovery + decision-maker research)
 */

import 'dotenv/config';
import { writeFileSync } from 'fs';
import { join } from 'path';

import { processVibe, sleep } from './lib/seed-pipeline';
import type { Vibe, TemplateSnapshot } from './lib/seed-pipeline';

// ============================================================================
// Org Vibes
// ============================================================================

const VIBES: Vibe[] = [
	{
		vibe: 'The Clean Energy Investment Act would create 2.1 million jobs and cut carbon emissions 40% by 2035. Every dollar invested returns $3.20 in economic activity. Congress needs to pass it now.',
		orgSlug: 'climate-action-now',
		fallbackCategory: 'Energy',
		countryCode: 'US',
	},
	{
		vibe: 'Same-day voter registration increases turnout by 5-7%. Mail-in voting reduces cost per ballot by 40%. Twenty states still block both. The Voter Access Expansion Act fixes this.',
		orgSlug: 'voter-rights-coalition',
		fallbackCategory: 'Voting Rights',
		countryCode: 'US',
	},
	{
		vibe: "San Francisco approved 82,000 housing units since 2015 but only built 29,000. Permitting takes 27 months average. The city's own data shows streamlining approvals would cut costs 18% and timelines in half.",
		orgSlug: 'local-first-sf',
		fallbackCategory: 'Housing',
		countryCode: 'US',
		locationHint: { city: 'San Francisco', state: 'CA', displayName: 'San Francisco, CA' },
	},
];

// ============================================================================
// Main
// ============================================================================

async function main() {
	const startTime = Date.now();

	if (!process.env.GEMINI_API_KEY) {
		console.error('ERROR: GEMINI_API_KEY environment variable required');
		console.error('  This script calls Gemini for subject lines, decision makers, and messages.');
		process.exit(1);
	}

	console.log('='.repeat(70));
	console.log('ORG-SCOPED AGENT-POWERED SEED');
	console.log('Pipeline: subject line -> decision makers -> message -> moderation');
	console.log(`Vibes: ${VIBES.length} orgs to process`);
	console.log('='.repeat(70));
	console.log('');

	const results: Record<string, TemplateSnapshot> = {};
	const errors: Array<{ orgSlug: string; error: string }> = [];

	for (let i = 0; i < VIBES.length; i++) {
		const vibe = VIBES[i];
		const label = `[${vibe.orgSlug}]`;

		console.log(`\n${'─'.repeat(70)}`);
		console.log(`[${i + 1}/${VIBES.length}] ${vibe.orgSlug} (${vibe.fallbackCategory})`);
		console.log(`${'─'.repeat(70)}`);

		try {
			const snapshot = await processVibe({ vibe, label });

			if (snapshot) {
				results[vibe.orgSlug!] = snapshot;
				console.log(`\n[${vibe.orgSlug}] COMPLETE — ${snapshot.approved ? 'APPROVED' : 'REJECTED'}`);
			} else {
				errors.push({ orgSlug: vibe.orgSlug!, error: 'No subject line generated' });
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`\n[${vibe.orgSlug}] FAILED: ${message}`);
			errors.push({ orgSlug: vibe.orgSlug!, error: message });
		}

		// Rate limit between vibes
		if (i < VIBES.length - 1) {
			console.log('\nWaiting 2s before next org...');
			await sleep(2000);
		}
	}

	// ── Write Output ──────────────────────────────────────────────────────

	const outputPath = join(process.cwd(), 'scripts', 'seed-org-snapshot.json');
	writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');

	const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);

	console.log('');
	console.log('='.repeat(70));
	console.log('SUMMARY');
	console.log('='.repeat(70));
	console.log(`  Output:    ${outputPath}`);
	console.log(`  Succeeded: ${Object.keys(results).length}/${VIBES.length}`);
	console.log(`  Failed:    ${errors.length}`);
	console.log(`  Duration:  ${totalDuration}s`);
	console.log('');

	for (const [slug, snap] of Object.entries(results)) {
		console.log(`  ${snap.approved ? 'OK' : 'REJECTED'}  ${slug}`);
		console.log(`         title: "${snap.title}"`);
		console.log(`         DMs:   ${snap.decisionMakers.length}`);
		console.log(`         sources: ${snap.sources.length}`);
	}

	if (errors.length > 0) {
		console.log('');
		console.log('  ERRORS:');
		for (const e of errors) {
			console.log(`    ${e.orgSlug}: ${e.error}`);
		}
	}

	console.log('');
}

// ============================================================================
// Run
// ============================================================================

main().catch((err) => {
	console.error('FATAL:', err);
	process.exit(1);
});
