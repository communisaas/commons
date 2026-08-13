/**
// CONVEX: Keep SvelteKit
 * Batch Delivery Registration Endpoint — Power Landscape
 *
 * POST: Create delivery records for a position registration.
 * Requires authentication. Associates recipients with an existing registration.
 *
 * Called after the citizen chooses which decision-makers to address.
 * Each recipient gets a PositionDelivery record tracking delivery status.
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import type { RequestHandler } from './$types';
import { serverMutation } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '$lib/server/bounded-json-request';

const POSITION_DELIVERY_CONVEX_ENVELOPE_MAX_BYTES = 64 * 1024;
// Leave room for the server-added secret, verified identity, registration ID,
// and Convex argument field names inside the mutation's complete-envelope cap.
const POSITION_DELIVERY_CONVEX_ENVELOPE_RESERVE_BYTES = 4 * 1024;
const POSITION_DELIVERY_REQUEST_MAX_BYTES =
	POSITION_DELIVERY_CONVEX_ENVELOPE_MAX_BYTES - POSITION_DELIVERY_CONVEX_ENVELOPE_RESERVE_BYTES;
const POSITION_DELIVERY_RECIPIENT_MAX = 20;
const POSITION_DELIVERY_REGISTRATION_ID_MAX_CHARS = 64;
const POSITION_DELIVERY_NAME_MAX_CHARS = 200;
const POSITION_DELIVERY_NAME_MAX_BYTES = 512;
const POSITION_DELIVERY_EMAIL_MAX_CHARS = 254;
const POSITION_DELIVERY_RECIPIENT_KEY_MAX_CHARS = 256;
const POSITION_DELIVERY_METHODS = new Set(['cwc', 'email', 'recorded']);
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
// eslint-disable-next-line no-control-regex
const EMAIL_SHAPE = /^[^\s@\u0000-\u001f\u007f]+@[^\s@\u0000-\u001f\u007f]+$/u;
const textEncoder = new TextEncoder();

type PositionDeliveryRecipient = {
	name: string;
	email?: string;
	deliveryMethod: 'cwc' | 'email' | 'recorded';
};

class PositionDeliveryInputError extends Error {}

function invalidInput(message: string, status: 400 | 413 = 400): Response {
	return json({ error: message }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
	const expected = new Set(allowed);
	return Object.keys(value).every((key) => expected.has(key));
}

function normalizeRecipientName(value: unknown): string {
	if (typeof value !== 'string') {
		throw new PositionDeliveryInputError('Each recipient must have a string name');
	}
	const name = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
	if (
		name.length === 0 ||
		name.length > POSITION_DELIVERY_NAME_MAX_CHARS ||
		textEncoder.encode(name).byteLength > POSITION_DELIVERY_NAME_MAX_BYTES ||
		CONTROL_CHARACTERS.test(name)
	) {
		throw new PositionDeliveryInputError(
			`Each recipient name must be 1-${POSITION_DELIVERY_NAME_MAX_CHARS} characters and at most ${POSITION_DELIVERY_NAME_MAX_BYTES} bytes`
		);
	}
	return name;
}

function canonicalRecipientKey(name: string): string {
	const key = name
		.normalize('NFKD')
		.replace(/\p{M}+/gu, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/gu, '');
	if (key.length === 0 || key.length > POSITION_DELIVERY_RECIPIENT_KEY_MAX_CHARS) {
		throw new PositionDeliveryInputError('Each recipient must produce a valid canonical key');
	}
	return key;
}

function normalizeRecipient(value: unknown): PositionDeliveryRecipient & { recipientKey: string } {
	if (!isRecord(value) || !hasExactKeys(value, ['name', 'email', 'deliveryMethod'])) {
		throw new PositionDeliveryInputError(
			'Each recipient may contain only name, email, and deliveryMethod'
		);
	}
	const name = normalizeRecipientName(value.name);
	if (
		typeof value.deliveryMethod !== 'string' ||
		!POSITION_DELIVERY_METHODS.has(value.deliveryMethod)
	) {
		throw new PositionDeliveryInputError(
			`deliveryMethod must be one of: ${[...POSITION_DELIVERY_METHODS].join(', ')}`
		);
	}

	let email: string | undefined;
	if (value.email !== undefined) {
		if (typeof value.email !== 'string') {
			throw new PositionDeliveryInputError('Recipient email must be a string');
		}
		email = value.email.normalize('NFKC').trim().toLowerCase();
		if (
			email.length === 0 ||
			email.length > POSITION_DELIVERY_EMAIL_MAX_CHARS ||
			!EMAIL_SHAPE.test(email)
		) {
			throw new PositionDeliveryInputError(
				`Recipient email must be a valid address of at most ${POSITION_DELIVERY_EMAIL_MAX_CHARS} characters`
			);
		}
	}

	return {
		name,
		...(email ? { email } : {}),
		deliveryMethod: value.deliveryMethod as PositionDeliveryRecipient['deliveryMethod'],
		recipientKey: canonicalRecipientKey(name)
	};
}

function normalizeRecipients(values: unknown[]): PositionDeliveryRecipient[] {
	const byKey = new Map<
		string,
		PositionDeliveryRecipient & { recipientKey: string; fingerprint: string }
	>();
	for (const value of values) {
		const recipient = normalizeRecipient(value);
		const fingerprint = JSON.stringify([recipient.email ?? '', recipient.deliveryMethod]);
		const existing = byKey.get(recipient.recipientKey);
		if (existing) {
			if (existing.fingerprint !== fingerprint) {
				throw new PositionDeliveryInputError(
					`Conflicting recipient entries share canonical key "${recipient.recipientKey}"`
				);
			}
			continue;
		}
		byKey.set(recipient.recipientKey, { ...recipient, fingerprint });
	}
	return [...byKey.values()].map(
		({ recipientKey: _key, fingerprint: _fingerprint, ...recipient }) => recipient
	);
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!FEATURES.STANCE_POSITIONS) throw error(404, 'Not found');

	try {
		const session = locals.session;
		if (!session?.userId) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		let body: unknown;
		try {
			body = await readBoundedJsonRequest(request, POSITION_DELIVERY_REQUEST_MAX_BYTES, {
				maxArrayItems: POSITION_DELIVERY_RECIPIENT_MAX,
				maxDepth: 3,
				maxNodes: 128,
				maxObjectKeys: 3,
				maxStringBytes: 2_048
			});
		} catch (cause) {
			if (cause instanceof BoundedJsonRequestError) {
				return invalidInput(cause.message, cause.status);
			}
			return invalidInput('Invalid request body');
		}
		if (!isRecord(body) || !hasExactKeys(body, ['registrationId', 'recipients'])) {
			return invalidInput('Request body may contain only registrationId and recipients');
		}
		const { registrationId, recipients } = body;

		// Validate required fields
		if (
			typeof registrationId !== 'string' ||
			registrationId.length === 0 ||
			registrationId.length > POSITION_DELIVERY_REGISTRATION_ID_MAX_CHARS
		) {
			return invalidInput(
				`registrationId must be a non-empty string of at most ${POSITION_DELIVERY_REGISTRATION_ID_MAX_CHARS} characters`
			);
		}

		if (
			!Array.isArray(recipients) ||
			recipients.length === 0 ||
			recipients.length > POSITION_DELIVERY_RECIPIENT_MAX
		) {
			return invalidInput(
				`recipients must be a non-empty array of at most ${POSITION_DELIVERY_RECIPIENT_MAX} entries`
			);
		}

		let normalizedRecipients: PositionDeliveryRecipient[];
		try {
			normalizedRecipients = normalizeRecipients(recipients);
		} catch (cause) {
			if (cause instanceof PositionDeliveryInputError) return invalidInput(cause.message);
			throw cause;
		}

		// Verify the registration exists and belongs to the caller
		const identityCommitment = locals.user?.identity_commitment;
		if (!identityCommitment) {
			return json({ error: 'Identity verification required' }, { status: 403 });
		}

		// Create delivery records (mutation verifies ownership via identityCommitment)
		const result = await serverMutation(api.positions.batchRegisterDeliveries, {
			_secret: getInternalSecret(),
			registrationId: registrationId as Id<'positionRegistrations'>,
			identityCommitment,
			recipients: normalizedRecipients
		});

		return json({
			deliveries: result.created,
			existing: normalizedRecipients.length - result.created,
			duplicates: recipients.length - normalizedRecipients.length
		});
	} catch (err) {
		console.error('[Batch Delivery Registration] Error:', err);

		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}

		const message = err instanceof Error ? err.message : 'Failed to register deliveries';
		if (message.includes('POSITION_DELIVERY_INPUT_TOO_LARGE')) {
			return json({ error: 'Request body exceeds maximum size' }, { status: 413 });
		}
		if (message.includes('POSITION_DELIVERY_RATE_LIMITED')) {
			return json(
				{ error: 'Too many delivery registration requests. Please retry in one minute.' },
				{ status: 429, headers: { 'Retry-After': '60' } }
			);
		}
		if (message.includes('POSITION_DELIVERY_REGISTRATION_CAP_EXCEEDED')) {
			return json(
				{
					error: `A position registration may contain at most ${POSITION_DELIVERY_RECIPIENT_MAX} recipients.`
				},
				{ status: 409 }
			);
		}
		throw error(500, message);
	}
};
