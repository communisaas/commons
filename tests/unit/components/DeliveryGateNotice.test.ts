import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import DeliveryGateNotice from '$lib/components/org/DeliveryGateNotice.svelte';
import DeliveryGateHarness from './fixtures/DeliveryGateHarness.svelte';
import {
	DELIVERY_QUOTA_SUBSCRIBE_GATE,
	deliveryPlanGridHref
} from '$lib/data/org-limit-sentences';

describe('DeliveryGateNotice', () => {
	it('renders the loss-aversion conversion prompt with a CTA to the in-app pricing grid', () => {
		const slug = 'climate-action-now';
		const { getByText, getByRole } = render(DeliveryGateNotice, {
			props: { planHref: deliveryPlanGridHref(slug) }
		});

		// Loss-aversion headline: the work is done, only sending needs a plan.
		expect(getByText("Your campaign's ready — choose a plan to send it")).toBeTruthy();
		expect(getByText('Authoring is free; sending to your people needs a plan.')).toBeTruthy();

		// Primary CTA points at the settings plan-comparison grid anchor.
		const cta = getByRole('link', { name: /choose a plan/i });
		expect(cta.getAttribute('href')).toBe(`/org/${slug}/settings#plan-feature-boundary`);
	});

	it('does not leak a raw error code into the visible copy', () => {
		const { container } = render(DeliveryGateNotice, {
			props: { planHref: deliveryPlanGridHref('voter-rights-coalition') }
		});
		expect(container.textContent).not.toContain('QUOTA');
		expect(container.textContent).not.toContain(DELIVERY_QUOTA_SUBSCRIBE_GATE);
	});
});

describe('delivery gate surface selection', () => {
	const slug = 'local-first-sf';

	it('shows the subscribe-to-send prompt when the send action returns the quota-gate code', () => {
		const { getByRole, getByText, queryByTestId } = render(DeliveryGateHarness, {
			props: {
				slug,
				form: {
					error: 'Sending to your people needs a plan. Authoring stays free.',
					errorCode: DELIVERY_QUOTA_SUBSCRIBE_GATE
				}
			}
		});

		// Conversion prompt is shown...
		expect(getByText("Your campaign's ready — choose a plan to send it")).toBeTruthy();
		expect(getByRole('link', { name: /choose a plan/i }).getAttribute('href')).toBe(
			`/org/${slug}/settings#plan-feature-boundary`
		);
		// ...and the raw error box is NOT.
		expect(queryByTestId('raw-error')).toBeNull();
	});

	it('does NOT show the subscribe CTA for a non-quota send error', () => {
		const { getByTestId, queryByRole, queryByText } = render(DeliveryGateHarness, {
			props: {
				slug,
				form: { error: 'No recipients match your filters. Adjust filters and try again.' }
			}
		});

		// The generic error renders as the raw error box...
		expect(getByTestId('raw-error').textContent).toContain('No recipients match your filters');
		// ...and the conversion prompt / subscribe CTA is absent.
		expect(queryByText("Your campaign's ready — choose a plan to send it")).toBeNull();
		expect(queryByRole('link', { name: /choose a plan/i })).toBeNull();
	});

	it('does NOT show the subscribe CTA for an active-plan mid-period quota exhaustion', () => {
		// maxEmails > 0 path returns the upgrade sentence WITHOUT the gate code,
		// so the conversion prompt must not fire for that distinct case.
		const { getByTestId, queryByRole } = render(DeliveryGateHarness, {
			props: {
				slug,
				form: {
					error:
						'Email send limit reached for the current billing period. Upgrade your plan to send more.'
				}
			}
		});

		expect(getByTestId('raw-error').textContent).toContain('Email send limit reached');
		expect(queryByRole('link', { name: /choose a plan/i })).toBeNull();
	});
});
