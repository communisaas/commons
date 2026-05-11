// RFC 2047 encoded-word for non-ASCII header values. Subjects with emoji or
// accented characters render as raw UTF-8 in many email clients but strict
// MIME parsers treat anything outside printable ASCII (0x20-0x7E) as invalid
// in unstructured header text. Encoded-word format: `=?UTF-8?B?{base64}?=`.
// We apply only when the input contains a non-ASCII byte; ASCII subjects
// pass through unchanged for cleaner inbox previews.
//
// This module's source is duplicated verbatim into `infra/lambda/ses-proxy/index.ts`
// because the Lambda is bundled separately and cannot import from src/. Keep
// both in lockstep — drift would mean a non-ASCII subject sent through the
// raw-email path encodes differently than one expected by a test fixture.
export function encodeMimeHeader(value: string): string {
	// eslint-disable-next-line no-control-regex
	if (!/[^\x20-\x7E]/.test(value)) {
		return value;
	}
	const b64 = Buffer.from(value, 'utf-8').toString('base64');
	return `=?UTF-8?B?${b64}?=`;
}
