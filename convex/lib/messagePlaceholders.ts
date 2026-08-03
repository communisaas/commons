/**
 * Sender-fill placeholders — one decision, both runtimes.
 *
 * An author writes a letter with bracket slots the SENDER is meant to fill by
 * hand. They are not instructions the recipient should read: on the send path
 * each slot either carries the sender's own words or it disappears. A bracket
 * string reaching a real inbox — or a congressional office — is the failure this
 * module exists to prevent.
 *
 * SvelteKit resolves the mailto lanes and Convex resolves the CWC lane. Both
 * read this table, so the two cannot drift. The module is deliberately pure:
 * zero imports, so it loads unchanged in the Convex runtime and in the browser.
 */

/** Placeholder name → substituted text, or `null` to erase the placeholder. */
export type TemplateReplacements = Record<string, string | null>;

/** The slots an author leaves for the sender to fill by hand. */
export const MANUAL_FILL_PLACEHOLDERS = [
	'[Personal Connection]',
	'[Phone]',
	'[Phone Number]',
	'[Your Phone]',
	'[Your Story]',
	'[Your Experience]',
	'[Personal Story]'
] as const;

/** The one slot the sender's typed words occupy — the position the author chose. */
export const PERSONAL_CONNECTION_PLACEHOLDER = '[Personal Connection]';

/**
 * Every bracket string that must never survive to a recipient: the manual-fill
 * family plus the identity slots the send path substitutes or erases.
 *
 * Matching is literal-string only. A generic `\[.*?\]` matcher would also strike
 * the footnote markers ([1], [2], [3]) real letters cite, which must reach the
 * recipient intact.
 */
export const DELIVERABLE_PLACEHOLDER_DENYLIST = [
	...MANUAL_FILL_PLACEHOLDERS,
	'[Name]',
	'[Your Name]',
	'[Address]',
	'[Your Address]',
	'[City]',
	'[State]',
	'[ZIP]',
	'[Zip Code]',
	'[Representative Name]',
	'[Rep Name]',
	'[Representative]',
	'[Senator Name]',
	'[Senator]',
	'[Senior Senator]',
	'[Junior Senator]'
] as const;

/**
 * Build the manual-fill table for one send: the sender's words at the personal
 * connection site when they supplied any, removal everywhere else. Called with
 * no argument — as the server side must, holding no message text — every
 * manual-fill placeholder erases.
 */
export function manualFillReplacements(personalConnection?: string): TemplateReplacements {
	const typed = personalConnection?.trim();
	const table: TemplateReplacements = {};
	for (const placeholder of MANUAL_FILL_PLACEHOLDERS) {
		table[placeholder] = placeholder === PERSONAL_CONNECTION_PLACEHOLDER && typed ? typed : null;
	}
	return table;
}

/**
 * Escape a string for use inside a regular expression.
 */
function escapeRegex(value: string): string {
	if (typeof value !== 'string') {
		console.warn('escapeRegex received non-string input:', typeof value);
		return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply ONE placeholder to ONE string.
 *
 * A value substitutes in place; `null` erases the placeholder along with the
 * line or the connecting phrase that carried it. Every branch that resolves a
 * placeholder goes through here — a second copy of this logic is how the subject
 * line and the body start disagreeing.
 */
export function applyReplacement(
	text: string,
	placeholder: string,
	value: string | null
): string {
	const escaped = escapeRegex(placeholder);

	if (value !== null) {
		return text.replace(new RegExp(escaped, 'g'), value);
	}

	// Lines holding nothing but this placeholder go away entirely.
	let resolved = text.replace(new RegExp(`^[ \\t]*${escaped}[ \\t]*$`, 'gm'), '');

	// Inline occurrences take their connecting word with them, so "from [Address]"
	// does not leave a dangling preposition.
	resolved = resolved.replace(new RegExp(`(from|at|in|of)\\s+${escaped}`, 'gi'), '');

	// Anything still standing is removed outright.
	return resolved.replace(new RegExp(escaped, 'g'), '');
}

/**
 * Apply an entire replacement table to one string, then close the gaps the
 * erasures left behind. This is the whole resolution step — every lane calls it
 * rather than re-writing the loop and the cleanup.
 */
export function resolvePlaceholders(text: string, replacements: TemplateReplacements): string {
	let resolved = text;
	for (const [placeholder, value] of Object.entries(replacements)) {
		resolved = applyReplacement(resolved, placeholder, value);
	}
	return resolved.replace(/\n{3,}/g, '\n\n').trim();
}
