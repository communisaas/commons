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

// Canonical supported merge-field token names. This is the single source of
// truth for the token set; the Convex mirror, the server compiler, and the
// compose page's detection pattern must all support exactly these. A parity
// suite imports this list and asserts set-equality so a token added at one
// site but not another fails CI.
export const MERGE_FIELD_NAMES = [
	'firstName',
	'lastName',
	'email',
	'postalCode',
	'verificationStatus',
	'tierLabel',
	'tierContext'
] as const;

type MergeFieldName = (typeof MERGE_FIELD_NAMES)[number];

const TOKEN_ALTERNATION = MERGE_FIELD_NAMES.join('|');

// Grammar: {{token}} or {{token|fallback}}. The fallback (no pipes or braces
// inside it) renders when the recipient value is blank, so an imported list
// with missing names gets "Dear Friend," instead of "Dear ,". A token that
// resolves blank with no usable fallback collapses together with one
// preceding space, leaving no orphaned punctuation. This grammar is mirrored
// in convex/_emailMergeFields.ts (the Convex bundler cannot resolve $lib
// paths); a parity suite holds the implementations identical.
const MERGE_FIELD_RESOLVE_RE = new RegExp(
	`( ?)\\{\\{(${TOKEN_ALTERNATION})(?:\\|([^{}|]*))?\\}\\}`,
	'g'
);
const MERGE_FIELD_RE = new RegExp(`\\{\\{(?:${TOKEN_ALTERNATION})(?:\\|[^{}|]*)?\\}\\}`, 'g');
const HAS_MERGE_FIELD_RE = new RegExp(`\\{\\{(?:${TOKEN_ALTERNATION})(?:\\|[^{}|]*)?\\}\\}`);

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
	return template.replace(
		MERGE_FIELD_RESOLVE_RE,
		(_match, leading: string, field: string, fallback: string | undefined) => {
			const resolved = mergeValue(ctx, field as MergeFieldName);
			const value = resolved.trim() !== '' ? resolved : (fallback ?? '');
			if (value.trim() === '') return '';
			return leading + (mode === 'html' ? escapeHtml(value) : cleanHeaderValue(value));
		}
	);
}
