import { describe, expect, it } from 'vitest';

import {
	WEBHOOK_DESCRIPTION_MAX_BYTES,
	WEBHOOK_EVENT_INPUT_MAX,
	WEBHOOK_PAYLOAD_MAX_BYTES,
	normalizeWebhookDescription,
	normalizeWebhookDestination,
	normalizeWebhookEvents,
	normalizeWebhookPayload,
	validateWebhookDeliveryEnvelope
} from '../../../convex/lib/orgWebhookPolicy';

const TRUSTED = 'https://hooks.acme.net,https://8.8.8.8';

describe('organization webhook policy', () => {
	it('requires one exact trusted HTTPS origin and canonicalizes the destination', () => {
		expect(normalizeWebhookDestination('https://hooks.acme.net/inbox?q=1', TRUSTED)).toEqual({
			ok: true,
			url: 'https://hooks.acme.net/inbox?q=1'
		});
		expect(normalizeWebhookDestination('https://other.acme.net/inbox', TRUSTED)).toEqual({
			ok: false,
			error: 'destination_not_allowed'
		});
		expect(normalizeWebhookDestination('https://hooks.acme.net', '')).toEqual({
			ok: false,
			error: 'destination_policy_invalid'
		});
	});

	it.each([
		['http://hooks.acme.net', 'invalid_url_scheme'],
		['https://user:secret@hooks.acme.net', 'destination_credentials'],
		['https://hooks.acme.net/path#fragment', 'destination_fragment'],
		['https://127.0.0.1', 'destination_private'],
		['https://2130706433', 'destination_private'],
		['https://10.0.0.1', 'destination_private'],
		['https://169.254.169.254/latest/meta-data', 'destination_private'],
		['https://[::1]', 'destination_private'],
		['https://[::ffff:127.0.0.1]', 'destination_private'],
		['https://service.internal', 'destination_private'],
		['https://127.0.0.1.nip.io', 'destination_private']
	] as const)('rejects hostile destination %s', (url, error) => {
		expect(normalizeWebhookDestination(url, `${TRUSTED},${url}`)).toMatchObject({
			ok: false,
			error
		});
	});

	it('permits an explicitly trusted public literal without a DNS-rebinding surface', () => {
		expect(normalizeWebhookDestination('https://8.8.8.8/delivery', TRUSTED)).toEqual({
			ok: true,
			url: 'https://8.8.8.8/delivery'
		});
	});

	it('deduplicates events into catalog order while bounding raw cardinality and bytes', () => {
		expect(
			normalizeWebhookEvents([
				'supporter.created',
				'campaign.updated',
				'supporter.created'
			])
		).toEqual({
			ok: true,
			events: ['campaign.updated', 'supporter.created']
		});
		expect(
			normalizeWebhookEvents(Array.from({ length: WEBHOOK_EVENT_INPUT_MAX + 1 }, () => 'supporter.created'))
		).toMatchObject({ ok: false, error: 'too_many_events' });
		expect(normalizeWebhookEvents(['x'.repeat(65)])).toMatchObject({
			ok: false,
			error: 'event_too_long'
		});
	});

	it('bounds descriptions and JSON-object payloads in UTF-8 bytes', () => {
		expect(normalizeWebhookDescription('  Receiver one  ')).toEqual({
			ok: true,
			description: 'Receiver one'
		});
		expect(normalizeWebhookDescription('é'.repeat(WEBHOOK_DESCRIPTION_MAX_BYTES))).toEqual({
			ok: false,
			error: 'description_too_long'
		});
		expect(normalizeWebhookPayload('supporter.created', ' { "id": 1 } ')).toEqual({
			ok: true,
			event: 'supporter.created',
			payload: '{"id":1}'
		});
		expect(normalizeWebhookPayload('supporter.created', '[]')).toMatchObject({
			ok: false,
			error: 'invalid_payload'
		});
		expect(
			normalizeWebhookPayload('supporter.created', `{"wide":"${'x'.repeat(WEBHOOK_PAYLOAD_MAX_BYTES)}"}`)
		).toMatchObject({ ok: false, error: 'payload_too_large' });
	});

	it('bounds every user-influenced delivery header/envelope field', () => {
		expect(
			validateWebhookDeliveryEnvelope({
				event: 'webhook.test',
				payload: '{"ok":true}',
				deliveryId: 'delivery-id',
				attempt: 1,
				signingSecret: 'a'.repeat(64)
			})
		).toEqual({ ok: true });
		expect(
			validateWebhookDeliveryEnvelope({
				event: 'supporter.created',
				payload: '{"ok":true}',
				deliveryId: 'x'.repeat(257),
				attempt: 1,
				signingSecret: 'a'.repeat(64)
			})
		).toEqual({ ok: false, error: 'delivery_header_too_long' });
	});
});
