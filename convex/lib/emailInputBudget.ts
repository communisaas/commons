export const MAX_EMAIL_SUBJECT_BYTES = 512;
export const MAX_EMAIL_BODY_HTML_BYTES = 256 * 1024;
export const MAX_EMAIL_FROM_NAME_BYTES = 256;
export const MAX_EMAIL_FROM_ADDRESS_BYTES = 320;
export const MAX_EMAIL_AB_PARENT_ID_BYTES = 128;
export const MAX_EMAIL_AB_CONFIG_BYTES = 32 * 1024;

const encoder = new TextEncoder();

function utf8Bytes(value: string): number {
	return encoder.encode(value).byteLength;
}

function assertStringBudget(
	value: string,
	label: string,
	maxBytes: number,
	{ allowEmpty = false }: { allowEmpty?: boolean } = {}
): void {
	const bytes = utf8Bytes(value);
	if ((!allowEmpty && bytes === 0) || bytes > maxBytes) {
		throw new Error(`${label}_INVALID (max ${maxBytes} UTF-8 bytes)`);
	}
}

export function assertEmailDraftInput(input: {
	subject: string;
	bodyHtml: string;
	fromName: string;
	fromEmail: string;
}): void {
	assertStringBudget(input.subject, 'EMAIL_SUBJECT', MAX_EMAIL_SUBJECT_BYTES);
	assertStringBudget(input.bodyHtml, 'EMAIL_BODY_HTML', MAX_EMAIL_BODY_HTML_BYTES, {
		allowEmpty: true
	});
	assertStringBudget(input.fromName, 'EMAIL_FROM_NAME', MAX_EMAIL_FROM_NAME_BYTES);
	assertStringBudget(input.fromEmail, 'EMAIL_FROM_ADDRESS', MAX_EMAIL_FROM_ADDRESS_BYTES);
	if (/[\r\n\0]/.test(input.fromName)) throw new Error('EMAIL_FROM_NAME_INVALID');
	if (
		/[\r\n\0]/.test(input.fromEmail) ||
		!/^[-.!#$%&'*+/=?^_`{}|~0-9A-Z]+@[-.0-9A-Z]+$/i.test(input.fromEmail)
	) {
		throw new Error('EMAIL_FROM_ADDRESS_INVALID');
	}
}

export function assertEmailDraftPatch(input: {
	subject?: string;
	bodyHtml?: string;
	fromName?: string;
	fromEmail?: string;
}): void {
	if (input.subject !== undefined) {
		assertStringBudget(input.subject, 'EMAIL_SUBJECT', MAX_EMAIL_SUBJECT_BYTES);
	}
	if (input.bodyHtml !== undefined) {
		assertStringBudget(input.bodyHtml, 'EMAIL_BODY_HTML', MAX_EMAIL_BODY_HTML_BYTES, {
			allowEmpty: true
		});
	}
	if (input.fromName !== undefined) {
		assertStringBudget(input.fromName, 'EMAIL_FROM_NAME', MAX_EMAIL_FROM_NAME_BYTES);
	}
	if (input.fromEmail !== undefined) {
		assertEmailDraftInput({
			subject: 'x',
			bodyHtml: '',
			fromName: 'x',
			fromEmail: input.fromEmail
		});
	}
}

export function assertAbMetadataInput(parentId: string, config: unknown): void {
	assertStringBudget(parentId, 'EMAIL_AB_PARENT_ID', MAX_EMAIL_AB_PARENT_ID_BYTES);
	if (!/^[A-Za-z0-9_-]+$/.test(parentId)) {
		throw new Error('EMAIL_AB_PARENT_ID_INVALID');
	}
	let serialized: string;
	try {
		serialized = JSON.stringify(config);
	} catch {
		throw new Error('EMAIL_AB_CONFIG_INVALID');
	}
	if (serialized === undefined || utf8Bytes(serialized) > MAX_EMAIL_AB_CONFIG_BYTES) {
		throw new Error(`EMAIL_AB_CONFIG_INVALID (max ${MAX_EMAIL_AB_CONFIG_BYTES} UTF-8 bytes)`);
	}
}
