import { isUsableContactEmail, normalizeExternalHttpUrl } from '$lib/core/agents/exa-search';

type SeatHopPage = Readonly<{
	url: string;
	attributedTo: readonly number[];
	contactHints: Readonly<{ emails: readonly string[] }>;
}>;

export type SeatHopTarget = Readonly<{
	url: string;
	identityIndexes: number[];
}>;

export type SeatHopSelectionInput = Readonly<{
	pages: readonly SeatHopPage[];
	linksByUrl: ReadonlyMap<string, readonly string[]>;
	alreadyFetchedUrls: ReadonlySet<string>;
	identityCount: number;
	maxTargets: number;
}>;

const PATH_PRIORS: ReadonlyArray<
	Readonly<{ prior: number; sequences: readonly (readonly string[])[] }>
> = [
	{
		prior: 100,
		sequences: [['contact'], ['contact-us'], ['connect']]
	},
	{
		prior: 90,
		sequences: [['office-of-the-president'], ['about', 'contact']]
	},
	{
		prior: 70,
		sequences: [['media-contacts'], ['press'], ['newsroom']]
	},
	{
		prior: 60,
		sequences: [['governance'], ['board'], ['corporate-secretary']]
	},
	{
		prior: 50,
		sequences: [['staff'], ['directory'], ['people']]
	}
];

function containsContiguousSequence(pathSegments: readonly string[], sequence: readonly string[]) {
	if (sequence.length > pathSegments.length) return false;
	for (let start = 0; start <= pathSegments.length - sequence.length; start++) {
		if (sequence.every((segment, offset) => pathSegments[start + offset] === segment)) {
			return true;
		}
	}
	return false;
}

export function seatHopPathPrior(url: string): number {
	let pathSegments: string[];
	try {
		pathSegments = new URL(url).pathname
			.toLowerCase()
			.split('/')
			.filter((segment) => segment.length > 0);
	} catch {
		return 0;
	}

	for (const { prior, sequences } of PATH_PRIORS) {
		if (sequences.some((sequence) => containsContiguousSequence(pathSegments, sequence))) {
			return prior;
		}
	}
	return 0;
}

export function seatHopHostKey(url: string): string | null {
	try {
		return new URL(url).hostname.toLowerCase().replace(/^www\./u, '');
	} catch {
		return null;
	}
}

export function gappedIdentityIndexes(
	pages: readonly SeatHopPage[],
	identityCount: number
): number[] {
	if (!Number.isSafeInteger(identityCount) || identityCount <= 0) return [];

	const identitiesWithUsableEmail = new Set<number>();
	for (const page of pages) {
		if (!page.contactHints.emails.some(isUsableContactEmail)) continue;
		for (const identityIndex of page.attributedTo) {
			if (identityIndex >= 0 && identityIndex < identityCount) {
				identitiesWithUsableEmail.add(identityIndex);
			}
		}
	}

	return Array.from({ length: identityCount }, (_, index) => index).filter(
		(index) => !identitiesWithUsableEmail.has(index)
	);
}

type RankedSeatHopCandidate = Readonly<{
	url: string;
	prior: number;
	pathnameLength: number;
}>;

function compareCandidates(a: RankedSeatHopCandidate, b: RankedSeatHopCandidate): number {
	return (
		b.prior - a.prior ||
		a.pathnameLength - b.pathnameLength ||
		(a.url < b.url ? -1 : a.url > b.url ? 1 : 0)
	);
}

export function selectSeatHopTargets(input: SeatHopSelectionInput): SeatHopTarget[] {
	if (
		!Number.isSafeInteger(input.identityCount) ||
		input.identityCount <= 0 ||
		!Number.isSafeInteger(input.maxTargets) ||
		input.maxTargets <= 0
	) {
		return [];
	}

	const fetchedUrls = new Set<string>();
	for (const url of input.alreadyFetchedUrls) {
		const normalized = normalizeExternalHttpUrl(url);
		if (normalized) fetchedUrls.add(normalized);
	}

	const selected = new Map<string, { url: string; identityIndexes: number[] }>();
	for (const identityIndex of gappedIdentityIndexes(input.pages, input.identityCount)) {
		const candidatesByUrl = new Map<string, RankedSeatHopCandidate>();

		for (const page of input.pages) {
			if (!page.attributedTo.includes(identityIndex)) continue;
			const sourceHost = seatHopHostKey(page.url);
			if (!sourceHost) continue;

			const links = input.linksByUrl.get(page.url);
			if (links === undefined) continue;
			for (const rawLink of links) {
				const url = normalizeExternalHttpUrl(rawLink);
				if (!url || fetchedUrls.has(url) || seatHopHostKey(url) !== sourceHost) continue;
				const prior = seatHopPathPrior(url);
				if (prior === 0 || candidatesByUrl.has(url)) continue;
				candidatesByUrl.set(url, {
					url,
					prior,
					pathnameLength: new URL(url).pathname.length
				});
			}
		}

		const best = Array.from(candidatesByUrl.values()).sort(compareCandidates)[0];
		if (!best) continue;

		const existing = selected.get(best.url);
		if (existing) {
			existing.identityIndexes.push(identityIndex);
			continue;
		}
		if (selected.size >= input.maxTargets) continue;
		selected.set(best.url, { url: best.url, identityIndexes: [identityIndex] });
	}

	return Array.from(selected.values());
}
