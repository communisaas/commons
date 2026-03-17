/**
 * Stripe webhook handler.
 *
 * Security:
 * - Verifies webhook signature using STRIPE_WEBHOOK_SECRET
 * - Raw body via request.text() for signature verification (before JSON parse)
 * - Idempotent: upsert for creation, update keyed on stripe_subscription_id
 *
 * CSRF: Stripe sends application/json (not form data), so SvelteKit's
 * CSRF origin checking (trustedOrigins) does not apply. Server-to-server calls have no Origin header.
 *
 * Rate limiting: Exempted in RATE_LIMIT_EXEMPT_PATHS (signature-authenticated).
 */

import { error } from '@sveltejs/kit';
import { getStripe } from '$lib/server/billing/stripe';
import { PLANS } from '$lib/server/billing/plans';
import { db } from '$lib/core/db';
import type Stripe from 'stripe';
import type { RequestHandler } from './$types';

/** Extract billing period from subscription's first item (Stripe API 2026+). */
function getPeriodDates(sub: Stripe.Subscription): { start: Date; end: Date } {
	const item = sub.items.data[0];
	return {
		start: new Date(item.current_period_start * 1000),
		end: new Date(item.current_period_end * 1000)
	};
}

export const POST: RequestHandler = async ({ request }) => {
	const stripe = getStripe();
	const signature = request.headers.get('stripe-signature');
	const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

	if (!signature || !webhookSecret) {
		throw error(400, 'Missing signature or webhook secret');
	}

	// Read raw body for signature verification — must happen before any JSON parse
	const body = await request.text();
	let event: Stripe.Event;
	try {
		event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
	} catch (err) {
		console.error('[Stripe Webhook] Signature verification failed:', err);
		throw error(400, 'Invalid signature');
	}

	switch (event.type) {
		case 'checkout.session.completed': {
			const session = event.data.object;

			// Handle donation checkouts
			if (session.metadata?.type === 'donation') {
				const donationId = session.metadata.donationId;
				const campaignId = session.metadata.campaignId;
				if (donationId) {
					const donation = await db.donation.findUnique({ where: { id: donationId } });
					if (donation && donation.status === 'pending') {
						await db.donation.update({
							where: { id: donationId },
							data: {
								status: 'completed',
								stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
								stripeSubscriptionId: typeof session.subscription === 'string' ? session.subscription : null,
								completedAt: new Date()
							}
						});
						// Increment campaign counters
						if (campaignId) {
							await db.campaign.update({
								where: { id: campaignId },
								data: {
									raisedAmountCents: { increment: donation.amountCents },
									donorCount: { increment: 1 }
								}
							});
						}

						// Fire-and-forget: trigger automation workflows
						const orgId = session.metadata?.orgId;
						if (orgId) {
							void (async () => {
								try {
									const { dispatchTrigger } = await import('$lib/server/automation/trigger');
									await dispatchTrigger(orgId, 'donation_completed', {
										entityId: donationId,
										supporterId: donation.supporterId ?? undefined,
										metadata: { campaignId, amountCents: donation.amountCents }
									});
								} catch {}
							})();
						}
					}
				}
				break;
			}

			if (session.mode !== 'subscription' || !session.subscription) break;
			const orgId = session.metadata?.orgId;
			const plan = session.metadata?.plan;
			if (!orgId || !plan || !PLANS[plan]) break;

			const sub = await stripe.subscriptions.retrieve(session.subscription as string);
			const period = getPeriodDates(sub);

			// Upsert keyed on orgId — idempotent for replayed events
			await db.subscription.upsert({
				where: { orgId },
				create: {
					orgId,
					plan,
					price_cents: PLANS[plan]?.priceCents ?? 0,
					status: sub.status === 'active' ? 'active' : 'trialing',
					stripe_subscription_id: sub.id,
					current_period_start: period.start,
					current_period_end: period.end,
					payment_method: 'stripe'
				},
				update: {
					plan,
					price_cents: PLANS[plan]?.priceCents ?? 0,
					status: sub.status === 'active' ? 'active' : 'trialing',
					stripe_subscription_id: sub.id,
					current_period_start: period.start,
					current_period_end: period.end
				}
			});

			// Sync org limits to match new plan
			const planDef = PLANS[plan];
			if (planDef) {
				await db.organization.update({
					where: { id: orgId },
					data: {
						max_seats: planDef.maxSeats,
						max_templates_month: planDef.maxTemplatesMonth
					}
				});
			}
			break;
		}

		case 'customer.subscription.updated': {
			const sub = event.data.object;
			const existing = await db.subscription.findUnique({
				where: { stripe_subscription_id: sub.id }
			});
			if (!existing) break;

			// When a user cancels via the portal, Stripe sets cancel_at_period_end=true
			// but keeps status='active' until the period ends. We map this to 'canceled'
			// so the UI shows the pending cancellation. The subscription.deleted event
			// fires when the period actually ends.
			const effectiveStatus = sub.cancel_at_period_end
				? 'canceled'
				: mapStripeStatus(sub.status);

			const period = getPeriodDates(sub);
			await db.subscription.update({
				where: { id: existing.id },
				data: {
					status: effectiveStatus,
					current_period_start: period.start,
					current_period_end: period.end
				}
			});
			break;
		}

		case 'customer.subscription.deleted': {
			const sub = event.data.object;
			const existing = await db.subscription.findUnique({
				where: { stripe_subscription_id: sub.id }
			});
			if (!existing) break;

			await db.subscription.update({
				where: { id: existing.id },
				data: { status: 'canceled' }
			});

			// Reset org limits to free tier
			if (existing.orgId) {
				await db.organization.update({
					where: { id: existing.orgId },
					data: {
						max_seats: PLANS.free.maxSeats,
						max_templates_month: PLANS.free.maxTemplatesMonth
					}
				});
			}
			break;
		}

		case 'invoice.payment_failed': {
			const invoice = event.data.object;
			// In Stripe API 2026+, subscription is on invoice.parent.subscription_details
			const subId =
				invoice.parent?.subscription_details?.subscription;
			if (!subId) break;
			const stripeSubId = typeof subId === 'string' ? subId : subId.id;

			const existing = await db.subscription.findUnique({
				where: { stripe_subscription_id: stripeSubId }
			});
			if (!existing) break;

			await db.subscription.update({
				where: { id: existing.id },
				data: { status: 'past_due' }
			});
			break;
		}

		case 'charge.refunded': {
			const charge = event.data.object;
			const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
			if (!paymentIntentId) break;
			const donation = await db.donation.findFirst({ where: { stripePaymentIntentId: paymentIntentId } });
			if (!donation || donation.status !== 'completed') break;
			await db.donation.update({
				where: { id: donation.id },
				data: { status: 'refunded' }
			});
			// Decrement campaign counters
			await db.campaign.update({
				where: { id: donation.campaignId },
				data: {
					raisedAmountCents: { decrement: donation.amountCents },
					donorCount: { decrement: 1 }
				}
			});
			break;
		}
	}

	// Always return 200 to acknowledge receipt — Stripe retries on non-2xx
	return new Response('ok', { status: 200 });
};

function mapStripeStatus(status: string): string {
	switch (status) {
		case 'active':
			return 'active';
		case 'past_due':
			return 'past_due';
		case 'canceled':
			return 'canceled';
		case 'trialing':
			return 'trialing';
		default:
			return 'active';
	}
}
