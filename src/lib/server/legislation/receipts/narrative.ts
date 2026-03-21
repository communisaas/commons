/**
 * Narrative Generation: deterministic template-based narrative for receipts.
 * No LLM — purely mechanical from receipt data.
 */

export interface NarrativeInput {
	dmName: string;
	dmAction: string | null;
	proofVerifiedAt: Date | null;
	verifiedCount: number | null;
	districtCount: number | null;
	proofWeight: number;
	causalityClass: string;
}

/**
 * Generate a human-readable narrative for an accountability receipt.
 */
export function generateNarrative(receipt: NarrativeInput): string {
	const action = receipt.dmAction
		? formatAction(receipt.dmAction)
		: 'has not yet acted on';

	const verifyWord = receipt.proofVerifiedAt ? 'verifying' : 'receiving';
	const countLabel = receipt.verifiedCount !== null ? `${receipt.verifiedCount}` : 'fewer than 5';
	const districtLabel = receipt.districtCount !== null ? `${receipt.districtCount}` : 'fewer than 3';
	const proofClause = `after ${verifyWord} proof from ${countLabel} constituents across ${districtLabel} districts`;
	const weightClause = `(proof weight: ${receipt.proofWeight.toFixed(2)}, causality: ${receipt.causalityClass})`;

	return `${receipt.dmName} ${action} this bill ${proofClause} ${weightClause}`;
}

function formatAction(action: string): string {
	switch (action) {
		case 'voted_yes':
			return 'voted for';
		case 'voted_no':
			return 'voted against';
		case 'abstained':
			return 'abstained on';
		case 'sponsored':
			return 'sponsored';
		case 'co-sponsored':
			return 'co-sponsored';
		default:
			return action.replace(/_/g, ' ');
	}
}
