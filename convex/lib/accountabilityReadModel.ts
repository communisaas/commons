import type { Doc, Id } from '../_generated/dataModel';

export const ACCOUNTABILITY_READ_MODEL_VERSION = 1;
export const ACCOUNTABILITY_READ_MODEL_MIGRATION_KEY = 'v1' as const;
export const ACCOUNTABILITY_K_FLOOR = 5;
export const ACCOUNTABILITY_RESPONSE_MAX = 128;
export const ACCOUNTABILITY_BROWSE_PAGE_DEFAULT = 20;
export const ACCOUNTABILITY_BROWSE_PAGE_MAX = 50;
export const ACCOUNTABILITY_EXPORT_PAGE_DEFAULT = 100;
export const ACCOUNTABILITY_EXPORT_PAGE_MAX = 100;
export const ACCOUNTABILITY_CURSOR_MAX_BYTES = 2 * 1024;
export const ACCOUNTABILITY_RECEIPT_PROJECTION_MAX_BYTES = 8 * 1024;
export const ACCOUNTABILITY_USER_RECEIPT_MAX_BYTES = 4 * 1024;
export const ACCOUNTABILITY_AGGREGATE_MAX_BYTES = 4 * 1024;
export const ACCOUNTABILITY_SCORECARD_MAX_BYTES = 8 * 1024;

type AccountabilityReadModelMigrationState = Pick<
	Doc<'accountabilityReadModelMigrations'>,
	| 'status'
	| 'phase'
	| 'cursor'
	| 'scanComplete'
	| 'scanned'
	| 'projected'
	| 'failureCode'
	| 'failureSourceId'
	| 'failurePhase'
>;

/**
 * One exact cutover predicate shared by serving reads, deployment readiness,
 * and the explicit activation boundary. A status label alone is never enough:
 * stale cursor or failure evidence must keep the legacy plane closed.
 */
export function isAccountabilityReadModelReady(
	row: AccountabilityReadModelMigrationState | null | undefined
): boolean {
	return (
		row?.status === 'ready' &&
		row.phase === 'complete' &&
		row.scanComplete === true &&
		row.cursor === undefined &&
		row.failureCode === undefined &&
		row.failureSourceId === undefined &&
		row.failurePhase === undefined &&
		row.scanned === row.projected
	);
}

const encoder = new TextEncoder();

function byteLength(value: unknown): number {
	return encoder.encode(JSON.stringify(value)).byteLength;
}

function boundedString(name: string, value: string, maxBytes: number): string {
	if (encoder.encode(value).byteLength > maxBytes) {
		throw new Error(`ACCOUNTABILITY_PROJECTION_INVALID:${name}:bytes`);
	}
	return value;
}

function boundedOptionalString(
	name: string,
	value: string | undefined,
	maxBytes: number
): string | undefined {
	return value === undefined ? undefined : boundedString(name, value, maxBytes);
}

function finite(name: string, value: number): number {
	if (!Number.isFinite(value)) {
		throw new Error(`ACCOUNTABILITY_PROJECTION_INVALID:${name}:finite`);
	}
	return value;
}

function finiteNonNegative(name: string, value: number): number {
	finite(name, value);
	if (value < 0) throw new Error(`ACCOUNTABILITY_PROJECTION_INVALID:${name}:negative`);
	return value;
}

function safeNonNegativeInteger(name: string, value: number): number {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(`ACCOUNTABILITY_PROJECTION_INVALID:${name}:integer`);
	}
	return value;
}

export function accountabilityProjectionWithBytes<T extends Record<string, unknown>>(
	projection: T,
	maxBytes: number
): T & { projectionBytes: number } {
	let projectionBytes = byteLength({ ...projection, projectionBytes: 0 });
	for (let attempt = 0; attempt < 3; attempt++) {
		const next = byteLength({ ...projection, projectionBytes });
		if (next === projectionBytes) break;
		projectionBytes = next;
	}
	if (projectionBytes > maxBytes) {
		throw new Error(`ACCOUNTABILITY_PROJECTION_INVALID:projection:${projectionBytes}`);
	}
	return { ...projection, projectionBytes };
}

export function normalizeAccountabilityPageSize(
	value: number | undefined,
	mode: 'browse' | 'export'
): number {
	const fallback =
		mode === 'export' ? ACCOUNTABILITY_EXPORT_PAGE_DEFAULT : ACCOUNTABILITY_BROWSE_PAGE_DEFAULT;
	const max = mode === 'export' ? ACCOUNTABILITY_EXPORT_PAGE_MAX : ACCOUNTABILITY_BROWSE_PAGE_MAX;
	const resolved = value ?? fallback;
	if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > max) {
		throw new Error(`ACCOUNTABILITY_PAGE_SIZE_INVALID:${mode}`);
	}
	return resolved;
}

export function normalizeAccountabilityCursor(value: string | null | undefined): string | null {
	if (value === undefined || value === null || value === '') return null;
	if (encoder.encode(value).byteLength > ACCOUNTABILITY_CURSOR_MAX_BYTES) {
		throw new Error('ACCOUNTABILITY_CURSOR_INVALID:bytes');
	}
	return value;
}

export type AccountabilityReceiptProjectionContext = {
	campaignId?: Id<'campaigns'>;
	deliveryId?: string;
	bill: Pick<Doc<'bills'>, '_id' | 'externalId' | 'title' | 'status' | 'jurisdiction'>;
};

/**
 * Compact canonical row used by every receipt browse surface. Packet snapshots,
 * response history and embeddings never enter this projection.
 */
export function projectAccountabilityReceipt(
	receipt: Doc<'accountabilityReceipts'>,
	context: AccountabilityReceiptProjectionContext
) {
	const verifiedCount = safeNonNegativeInteger('verifiedCount', receipt.verifiedCount);
	const totalCount = safeNonNegativeInteger('totalCount', receipt.totalCount);
	if (verifiedCount > totalCount) {
		throw new Error('ACCOUNTABILITY_PROJECTION_INVALID:verifiedCount:exceedsTotal');
	}
	const responseCount = safeNonNegativeInteger('responseCount', receipt.responses?.length ?? 0);
	if (responseCount > ACCOUNTABILITY_RESPONSE_MAX) {
		throw new Error('ACCOUNTABILITY_PROJECTION_INVALID:responses:cardinality');
	}
	const responses = receipt.responses ?? [];

	return accountabilityProjectionWithBytes(
		{
			receiptId: receipt._id,
			orgId: receipt.orgId,
			campaignId: context.campaignId,
			deliveryId: boundedOptionalString('deliveryId', context.deliveryId, 256),
			decisionMakerId: receipt.decisionMakerId,
			billId: receipt.billId,
			dmName: boundedString('dmName', receipt.dmName.trim(), 512),
			billExternalId: boundedString('billExternalId', context.bill.externalId, 256),
			billTitle: boundedString('billTitle', context.bill.title, 2_048),
			billStatus: boundedString('billStatus', context.bill.status, 128),
			billJurisdiction: boundedString('billJurisdiction', context.bill.jurisdiction, 256),
			publicEligible: totalCount >= ACCOUNTABILITY_K_FLOOR,
			verifiedCount,
			totalCount,
			districtCount: safeNonNegativeInteger('districtCount', receipt.districtCount),
			attestationDigest: boundedString('attestationDigest', receipt.attestationDigest, 512),
			proofDeliveredAt: finiteNonNegative('proofDeliveredAt', receipt.proofDeliveredAt),
			proofVerifiedAt:
				receipt.proofVerifiedAt === undefined
					? undefined
					: finiteNonNegative('proofVerifiedAt', receipt.proofVerifiedAt),
			actionOccurredAt:
				receipt.actionOccurredAt === undefined
					? undefined
					: finiteNonNegative('actionOccurredAt', receipt.actionOccurredAt),
			causalityClass: boundedString('causalityClass', receipt.causalityClass, 32),
			dmAction: boundedOptionalString('dmAction', receipt.dmAction, 2_048),
			alignment: finite('alignment', receipt.alignment),
			anchorCid: boundedOptionalString('anchorCid', receipt.anchorCid, 2_048),
			anchorRoot: boundedOptionalString('anchorRoot', receipt.anchorRoot, 2_048),
			status: boundedString('status', receipt.status, 128),
			responseCount,
			hasResponse: responseCount > 0,
			deliveryOpened: responses.some(
				(response) => response.type === 'opened' || response.type === 'clicked_verify'
			),
			deliveryVerified: responses.some((response) => response.type === 'clicked_verify'),
			replyReceived: responses.some((response) => response.type === 'replied'),
			version: ACCOUNTABILITY_READ_MODEL_VERSION,
			updatedAt: finiteNonNegative('updatedAt', receipt.updatedAt)
		},
		ACCOUNTABILITY_RECEIPT_PROJECTION_MAX_BYTES
	);
}

/** Compact, K-floored row for one identity-bound profile receipt page. */
export function projectUserAccountabilityReceipt(
	receipt: Doc<'accountabilityReceipts'>,
	supporterId: Id<'supporters'>,
	identityCommitment?: string
) {
	const verifiedCount = safeNonNegativeInteger('verifiedCount', receipt.verifiedCount);
	const totalCount = safeNonNegativeInteger('totalCount', receipt.totalCount);
	if (verifiedCount > totalCount) {
		throw new Error('ACCOUNTABILITY_PROJECTION_INVALID:verifiedCount:exceedsTotal');
	}
	if (totalCount < ACCOUNTABILITY_K_FLOOR) return null;
	const normalizedIdentityCommitment =
		normalizeAccountabilityIdentityCommitment(identityCommitment);
	return accountabilityProjectionWithBytes(
		{
			supporterId,
			identityCommitment: normalizedIdentityCommitment,
			receiptId: receipt._id as Id<'accountabilityReceipts'>,
			decisionMakerId: receipt.decisionMakerId,
			billId: receipt.billId,
			dmName: boundedString('dmName', receipt.dmName, 512),
			alignment: finite('alignment', receipt.alignment),
			causalityClass: boundedString('causalityClass', receipt.causalityClass, 32),
			proofDeliveredAt: finiteNonNegative('proofDeliveredAt', receipt.proofDeliveredAt),
			version: ACCOUNTABILITY_READ_MODEL_VERSION,
			updatedAt: finiteNonNegative('updatedAt', receipt.updatedAt)
		},
		ACCOUNTABILITY_USER_RECEIPT_MAX_BYTES
	);
}

export function normalizeAccountabilityIdentityCommitment(
	identityCommitment: string | undefined
): string | undefined {
	if (identityCommitment === undefined) return undefined;
	const normalized = identityCommitment.trim();
	if (normalized.length === 0) {
		throw new Error('ACCOUNTABILITY_PROJECTION_INVALID:identityCommitment:empty');
	}
	return boundedString('identityCommitment', normalized, 512);
}

function finiteOptional(name: string, value: number | undefined): number | undefined {
	return value === undefined ? undefined : finite(name, value);
}

/** Compact latest-snapshot row with numeric and cardinality poison checks. */
export function projectAccountabilityScorecard(snapshot: Doc<'scorecardSnapshots'>) {
	const periodStart = finiteNonNegative('periodStart', snapshot.periodStart);
	const periodEnd = finiteNonNegative('periodEnd', snapshot.periodEnd);
	if (periodEnd < periodStart) {
		throw new Error('ACCOUNTABILITY_PROJECTION_INVALID:scorecardPeriod:order');
	}
	const deliveriesSent = safeNonNegativeInteger('deliveriesSent', snapshot.deliveriesSent);
	const deliveriesOpened = safeNonNegativeInteger('deliveriesOpened', snapshot.deliveriesOpened);
	const deliveriesVerified = safeNonNegativeInteger(
		'deliveriesVerified',
		snapshot.deliveriesVerified
	);
	const repliesReceived = safeNonNegativeInteger('repliesReceived', snapshot.repliesReceived);
	if (
		deliveriesOpened > deliveriesSent ||
		deliveriesVerified > deliveriesSent ||
		repliesReceived > deliveriesSent
	) {
		throw new Error('ACCOUNTABILITY_PROJECTION_INVALID:scorecardDeliveries:exceedsSent');
	}
	const alignedVotes = safeNonNegativeInteger('alignedVotes', snapshot.alignedVotes);
	const totalScoredVotes = safeNonNegativeInteger('totalScoredVotes', snapshot.totalScoredVotes);
	if (alignedVotes > totalScoredVotes) {
		throw new Error('ACCOUNTABILITY_PROJECTION_INVALID:alignedVotes:exceedsTotal');
	}
	const methodologyVersion = safeNonNegativeInteger(
		'methodologyVersion',
		snapshot.methodologyVersion
	);
	if (methodologyVersion === 0) {
		throw new Error('ACCOUNTABILITY_PROJECTION_INVALID:methodologyVersion:zero');
	}
	const snapshotHash = boundedString('snapshotHash', snapshot.snapshotHash.trim(), 512);
	if (snapshotHash.length === 0) {
		throw new Error('ACCOUNTABILITY_PROJECTION_INVALID:snapshotHash:empty');
	}

	return accountabilityProjectionWithBytes(
		{
			decisionMakerId: snapshot.decisionMakerId,
			latestSnapshotId: snapshot._id,
			periodStart,
			periodEnd,
			responsiveness: finiteOptional('responsiveness', snapshot.responsiveness),
			alignment: finiteOptional('scorecardAlignment', snapshot.alignment),
			composite: finiteOptional('composite', snapshot.composite),
			deliveriesSent,
			deliveriesOpened,
			deliveriesVerified,
			repliesReceived,
			alignedVotes,
			totalScoredVotes,
			methodologyVersion,
			snapshotHash,
			version: ACCOUNTABILITY_READ_MODEL_VERSION,
			updatedAt: Date.now()
		},
		ACCOUNTABILITY_SCORECARD_MAX_BYTES
	);
}

export type AccountabilityReceiptContribution = {
	receiptCount: number;
	pendingCount: number;
	responseLoggedCount: number;
	anchorFieldCount: number;
	alignedCount: number;
	opposedCount: number;
	publicReceiptCount: number;
	publicVerifiedCount: number;
	publicCausalReceiptCount: number;
};

export function accountabilityReceiptContribution(
	projection: ReturnType<typeof projectAccountabilityReceipt>
): AccountabilityReceiptContribution {
	const publicMultiplier = projection.publicEligible ? 1 : 0;
	return {
		receiptCount: 1,
		pendingCount: projection.status === 'pending_response' ? 1 : 0,
		responseLoggedCount: projection.hasResponse ? 1 : 0,
		anchorFieldCount: projection.anchorCid || projection.anchorRoot ? 1 : 0,
		alignedCount: projection.alignment > 0 ? 1 : 0,
		opposedCount: projection.alignment < 0 ? 1 : 0,
		publicReceiptCount: publicMultiplier,
		publicVerifiedCount: publicMultiplier * projection.verifiedCount,
		publicCausalReceiptCount:
			publicMultiplier *
			(projection.causalityClass === 'strong' || projection.causalityClass === 'moderate' ? 1 : 0)
	};
}

export function applyReceiptCountDelta(current: number | undefined, delta: 1 | -1): number {
	if (!Number.isSafeInteger(current ?? 0) || (current ?? 0) < 0) {
		throw new Error('ACCOUNTABILITY_METRIC_INVALID:receiptCount');
	}
	const next = (current ?? 0) + delta;
	if (next < 0) throw new Error('ACCOUNTABILITY_METRIC_UNDERFLOW:receiptCount');
	return next;
}

export function applyNonNegativeMetricDelta(
	name: string,
	current: number | undefined,
	delta: number
): number {
	finite(name, current ?? 0);
	finite(name, delta);
	const next = (current ?? 0) + delta;
	if (next < -1e-9) throw new Error(`ACCOUNTABILITY_METRIC_UNDERFLOW:${name}`);
	return Math.abs(next) < 1e-9 ? 0 : next;
}

export function applyFiniteMetricDelta(
	name: string,
	current: number | undefined,
	delta: number
): number {
	finite(name, current ?? 0);
	finite(name, delta);
	const next = (current ?? 0) + delta;
	if (!Number.isFinite(next)) throw new Error(`ACCOUNTABILITY_METRIC_INVALID:${name}`);
	return Math.abs(next) < 1e-9 ? 0 : next;
}

export function assertReceiptProjectionIdentityStable(
	before: Pick<
		ReturnType<typeof projectAccountabilityReceipt>,
		| 'receiptId'
		| 'orgId'
		| 'campaignId'
		| 'deliveryId'
		| 'decisionMakerId'
		| 'billId'
		| 'proofDeliveredAt'
	>,
	after: Pick<
		ReturnType<typeof projectAccountabilityReceipt>,
		| 'receiptId'
		| 'orgId'
		| 'campaignId'
		| 'deliveryId'
		| 'decisionMakerId'
		| 'billId'
		| 'proofDeliveredAt'
	>
): void {
	for (const field of [
		'receiptId',
		'orgId',
		'campaignId',
		'deliveryId',
		'decisionMakerId',
		'billId',
		'proofDeliveredAt'
	] as const) {
		if (before[field] !== after[field]) {
			throw new Error(`ACCOUNTABILITY_PROJECTION_IMMUTABLE:${field}`);
		}
	}
}

export function assertProjectionByteBudget(value: unknown, maxBytes: number, name: string): void {
	const bytes = byteLength(value);
	if (bytes > maxBytes) throw new Error(`ACCOUNTABILITY_PROJECTION_INVALID:${name}:${bytes}`);
}
