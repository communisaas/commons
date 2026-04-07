export interface ShareMessageContext {
	template: { title: string; domain: string; description: string };
	/** Empty array signals pre-send state. Populated signals post-send. */
	contactedNames: string[];
	/** Used when contactedNames is empty but recipients were still addressed. */
	totalRecipients: number;
	shareUrl: string;
}

export type ShareVariant = 'short' | 'medium' | 'long' | 'sms';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Formats a list of decision-maker names into a readable attribution string.
 *
 * - 0 names, totalRecipients > 0 → "N decision-makers"
 * - 0 names, 0 recipients       → "decision-makers" (generic fallback)
 * - 1 name                      → "Mayor Rodriguez"
 * - 2 names                     → "Mayor Rodriguez and Council Member Chen"
 * - 3+ names                    → "Mayor Rodriguez, Council Member Chen, and N others"
 */
function formatRecipients(names: string[], total: number): string {
	if (names.length === 0) {
		return total > 0 ? `${total} decision-makers` : 'decision-makers';
	}
	if (names.length === 1) {
		return names[0];
	}
	if (names.length === 2) {
		return `${names[0]} and ${names[1]}`;
	}
	// 3 or more: show first two by name, collapse the rest into a count
	const overflow = total > names.length ? total - 2 : names.length - 2;
	return `${names[0]}, ${names[1]}, and ${overflow} ${overflow === 1 ? 'other' : 'others'}`;
}

/**
 * Returns a lowercase domain string for use in share messages.
 * Falls back to "advocacy" when the domain is absent.
 */
function normalizeDomain(raw: string): string {
	return raw.trim().toLowerCase() || 'advocacy';
}

// ---------------------------------------------------------------------------
// Pre-send variants (creator has published but not yet sent)
// ---------------------------------------------------------------------------

function preSendShort(ctx: ShareMessageContext): string {
	// Target: <280 chars. Action-first. URL at end.
	// Example: "Need people to pressure the city council on housing? Template's ready. Takes 2 min. https://..."
	const domain = normalizeDomain(ctx.template.domain);
	// ~130 chars base + URL
	return `Working on ${domain}. I put together a template to contact the right people directly.\n\n"${ctx.template.title}"\n\nTakes 2 minutes. ${ctx.shareUrl}`;
}

function preSendMedium(ctx: ShareMessageContext): string {
	// Target: ~500 chars. Conversational, URL in flow.
	const domain = normalizeDomain(ctx.template.domain);
	const description = ctx.template.description?.trim();
	const descLine = description ? `\n\n${description}` : '';
	return `I put together a direct-contact template on ${domain}: "${ctx.template.title}"${descLine}\n\nIt pre-writes the message and routes it to the right decision-makers. ${ctx.shareUrl} — you fill in your name and send. Takes about 2 minutes.`;
}

function preSendLong(ctx: ShareMessageContext): string {
	// Target: unlimited. Full context, persuasive framing, URL with clear CTA.
	const domain = normalizeDomain(ctx.template.domain);
	const description = ctx.template.description?.trim();
	const descParagraph = description ? `\n\n${description}\n` : '\n';
	return `On ${domain}: "${ctx.template.title}"${descParagraph}\nI built a contact template that writes the message for you and sends it directly to the decision-makers who can act on it — no petitions, no intermediaries.\n\nIf this issue matters to you, this is the most direct path: ${ctx.shareUrl}\n\nIt takes about 2 minutes. The message goes to the right people.`;
}

function preSendSms(ctx: ShareMessageContext): string {
	// Target: <160 chars. Compressed, direct, URL only.
	// "On housing: direct message template to city council. 2 min: https://..."
	const domain = normalizeDomain(ctx.template.domain);
	// Keep well under 160: category + short hook + URL
	return `On ${domain}: "${ctx.template.title}" — write to decision-makers directly. 2 min: ${ctx.shareUrl}`;
}

// ---------------------------------------------------------------------------
// Post-send variants (user has started emails, now recruiting)
// ---------------------------------------------------------------------------

function postSendShort(ctx: ShareMessageContext): string {
	// Target: <280 chars. First-person. Name the decision-makers. Invitational.
	const recipients = formatRecipients(ctx.contactedNames, ctx.totalRecipients);
	return `I reached out to ${recipients} about "${ctx.template.title}". Send the same message: ${ctx.shareUrl}`;
}

function postSendMedium(ctx: ShareMessageContext): string {
	// Target: ~500 chars. First-person account, invitational close, URL in flow.
	const recipients = formatRecipients(ctx.contactedNames, ctx.totalRecipients);
	const domain = normalizeDomain(ctx.template.domain);
	return `I reached out to ${recipients} about ${domain} — specifically: "${ctx.template.title}".\n\nThe template is here: ${ctx.shareUrl}\n\nSame message, your name. Add your voice.`;
}

function postSendLong(ctx: ShareMessageContext): string {
	// Target: unlimited. Full account of what happened, why it matters, clear ask.
	const recipients = formatRecipients(ctx.contactedNames, ctx.totalRecipients);
	const domain = normalizeDomain(ctx.template.domain);
	const description = ctx.template.description?.trim();
	const descParagraph = description ? `\n\n${description}\n` : '\n';
	return `I reached out to ${recipients} about "${ctx.template.title}"${descParagraph}\nThe issue is ${domain}. I used a direct-contact template — no petition, no form letter to an inbox nobody monitors. It goes to the people with actual authority to act on it.\n\nIf you agree this matters, send the same message with your name on it: ${ctx.shareUrl}\n\nTakes 2 minutes. The more people who send it, the harder it is to ignore.`;
}

function postSendSms(ctx: ShareMessageContext): string {
	// Target: <160 chars. First-person, name(s), direct CTA.
	const recipients = formatRecipients(ctx.contactedNames, ctx.totalRecipients);
	return `I reached out to ${recipients} about "${ctx.template.title}". Add your voice: ${ctx.shareUrl}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates a platform-appropriate share message for a given template and
 * send state. Pure function — no side effects, no external dependencies.
 *
 * Pre-send (contactedNames is empty): recruits others to act.
 * Post-send (contactedNames is populated): reports action taken, invites others.
 *
 * Character budgets by variant:
 *   short  → <280 chars (Twitter, Discord)
 *   medium → ~500 chars (Slack, iMessage)
 *   long   → unlimited (Email, Reddit)
 *   sms    → <160 chars (SMS)
 */
export function generateShareMessage(ctx: ShareMessageContext, variant: ShareVariant): string {
	// Post-send copy requires actual contacted names — a non-zero totalRecipients
	// alone is not evidence of action (the page always passes landscape count).
	const postSend = ctx.contactedNames.length > 0;

	if (postSend) {
		switch (variant) {
			case 'short':
				return postSendShort(ctx);
			case 'medium':
				return postSendMedium(ctx);
			case 'long':
				return postSendLong(ctx);
			case 'sms':
				return postSendSms(ctx);
		}
	}

	switch (variant) {
		case 'short':
			return preSendShort(ctx);
		case 'medium':
			return preSendMedium(ctx);
		case 'long':
			return preSendLong(ctx);
		case 'sms':
			return preSendSms(ctx);
	}
}
