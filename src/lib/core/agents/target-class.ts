/**
 * Delivery authority is derived on the server from grounding evidence. The
 * officeholder title lexicon may only lift an otherwise eligible,
 * self-published route from B to A; it never rescues an ungrounded or
 * off-domain C. Ambiguity resolves to the most restrictive tier.
 */

import {
	classifySeatRoute,
	type SeatRouteVerdict,
	type StandingClass
} from '$lib/core/agents/seat-route';

export type DeliveryTier = 'A' | 'B' | 'C';

export type StandingEvidence = {
	email?: string;
	candidateName?: string;
	title?: string;
	groundedThisRun: boolean;
	groundingSourceUrl?: string;
	nameBoundInBlock?: boolean;
	designatedContactForSubject?: boolean;
};

export type DeliveryDerivation = {
	deliveryTier: DeliveryTier;
	seatRoute?: SeatRouteVerdict;
	reason: string;
};

type OfficeholderStanding = Extract<StandingClass, 'decides' | 'gates' | 'administers'>;

const OFFICEHOLDER_TITLE = [
	{
		standing: 'decides',
		pattern:
			/\b(?:mayor|council\s+member|councilmember|alderman|county\s+supervisor|commissioner|board\s+member|trustee|superintendent|sheriff|assessor|attorney\s+general|secretary\s+of\s+state|governor|senator|representative|assemblymember|delegate|judge|chancellor|president)\b/i
	},
	{
		standing: 'administers',
		pattern: /\b(?:clerk|treasurer|comptroller|controller)\b/i
	},
	{
		standing: 'gates',
		pattern: /\b(?:chair|chairman|chairwoman)\b(?:\s+of\s+|\s*[,—-]\s*)\S/i
	}
] satisfies ReadonlyArray<{ standing: OfficeholderStanding; pattern: RegExp }>;

const PUBLIC_SUFFIX_LIKE = /^(?:co|com|net|org|gov|edu|ac|gouv|govt)\.[a-z]{2}$/;

function isOfficeholderTitle(title: string | undefined): boolean {
	if (!title?.trim()) return false;
	if (
		/\b(?:assistant|associate|deputy|vice|former|interim|acting|aide|advisor|adviser|staff|office)\b/i.test(
			title
		)
	) {
		return false;
	}
	return OFFICEHOLDER_TITLE.some(({ pattern }) => pattern.test(title));
}

function emailDomain(email: string): string | undefined {
	const normalized = email.trim().toLowerCase();
	const separator = normalized.lastIndexOf('@');
	if (separator <= 0 || separator === normalized.length - 1) return undefined;

	const domain = normalized.slice(separator + 1);
	if (!/^[a-z0-9.-]+$/.test(domain) || domain.startsWith('.') || domain.endsWith('.')) {
		return undefined;
	}
	return domain;
}

function isSelfPublished(email: string, groundingSourceUrl: string | undefined): boolean {
	const domain = emailDomain(email);
	if (!domain || !groundingSourceUrl) return false;

	let host: string;
	try {
		host = new URL(groundingSourceUrl).hostname.toLowerCase().replace(/^www\./, '');
	} catch {
		return false;
	}
	if (!host) return false;

	const domainsMatch =
		host === domain || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`);
	if (!domainsMatch) return false;

	const hostLabels = host.split('.');
	const domainLabels = domain.split('.');
	const shorter =
		hostLabels.length < domainLabels.length
			? host
			: domainLabels.length < hostLabels.length
				? domain
				: host.length <= domain.length
					? host
					: domain;
	if (shorter.split('.').length < 2 || PUBLIC_SUFFIX_LIKE.test(shorter)) return false;

	return true;
}

export function deriveDeliveryTier(evidence: StandingEvidence): DeliveryDerivation {
	const email = evidence.email?.trim();
	if (!email) return { deliveryTier: 'C', reason: 'no_address' };

	const selfPublished = isSelfPublished(email, evidence.groundingSourceUrl);
	const seatRoute = classifySeatRoute(email, { candidateName: evidence.candidateName });
	const isSeatRoute = seatRoute?.form === 'seat' && seatRoute.lexiconHit !== null;

	if (!evidence.groundedThisRun) {
		if (isSeatRoute && selfPublished) {
			return { deliveryTier: 'B', seatRoute, reason: 'seat_channel_self_published' };
		}
		return { deliveryTier: 'C', reason: 'not_grounded_this_run' };
	}

	// Statutory-record sources are intentionally deferred to a later lane.
	if (!selfPublished) return { deliveryTier: 'C', reason: 'off_domain_publication' };

	if (evidence.designatedContactForSubject === true && evidence.nameBoundInBlock === true) {
		return { deliveryTier: 'A', reason: 'designated_contact_self_published' };
	}
	if (isSeatRoute) {
		if (isOfficeholderTitle(evidence.title)) {
			return { deliveryTier: 'A', reason: 'officeholder_self_published' };
		}
		return { deliveryTier: 'B', seatRoute, reason: 'seat_channel_self_published' };
	}

	return { deliveryTier: 'C', reason: 'personal_local_part_no_seat' };
}
