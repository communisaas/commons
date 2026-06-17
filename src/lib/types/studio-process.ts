/**
 * Runtime evidence types for the studio authoring process: why target
 * resolution stopped, and the observable state of in-flight message work.
 */

export type ResolutionStopReason = 'no-target' | 'no-public-email' | 'stopped' | 'unknown';

export type StudioProcessEvidence = {
	processCount: number;
	runningCount: number;
	restoredCount: number;
	focusedStatus: string | null;
	contactableTargetCount: number;
	droppedTargetCount: number;
	resolutionStopReason: ResolutionStopReason | null;
	resolutionStopDetail: string | null;
	sourceEvidenceObserved: boolean;
	sourceEvidenceCount: number;
	sourceEvidenceMode: 'discovery' | 'preverified' | null;
	sourceEvidenceEvaluationFallback: boolean;
	sourceEvidenceCandidateCount: number | null;
	sourceEvidenceFailedCount: number | null;
	sourceEvidenceSearchQueryCount: number | null;
	evaluatedSourceCount: number;
	searchOnlySourceCount: number;
	messageParagraphCount: number;
	draftHandoffCount: number;
	hasComposedMessage: boolean;
	hasRecoveryJob: boolean;
	recoveryJobStatus: string | null;
	hasTraceHandle: boolean;
	scopeLabel: string | null;
	scopeSource: string | null;
};
