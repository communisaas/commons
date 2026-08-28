/**
 * Direct delivery recording — authenticated, stance-agnostic civic action.
 *
 * The browser supplies only the template and the bounded recipient identities
 * needed for durable idempotency. The server derives the pseudonymous actor;
 * raw user IDs and recipient email addresses never enter the delivery table.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverMutation } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import { computePseudonymousId } from '$lib/core/privacy/pseudonymous-id';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '$lib/server/bounded-json-request';

const DIRECT_DELIVERY_REQUEST_MAX_BYTES = 16 * 1024;
const DIRECT_DELIVERY_RECIPIENT_MAX = 20;
const DIRECT_DELIVERY_TEMPLATE_ID_MAX_CHARS = 64;
const DIRECT_DELIVERY_NAME_MAX_CHARS = 200;
const DIRECT_DELIVERY_NAME_MAX_BYTES = 512;
const DIRECT_DELIVERY_RECIPIENT_KEY_MAX_CHARS = 256;
const DIRECT_DELIVERY_METHODS = new Set(['cwc', 'email', 'recorded']);
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const textEncoder = new TextEncoder();

type DirectDeliveryRecipient = {
	name: string;
	deliveryMethod: 'cwc' | 'email' | 'recorded';
};

class DirectDeliveryInputError extends Error {}

function response(body: Record<string, unknown>, status = 200): Response {
	return json(body, { status, headers: NO_STORE_HEADERS });
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
		throw new DirectDeliveryInputError('Each recipient must have a string name');
	}
	const name = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
	if (
		name.length === 0 ||
		name.length > DIRECT_DELIVERY_NAME_MAX_CHARS ||
		textEncoder.encode(name).byteLength > DIRECT_DELIVERY_NAME_MAX_BYTES ||
		CONTROL_CHARACTERS.test(name)
	) {
		throw new DirectDeliveryInputError(
			`Each recipient name must be 1-${DIRECT_DELIVERY_NAME_MAX_CHARS} characters and at most ${DIRECT_DELIVERY_NAME_MAX_BYTES} bytes`
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
	if (key.length === 0 || key.length > DIRECT_DELIVERY_RECIPIENT_KEY_MAX_CHARS) {
		throw new DirectDeliveryInputError('Each recipient must produce a valid canonical key');
	}
	return key;
}

function normalizeRecipients(values: unknown[]): DirectDeliveryRecipient[] {
	const byKey = new Map<
		string,
		DirectDeliveryRecipient & { recipientKey: string; fingerprint: string }
	>();
	for (const value of values) {
		if (!isRecord(value) || !hasExactKeys(value, ['name', 'deliveryMethod'])) {
			throw new DirectDeliveryInputError('Each recipient may contain only name and deliveryMethod');
		}
		const name = normalizeRecipientName(value.name);
		if (
			typeof value.deliveryMethod !== 'string' ||
			!DIRECT_DELIVERY_METHODS.has(value.deliveryMethod)
		) {
			throw new DirectDeliveryInputError(
				`deliveryMethod must be one of: ${[...DIRECT_DELIVERY_METHODS].join(', ')}`
			);
		}
		const recipientKey = canonicalRecipientKey(name);
		const recipient = {
			name,
			deliveryMethod: value.deliveryMethod as DirectDeliveryRecipient['deliveryMethod'],
			recipientKey,
			fingerprint: value.deliveryMethod
		};
		const existing = byKey.get(recipientKey);
		if (existing) {
			if (existing.fingerprint !== recipient.fingerprint) {
				throw new DirectDeliveryInputError(
					`Conflicting recipient entries share canonical key "${recipientKey}"`
				);
			}
			continue;
		}
		byKey.set(recipientKey, recipient);
	}
	return [...byKey.values()].map(
		({ recipientKey: _recipientKey, fingerprint: _fingerprint, ...recipient }) => recipient
	);
}

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const session = locals.session;
		if (!session?.userId) {
			return response({ error: 'Authentication required' }, 401);
		}

		let body: unknown;
		try {
			body = await readBoundedJsonRequest(request, DIRECT_DELIVERY_REQUEST_MAX_BYTES, {
				maxArrayItems: DIRECT_DELIVERY_RECIPIENT_MAX,
				maxDepth: 3,
				maxNodes: 128,
				maxObjectKeys: 2,
				maxStringBytes: DIRECT_DELIVERY_NAME_MAX_BYTES
			});
		} catch (cause) {
			if (cause instanceof BoundedJsonRequestError) {
				return response({ error: cause.message }, cause.status);
			}
			return response({ error: 'Invalid request body' }, 400);
		}
		if (!isRecord(body) || !hasExactKeys(body, ['templateId', 'recipients'])) {
			return response({ error: 'Request body may contain only templateId and recipients' }, 400);
		}
		if (
			typeof body.templateId !== 'string' ||
			body.templateId.length === 0 ||
			body.templateId.length > DIRECT_DELIVERY_TEMPLATE_ID_MAX_CHARS
		) {
			return response(
				{
					error: `templateId must be a non-empty string of at most ${DIRECT_DELIVERY_TEMPLATE_ID_MAX_CHARS} characters`
				},
				400
			);
		}
		if (
			!Array.isArray(body.recipients) ||
			body.recipients.length === 0 ||
			body.recipients.length > DIRECT_DELIVERY_RECIPIENT_MAX
		) {
			return response(
				{
					error: `recipients must be a non-empty array of at most ${DIRECT_DELIVERY_RECIPIENT_MAX} entries`
				},
				400
			);
		}

		let recipients: DirectDeliveryRecipient[];
		try {
			recipients = normalizeRecipients(body.recipients);
		} catch (cause) {
			if (cause instanceof DirectDeliveryInputError) {
				return response({ error: cause.message }, 400);
			}
			throw cause;
		}

		let pseudonymousId: string;
		try {
			pseudonymousId = computePseudonymousId(session.userId);
		} catch {
			return response({ error: 'Service configuration error' }, 500);
		}

		const result = await serverMutation(api.positions.recordDirectDeliveries, {
			_secret: getInternalSecret(),
			pseudonymousId,
			templateId: body.templateId as Id<'templates'>,
			recipients
		});

		return response({
			created: result.created,
			existing: result.existing,
			duplicates: body.recipients.length - recipients.length
		});
	} catch (cause) {
		console.error('[Delivery Record] Error:', cause);

		if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
		const message = cause instanceof Error ? cause.message : '';
		if (message.includes('DIRECT_DELIVERY_RATE_LIMITED')) {
			return response(
				{ error: 'Too many delivery recording requests. Please retry in one minute.' },
				429
			);
		}
		if (message.includes('DIRECT_DELIVERY_TEMPLATE_INELIGIBLE')) {
			return response({ error: 'Template not found' }, 404);
		}
		if (
			message.includes('DIRECT_DELIVERY_LIFETIME_CAP_EXCEEDED') ||
			message.includes('DIRECT_DELIVERY_CARDINALITY_REPAIR_REQUIRED') ||
			message.includes('DIRECT_DELIVERY_IDENTITY_REPAIR_REQUIRED') ||
			message.includes('DIRECT_DELIVERY_IDENTITY_MULTIPLICITY')
		) {
			return response({ error: 'Direct delivery history requires review' }, 409);
		}
		if (message.includes('DIRECT_DELIVERY_INPUT_TOO_LARGE')) {
			return response({ error: 'Request body exceeds maximum size' }, 413);
		}
		if (
			message.includes('DIRECT_DELIVERY_') ||
			message.includes('POSITION_DELIVERY_') ||
			message.includes('POSITION_DISTRICT_CODE_INVALID')
		) {
			return response({ error: 'Invalid direct delivery request' }, 400);
		}
		throw error(500, 'Failed to record deliveries');
	}
};
