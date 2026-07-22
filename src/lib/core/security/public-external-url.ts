const encoder = new TextEncoder();

function utf8Bytes(value: string): number {
	return encoder.encode(value).byteLength;
}

function parseIpv4(hostname: string): [number, number, number, number] | null {
	if (!/^\d+\.\d+\.\d+\.\d+$/u.test(hostname)) return null;
	const octets = hostname.split('.').map(Number);
	if (
		octets.length !== 4 ||
		octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
	) {
		return null;
	}
	return octets as [number, number, number, number];
}

function isNonPublicIpv4(octets: readonly number[]): boolean {
	const [a, b, c] = octets;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 0 && c === 0) ||
		(a === 192 && b === 0 && c === 2) ||
		(a === 192 && b === 88 && c === 99) ||
		(a === 192 && b === 168) ||
		(a === 198 && (b === 18 || b === 19)) ||
		(a === 198 && b === 51 && c === 100) ||
		(a === 203 && b === 0 && c === 113) ||
		a >= 224
	);
}

function parseIpv6(hostname: string): number[] | null {
	let source = hostname.toLowerCase();
	if (source.startsWith('[') && source.endsWith(']')) source = source.slice(1, -1);
	if (source.includes('%') || (source.match(/::/gu)?.length ?? 0) > 1) return null;

	let ipv4Tail: [number, number, number, number] | null = null;
	if (source.includes('.')) {
		const lastColon = source.lastIndexOf(':');
		if (lastColon < 0) return null;
		ipv4Tail = parseIpv4(source.slice(lastColon + 1));
		if (!ipv4Tail) return null;
		source = `${source.slice(0, lastColon)}:${((ipv4Tail[0] << 8) | ipv4Tail[1]).toString(16)}:${(
			(ipv4Tail[2] << 8) |
			ipv4Tail[3]
		).toString(16)}`;
	}

	const halves = source.split('::');
	const left = halves[0] ? halves[0].split(':') : [];
	const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
	if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/u.test(part))) return null;
	const missing = 8 - left.length - right.length;
	if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
	const groups = [
		...left,
		...Array.from({ length: Math.max(0, missing) }, () => '0'),
		...right
	].map((part) => Number.parseInt(part, 16));
	if (groups.length !== 8) return null;
	const bytes: number[] = [];
	for (const group of groups) bytes.push(group >> 8, group & 0xff);
	return bytes;
}

function isNonPublicIpv6(bytes: readonly number[]): boolean {
	const allZero = bytes.every((value) => value === 0);
	const loopback = bytes.slice(0, 15).every((value) => value === 0) && bytes[15] === 1;
	const uniqueLocal = (bytes[0] & 0xfe) === 0xfc;
	const linkLocal = bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80;
	const siteLocal = bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0;
	const multicast = bytes[0] === 0xff;
	const documentation =
		bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8;
	const documentation2 = bytes[0] === 0x3f && (bytes[1] & 0xf0) === 0xf0;
	const discardOnly = bytes[0] === 0x01 && bytes.slice(1, 8).every((value) => value === 0);
	const teredo = bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00;
	const sixToFour = bytes[0] === 0x20 && bytes[1] === 0x02;
	const benchmarking =
		bytes[0] === 0x20 &&
		bytes[1] === 0x01 &&
		bytes[2] === 0x00 &&
		bytes[3] === 0x02 &&
		bytes[4] === 0x00 &&
		bytes[5] === 0x00;
	const orchid =
		bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && (bytes[3] & 0xf0) === 0x10;
	const orchidV2 =
		bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && (bytes[3] & 0xf0) === 0x20;
	const mappedIpv4 =
		bytes.slice(0, 10).every((value) => value === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
	const compatibleIpv4 = bytes.slice(0, 12).every((value) => value === 0);
	const nat64 = bytes
		.slice(0, 12)
		.every((value, index) => value === [0, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0][index]);
	const localNat64 =
		bytes[0] === 0x00 &&
		bytes[1] === 0x64 &&
		bytes[2] === 0xff &&
		bytes[3] === 0x9b &&
		bytes[4] === 0x00 &&
		bytes[5] === 0x01;
	const isatap =
		(bytes[8] === 0x00 || bytes[8] === 0x02) &&
		bytes[9] === 0x00 &&
		bytes[10] === 0x5e &&
		bytes[11] === 0xfe;
	const embeddedIpv4 = mappedIpv4 || compatibleIpv4 || nat64;
	return (
		allZero ||
		loopback ||
		uniqueLocal ||
		linkLocal ||
		siteLocal ||
		multicast ||
		documentation ||
		documentation2 ||
		discardOnly ||
		teredo ||
		sixToFour ||
		benchmarking ||
		orchid ||
		orchidV2 ||
		localNat64 ||
		(isatap && isNonPublicIpv4(bytes.slice(12))) ||
		(embeddedIpv4 && isNonPublicIpv4(bytes.slice(12)))
	);
}

function normalizedPublicHostname(parsed: URL): string | null {
	const raw = parsed.hostname.toLowerCase().replace(/\.$/u, '');
	if (raw.length === 0) return null;
	const ipv4 = parseIpv4(raw);
	if (ipv4) return isNonPublicIpv4(ipv4) ? null : raw;
	if (raw.includes(':') || (raw.startsWith('[') && raw.endsWith(']'))) {
		const ipv6 = parseIpv6(raw);
		return ipv6 && !isNonPublicIpv6(ipv6) ? raw.replace(/^\[|\]$/gu, '') : null;
	}

	const deniedSuffixes = [
		'localhost',
		'.localhost',
		'.local',
		'.lan',
		'.internal',
		'.corp',
		'.home',
		'.home.arpa',
		'.invalid',
		'.test',
		'.example',
		'.onion',
		'.nip.io',
		'.sslip.io',
		'localtest.me',
		'.localtest.me',
		'lvh.me',
		'.lvh.me'
	];
	if (deniedSuffixes.some((suffix) => raw === suffix || raw.endsWith(suffix))) return null;
	const labels = raw.split('.');
	if (
		labels.length < 2 ||
		labels.some(
			(label) =>
				label.length === 0 ||
				label.length > 63 ||
				!/^[a-z0-9-]+$/u.test(label) ||
				label.startsWith('-') ||
				label.endsWith('-')
		) ||
		/^\d+$/u.test(labels.at(-1) ?? '')
	) {
		return null;
	}
	return raw;
}

/** Parse an HTTP(S) URL only when its literal host is structurally public. */
/**
 * Structural (literal-host) validation only: no DNS resolution or
 * connection-time IP pinning, so it is not a complete standalone SSRF
 * boundary. Callers here egress via third-party scrape APIs; revisit with
 * resolved-IP pinning before any first-party fetch uses this as its guard.
 */
export function parsePublicHttpUrl(value: unknown, maxBytes = 2_048): URL | null {
	if (typeof value !== 'string' || value.length === 0 || utf8Bytes(value) > maxBytes) return null;
	const source = value.trim();
	if (source.length === 0 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(source)) return null;

	try {
		const parsed = new URL(source);
		if (
			(parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
			parsed.username.length > 0 ||
			parsed.password.length > 0
		) {
			return null;
		}
		const hostname = normalizedPublicHostname(parsed);
		if (!hostname) return null;
		parsed.hostname = hostname.includes(':') ? `[${hostname}]` : hostname;
		return parsed;
	} catch {
		return null;
	}
}
