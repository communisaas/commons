function toUint8Array(bytes: ArrayBuffer | ArrayBufferView): Uint8Array {
	if (ArrayBuffer.isView(bytes)) {
		return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	}
	return new Uint8Array(bytes);
}

export function base64urlEncode(bytes: ArrayBuffer | ArrayBufferView): string {
	const view = toUint8Array(bytes);
	let binary = '';
	for (let i = 0; i < view.length; i++) {
		binary += String.fromCharCode(view[i]);
	}

	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64urlDecode(value: string): Uint8Array<ArrayBuffer> {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
	const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes as Uint8Array<ArrayBuffer>;
}
