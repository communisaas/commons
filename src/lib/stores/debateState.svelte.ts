/**
 * Debate State Store — Svelte 5 runes
 *
 * Manages debate data for the current template view and
 * draft argument state during the debate modal flow.
 *
 * Pattern follows guestState.svelte.ts (factory function, exported singleton).
 */

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type Stance = 'SUPPORT' | 'OPPOSE' | 'AMEND';

export interface ArgumentData {
	id: string;
	argumentIndex: number;
	stance: Stance;
	body: string;
	amendmentText?: string;
	stakeAmount: string; // BigInt serialized as string
	engagementTier: number;
	weightedScore: string;
	totalStake: string;
	coSignCount: number;
	createdAt: string;
	currentPrice?: string;
	priceHistory?: Array<{ epoch: number; price: string; timestamp: string }>;
	positionCount?: number;
	// AI evaluation scores (populated after resolution)
	aiScore?: DimensionScores;
	weightedAIScore?: number;
	finalScore?: number;
	modelAgreement?: number;
	// On-chain verification status (UI awareness only — backend excludes pending/rejected from resolution)
	verificationStatus?: 'pending' | 'verified' | 'rejected';
}

export interface DebateData {
	id: string;
	debateIdOnchain: string;
	templateId: string;
	propositionText: string;
	propositionHash: string;
	actionDomain: string;
	deadline: string;
	jurisdictionSize: number;
	status: 'active' | 'resolving' | 'resolved' | 'awaiting_governance' | 'under_appeal';
	argumentCount: number;
	uniqueParticipants: number;
	totalStake: string;
	arguments: ArgumentData[];
	winningArgumentIndex?: number;
	winningStance?: string;
	resolvedAt?: string;
	// LMSR market state
	marketStatus?: 'pre_market' | 'active' | 'resolved';
	marketLiquidity?: string;
	currentPrices?: Record<number, string>;
	currentEpoch?: number;
	tradeDeadline?: string;
	resolutionDeadline?: string;
	// AI Resolution (Phase 3)
	aiResolution?: AIResolutionData;
}

/** AI evaluation scores per dimension (0-10000 basis points) */
export interface DimensionScores {
	reasoning: number;
	accuracy: number;
	evidence: number;
	constructiveness: number;
	feasibility: number;
}

/** Per-argument AI evaluation result */
export interface ArgumentAIScore {
	argumentIndex: number;
	dimensions: DimensionScores;
	weightedAIScore: number; // dimension-weighted, 0-10000
	communityScore: number; // normalized 0-10000
	finalScore: number; // alpha-blended
	modelAgreement: number; // fraction of models within 20% of median, 0-1
}

/** Full AI resolution data for a debate */
export interface AIResolutionData {
	argumentScores: ArgumentAIScore[];
	alphaWeight: number; // basis points, e.g. 4000 = 40% AI
	modelCount: number;
	signatureCount: number;
	quorumRequired: number;
	resolutionMethod: 'ai_community' | 'governance_override' | 'community_only';
	evaluatedAt?: string;
	// Evaluation source attribution
	source?: 'ai_panel' | string;
	minerCount?: number;
	// Level 3 miner transparency — per-miner raw evaluations with grounding evidence
	minerEvaluations?: MinerEvaluation[];
	// Appeal state
	appealDeadline?: string;
	hasAppeal?: boolean;
	governanceJustification?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// MINER EVIDENCE TYPES — Level 3 transparency
// ═══════════════════════════════════════════════════════════════════════════

/** A single miner's full evaluation (scores + grounding evidence per argument) */
export interface MinerEvaluation {
	minerUid: number;
	inference: string; // "groq" | "gemini" | "ollama"
	argumentEvaluations: MinerArgumentEvaluation[];
}

/** One miner's evaluation of one argument */
export interface MinerArgumentEvaluation {
	argumentIndex: number;
	scores: DimensionScores;
	grounding?: ArgumentGrounding;
}

/** Grounding evidence for one argument from one miner's research */
export interface ArgumentGrounding {
	claimVerdicts: ClaimVerdict[];
	sourceVerdicts: SourceVerdict[];
	accuracyJustification: string;
}

/** Verdict on a factual claim, backed by retrieved sources */
export interface ClaimVerdict {
	claim: string;
	verdict: 'CONFIRMED' | 'CONTRADICTED' | 'PARTIALLY_CONFIRMED' | 'UNVERIFIED';
	sourceIndices: number[];
	reasoning: string;
}

/** Integrity assessment of a retrieved source */
export interface SourceVerdict {
	sourceIndex: number;
	url: string;
	title: string;
	reliability: number; // 0-10000 bp
	groundingDistance: number; // 0-3 layers from direct evidence
	integrityFlags: string[];
	note: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// SSE EVENT SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

import { z } from 'zod';

const sseStateSchema = z.object({
	prices: z.record(z.string()).optional(),
	epochPhase: z.enum(['commit', 'reveal', 'executing', 'idle']),
	epochSecondsRemaining: z.number().optional()
});

const sseEpochExecutedSchema = z.object({
	prices: z.record(z.string()).optional(),
	pricesStale: z.boolean()
});

const sseAIScoresSchema = z.object({
	signatureCount: z.number()
});

const sseResolutionSchema = z.object({
	winningArgumentIndex: z.number(),
	winningStance: z.string()
});

const sseAppealSchema = z.object({
	appealDeadline: z.string().nullable()
});

/** Parse SSE event data with schema validation. Returns null on failure. */
function parseSSE<T>(raw: string, schema: z.ZodType<T>, eventName: string): T | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		console.warn(`[debate-sse] Failed to parse ${eventName}:`, raw?.slice(0, 100));
		return null;
	}
	const result = schema.safeParse(parsed);
	if (!result.success) {
		console.warn(`[debate-sse] Invalid ${eventName} payload:`, result.error.flatten());
		return null;
	}
	return result.data;
}

// ═══════════════════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_STAKE = 1_000_000; // $1 USDC (6 decimals)

function createDebateState() {
	// Current debate for the viewed template
	let currentDebate = $state<DebateData | null>(null);
	let isLoading = $state(false);
	let error = $state<string | null>(null);

	// LMSR price state
	let lmsrPrices = $state<Record<number, number>>({});
	let epochPhase = $state<'commit' | 'reveal' | 'executing' | 'idle'>('idle');
	let epochSecondsRemaining = $state(0);
	let epochCountdownTimer = $state<ReturnType<typeof setInterval> | null>(null);
	let sseConnection = $state<EventSource | null>(null);

	// Draft argument state (persists during modal flow)
	let draftStance = $state<Stance | null>(null);
	let draftBody = $state('');
	let draftAmendment = $state('');
	let draftStake = $state(DEFAULT_STAKE);

	return {
		// ── Getters ──────────────────────────────────────────────────────
		get debate() {
			return currentDebate;
		},
		get isLoading() {
			return isLoading;
		},
		get error() {
			return error;
		},
		get draftStance() {
			return draftStance;
		},
		get draftBody() {
			return draftBody;
		},
		get draftAmendment() {
			return draftAmendment;
		},
		get draftStake() {
			return draftStake;
		},

		get lmsrPrices() {
			return lmsrPrices;
		},
		get epochPhase() {
			return epochPhase;
		},
		get epochSecondsRemaining() {
			return epochSecondsRemaining;
		},
		get isTrading() {
			return epochPhase === 'commit' || epochPhase === 'reveal';
		},

		// ── Derived ──────────────────────────────────────────────────────
		get isActive() {
			return currentDebate?.status === 'active';
		},
		get isResolving() {
			return currentDebate?.status === 'resolving';
		},
		get isResolved() {
			return currentDebate?.status === 'resolved';
		},
		get isAwaitingGovernance() {
			return currentDebate?.status === 'awaiting_governance';
		},
		get isUnderAppeal() {
			return currentDebate?.status === 'under_appeal';
		},
		get hasAIResolution() {
			return currentDebate?.aiResolution !== undefined;
		},
		get hasDebate() {
			return currentDebate !== null;
		},

		// ── Setters ──────────────────────────────────────────────────────
		setDebate(debate: DebateData | null) {
			currentDebate = debate;
		},
		setDraftStance(stance: Stance | null) {
			draftStance = stance;
		},
		setDraftBody(body: string) {
			draftBody = body;
		},
		setDraftAmendment(text: string) {
			draftAmendment = text;
		},
		setDraftStake(amount: number) {
			draftStake = amount;
		},

		// ── Actions ──────────────────────────────────────────────────────
		resetDraft() {
			draftStance = null;
			draftBody = '';
			draftAmendment = '';
			draftStake = DEFAULT_STAKE;
		},

		/** Connect to debate SSE stream for real-time price updates */
		connectSSE(debateId: string) {
			this.disconnectSSE();
			const source = new EventSource(`/api/debates/${debateId}/stream`);
			sseConnection = source;

			source.addEventListener('state', (e: MessageEvent) => {
				const data = parseSSE(e.data, sseStateSchema, 'state');
				if (!data) return;
				if (data.prices) {
					lmsrPrices = Object.fromEntries(
						Object.entries(data.prices).map(([k, v]) => [Number(k), Number(v)])
					);
				}
				epochPhase = data.epochPhase;
				epochSecondsRemaining = data.epochSecondsRemaining ?? 0;
			});

			source.addEventListener('epoch_executed', (e: MessageEvent) => {
				const data = parseSSE(e.data, sseEpochExecutedSchema, 'epoch_executed');
				if (!data) return;
				if (data.prices) {
					lmsrPrices = Object.fromEntries(
						Object.entries(data.prices).map(([k, v]) => [Number(k), Number(v)])
					);
				}
				// Finding 6: pricesStale signals that on-chain prices changed after
				// epoch execution but the service has no RPC access to fetch them
				// directly. Reload the full debate state from the API, which queries
				// the contract via the chain scanner and returns fresh currentPrices.
				if (data.pricesStale && currentDebate) {
					this.loadDebate(currentDebate.templateId);
				}
			});

			source.addEventListener('resolved', (e: MessageEvent) => {
				// Reload full debate state on resolution
				if (currentDebate) {
					this.loadDebate(currentDebate.templateId);
				}
			});

			// AI Resolution events (Phase 3)
			source.addEventListener('evaluating', () => {
				if (currentDebate) {
					currentDebate = { ...currentDebate, status: 'resolving' };
				}
			});

			// Finding 11: shadow-atlas emits 'ai_evaluation_submitted'; the Prisma-polling
			// path emits 'ai_scores_submitted'. Both carry the same payload shape and
			// must update signatureCount identically. Extract to a shared handler.
			const handleAIScoresSubmitted = (e: MessageEvent) => {
				const data = parseSSE(e.data, sseAIScoresSchema, 'ai_scores');
				if (!data) return;
				if (currentDebate && currentDebate.aiResolution) {
					currentDebate = {
						...currentDebate,
						aiResolution: {
							...currentDebate.aiResolution,
							signatureCount: data.signatureCount
						}
					};
				}
			};
			source.addEventListener('ai_scores_submitted', handleAIScoresSubmitted);
			source.addEventListener('ai_evaluation_submitted', handleAIScoresSubmitted);

			source.addEventListener('resolved_with_ai', (e: MessageEvent) => {
				const data = parseSSE(e.data, sseResolutionSchema, 'resolved_with_ai');
				if (!data) return;
				if (currentDebate) {
					currentDebate = {
						...currentDebate,
						status: 'resolved',
						winningArgumentIndex: data.winningArgumentIndex,
						winningStance: data.winningStance
					};
					this.fetchAIResolution(currentDebate.id);
				}
			});

			source.addEventListener('governance_escalated', () => {
				if (currentDebate) {
					currentDebate = {
						...currentDebate,
						status: 'awaiting_governance'
					};
				}
			});

			source.addEventListener('appeal_started', (e: MessageEvent) => {
				const data = parseSSE(e.data, sseAppealSchema, 'appeal_started');
				if (!data) return;
				if (currentDebate) {
					currentDebate = {
						...currentDebate,
						status: 'under_appeal',
						aiResolution: currentDebate.aiResolution
							? {
									...currentDebate.aiResolution,
									hasAppeal: true,
									appealDeadline: data.appealDeadline ?? undefined // null → undefined
								}
							: undefined
					};
				}
			});

			source.addEventListener('resolution_finalized', (e: MessageEvent) => {
				const data = parseSSE(e.data, sseResolutionSchema, 'resolution_finalized');
				if (!data) return;
				if (currentDebate) {
					currentDebate = {
						...currentDebate,
						status: 'resolved',
						winningArgumentIndex: data.winningArgumentIndex,
						winningStance: data.winningStance
					};
					this.fetchAIResolution(currentDebate.id);
				}
			});

			// Debate activity events (argument/participant changes)
			source.addEventListener('debate:argument', (e: MessageEvent) => {
				try {
					const data = JSON.parse(e.data);
					if (currentDebate && typeof data.argumentCount === 'number') {
						currentDebate = {
							...currentDebate,
							argumentCount: data.argumentCount,
							uniqueParticipants: data.uniqueParticipants ?? currentDebate.uniqueParticipants
						};
					}
				} catch { /* skip */ }
			});

			source.addEventListener('debate:position', (e: MessageEvent) => {
				try {
					const data = JSON.parse(e.data);
					if (currentDebate && typeof data.uniqueParticipants === 'number') {
						currentDebate = {
							...currentDebate,
							uniqueParticipants: data.uniqueParticipants
						};
					}
				} catch { /* skip */ }
			});

			// Org settlement event
			source.addEventListener('debate:settled', (e: MessageEvent) => {
				try {
					const data = JSON.parse(e.data);
					if (currentDebate) {
						currentDebate = {
							...currentDebate,
							status: 'resolved',
							winningStance: data.winningStance ?? currentDebate.winningStance
						};
					}
				} catch { /* skip */ }
			});

			source.onerror = () => {
				// Reconnect after 5s on error
				this.disconnectSSE();
				setTimeout(() => {
					if (currentDebate) {
						this.connectSSE(debateId);
					}
				}, 5000);
			};
		},

		/** Disconnect SSE stream */
		disconnectSSE() {
			if (sseConnection) {
				sseConnection.close();
				sseConnection = null;
			}
			if (epochCountdownTimer) {
				clearInterval(epochCountdownTimer);
				epochCountdownTimer = null;
			}
		},

		/** Start countdown timer for epoch phase */
		startEpochCountdown() {
			if (epochCountdownTimer) clearInterval(epochCountdownTimer);
			epochCountdownTimer = setInterval(() => {
				if (epochSecondsRemaining > 0) {
					epochSecondsRemaining--;
				}
			}, 1000);
		},

		async loadDebate(templateId: string) {
			isLoading = true;
			error = null;
			try {
				const res = await fetch(`/api/debates/by-template/${templateId}`);
				if (res.ok) {
					const data = await res.json();
					currentDebate = data.debate ?? null;
				} else if (res.status === 404) {
					currentDebate = null;
				} else {
					throw new Error(`Failed to load debate (${res.status})`);
				}
			} catch (err) {
				error = err instanceof Error ? err.message : 'Failed to load debate';
				currentDebate = null;
			} finally {
				isLoading = false;
			}
		},

		/** Fetch AI resolution data and merge into current debate */
		async fetchAIResolution(debateId: string) {
			try {
				const res = await fetch(`/api/debates/${debateId}/ai-resolution`);
				if (!res.ok) return;
				const { aiResolution } = await res.json();
				if (!aiResolution || !currentDebate) return;

				// Transform API response → store type
				const args = (aiResolution.arguments ?? []) as Array<{
					argumentIndex: number;
					aiScores: Record<string, number> | null;
					aiWeighted: number | null;
					finalScore: number | null;
					modelAgreement: number | null;
				}>;

				const argumentScores: ArgumentAIScore[] = args
					.filter((a) => a.aiScores != null)
					.map((a) => {
						const dims = a.aiScores ?? {};
						const argData = currentDebate!.arguments.find(
							(ad) => ad.argumentIndex === a.argumentIndex
						);
						return {
							argumentIndex: a.argumentIndex,
							dimensions: {
								reasoning: dims.reasoning ?? 0,
								accuracy: dims.accuracy ?? 0,
								evidence: dims.evidence ?? 0,
								constructiveness: dims.constructiveness ?? 0,
								feasibility: dims.feasibility ?? 0
							},
							weightedAIScore: a.aiWeighted ?? 0,
							communityScore: Number(argData?.weightedScore ?? 0),
							finalScore: a.finalScore ?? 0,
							modelAgreement: a.modelAgreement ?? 0
						};
					});

				const source = (aiResolution.source as AIResolutionData['source']) ?? 'ai_panel';
				const resMinerCount = (aiResolution.minerCount as number) ?? undefined;

				const resolution: AIResolutionData = {
					argumentScores,
					alphaWeight: 4000,
					modelCount: resMinerCount ?? (models.length || 5),
					signatureCount: aiResolution.signatureCount ?? 0,
					quorumRequired: 4,
					resolutionMethod: aiResolution.resolutionMethod ?? 'ai_community',
					evaluatedAt: aiResolution.resolvedAt ?? undefined,
					source,
					minerCount: resMinerCount,
					appealDeadline: aiResolution.appealDeadline ?? undefined,
					hasAppeal: false,
					governanceJustification: aiResolution.governanceJustification ?? undefined
				};

				// Also merge per-argument AI data into argument objects
				const updatedArgs = currentDebate.arguments.map((arg) => {
					const score = argumentScores.find((s) => s.argumentIndex === arg.argumentIndex);
					if (!score) return arg;
					return {
						...arg,
						aiScore: score.dimensions,
						weightedAIScore: score.weightedAIScore,
						finalScore: score.finalScore,
						modelAgreement: score.modelAgreement
					};
				});

				currentDebate = {
					...currentDebate,
					aiResolution: resolution,
					arguments: updatedArgs,
					winningArgumentIndex: aiResolution.winningArgumentIndex ?? currentDebate.winningArgumentIndex,
					winningStance: aiResolution.winningStance ?? currentDebate.winningStance
				};
			} catch {
				// Silently fail — resolution data is supplementary
			}
		},

		clear() {
			this.disconnectSSE();
			currentDebate = null;
			isLoading = false;
			error = null;
			draftStance = null;
			draftBody = '';
			draftAmendment = '';
			draftStake = DEFAULT_STAKE;
		}
	};
}

export const debateState = createDebateState();
