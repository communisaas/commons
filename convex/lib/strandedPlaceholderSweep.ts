export type StrandedPlaceholderSweepCasState = {
	activeVersion?: number;
	activeRunToken?: string;
	cursorRevision?: number;
	cursor?: string;
};

export type StrandedPlaceholderSweepCasExpectation = {
	version: number;
	runToken: string;
	expectedRevision: number;
	expectedCursor?: string;
};

/** Pure CAS predicate shared by both one-shot placeholder sweep workers. */
export function matchesStrandedPlaceholderSweepCas(
	current: StrandedPlaceholderSweepCasState | null,
	expected: StrandedPlaceholderSweepCasExpectation
): current is StrandedPlaceholderSweepCasState & {
	activeVersion: number;
	activeRunToken: string;
	cursorRevision: number;
} {
	return (
		current !== null &&
		current.activeVersion === expected.version &&
		current.activeRunToken === expected.runToken &&
		current.cursorRevision === expected.expectedRevision &&
		current.cursor === expected.expectedCursor
	);
}
