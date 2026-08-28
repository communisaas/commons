import { hasRoleFormLocalPart, isUsableContactEmail } from './contact-email';
import { DECISION_MAKER_PROVIDER_LIMITS } from './provider-call-envelope';

/**
 * The structural extractor never has enough semantic evidence to assert that
 * an address reaches a person. Institution-bound addresses are reported on the
 * separate SegmentResult field; every emitted RecordBlock is office-scoped and
 * the synthesis model classifies any institution-designated individual contact.
 */
export type BindingScope = 'office' | 'institution';

export interface RecordBlock {
	address: string;
	addressOrigin: 'mailto' | 'text';
	names: string[];
	labels: string[];
	titleLine?: string;
	bindingScope: BindingScope;
	bindingRejectedReason?: string;
}

export interface SegmentResult {
	blocks: RecordBlock[];
	institutionBoundAddresses: string[];
	truncated: boolean;
}

export const CONSUMER_MAILBOX_DOMAINS: ReadonlySet<string> = Object.freeze(
	new Set([
		'gmail.com',
		'googlemail.com',
		'yahoo.com',
		'ymail.com',
		'hotmail.com',
		'outlook.com',
		'live.com',
		'msn.com',
		'aol.com',
		'icloud.com',
		'me.com',
		'mac.com',
		'comcast.net',
		'verizon.net',
		'att.net',
		'sbcglobal.net',
		'protonmail.com',
		'proton.me',
		'gmx.com',
		'mail.com',
		'zoho.com',
		'yandex.com',
		'qq.com',
		'163.com'
	])
);

const DEFAULT_MAX_SCAN_CHARACTERS = 500_000;
const MAX_FRAME_TEXT_CHARACTERS = 8_192;
const MAX_LABEL_CHARACTERS = 160;
const MAX_TITLE_LINE_CHARACTERS = 160;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+\-]{1,64}@[a-zA-Z0-9.\-]{1,187}\.[a-zA-Z]{2,63}/gu;
const HIDDEN_SUBTREE_TAGS = new Set(['script', 'style', 'noscript', 'template']);
const VOID_ELEMENT_TAGS = new Set([
	'br',
	'img',
	'input',
	'hr',
	'meta',
	'link',
	'area',
	'base',
	'col',
	'embed',
	'source',
	'track',
	'wbr'
]);
const NAME_PREFIX = /^(?:name\s*:\s*)?(?:(?:dr|mr|mrs|ms|miss|prof)\.?\s+)?/iu;
const NAME_WORD = /^(?:\p{Lu}[\p{L}\p{M}'’.\-]*|\p{Lu}{2,})$/u;
const HONORIFIC = /^(?:dr|mr|mrs|ms|miss|prof)\.?$/iu;

interface Frame {
	tag: string;
	hidden: boolean;
	addresses: Map<string, 'mailto' | 'text'>;
	textChunks: string[];
	textCharacters: number;
	labels: Set<string>;
	descendantBlockAddresses: Set<string>;
	anchorAddresses: Set<string>;
}

interface NameCandidate {
	name: string;
}

export interface BlockAccumulator {
	openElement(tag: string): void;
	text(chunk: string): void;
	mailto(address: string, label?: string | null): void;
	closeElement(): void;
	finish(): SegmentResult;
}

function normalizeLimit(value: number | undefined, fallback: number): number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function decodeHtmlEntities(value: string): string {
	return value.replace(
		/&(?:#(\d+)|#x([\da-f]+)|amp|lt|gt|quot|apos|nbsp);/giu,
		(entity, decimal, hex) => {
			if (decimal) {
				const point = Number.parseInt(decimal, 10);
				return Number.isSafeInteger(point) && point <= 0x10ffff
					? String.fromCodePoint(point)
					: entity;
			}
			if (hex) {
				const point = Number.parseInt(hex, 16);
				return Number.isSafeInteger(point) && point <= 0x10ffff
					? String.fromCodePoint(point)
					: entity;
			}
			switch (entity.toLowerCase()) {
				case '&amp;':
					return '&';
				case '&lt;':
					return '<';
				case '&gt;':
					return '>';
				case '&quot;':
					return '"';
				case '&apos;':
					return "'";
				case '&nbsp;':
					return ' ';
				default:
					return entity;
			}
		}
	);
}

function normalizeVisibleText(value: string): string {
	return decodeHtmlEntities(value).replace(/\s+/gu, ' ').trim();
}

function emailDomain(address: string): string {
	return address.slice(address.lastIndexOf('@') + 1).toLowerCase();
}

function eligibleAddress(address: string): string | null {
	const normalized = address.toLowerCase();
	if (!isUsableContactEmail(normalized) || CONSUMER_MAILBOX_DOMAINS.has(emailDomain(normalized))) {
		return null;
	}
	return normalized;
}

function emailMatches(value: string): string[] {
	return Array.from(value.matchAll(EMAIL_PATTERN), (match) => match[0]);
}

function mailtoAddresses(value: string): string[] {
	if (!value.toLowerCase().startsWith('mailto:')) return [];
	const encodedTarget = decodeHtmlEntities(value.slice('mailto:'.length).split('?', 1)[0]);
	let target = encodedTarget;
	try {
		target = decodeURIComponent(encodedTarget);
	} catch {
		// A malformed escape does not make attribute-only text eligible. The email
		// matcher below may still recover a literal, otherwise the href is ignored.
	}
	return emailMatches(target);
}

function nameTokens(value: string): string[] {
	return value
		.normalize('NFKD')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()
		.split(/\s+/u)
		.filter((token) => token && !HONORIFIC.test(token));
}

/**
 * Deliberately only a shape check. A capitalized two-word office title has the
 * same lexical shape as a person's name, so candidates remain observations and
 * are never authority for the extractor to mint a person binding.
 */
function looksLikeNameCandidate(value: string): boolean {
	const withoutPrefix = value.replace(NAME_PREFIX, '').trim();
	const words = withoutPrefix.split(/\s+/u).filter(Boolean);
	if (words.length < 2 || words.length > 5) return false;
	if (!words.every((word) => NAME_WORD.test(word))) return false;
	return nameTokens(withoutPrefix).length >= 2;
}

function extractNameCandidates(chunks: readonly string[]): NameCandidate[] {
	const names = new Map<string, NameCandidate>();
	for (const chunk of chunks) {
		const withoutEmails = normalizeVisibleText(chunk).replace(EMAIL_PATTERN, ' ').trim();
		for (const part of withoutEmails.split(/[,;|•\r\n]+|\s+[–—]\s+/u)) {
			const candidate = part.trim();
			if (candidate && looksLikeNameCandidate(candidate)) {
				const name = candidate.replace(/^name\s*:\s*/iu, '').trim();
				const key = name.toLocaleLowerCase();
				names.set(key, { name });
			}
		}
	}
	return [...names.values()];
}

function localPartTokens(address: string): string[] {
	const localPart = address.slice(0, address.indexOf('@')).toLowerCase();
	return localPart
		.split(/[._+\-]+/u)
		.map((token) => token.replace(/[^\p{L}\p{N}]/gu, ''))
		.filter(Boolean);
}

function localPartSharesNameToken(address: string, name: string): boolean {
	const localTokens = localPartTokens(address);
	const personTokens = nameTokens(name);
	return localTokens.some((local) =>
		personTokens.some((token) => token.length >= 2 && local === token)
	);
}

function titleLineFor(chunks: readonly string[], names: readonly string[]): string | undefined {
	const normalizedNames = new Set(names.map((name) => normalizeVisibleText(name).toLowerCase()));
	const normalizedNameBodies = new Set(
		names.map((name) => normalizeVisibleText(name.replace(NAME_PREFIX, '')).toLowerCase())
	);
	for (const chunk of chunks) {
		for (const part of normalizeVisibleText(chunk).split(/[|•\r\n]+|\s+[–—]\s+/u)) {
			const candidate = part.replace(EMAIL_PATTERN, ' ').replace(/\s+/gu, ' ').trim();
			const candidateBody = normalizeVisibleText(candidate.replace(NAME_PREFIX, '')).toLowerCase();
			if (
				candidate.length < 2 ||
				normalizedNames.has(candidate.toLowerCase()) ||
				normalizedNameBodies.has(candidateBody) ||
				/^(?:email|e-mail|contact|mailto)\s*:?$/iu.test(candidate)
			) {
				continue;
			}
			return candidate.slice(0, MAX_TITLE_LINE_CHARACTERS);
		}
	}
	return undefined;
}

function blockForFrame(frame: Frame, address: string): RecordBlock {
	const nameCandidates = extractNameCandidates(frame.textChunks);
	// Correspondence decides which same-frame strings are useful observations,
	// never whether those strings name a person. "Fire Marshal" and "Jane Smith"
	// can satisfy this test equally; the semantic distinction belongs downstream.
	const names = nameCandidates
		.filter((candidate) => localPartSharesNameToken(address, candidate.name))
		.map((candidate) => candidate.name);
	const titleLine = titleLineFor(frame.textChunks, names);
	const labels = [...frame.labels].slice(0, 8);
	const bindingRejectedReason = hasRoleFormLocalPart(address)
		? undefined
		: nameCandidates.length > 0 && names.length === 0
			? 'local-part-name-mismatch'
			: names.length > 0
				? 'person-evidence-insufficient'
				: undefined;
	return {
		address,
		addressOrigin: frame.addresses.get(address) ?? 'text',
		names,
		labels,
		...(titleLine ? { titleLine } : {}),
		bindingScope: 'office',
		...(bindingRejectedReason ? { bindingRejectedReason } : {})
	};
}

export function createBlockAccumulator(options?: {
	maxBlocks?: number;
	truncated?: boolean;
}): BlockAccumulator {
	const maxBlocks = normalizeLimit(
		options?.maxBlocks,
		DECISION_MAKER_PROVIDER_LIMITS.maxRecordBlocksPerPage
	);
	const stack: Frame[] = [];
	const candidates: RecordBlock[] = [];
	const pendingOfficeBlocks = new Map<string, RecordBlock>();
	const institutionBoundAddresses = new Set<string>();
	let inputTruncated = options?.truncated === true;
	let finished: SegmentResult | undefined;

	const addAddress = (address: string, origin: 'mailto' | 'text') => {
		const eligible = eligibleAddress(address);
		if (!eligible) return;
		for (const frame of stack) {
			if (frame.hidden) continue;
			const existing = frame.addresses.get(eligible);
			if (!existing || origin === 'mailto') frame.addresses.set(eligible, origin);
		}
	};

	const accumulator: BlockAccumulator = {
		openElement(tag) {
			if (finished) return;
			const normalizedTag = tag.toLowerCase();
			const parent = stack.at(-1);
			stack.push({
				tag: normalizedTag,
				hidden: parent?.hidden === true || HIDDEN_SUBTREE_TAGS.has(normalizedTag),
				addresses: new Map(),
				textChunks: [],
				textCharacters: 0,
				labels: new Set(),
				descendantBlockAddresses: new Set(),
				anchorAddresses: new Set()
			});
		},

		text(chunk) {
			if (finished || !chunk || stack.at(-1)?.hidden !== false) return;
			const decoded = decodeHtmlEntities(chunk);
			for (const address of emailMatches(decoded)) addAddress(address, 'text');

			const normalized = normalizeVisibleText(decoded);
			if (!normalized) return;
			for (const frame of stack) {
				if (frame.hidden || frame.textCharacters >= MAX_FRAME_TEXT_CHARACTERS) continue;
				const retained = normalized.slice(0, MAX_FRAME_TEXT_CHARACTERS - frame.textCharacters);
				if (!retained) continue;
				frame.textChunks.push(retained);
				frame.textCharacters += retained.length;
			}

			const anchorFrame = [...stack].reverse().find((frame) => frame.tag === 'a');
			if (anchorFrame?.anchorAddresses.size) {
				const label = normalized.slice(0, MAX_LABEL_CHARACTERS);
				for (const frame of stack) {
					if (!frame.hidden) frame.labels.add(label);
				}
			}
		},

		mailto(address, label) {
			if (finished || stack.at(-1)?.hidden !== false) return;
			const addresses = mailtoAddresses(address);
			const anchor = stack.at(-1);
			for (const candidate of addresses) {
				const eligible = eligibleAddress(candidate);
				if (!eligible) continue;
				addAddress(eligible, 'mailto');
				if (anchor?.tag === 'a') anchor.anchorAddresses.add(eligible);
			}
			const normalizedLabel = normalizeVisibleText(label ?? '').slice(0, MAX_LABEL_CHARACTERS);
			if (addresses.length > 0 && normalizedLabel) {
				for (const frame of stack) {
					if (!frame.hidden) frame.labels.add(normalizedLabel);
				}
			}
		},

		closeElement() {
			if (finished) return;
			const frame = stack.pop();
			if (!frame) return;
			const emittedHere = new Set<string>();
			if (!frame.hidden) {
				const addresses = [...frame.addresses.keys()];
				const names = extractNameCandidates(frame.textChunks);
				if (
					addresses.length >= 2 &&
					names.length >= 2 &&
					frame.descendantBlockAddresses.size === 0
				) {
					for (const address of addresses) {
						institutionBoundAddresses.add(address);
						pendingOfficeBlocks.delete(address);
					}
				} else if (
					addresses.length === 1 &&
					!frame.descendantBlockAddresses.has(addresses[0]) &&
					!institutionBoundAddresses.has(addresses[0])
				) {
					const block = blockForFrame(frame, addresses[0]);
					if (names.length > 0 || (block.titleLine && frame.tag !== 'a')) {
						candidates.push(block);
						pendingOfficeBlocks.delete(block.address);
						emittedHere.add(block.address);
					} else if (!pendingOfficeBlocks.has(block.address)) {
						pendingOfficeBlocks.set(block.address, block);
					}
				}
			}

			const parent = stack.at(-1);
			if (parent) {
				for (const address of frame.descendantBlockAddresses) {
					parent.descendantBlockAddresses.add(address);
				}
				for (const address of emittedHere) parent.descendantBlockAddresses.add(address);
			}
		},

		finish() {
			if (finished) return finished;
			while (stack.length > 0) accumulator.closeElement();
			for (const [address, block] of pendingOfficeBlocks) {
				if (
					!institutionBoundAddresses.has(address) &&
					!candidates.some((item) => item.address === address)
				) {
					candidates.push(block);
				}
			}

			const addressCounts = new Map<string, number>();
			for (const block of candidates) {
				addressCounts.set(block.address, (addressCounts.get(block.address) ?? 0) + 1);
			}
			const normalizedCandidates = candidates.map((block) =>
				(addressCounts.get(block.address) ?? 0) >= 2
					? {
							...block,
							bindingScope: 'office' as const,
							names: [],
							bindingRejectedReason: undefined
						}
					: block
			);
			inputTruncated ||= normalizedCandidates.length > maxBlocks;
			finished = {
				blocks: normalizedCandidates.slice(0, maxBlocks),
				institutionBoundAddresses: [...institutionBoundAddresses],
				truncated: inputTruncated
			};
			return finished;
		}
	};

	accumulator.openElement('#document');
	return accumulator;
}

function findTagEnd(html: string, start: number): number {
	let quote = '';
	for (let index = start; index < html.length; index++) {
		const character = html[index];
		if (quote) {
			if (character === quote) quote = '';
			continue;
		}
		if (character === '"' || character === "'") quote = character;
		else if (character === '>') return index;
	}
	return -1;
}

function tagName(token: string): string {
	let index = 0;
	while (index < token.length && /\s/u.test(token[index])) index++;
	const start = index;
	while (index < token.length && /[a-zA-Z0-9:-]/u.test(token[index])) index++;
	return token.slice(start, index).toLowerCase();
}

function selectedAttributes(token: string): Map<string, string> {
	const attributes = new Map<string, string>();
	let index = 0;
	while (index < token.length && !/\s/u.test(token[index])) index++;
	while (index < token.length) {
		while (index < token.length && /[\s/]/u.test(token[index])) index++;
		const nameStart = index;
		while (index < token.length && !/[\s=/>]/u.test(token[index])) index++;
		const name = token.slice(nameStart, index).toLowerCase();
		while (index < token.length && /\s/u.test(token[index])) index++;
		let value = '';
		if (token[index] === '=') {
			index++;
			while (index < token.length && /\s/u.test(token[index])) index++;
			const quote = token[index] === '"' || token[index] === "'" ? token[index++] : '';
			const valueStart = index;
			if (quote) {
				while (index < token.length && token[index] !== quote) index++;
				value = token.slice(valueStart, index);
				if (token[index] === quote) index++;
			} else {
				while (index < token.length && !/[\s>]/u.test(token[index])) index++;
				value = token.slice(valueStart, index);
			}
		}
		if (name === 'href' || name === 'title' || name === 'aria-label') {
			attributes.set(name, decodeHtmlEntities(value));
		}
		if (!name && index < token.length) index++;
	}
	return attributes;
}

export function regexTokenizer(html: string, accumulator: BlockAccumulator): void {
	const lowerHtml = html.toLowerCase();
	let index = 0;
	while (index < html.length) {
		const tagStart = html.indexOf('<', index);
		if (tagStart === -1) {
			accumulator.text(html.slice(index));
			break;
		}
		if (tagStart > index) accumulator.text(html.slice(index, tagStart));
		if (html.startsWith('<!--', tagStart)) {
			const commentEnd = html.indexOf('-->', tagStart + 4);
			index = commentEnd === -1 ? html.length : commentEnd + 3;
			continue;
		}
		const tagEnd = findTagEnd(html, tagStart + 1);
		if (tagEnd === -1) {
			accumulator.text(html.slice(tagStart));
			break;
		}
		const rawToken = html.slice(tagStart + 1, tagEnd);
		const trimmedToken = rawToken.trimStart();
		if (trimmedToken.startsWith('/') && !trimmedToken.startsWith('/!')) {
			accumulator.closeElement();
			index = tagEnd + 1;
			continue;
		}
		if (trimmedToken.startsWith('!') || trimmedToken.startsWith('?')) {
			index = tagEnd + 1;
			continue;
		}

		const name = tagName(rawToken);
		if (!name) {
			accumulator.text(html.slice(tagStart, tagEnd + 1));
			index = tagEnd + 1;
			continue;
		}
		accumulator.openElement(name);
		if (name === 'a') {
			const attributes = selectedAttributes(rawToken);
			const href = attributes.get('href');
			if (href?.startsWith('mailto:')) {
				accumulator.mailto(href, attributes.get('title') ?? attributes.get('aria-label'));
			}
		}

		if (HIDDEN_SUBTREE_TAGS.has(name)) {
			const closingStart = lowerHtml.indexOf(`</${name}`, tagEnd + 1);
			if (closingStart === -1) {
				accumulator.closeElement();
				break;
			}
			const closingEnd = findTagEnd(html, closingStart + 2 + name.length);
			accumulator.closeElement();
			index = closingEnd === -1 ? html.length : closingEnd + 1;
			continue;
		}

		if (VOID_ELEMENT_TAGS.has(name) || /\/\s*$/u.test(rawToken)) accumulator.closeElement();
		index = tagEnd + 1;
	}
}

interface RewriterElement {
	tagName: string;
	getAttribute(name: string): string | null;
	onEndTag(callback: () => void): void;
}

interface RewriterTextChunk {
	text: string;
}

interface RewriterLike {
	on(
		selector: string,
		handlers: {
			element?: (element: RewriterElement) => void;
			text?: (chunk: RewriterTextChunk) => void;
		}
	): RewriterLike;
	transform(response: Response): Response;
}

type RewriterConstructor = new () => RewriterLike;

export async function htmlRewriterTokenizer(
	html: string,
	accumulator: BlockAccumulator,
	Rewriter: RewriterConstructor
): Promise<void> {
	const rewriter = new Rewriter()
		.on('*', {
			element(element) {
				const name = element.tagName.toLowerCase();
				accumulator.openElement(name);
				if (VOID_ELEMENT_TAGS.has(name)) accumulator.closeElement();
				else element.onEndTag(() => accumulator.closeElement());
			},
			text(chunk) {
				accumulator.text(chunk.text);
			}
		})
		.on('a[href^="mailto:"]', {
			element(element) {
				accumulator.mailto(
					element.getAttribute('href') ?? '',
					element.getAttribute('title') ?? element.getAttribute('aria-label')
				);
			}
		});
	await rewriter.transform(new Response(html)).text();
}

export async function segmentRecordBlocks(
	html: string,
	opts?: { maxBlocks?: number; maxScanChars?: number }
): Promise<SegmentResult> {
	const maxScanChars = normalizeLimit(opts?.maxScanChars, DEFAULT_MAX_SCAN_CHARACTERS);
	const boundedHtml = html.slice(0, maxScanChars);
	const accumulator = createBlockAccumulator({
		maxBlocks: opts?.maxBlocks,
		truncated: boundedHtml.length < html.length
	});
	const Rewriter = (globalThis as typeof globalThis & { HTMLRewriter?: RewriterConstructor })
		.HTMLRewriter;
	if (typeof Rewriter === 'function')
		await htmlRewriterTokenizer(boundedHtml, accumulator, Rewriter);
	else regexTokenizer(boundedHtml, accumulator);
	return accumulator.finish();
}
