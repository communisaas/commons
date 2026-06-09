export interface ShareMessageContext {
	template: { title: string; domain: string; description: string };
	/** Empty array signals pre-confirmation state. Populated signals route handoff evidence. */
	contactedNames: string[];
	/** Used when contactedNames is empty but recipients are still addressable. */
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
// Pre-confirmation variants (creator has published an action page)
// ---------------------------------------------------------------------------

function preSendShort(ctx: ShareMessageContext): string {
	// Target: <280 chars. Action-first. URL at end.
	const domain = normalizeDomain(ctx.template.domain);
	return `Working on ${domain}. I put together an action page to confirm routes to the right decision-makers.\n\n"${ctx.template.title}"\n\nOpen it here: ${ctx.shareUrl}`;
}

function preSendMedium(ctx: ShareMessageContext): string {
	// Target: ~500 chars. Conversational, URL in flow.
	const domain = normalizeDomain(ctx.template.domain);
	const description = ctx.template.description?.trim();
	const descLine = description ? `\n\n${description}` : '';
	return `I published an action page on ${domain}: "${ctx.template.title}"${descLine}\n\nEach reader reviews the message, confirms their route, and opens the right delivery path. ${ctx.shareUrl}`;
}

function preSendLong(ctx: ShareMessageContext): string {
	// Target: unlimited. Full context, persuasive framing, URL with clear CTA.
	const domain = normalizeDomain(ctx.template.domain);
	const description = ctx.template.description?.trim();
	const descParagraph = description ? `\n\n${description}\n` : '\n';
	return `On ${domain}: "${ctx.template.title}"${descParagraph}\nI published an action page that resolves the right decision-makers before anyone claims a send or proof record.\n\nIf this issue matters to you, open the page and confirm your own route: ${ctx.shareUrl}`;
}

function preSendSms(ctx: ShareMessageContext): string {
	// Target: <160 chars. Compressed, direct, URL only.
	const domain = normalizeDomain(ctx.template.domain);
	return `On ${domain}: "${ctx.template.title}" - confirm your route to decision-makers: ${ctx.shareUrl}`;
}

// ---------------------------------------------------------------------------
// Post-confirmation variants (reader has opened a route handoff, now recruiting)
// ---------------------------------------------------------------------------

function postSendShort(ctx: ShareMessageContext): string {
	// Target: <280 chars. First-person. Name the decision-makers. Invitational.
	const recipients = formatRecipients(ctx.contactedNames, ctx.totalRecipients);
	return `I confirmed my route to ${recipients} about "${ctx.template.title}". Open the action page: ${ctx.shareUrl}`;
}

function postSendMedium(ctx: ShareMessageContext): string {
	// Target: ~500 chars. First-person account, invitational close, URL in flow.
	const recipients = formatRecipients(ctx.contactedNames, ctx.totalRecipients);
	const domain = normalizeDomain(ctx.template.domain);
	return `My route to ${recipients} is confirmed for this ${domain} action: "${ctx.template.title}".\n\nThe action page is here: ${ctx.shareUrl}\n\nReview it and confirm your own route.`;
}

function postSendLong(ctx: ShareMessageContext): string {
	// Target: unlimited. Full account of what happened, why it matters, clear ask.
	const recipients = formatRecipients(ctx.contactedNames, ctx.totalRecipients);
	const domain = normalizeDomain(ctx.template.domain);
	const description = ctx.template.description?.trim();
	const descParagraph = description ? `\n\n${description}\n` : '\n';
	return `I confirmed my route to ${recipients} about "${ctx.template.title}"${descParagraph}\nThe issue is ${domain}. Commons resolves who should receive the message before any send or proof claim is recorded.\n\nIf you agree this matters, open the action page and confirm your own route: ${ctx.shareUrl}`;
}

function postSendSms(ctx: ShareMessageContext): string {
	// Target: <160 chars. First-person, name(s), direct CTA.
	const recipients = formatRecipients(ctx.contactedNames, ctx.totalRecipients);
	return `I confirmed my route to ${recipients} about "${ctx.template.title}". Confirm yours: ${ctx.shareUrl}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates a platform-appropriate share message for a given template and
 * route-confirmation state. Pure function; no side effects or external dependencies.
 *
 * Pre-confirmation (contactedNames is empty): recruits readers to confirm route.
 * Post-confirmation (contactedNames is populated): reports route handoff, invites others.
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
