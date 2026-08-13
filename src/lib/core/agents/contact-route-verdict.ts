/**
 * `blocked` is a lower bound, never a census — a proxy may transparently pass a
 * wall, or a fetch may fail before any body reaches us. `unknown` is a real
 * answer and is never to be rendered as `absent`. This verdict is a category,
 * never a score: do not sum it, rank it, average it, or color it.
 */

/**
 * WITHHELD (a directory that publishes a contact route which is not an email
 * address) is deliberately NOT a member of this union. Deciding it requires the
 * page link graph, which `ExaPageContent` does not expose today
 * (`src/lib/core/agents/exa-search.ts:171-178`). Nodes R1 and R4 own that. Until
 * then, that population is honestly reported as `unknown`.
 */

import { absent, blocked, type Fact } from '$lib/core/fact';

type ObservedAbsenceStatus = Extract<Fact<never>, { state: 'blocked' | 'absent' }>['state'];

export type ContactRouteStatus =
	| 'routed'
	| 'ungrounded'
	| 'undeliverable'
	| ObservedAbsenceStatus
	| 'unknown';

export type ContactRouteVerdict =
	| { status: 'routed' }
	| { status: 'ungrounded' }
	| { status: 'undeliverable' }
	| { status: 'blocked'; hosts: string[] }
	| { status: 'absent'; readSource: string }
	| { status: 'unknown' };

export type ContactRouteCounts = Record<ContactRouteStatus, number>;

export function emptyContactRouteCounts(): ContactRouteCounts {
	return {
		routed: 0,
		ungrounded: 0,
		undeliverable: 0,
		blocked: 0,
		absent: 0,
		unknown: 0
	};
}

export function tallyContactRoutes(
	verdicts: readonly (ContactRouteVerdict | undefined)[]
): ContactRouteCounts {
	const counts = emptyContactRouteCounts();
	for (const verdict of verdicts) {
		if (verdict) counts[verdict.status] += 1;
	}
	return counts;
}

export function deriveContactRouteVerdict(input: {
	hasEmail: boolean;
	emailClaimStripped?: boolean;
	mxUndeliverable?: boolean;
	sourceUrl?: string;
	blockedHosts?: ReadonlySet<string>;
	readSources?: ReadonlySet<string>;
}): ContactRouteVerdict {
	if (input.mxUndeliverable === true) return { status: 'undeliverable' };
	if (input.hasEmail === true) return { status: 'routed' };
	if (input.emailClaimStripped === true) return { status: 'ungrounded' };

	const readSource = normalizeContactRouteSource(input.sourceUrl);
	if (!readSource) return { status: 'unknown' };
	const host = new URL(readSource).hostname.toLowerCase();

	if (input.blockedHosts?.has(host)) {
		const fact = blocked(host);
		return { status: fact.state, hosts: [host] };
	}
	if (input.readSources?.has(readSource)) {
		const fact = absent();
		return { status: fact.state, readSource };
	}
	return { status: 'unknown' };
}

/** Canonical page key used to compare a candidate source with pages read this run. */
export function normalizeContactRouteSource(value: string | undefined): string | undefined {
	if (!value) return undefined;
	try {
		const parsed = new URL(value);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
		parsed.hash = '';
		return parsed.toString();
	} catch {
		return undefined;
	}
}

/** Human copy for one categorical verdict. It never turns the category into a grade. */
export function describeContactRoute(verdict: ContactRouteVerdict | undefined): string {
	switch (verdict?.status) {
		case 'routed':
			return 'Public email route found';
		case 'ungrounded':
			return 'A proposed email was not found in any page read this run';
		case 'undeliverable':
			return 'The public email could not receive mail';
		case 'blocked':
			return `Source retrieval was blocked${verdict.hosts.length > 0 ? ` for ${verdict.hosts.join(', ')}` : ''}`;
		case 'absent':
			return 'No email was published on the source page read this run';
		case 'unknown':
		case undefined:
			return 'The contact route could not be determined from this run';
	}
}
