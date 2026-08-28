/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';

import cardSource from '../../../src/lib/components/action/DecisionMakerLandscapeCard.svelte?raw';
import landscapeSource from '../../../src/lib/components/action/PowerLandscape.svelte?raw';
import roleGroupSource from '../../../src/lib/components/action/RoleGroup.svelte?raw';
import loaderSource from '../../../src/routes/s/[slug]/+page.server.ts?raw';
import pageSource from '../../../src/routes/s/[slug]/+page.svelte?raw';

/** The one line that decides whether the write button exists at all. */
function activeLine(): string {
	const line = cardSource
		.split('\n')
		.find((candidate) => candidate.includes('const isActive = $derived('));
	if (!line) throw new Error('Could not locate the isActive derivation');
	return line;
}

describe('prior-contact annotation never costs a write affordance', () => {
	it('keeps the write gate free of prior-contact state and of server data', () => {
		expect(activeLine().trim()).toBe('const isActive = $derived(canAct && !contacted && !departing);');
		expect(activeLine()).not.toContain('priorContact');
		expect(activeLine()).not.toContain('data.');
		// The click handler and the button branch gate on isActive alone.
		const handler = cardSource.slice(
			cardSource.indexOf('function handleClick()'),
			cardSource.indexOf('function reportBounce(')
		);
		expect(handler).toContain('if (isActive)');
		expect(handler).not.toContain('priorContact');
		expect(cardSource).toContain('{#if isActive}');
	});

	it('never seeds client send state from server data', () => {
		expect(pageSource).toContain('let contactedRecipients = $state(new Set<string>());');
		expect(pageSource).toContain('let departingRecipients = $state(new Set<string>());');
		for (const assignment of pageSource
			.split('\n')
			.filter(
				(line) =>
					/\b(contactedRecipients|departingRecipients)\s*=[^=]/.test(line) && !line.includes('$state(')
			)) {
			expect(assignment).not.toContain('data.');
		}
	});

	it('leaves every reach count and the batch list untouched', () => {
		expect(landscapeSource).toContain('.filter(id => !contactedRecipients.has(id))');
		expect(landscapeSource).toContain('allMembers.filter(m => contactedRecipients.has(m.id)).length');
		expect(landscapeSource).toContain(
			"allMembers.filter(m => m.email && m.deliveryRoute === 'email' && !contactedRecipients.has(m.id)).length"
		);
		const batchRegister = landscapeSource.slice(
			landscapeSource.indexOf('function handleBatchRegister()'),
			landscapeSource.indexOf('</script>')
		);
		expect(batchRegister).not.toContain('priorContactIds');
		const contactedCount = landscapeSource.slice(
			landscapeSource.indexOf('const contactedInLandscape'),
			landscapeSource.indexOf('let revealed')
		);
		expect(contactedCount).not.toContain('priorContactIds');
	});

	it('threads the annotation from loader to card', () => {
		expect(loaderSource).toContain('api.positions.listViewerConfirmedContacts');
		expect(loaderSource).toContain('computePseudonymousId');
		expect(loaderSource).toContain('$lib/core/fact');
		expect(loaderSource).toContain('priorContacts');
		// The recorded refusal survives: server data still never becomes send state.
		expect(loaderSource).toContain('lock a user out of writing again');
		expect(pageSource).toContain('data.priorContacts.state === ');
		expect(pageSource).toContain('{priorContactIds}');
		expect(roleGroupSource).toContain('priorContact={priorContactIds.has(member.id)}');
	});

	it('attributes the claim to the person and never to a delivery', () => {
		const copy = cardSource.slice(
			cardSource.indexOf('{#if priorContact}'),
			cardSource.indexOf('{/if}', cardSource.indexOf('{#if priorContact}'))
		);
		expect(copy).toContain('You said');
		for (const overclaim of ['Delivered', 'Sent successfully', 'messages delivered']) {
			expect(cardSource).not.toContain(overclaim);
		}
	});
});
