// CONVEX: Keep SvelteKit — Evaluate uses AI evaluator, blockchain, $env/dynamic/private, CRON_SECRET auth.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { escalateToGovernance, readChainResolution } from '$lib/core/blockchain/debate-market-client';
import { verifyCronSecret } from '$lib/server/cron-auth';
import { FEATURES } from '$lib/config/features';

// ── Rate limiting ────────────────────────────────────────────────────────
const activeEvaluations = new Set<string>();
const recentEvaluations = new Map<string, number>();
const DEBOUNCE_MS = 5 * 60 * 1000;
const HOURLY_LIMIT = 10;
let hourlyCount = 0;
let hourlyResetAt = Date.now() + 3600_000;

function checkRateLimit(debateId: string): string | null {
	const now = Date.now();
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

export const POST: RequestHandler = async ({ params, request }) => {
	if (!FEATURES.DEBATE) {
		throw error(404, 'Not found');
	}

	const { debateId } = params;

	const authHeader = request.headers.get('Authorization');
	const cronSecret = env.CRON_SECRET;
	if (!cronSecret || !verifyCronSecret(authHeader, cronSecret)) {
		throw error(403, 'Operator access required');
	}

	const rateLimitError = checkRateLimit(debateId);
	if (rateLimitError) {
		throw error(429, rateLimitError);
	}

	const debate = await serverQuery(api.debates.get, { debateId: debateId as any });
	if (!debate) {
		throw error(404, 'Debate not found');
	}
	if (debate.status !== 'active') {
		throw error(400, `Debate is not active (status: ${debate.status})`);
	}
	if (new Date() <= new Date(debate.deadline)) {
		throw error(400, 'Debate deadline has not passed yet');
	}
	if (!debate.arguments || debate.arguments.length === 0) {
		throw error(400, 'Cannot evaluate a debate with no verified arguments');
	}
	if (!debate.debateIdOnchain) {
		throw error(400, 'Debate has no on-chain ID');
	}

	activeEvaluations.add(debateId);
	hourlyCount++;

	try {
		// Dynamic import — ai-evaluator lives in voter-protocol monorepo
		let aiEvaluator: any;
		try {
			aiEvaluator = await import('@voter-protocol/ai-evaluator');
		} catch {
			throw error(503, 'AI evaluator service not available.');
		}

		let modelConfigs: Array<{ provider: number; modelName: string; apiKey: string; signerPrivateKey: string }>;
		try {
			modelConfigs = aiEvaluator.loadModelConfigs();
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			throw error(503, `AI evaluator configuration error: ${msg}`);
		}

		const providers = aiEvaluator.createProviders(modelConfigs);

		const debateArguments = debate.arguments.map((arg: any) => ({
			index: arg.argumentIndex,
			stance: arg.stance,
			bodyText: arg.body,
			amendmentText: arg.amendmentText ?? undefined
		}));

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
			throw error(502, `AI evaluation failed: ${msg}`);
		}

		// No consensus — escalate to governance
		if (!evaluationResult.quorumMet || !evaluationResult.consensusAchieved) {
			const escResult = await escalateToGovernance(debate.debateIdOnchain);

			await serverMutation(api.debates.updateStatus, {
				debateId: debateId as any,
				status: 'awaiting_governance',
				aiResolution: {
					scores: evaluationResult.aggregatedScores,
					consensusAchieved: false,
					quorumMet: evaluationResult.quorumMet,
					evaluatedAt: new Date().toISOString()
				},
				aiPanelConsensus: Math.min(
					...evaluationResult.aggregatedScores.map((a) => a.modelAgreement)
				)
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

		// Submit + resolve on-chain
		const rpcUrl = env.SCROLL_RPC_URL;
		const submitterKey = env.SCROLL_PRIVATE_KEY;
		const debateMarketAddress = env.DEBATE_MARKET_ADDRESS;

		if (!rpcUrl || !submitterKey || !debateMarketAddress) {
			throw error(503, 'Blockchain not configured');
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
			throw error(502, `On-chain submission failed: ${msg}`);
		}

		const overallAgreement =
			evaluationResult.aggregatedScores.reduce((sum, a) => sum + a.modelAgreement, 0) /
			evaluationResult.aggregatedScores.length;

		// Determine winner
		let winnerIndex = 0;
		let bestScore = 0;
		for (const agg of evaluationResult.aggregatedScores) {
			if (agg.weightedScore > bestScore) {
				bestScore = agg.weightedScore;
				winnerIndex = agg.argumentIndex;
			}
		}
		let winnerStance = debate.arguments.find((a: any) => a.argumentIndex === winnerIndex)?.stance ?? null;
		let resolvedFromChain = false;

		// Chain is authoritative
		const chainState = await readChainResolution(debate.debateIdOnchain);
		if (chainState.success && chainState.winningArgumentIndex !== undefined) {
			const stanceMap: Record<number, string> = { 0: 'SUPPORT', 1: 'OPPOSE', 2: 'AMEND' };
			winnerIndex = chainState.winningArgumentIndex;
			winnerStance = stanceMap[chainState.winningStance ?? 0] ?? winnerStance;
			resolvedFromChain = true;
		}

		// Update debate status via Convex
		await serverMutation(api.debates.updateStatus, {
			debateId: debateId as any,
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
			},
			aiSignatureCount: modelConfigs.length,
			aiPanelConsensus: overallAgreement,
			resolutionMethod: 'ai_community',
			winningArgumentIndex: winnerIndex,
			winningStance: winnerStance,
		});

		// Update per-argument AI scores via Convex
		await serverMutation(api.debates.updateArgumentScores, {
			debateId: debateId as any,
			scores: evaluationResult.aggregatedScores.map((agg) => ({
				argumentIndex: agg.argumentIndex,
				aiScores: agg.medianScores,
				aiWeighted: agg.weightedScore,
				finalScore: agg.weightedScore,
				modelAgreement: agg.modelAgreement
			}))
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
		activeEvaluations.delete(debateId);
		recentEvaluations.set(debateId, Date.now());
	}
};
