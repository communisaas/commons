#!/usr/bin/env npx tsx
/**
 * Smoke Test: AI Resolution E2E on Scroll Sepolia
 *
 * Tests the full pipeline:
 * 1. Creates a debate (or uses existing debateId from argv)
 * 2. Submits 3 test arguments
 * 3. Waits for deadline to pass
 * 4. Triggers AI evaluation via POST /evaluate
 * 5. Polls GET /ai-resolution until data appears
 * 6. Validates resolution data structure
 *
 * Usage:
 *   npx tsx scripts/smoke-test-ai-resolution.ts [debateId]
 *
 * Environment:
 *   BASE_URL       - commons server URL (default: http://localhost:5173)
 *   CRON_SECRET    - operator auth token
 *   DEBATE_ID      - (optional) use existing debate instead of creating one
 *
 * Prerequisites:
 *   - commons dev server running (npm run dev)
 *   - Convex dev instance attached (npx convex dev)
 *   - .env populated with model API keys + signer keys
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const CRON_SECRET = process.env.CRON_SECRET;

if (!CRON_SECRET) {
	console.error('ERROR: CRON_SECRET environment variable required');
	process.exit(1);
}

// ============================================================================
// Helpers
// ============================================================================

async function api(method: string, path: string, body?: unknown) {
	const url = `${BASE_URL}${path}`;
	const headers: Record<string, string> = {
		'Content-Type': 'application/json'
	};

	if (path.includes('/evaluate')) {
		headers['Authorization'] = `Bearer ${CRON_SECRET}`;
	}

	const res = await fetch(url, {
		method,
		headers,
		body: body ? JSON.stringify(body) : undefined
	});

	const text = await res.text();
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		data = text;
	}

	if (!res.ok) {
		console.error(`  ${method} ${path} → ${res.status}:`, data);
	}

	return { status: res.status, data };
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition: boolean, message: string) {
	if (!condition) {
		console.error(`  FAIL: ${message}`);
		process.exit(1);
	}
	console.log(`  PASS: ${message}`);
}

// ============================================================================
// Test Steps
// ============================================================================

async function main() {
	const startTime = Date.now();
	let debateId = process.argv[2] || process.env.DEBATE_ID;

	console.log('=== AI Resolution Smoke Test ===');
	console.log(`Server: ${BASE_URL}`);
	console.log('');

	// ── Step 1: Get or verify debate ──────────────────────────────────────

	if (debateId) {
		console.log(`Step 1: Using existing debate: ${debateId}`);
	} else {
		console.log('Step 1: No debateId provided.');
		console.log('  To test with an existing debate, pass it as an argument:');
		console.log('  npx tsx scripts/smoke-test-ai-resolution.ts <debateId>');
		console.log('');
		console.log('  Or set DEBATE_ID in environment.');
		console.log('  Debate must be past deadline with arguments submitted.');
		process.exit(1);
	}

	// ── Step 2: Check debate state ───────────────────────────────────────

	console.log('');
	console.log(`Step 2: Checking debate state...`);

	const { status: stateStatus, data: stateData } = await api(
		'GET',
		`/api/debates/${debateId}/ai-resolution`
	);

	if (stateStatus === 404) {
		console.error('  Debate not found. Check the ID.');
		process.exit(1);
	}

	if (stateData?.aiResolution) {
		console.log('  Debate already has AI resolution data.');
		console.log('  Resolution method:', stateData.aiResolution.resolutionMethod);
		console.log('  Signature count:', stateData.aiResolution.signatureCount);
		console.log('  Skipping evaluation — jumping to validation.');
		await validateResolution(debateId, stateData.aiResolution);
		finish(startTime);
		return;
	}

	console.log('  No AI resolution data yet. Proceeding to evaluation.');

	// ── Step 3: Trigger AI evaluation ────────────────────────────────────

	console.log('');
	console.log('Step 3: Triggering AI evaluation...');
	console.log('  (This calls 5 LLM APIs — may take 30-90 seconds)');

	const evalStart = Date.now();
	const { status: evalStatus, data: evalData } = await api(
		'POST',
		`/api/debates/${debateId}/evaluate`
	);

	const evalDuration = ((Date.now() - evalStart) / 1000).toFixed(1);
	console.log(`  Completed in ${evalDuration}s`);

	if (evalStatus === 400) {
		console.error('  Evaluation rejected:', evalData);
		console.error('  Is the debate past deadline? Does it have arguments?');
		process.exit(1);
	}

	if (evalStatus === 503) {
		console.error('  Service unavailable:', evalData);
		console.error('  Check: ai-evaluator installed, model API keys configured.');
		process.exit(1);
	}

	if (evalStatus === 502) {
		console.error('  Upstream error:', evalData);
		if (typeof evalData === 'object' && evalData?.message?.includes('consensus')) {
			console.log('  AI consensus not reached — governance escalation triggered.');
			console.log('  This is a valid outcome. Check /ai-resolution for partial data.');
		}
		process.exit(1);
	}

	assert(evalStatus === 200, `Evaluate returned ${evalStatus} (expected 200)`);
	console.log('  Response:', JSON.stringify(evalData, null, 2));

	// ── Step 4: Poll for resolution data ─────────────────────────────────

	console.log('');
	console.log('Step 4: Fetching AI resolution data...');

	let resolution = null;
	for (let attempt = 0; attempt < 5; attempt++) {
		const { data } = await api('GET', `/api/debates/${debateId}/ai-resolution`);
		if (data?.aiResolution) {
			resolution = data.aiResolution;
			break;
		}
		console.log(`  Attempt ${attempt + 1}/5 — no data yet, waiting 2s...`);
		await sleep(2000);
	}

	assert(resolution !== null, 'AI resolution data available');

	// ── Step 5: Validate resolution structure ────────────────────────────

	await validateResolution(debateId, resolution);

	// ── Step 6: Validate evaluate response ───────────────────────────────

	console.log('');
	console.log('Step 6: Validating evaluate response...');

	assert(evalData.status === 'resolved', `Status is "${evalData.status}" (expected "resolved")`);
	assert(evalData.resolutionMethod === 'ai_community', `Method is "${evalData.resolutionMethod}"`);
	assert(typeof evalData.winningArgumentIndex === 'number', `Winner index: ${evalData.winningArgumentIndex}`);
	assert(typeof evalData.submitTxHash === 'string', `Submit TX: ${evalData.submitTxHash?.slice(0, 16)}...`);
	assert(typeof evalData.resolveTxHash === 'string', `Resolve TX: ${evalData.resolveTxHash?.slice(0, 16)}...`);
	assert(evalData.signatureCount >= 3, `Signatures: ${evalData.signatureCount} (quorum ≥ 3)`);
	assert(evalData.panelConsensus > 0.5, `Consensus: ${evalData.panelConsensus?.toFixed(2)} (> 0.5)`);

	if (evalData.gasUsed) {
		console.log(`  Gas used: ${evalData.gasUsed} (submit + resolve)`);
	}

	finish(startTime);
}

async function validateResolution(debateId: string, resolution: Record<string, unknown>) {
	console.log('');
	console.log('Step 5: Validating resolution data structure...');

	assert(resolution.signatureCount !== null, `Signature count: ${resolution.signatureCount}`);
	assert(
		typeof resolution.panelConsensus === 'number',
		`Panel consensus: ${(resolution.panelConsensus as number)?.toFixed(2)}`
	);
	assert(resolution.resolutionMethod === 'ai_community', `Method: ${resolution.resolutionMethod}`);
	assert(resolution.resolvedAt !== null, `Resolved at: ${resolution.resolvedAt}`);

	// Validate per-argument scores
	const args = resolution.arguments as Array<{
		argumentIndex: number;
		aiScores: Record<string, number> | null;
		aiWeighted: number | null;
		finalScore: number | null;
		modelAgreement: number | null;
	}>;

	assert(Array.isArray(args), `Arguments array present (${args?.length} items)`);

	if (args && args.length > 0) {
		for (const arg of args) {
			const idx = arg.argumentIndex;

			if (arg.aiScores) {
				const scores = arg.aiScores;
				const dims = ['reasoning', 'accuracy', 'evidence', 'constructiveness', 'feasibility'];
				for (const dim of dims) {
					assert(
						typeof scores[dim] === 'number' && scores[dim] >= 0 && scores[dim] <= 10000,
						`  Arg ${idx} ${dim}: ${scores[dim]} (0-10000)`
					);
				}
			}

			if (arg.aiWeighted !== null) {
				assert(
					arg.aiWeighted >= 0 && arg.aiWeighted <= 10000,
					`  Arg ${idx} weighted: ${arg.aiWeighted} (0-10000)`
				);
			}

			if (arg.finalScore !== null) {
				assert(
					arg.finalScore >= 0 && arg.finalScore <= 10000,
					`  Arg ${idx} final: ${arg.finalScore} (0-10000)`
				);
			}

			if (arg.modelAgreement !== null) {
				assert(
					arg.modelAgreement >= 0 && arg.modelAgreement <= 1,
					`  Arg ${idx} agreement: ${arg.modelAgreement.toFixed(2)} (0-1)`
				);
			}
		}
	}
}

function finish(startTime: number) {
	const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
	console.log('');
	console.log(`=== ALL CHECKS PASSED (${totalDuration}s) ===`);
}

// ============================================================================
// Run
// ============================================================================

main().catch((err) => {
	console.error('FATAL:', err);
	process.exit(1);
});
