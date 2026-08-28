import type { CachedPublicTemplateDetail } from './public-template-detail-cache';

export const PUBLIC_TEMPLATE_OG_IMAGE_WIDTH = 1200;
export const PUBLIC_TEMPLATE_OG_IMAGE_HEIGHT = 630;
export const PUBLIC_TEMPLATE_OG_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const PUBLIC_TEMPLATE_OG_IMAGE_BIT_DEPTH = 2;
export const PUBLIC_TEMPLATE_OG_IMAGE_PACKED_ROW_BYTES =
	PUBLIC_TEMPLATE_OG_IMAGE_WIDTH / (8 / PUBLIC_TEMPLATE_OG_IMAGE_BIT_DEPTH);
export const PUBLIC_TEMPLATE_OG_IMAGE_PACKED_SURFACE_BYTES =
	PUBLIC_TEMPLATE_OG_IMAGE_PACKED_ROW_BYTES * PUBLIC_TEMPLATE_OG_IMAGE_HEIGHT;
export const PUBLIC_TEMPLATE_OG_IMAGE_SCANLINE_BYTES =
	(PUBLIC_TEMPLATE_OG_IMAGE_PACKED_ROW_BYTES + 1) * PUBLIC_TEMPLATE_OG_IMAGE_HEIGHT;
export const PUBLIC_TEMPLATE_OG_IMAGE_MAX_GLYPHS = 340;
/** Safe upper bound: 340 rendered glyphs × 35 cells × scale-7 rows, plus card rectangles. */
export const PUBLIC_TEMPLATE_OG_IMAGE_MAX_RECT_ROW_WRITES = 84_048;

export type PublicTemplateOgRenderWork = Readonly<{
	compressionInputBytes: number;
	glyphs: number;
	rectRowWrites: number;
	scanlineRows: number;
}>;

export type PublicTemplateOgRenderLimits = Readonly<{
	compressionInputBytes: number;
	glyphs: number;
	rectRowWrites: number;
	scanlineRows: number;
}>;

export const PUBLIC_TEMPLATE_OG_IMAGE_RENDER_LIMITS: PublicTemplateOgRenderLimits = Object.freeze({
	compressionInputBytes: PUBLIC_TEMPLATE_OG_IMAGE_SCANLINE_BYTES,
	glyphs: PUBLIC_TEMPLATE_OG_IMAGE_MAX_GLYPHS,
	rectRowWrites: PUBLIC_TEMPLATE_OG_IMAGE_MAX_RECT_ROW_WRITES,
	scanlineRows: PUBLIC_TEMPLATE_OG_IMAGE_HEIGHT
});

type RenderBudget = {
	limits: PublicTemplateOgRenderLimits;
	work: {
		compressionInputBytes: number;
		glyphs: number;
		rectRowWrites: number;
		scanlineRows: number;
	};
};

type Rgb = readonly [number, number, number];

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const TEXT_COLOR: Rgb = [30, 41, 59];
const WHITE: Rgb = [255, 255, 255];

const DOMAIN_COLORS: Array<{ keywords: string[]; background: Rgb; accent: Rgb }> = [
	{
		keywords: ['housing', 'zoning', 'affordab'],
		background: [254, 243, 199],
		accent: [245, 158, 11]
	},
	{
		keywords: ['climate', 'environment', 'energy', 'park'],
		background: [209, 250, 229],
		accent: [16, 185, 129]
	},
	{
		keywords: ['health', 'medical', 'telehealth'],
		background: [219, 234, 254],
		accent: [59, 130, 246]
	},
	{
		keywords: ['labor', 'wage', 'worker', 'retail'],
		background: [252, 231, 243],
		accent: [236, 72, 153]
	},
	{
		keywords: ['voting', 'election', 'democra'],
		background: [224, 231, 255],
		accent: [99, 102, 241]
	},
	{
		keywords: ['education', 'school', 'preschool', 'librar'],
		background: [254, 215, 170],
		accent: [234, 88, 12]
	},
	{
		keywords: ['justice', 'criminal', 'police', 'sentenc'],
		background: [233, 213, 255],
		accent: [168, 85, 247]
	},
	{
		keywords: ['transport', 'parking', 'bike', 'transit', 'highway'],
		background: [255, 237, 213],
		accent: [234, 88, 12]
	},
	{
		keywords: ['immigra', 'green card', 'visa'],
		background: [224, 231, 255],
		accent: [99, 102, 241]
	},
	{
		keywords: ['indigenous', 'first nation', 'tribal'],
		background: [254, 243, 199],
		accent: [180, 83, 9]
	}
];

const DEFAULT_COLORS = { background: [241, 245, 249] as Rgb, accent: [100, 116, 139] as Rgb };

/**
 * A deliberately small 5x7 bitmap alphabet. Producer rendering needs no font,
 * native extension, browser process, or WASM module. Unknown Unicode glyphs
 * become `?`; the HTML document still carries the full accessible title.
 */
const FONT: Record<string, readonly string[]> = {
	' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
	'?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
	A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
	B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
	C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
	D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
	E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
	F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
	G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
	H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
	I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
	J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
	K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
	L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
	M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
	N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
	O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
	P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
	Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
	R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
	S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
	T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
	U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
	V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
	W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
	X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
	Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
	Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
	'0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
	'1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
	'2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
	'3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
	'4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
	'5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
	'6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
	'7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
	'8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
	'9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
	'.': ['00000', '00000', '00000', '00000', '00000', '00110', '00110'],
	',': ['00000', '00000', '00000', '00000', '00110', '00110', '00100'],
	':': ['00000', '00110', '00110', '00000', '00110', '00110', '00000'],
	'-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
	'!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
	'/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
	"'": ['00100', '00100', '00000', '00000', '00000', '00000', '00000'],
	'&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'],
	'+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
	'(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
	')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
	'%': ['11001', '11010', '00100', '01000', '10110', '00110', '00000'],
	'#': ['01010', '11111', '01010', '01010', '11111', '01010', '00000'],
	'@': ['01110', '10001', '10111', '10101', '10111', '10000', '01110']
};

const FONT_MASKS = Object.fromEntries(
	Object.entries(FONT).map(([character, rows]) => [
		character,
		rows.map((row) => Number.parseInt(row, 2))
	])
) as Record<string, readonly number[]>;

let crcTable: Uint32Array | undefined;

function pngCrcTable(): Uint32Array {
	if (crcTable) return crcTable;
	const table = new Uint32Array(256);
	for (let index = 0; index < table.length; index += 1) {
		let value = index;
		for (let bit = 0; bit < 8; bit += 1) {
			value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		}
		table[index] = value >>> 0;
	}
	crcTable = table;
	return table;
}

function crc32(bytes: Uint8Array, start = 0, end = bytes.byteLength): number {
	const table = pngCrcTable();
	let value = 0xffffffff;
	for (let index = start; index < end; index += 1) {
		value = table[(value ^ bytes[index]!) & 0xff]! ^ (value >>> 8);
	}
	return (value ^ 0xffffffff) >>> 0;
}

function writeU32(target: Uint8Array, offset: number, value: number): void {
	target[offset] = (value >>> 24) & 0xff;
	target[offset + 1] = (value >>> 16) & 0xff;
	target[offset + 2] = (value >>> 8) & 0xff;
	target[offset + 3] = value & 0xff;
}

function readU32(source: Uint8Array, offset: number): number {
	return (
		(source[offset]! * 0x1000000 +
			(source[offset + 1]! << 16) +
			(source[offset + 2]! << 8) +
			source[offset + 3]!) >>>
		0
	);
}

function ascii(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
	if (!/^[A-Za-z]{4}$/.test(type)) throw new Error('PUBLIC_TEMPLATE_OG_RENDER_INVALID:chunk');
	const typeBytes = ascii(type);
	const result = new Uint8Array(12 + data.byteLength);
	writeU32(result, 0, data.byteLength);
	result.set(typeBytes, 4);
	result.set(data, 8);
	writeU32(result, 8 + data.byteLength, crc32(result, 4, 8 + data.byteLength));
	return result;
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
	const result = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.byteLength;
	}
	return result;
}

function normalizeText(value: unknown, maximumCharacters: number): string {
	const source = typeof value === 'string' ? value : '';
	return source
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toUpperCase()
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, maximumCharacters)
		.split('')
		.map((character) => (FONT[character] ? character : '?'))
		.join('');
}

function wrapText(value: string, maximumColumns: number, maximumLines: number): string[] {
	if (maximumColumns < 1 || maximumLines < 1) return [];
	const words = value.split(' ').filter(Boolean);
	const lines: string[] = [];
	let current = '';
	for (const rawWord of words) {
		let word = rawWord;
		while (word.length > maximumColumns) {
			if (current) {
				lines.push(current);
				current = '';
				if (lines.length === maximumLines) return lines;
			}
			lines.push(word.slice(0, maximumColumns));
			word = word.slice(maximumColumns);
			if (lines.length === maximumLines) return lines;
		}
		const candidate = current ? `${current} ${word}` : word;
		if (candidate.length <= maximumColumns) {
			current = candidate;
			continue;
		}
		lines.push(current);
		if (lines.length === maximumLines) return lines;
		current = word;
	}
	if (current && lines.length < maximumLines) lines.push(current);
	return lines;
}

function createRenderBudget(limits: PublicTemplateOgRenderLimits): RenderBudget {
	for (const [name, value] of Object.entries(limits)) {
		const hardLimit =
			PUBLIC_TEMPLATE_OG_IMAGE_RENDER_LIMITS[name as keyof PublicTemplateOgRenderLimits];
		if (!Number.isSafeInteger(value) || value < 0 || value > hardLimit) {
			throw new Error(`PUBLIC_TEMPLATE_OG_RENDER_INVALID:budget-limit-${name}`);
		}
	}
	return {
		limits,
		work: { compressionInputBytes: 0, glyphs: 0, rectRowWrites: 0, scanlineRows: 0 }
	};
}

function reserveRenderWork(
	budget: RenderBudget,
	kind: keyof PublicTemplateOgRenderWork,
	amount: number
): void {
	const current = budget.work[kind];
	const limit = budget.limits[kind];
	if (!Number.isSafeInteger(amount) || amount < 0 || amount > limit - current) {
		throw new Error(`PUBLIC_TEMPLATE_OG_RENDER_BUDGET_EXCEEDED:${kind}`);
	}
	budget.work[kind] = current + amount;
}

function fillRect(
	surface: Uint8Array,
	x: number,
	y: number,
	width: number,
	height: number,
	color: number,
	budget: RenderBudget
): void {
	if (!Number.isInteger(color) || color < 0 || color > 3) {
		throw new Error('PUBLIC_TEMPLATE_OG_RENDER_INVALID:color');
	}
	const left = Math.max(0, Math.floor(x));
	const top = Math.max(0, Math.floor(y));
	const right = Math.min(PUBLIC_TEMPLATE_OG_IMAGE_WIDTH, Math.ceil(x + width));
	const bottom = Math.min(PUBLIC_TEMPLATE_OG_IMAGE_HEIGHT, Math.ceil(y + height));
	reserveRenderWork(budget, 'rectRowWrites', Math.max(0, bottom - top));
	const repeated = color * 0x55;
	for (let row = top; row < bottom; row += 1) {
		const rowOffset = row * PUBLIC_TEMPLATE_OG_IMAGE_PACKED_ROW_BYTES;
		let pixel = left;
		for (; pixel < right && pixel % 4 !== 0; pixel += 1) {
			const offset = rowOffset + (pixel >> 2);
			const shift = 6 - (pixel & 3) * 2;
			surface[offset] = (surface[offset]! & ~(3 << shift)) | (color << shift);
		}
		const wholeByteEnd = right - (right % 4);
		if (pixel < wholeByteEnd) {
			surface.fill(repeated, rowOffset + (pixel >> 2), rowOffset + (wholeByteEnd >> 2));
			pixel = wholeByteEnd;
		}
		for (; pixel < right; pixel += 1) {
			const offset = rowOffset + (pixel >> 2);
			const shift = 6 - (pixel & 3) * 2;
			surface[offset] = (surface[offset]! & ~(3 << shift)) | (color << shift);
		}
	}
}

function drawText(
	surface: Uint8Array,
	value: string,
	x: number,
	y: number,
	scale: number,
	color: number,
	budget: RenderBudget
): void {
	reserveRenderWork(budget, 'glyphs', value.length);
	let cursor = x;
	for (const character of value) {
		const glyph = FONT_MASKS[character] ?? FONT_MASKS['?']!;
		for (let row = 0; row < glyph.length; row += 1) {
			const rowMask = glyph[row]!;
			for (let column = 0; column < 5; column += 1) {
				if ((rowMask & (1 << (4 - column))) !== 0) {
					fillRect(surface, cursor + column * scale, y + row * scale, scale, scale, color, budget);
				}
			}
		}
		cursor += 6 * scale;
	}
}

function groupedInteger(value: unknown): string {
	const integer = Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : 0;
	return String(integer).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function paletteForDomain(domain: string): readonly Rgb[] {
	const normalized = domain.toLowerCase();
	const colors =
		DOMAIN_COLORS.find((candidate) =>
			candidate.keywords.some((keyword) => normalized.includes(keyword))
		) ?? DEFAULT_COLORS;
	return [colors.background, colors.accent, TEXT_COLOR, WHITE];
}

function drawCard(
	detail: CachedPublicTemplateDetail,
	budget: RenderBudget
): {
	palette: readonly Rgb[];
	surface: Uint8Array;
} {
	const domain = normalizeText(detail.domain || 'PUBLIC ACTION', 28) || 'PUBLIC ACTION';
	const title = normalizeText(detail.title, 180) || 'TAKE PUBLIC ACTION';
	const description = normalizeText(detail.description, 280);
	const actionCount = groupedInteger(detail.verified_sends);
	const palette = paletteForDomain(detail.domain || '');
	const surface = new Uint8Array(PUBLIC_TEMPLATE_OG_IMAGE_PACKED_SURFACE_BYTES);

	fillRect(surface, 0, 0, 18, PUBLIC_TEMPLATE_OG_IMAGE_HEIGHT, 1, budget);
	fillRect(surface, 58, 50, Math.min(570, domain.length * 24 + 54), 58, 1, budget);
	drawText(surface, domain, 84, 66, 4, 3, budget);

	const proof = `${actionCount} ROUTES CONFIRMED`;
	const proofWidth = proof.length * 18 + 44;
	fillRect(
		surface,
		PUBLIC_TEMPLATE_OG_IMAGE_WIDTH - proofWidth - 58,
		50,
		proofWidth,
		58,
		3,
		budget
	);
	drawText(surface, proof, PUBLIC_TEMPLATE_OG_IMAGE_WIDTH - proofWidth - 36, 68, 3, 2, budget);

	const titleLines = wrapText(title, 25, 3);
	for (let index = 0; index < titleLines.length; index += 1) {
		drawText(surface, titleLines[index]!, 66, 160 + index * 70, 7, 2, budget);
	}

	const descriptionY = 160 + Math.max(2, titleLines.length) * 70 + 22;
	const descriptionLines = wrapText(description, 58, descriptionY > 410 ? 2 : 3);
	for (let index = 0; index < descriptionLines.length; index += 1) {
		drawText(surface, descriptionLines[index]!, 70, descriptionY + index * 34, 3, 2, budget);
	}

	fillRect(surface, 58, 551, PUBLIC_TEMPLATE_OG_IMAGE_WIDTH - 116, 2, 1, budget);
	drawText(surface, 'COMMONS', 66, 576, 4, 2, budget);
	drawText(surface, 'CONFIRM YOUR ROUTE', 778, 579, 3, 1, budget);
	return { palette, surface };
}

async function deflateBase(bytes: Uint8Array, budget: RenderBudget): Promise<Uint8Array> {
	if (typeof CompressionStream !== 'function') {
		throw new Error('PUBLIC_TEMPLATE_OG_RENDER_UNAVAILABLE:compression-stream');
	}
	if (bytes.byteLength !== PUBLIC_TEMPLATE_OG_IMAGE_SCANLINE_BYTES) {
		throw new Error('PUBLIC_TEMPLATE_OG_RENDER_INVALID:compression-input');
	}
	reserveRenderWork(budget, 'compressionInputBytes', bytes.byteLength);
	const compressor = new CompressionStream('deflate');
	const compressed = new Response(compressor.readable).arrayBuffer();
	const writer = compressor.writable.getWriter();
	const input = new Uint8Array(bytes.byteLength);
	input.set(bytes);
	await writer.write(input.buffer);
	await writer.close();
	return new Uint8Array(await compressed);
}

async function encodeIndexedPng(
	surface: Uint8Array,
	palette: readonly Rgb[],
	budget: RenderBudget
): Promise<Uint8Array> {
	if (
		surface.byteLength !== PUBLIC_TEMPLATE_OG_IMAGE_PACKED_SURFACE_BYTES ||
		palette.length !== 4
	) {
		throw new Error('PUBLIC_TEMPLATE_OG_RENDER_INVALID:surface');
	}
	const scanlineWidth = PUBLIC_TEMPLATE_OG_IMAGE_PACKED_ROW_BYTES + 1;
	const scanlines = new Uint8Array(PUBLIC_TEMPLATE_OG_IMAGE_SCANLINE_BYTES);
	for (let row = 0; row < PUBLIC_TEMPLATE_OG_IMAGE_HEIGHT; row += 1) {
		reserveRenderWork(budget, 'scanlineRows', 1);
		scanlines.set(
			surface.subarray(
				row * PUBLIC_TEMPLATE_OG_IMAGE_PACKED_ROW_BYTES,
				(row + 1) * PUBLIC_TEMPLATE_OG_IMAGE_PACKED_ROW_BYTES
			),
			row * scanlineWidth + 1
		);
	}
	const ihdr = new Uint8Array(13);
	writeU32(ihdr, 0, PUBLIC_TEMPLATE_OG_IMAGE_WIDTH);
	writeU32(ihdr, 4, PUBLIC_TEMPLATE_OG_IMAGE_HEIGHT);
	ihdr[8] = PUBLIC_TEMPLATE_OG_IMAGE_BIT_DEPTH;
	ihdr[9] = 3;
	const plte = new Uint8Array(palette.length * 3);
	palette.forEach((color, index) => plte.set(color, index * 3));
	const png = concatenate([
		PNG_SIGNATURE,
		pngChunk('IHDR', ihdr),
		pngChunk('PLTE', plte),
		pngChunk('IDAT', await deflateBase(scanlines, budget)),
		pngChunk('IEND', new Uint8Array())
	]);
	if (
		budget.work.scanlineRows !== PUBLIC_TEMPLATE_OG_IMAGE_HEIGHT ||
		budget.work.compressionInputBytes !== PUBLIC_TEMPLATE_OG_IMAGE_SCANLINE_BYTES
	) {
		throw new Error('PUBLIC_TEMPLATE_OG_RENDER_INVALID:incomplete-work');
	}
	return png;
}

/** Authenticated queue-consumer renderer with executable work accounting. */
export async function renderPublicTemplateOgImageWithWork(
	detail: CachedPublicTemplateDetail,
	limits: PublicTemplateOgRenderLimits = PUBLIC_TEMPLATE_OG_IMAGE_RENDER_LIMITS
): Promise<{ image: Uint8Array; work: PublicTemplateOgRenderWork }> {
	const budget = createRenderBudget(limits);
	const { surface, palette } = drawCard(detail, budget);
	const image = await encodeIndexedPng(surface, palette, budget);
	return { image, work: Object.freeze({ ...budget.work }) };
}

/** Authenticated queue-consumer renderer. Anonymous/Pages requests never call it. */
export async function renderPublicTemplateOgImage(
	detail: CachedPublicTemplateDetail
): Promise<Uint8Array> {
	return (await renderPublicTemplateOgImageWithWork(detail)).image;
}

/** Exhaustive binary boundary shared by the producer, R2 reader, and tests. */
export function readPublicTemplateOgImage(value: ArrayBuffer | ArrayBufferView): Uint8Array {
	const bytes =
		value instanceof ArrayBuffer
			? new Uint8Array(value)
			: new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	if (
		bytes.byteLength < PNG_SIGNATURE.byteLength + 12 + 13 + 12 ||
		bytes.byteLength > PUBLIC_TEMPLATE_OG_IMAGE_MAX_BYTES ||
		PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)
	) {
		throw new Error('PUBLIC_TEMPLATE_OG_IMAGE_INVALID:container');
	}
	let offset = PNG_SIGNATURE.byteLength;
	let chunkIndex = 0;
	let sawPalette = false;
	let sawImageData = false;
	let sawEnd = false;
	while (offset < bytes.byteLength) {
		if (offset + 12 > bytes.byteLength) {
			throw new Error('PUBLIC_TEMPLATE_OG_IMAGE_INVALID:truncated-chunk');
		}
		const length = readU32(bytes, offset);
		const dataStart = offset + 8;
		const dataEnd = dataStart + length;
		const chunkEnd = dataEnd + 4;
		if (length > PUBLIC_TEMPLATE_OG_IMAGE_MAX_BYTES || chunkEnd > bytes.byteLength) {
			throw new Error('PUBLIC_TEMPLATE_OG_IMAGE_INVALID:chunk-bounds');
		}
		const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
		if (crc32(bytes, offset + 4, dataEnd) !== readU32(bytes, dataEnd)) {
			throw new Error('PUBLIC_TEMPLATE_OG_IMAGE_INVALID:crc');
		}
		if (chunkIndex === 0) {
			if (
				type !== 'IHDR' ||
				length !== 13 ||
				readU32(bytes, dataStart) !== PUBLIC_TEMPLATE_OG_IMAGE_WIDTH ||
				readU32(bytes, dataStart + 4) !== PUBLIC_TEMPLATE_OG_IMAGE_HEIGHT ||
				bytes[dataStart + 8] !== PUBLIC_TEMPLATE_OG_IMAGE_BIT_DEPTH ||
				bytes[dataStart + 9] !== 3 ||
				bytes[dataStart + 10] !== 0 ||
				bytes[dataStart + 11] !== 0 ||
				bytes[dataStart + 12] !== 0
			) {
				throw new Error('PUBLIC_TEMPLATE_OG_IMAGE_INVALID:ihdr');
			}
		} else if (type === 'PLTE') {
			if (sawPalette || length !== 12 || sawImageData) {
				throw new Error('PUBLIC_TEMPLATE_OG_IMAGE_INVALID:palette');
			}
			sawPalette = true;
		} else if (type === 'IDAT') {
			if (!sawPalette || sawEnd || length < 1) {
				throw new Error('PUBLIC_TEMPLATE_OG_IMAGE_INVALID:image-data');
			}
			sawImageData = true;
		} else if (type === 'IEND') {
			if (length !== 0 || !sawImageData || chunkEnd !== bytes.byteLength) {
				throw new Error('PUBLIC_TEMPLATE_OG_IMAGE_INVALID:end');
			}
			sawEnd = true;
		} else {
			throw new Error('PUBLIC_TEMPLATE_OG_IMAGE_INVALID:unknown-chunk');
		}
		offset = chunkEnd;
		chunkIndex += 1;
	}
	if (!sawPalette || !sawImageData || !sawEnd) {
		throw new Error('PUBLIC_TEMPLATE_OG_IMAGE_INVALID:incomplete');
	}
	return bytes.slice();
}
