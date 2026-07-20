export const MAX_INVITE_RECORDS_PER_ORG = 100;
export const MAX_ORG_SEATS = 25;

export function boundedOrgSeatLimit(value: number): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > MAX_ORG_SEATS) {
		throw new Error('ORG_SEAT_LIMIT_INVALID');
	}
	return value;
}
