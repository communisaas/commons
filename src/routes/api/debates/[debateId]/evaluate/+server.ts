// readChainResolution, submitAndResolve). Uses $env/dynamic/private, CRON_SECRET auth.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { escalateToGovernance, readChainResolution } from '$lib/core/blockchain/debate-market-client';
import { verifyCronSecret } from '$lib/server/cron-auth';
import { FEATURES } from '$lib/config/features';

// ── Rate limiting ────────────────────────────────────────────────────────
// Guards against accidental double-triggers and runaway cron jobs.
// Each evaluation calls 5 LLM APIs (~$0.05) + 2 on-chain TXs (~0.003 ETH).
const activeEvaluations = new Set<string>();
const recentEvaluations = new Map<string, number>(); // debateId → timestamp
const DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes per debate
const HOURLY_LIMIT = 10;
let hourlyCount = 0;
let hourlyResetAt = Date.now() + 3600_000;

function checkRateLimit(debateId: string): string | null {
	const now = Date.now();

	// Reset hourly window
	if (now > hourlyResetAt) {
		hourlyCount = 0;
		hourlyResetAt = now + 3600_000;
	}

	if (activeEvaluations.has(debateId)) {
		return `Evaluation already in progress for debate ${debateId}`;
	}

	const lastEval = recentEvaluations.get(debateId);
	if (lastEval && now - lastEval < DEBOUNCE_MS) {
		const waitSec = Math.ceil((DEBOUNCE_MS - (now - lastEval)) / 1000);
		return `Debate ${debateId} was recently evaluated. Retry in ${waitSec}s`;
	}

	if (hourlyCount >= HOURLY_LIMIT) {
		return `Hourly evaluation limit (${HOURLY_LIMIT}) reached. Resets at ${new Date(hourlyResetAt).toISOString()}`;
	}

	return null;
}
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/debates/[debateId]/evaluate
 *
 * Trigger AI evaluation for a debate that has passed its deadline.
 * 1. Fetches argument bodies from DB
 * 2. Runs 5-model AI evaluation panel (@voter-protocol/ai-evaluator)
 * 3. Aggregates scores via median-of-N
 * 4. Signs EIP-712 attestations and submits on-chain
 * 5. Resolves with α-blended final scores
 *
 * Operator-only endpoint (protected by CRON_SECRET).
 * Rate limited: 1 concurrent per debate, 5-min debounce, 10/hour global.
 *
 * NOTE: @voter-protocol/ai-evaluator is imported dynamically since it lives
 * in the voter-protocol monorepo, not the commons workspace.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	if (!FEATURES.DEBATE) {
		throw error(404, 'Not found');
	}

	const { debateId } = params;

	// Auth: operator-only via CRON_SECRET header
	const authHeader = request.headers.get('Authorization');
	const cronSecret = env.CRON_SECRET;
	if (!cronSecret || !verifyCronSecret(authHeader, cronSecret)) {
		throw error(403, 'Operator access required');
	}

	// Rate limit check
	const rateLimitError = checkRateLimit(debateId);
	if (rateLimitError) {
		throw error(429, rateLimitError);
	}

	await serverQuery(api.debates.get, { debateId: debateId as any });

	if (!debate) {
		throw error(404, 'Debate not found');
	}
	if (debate.status !== 'active') {
		throw error(400, `Debate is not active (status: ${debate.status})`);
	}
	if (new Date() <= debate.deadline) {
		throw error(400, 'Debate deadline has not passed yet');
	}
	if (debate.arguments.length === 0) {
		throw error(400, 'Cannot evaluate a debate with no verified arguments');
	}
	if (!debate.debateIdOnchain) {
		throw error(400, 'Debate has no on-chain ID');
	}

	// Acquire rate limit slot
	activeEvaluations.add(debateId);
	hourlyCount++;

	try {
	// Dynamic import — ai-evaluator lives in voter-protocol monorepo
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let aiEvaluator: any;
	try {
		aiEvaluator = await import('@voter-protocol/ai-evaluator');
	} catch {
		throw error(503, 'AI evaluator service not available. Ensure @voter-protocol/ai-evaluator is installed.');
	}

	// Load model configs from environment
	let modelConfigs: Array<{ provider: number; modelName: string; apiKey: string; signerPrivateKey: string }>;
	try {
		modelConfigs = aiEvaluator.loadModelConfigs();
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		throw error(503, `AI evaluator configuration error: ${msg}`);
	}

	// Instantiate model providers (handles both direct + OpenRouter mode)
	const providers = aiEvaluator.createProviders(modelConfigs);

	// Format arguments for the evaluator
	const debateArguments = debate.arguments.map((arg) => ({
		index: arg.argumentIndex,
		stance: arg.stance,
		bodyText: arg.body,
		amendmentText: arg.amendmentText ?? undefined
	}));

	// Step 1: Run 5-model evaluation panel
	console.debug('[evaluate] Running AI evaluation panel for debate:', debateId);

	let evaluationResult: {
		packedScores: bigint[];
		aggregatedScores: Array<{
			argumentIndex: number;
			medianScores: Record<string, number>;
			weightedScore: number;
			modelAgreement: number;
		}>;
		modelEvaluations: Array<{ provider: number; modelName: string; timestamp: number }>;
		consensusAchieved: boolean;
		quorumMet: boolean;
	};

	try {
		evaluationResult = await aiEvaluator.evaluateDebate(
			debate.debateIdOnchain,
			debateArguments,
			{ providers, timeoutMs: 90_000 }
		);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[evaluate] AI evaluation failed:', msg);
		throw error(502, `AI evaluation failed: ${msg}`);
	}

	// Step 2: Check consensus — if no quorum, escalate to governance
	if (!evaluationResult.quorumMet || !evaluationResult.consensusAchieved) {
		console.warn('[evaluate] AI consensus not reached, escalating to governance');

		const escResult = await escalateToGovernance(debate.debateIdOnchain);

		await serverMutation(api.debates.updateStatus, {
			where: { id: debateId },
			data: {
				status: 'awaiting_governance',
				aiResolution: {
					scores: evaluationResult.aggregatedScores,
					consensusAchieved: false,
					quorumMet: evaluationResult.quorumMet,
					evaluatedAt: new Date().toISOString()
				} as object,
				aiPanelConsensus: Math.min(
					...evaluationResult.aggregatedScores.map((a) => a.modelAgreement)
				)
			}
		});

		return json({
			debateId,
			status: 'awaiting_governance',
			reason: evaluationResult.quorumMet
				? 'AI scores diverged beyond consensus threshold'
				: 'Insufficient model responses (quorum not met)',
			txHash: escResult.success ? escResult.txHash : undefined,
			error: escResult.success ? undefined : escResult.error
		});
	}

	// Step 3: Sign and submit on-chain via submitAndResolve
	const rpcUrl = env.SCROLL_RPC_URL;
	const submitterKey = env.SCROLL_PRIVATE_KEY;
	const debateMarketAddress = env.DEBATE_MARKET_ADDRESS;

	if (!rpcUrl || !submitterKey || !debateMarketAddress) {
		throw error(503, 'Blockchain not configured (SCROLL_RPC_URL, SCROLL_PRIVATE_KEY, DEBATE_MARKET_ADDRESS)');
	}

	let eip712Domain: { name: string; version: string; chainId: bigint; verifyingContract: string };
	try {
		eip712Domain = aiEvaluator.loadEIP712Domain();
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		throw error(503, `EIP-712 domain config error: ${msg}`);
	}

	const { ethers } = await import('ethers');
	const rpcProvider = new ethers.JsonRpcProvider(rpcUrl);
	const signatureDeadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

	let submissionResult: { submitTxHash: string; resolveTxHash: string; gasUsed: bigint };
	try {
		submissionResult = await aiEvaluator.submitAndResolve(
			rpcProvider,
			submitterKey,
			debateMarketAddress,
			debate.debateIdOnchain,
			evaluationResult.aggregatedScores,
			modelConfigs,
			eip712Domain,
			signatureDeadline
		);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[evaluate] On-chain submission failed:', msg);
		throw error(502, `On-chain submission failed: ${msg}`);
	}

	// Step 4: Compute overall consensus for Prisma
	const overallAgreement =
		evaluationResult.aggregatedScores.reduce((sum, a) => sum + a.modelAgreement, 0) /
		evaluationResult.aggregatedScores.length;

	// Step 5: Determine winner (highest weighted score from aggregated — fallback)
	let winnerIndex = 0;
	let bestScore = 0;
	for (const agg of evaluationResult.aggregatedScores) {
		if (agg.weightedScore > bestScore) {
			bestScore = agg.weightedScore;
			winnerIndex = agg.argumentIndex;
		}
	}
	let winnerStance = debate.arguments.find((a) => a.argumentIndex === winnerIndex)?.stance ?? null;
	let resolvedFromChain = false;

	// Defense in depth: read authoritative winner from chain after resolveDebateWithAI()
	const chainState = await readChainResolution(debate.debateIdOnchain);
	if (chainState.success && chainState.winningArgumentIndex !== undefined) {
		const stanceMap: Record<number, string> = { 0: 'SUPPORT', 1: 'OPPOSE', 2: 'AMEND' };

		if (chainState.winningArgumentIndex !== winnerIndex) {
			console.warn('[evaluate] Chain winner differs from local computation!', {
				chainWinner: chainState.winningArgumentIndex,
				localWinner: winnerIndex,
				debateId
			});
		}

		// Chain is authoritative
		winnerIndex = chainState.winningArgumentIndex;
		winnerStance = stanceMap[chainState.winningStance ?? 0] ?? winnerStance;
		resolvedFromChain = true;
	} else {
		console.warn('[evaluate] Chain read failed, using local winner:', chainState.error);
	}

	// Step 6: Update Prisma with resolution data
	await serverMutation(api.debates.updateStatus, {
		where: { id: debateId },
		data: {
			status: 'resolved',
			aiResolution: {
				scores: evaluationResult.aggregatedScores,
				models: evaluationResult.modelEvaluations.map((m) => ({
					provider: m.provider,
					modelName: m.modelName,
					timestamp: m.timestamp
				})),
				consensusAchieved: true,
				evaluatedAt: new Date().toISOString(),
				submitTxHash: submissionResult.submitTxHash,
				resolveTxHash: submissionResult.resolveTxHash,
				gasUsed: submissionResult.gasUsed.toString()
			} as object,
			aiSignatureCount: modelConfigs.length,
			aiPanelConsensus: overallAgreement,
			resolutionMethod: 'ai_community',
			winningArgumentIndex: winnerIndex,
			winningStance: winnerStance,
			resolvedAt: new Date(),
			resolvedFromChain: resolvedFromChain,
		}
	});

	// Update per-argument AI scores
	for (const agg of evaluationResult.aggregatedScores) {
		await prisma.debateArgument.updateMany({
			where: {
				debateId: debateId,
				argumentIndex: agg.argumentIndex
			},
			data: {
				ai_scores: agg.medianScores as object,
				ai_weighted: agg.weightedScore,
				final_score: agg.weightedScore,
				model_agreement: agg.modelAgreement
			}
		});
	}

	console.debug('[evaluate] Debate resolved with AI:', {
		debateId,
		winnerIndex,
		winnerStance,
		signatureCount: modelConfigs.length,
		consensus: overallAgreement.toFixed(2),
		gasUsed: submissionResult.gasUsed.toString()
	});

	return json({
		debateId,
		status: 'resolved',
		resolutionMethod: 'ai_community',
		winningArgumentIndex: winnerIndex,
		winningStance: winnerStance,
		resolvedFromChain,
		signatureCount: modelConfigs.length,
		panelConsensus: overallAgreement,
		submitTxHash: submissionResult.submitTxHash,
		resolveTxHash: submissionResult.resolveTxHash,
		gasUsed: submissionResult.gasUsed.toString()
	});

	} finally {
		// Release rate limit slot
		activeEvaluations.delete(debateId);
		recentEvaluations.set(debateId, Date.now());
	}
};
