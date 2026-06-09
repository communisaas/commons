export type VerificationStatus = 'verified' | 'postal-resolved' | 'imported';

export type EmailMergeContext = {
	firstName: string;
	lastName: string;
	email: string;
	postalCode: string | null;
	verificationStatus: VerificationStatus;
	tierLabel?: string | null;
	tierContext: string;
};

const MERGE_FIELD_NAMES = [
	'firstName',
	'lastName',
	'email',
	'postalCode',
	'verificationStatus',
	'tierLabel',
	'tierContext'
] as const;

type MergeFieldName = (typeof MERGE_FIELD_NAMES)[number];

const MERGE_FIELD_RE =
	/\{\{(firstName|lastName|email|postalCode|verificationStatus|tierLabel|tierContext)\}\}/g;
const HAS_MERGE_FIELD_RE =
	/\{\{(?:firstName|lastName|email|postalCode|verificationStatus|tierLabel|tierContext)\}\}/;

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function cleanHeaderValue(value: string): string {
	return value.replace(/[\r\n\x00-\x1f\x7f]/g, '').slice(0, 998);
}

function mergeValue(ctx: EmailMergeContext, field: MergeFieldName): string {
	switch (field) {
		case 'firstName':
			return ctx.firstName;
		case 'lastName':
			return ctx.lastName;
		case 'email':
			return ctx.email;
		case 'postalCode':
			return ctx.postalCode ?? '';
		case 'verificationStatus':
			return ctx.verificationStatus;
		case 'tierLabel':
			return ctx.tierLabel ?? '';
		case 'tierContext':
			return ctx.tierContext;
	}
}

export function hasEmailMergeFields(value: string): boolean {
	return HAS_MERGE_FIELD_RE.test(value);
}

export function countEmailMergeFields(value: string): number {
	return value.match(MERGE_FIELD_RE)?.length ?? 0;
}

export function buildEmailTierContext(status: VerificationStatus): string {
	switch (status) {
		case 'verified':
			return 'Your identity is verified. You appear as a verified contact in this campaign.';
		case 'postal-resolved':
			return 'Your postal code is on file. Verification is pending.';
		case 'imported':
			return 'You were added by an organization. Verification is pending.';
	}
}

export function applyEmailMergeFields(
	template: string,
	ctx: EmailMergeContext,
	mode: 'html' | 'header' = 'html'
): string {
	return template.replace(MERGE_FIELD_RE, (_match, field: MergeFieldName) => {
		const value = mergeValue(ctx, field);
		return mode === 'html' ? escapeHtml(value) : cleanHeaderValue(value);
	});
}
