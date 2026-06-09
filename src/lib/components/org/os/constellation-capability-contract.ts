import type { OperatorCapabilityState } from '$lib/data/capability-state-labels';
import { getGateEvidence, type GateEvidence } from '$lib/data/capability-hypergraph';
import type { DataConstellationObject } from './constellation';

export type ConstellationCapabilityContract = {
	label: string;
	state: OperatorCapabilityState;
	clusters: string;
	action: string;
	handoff: string;
	effect: string;
	cite: string;
	gate: GateEvidence;
};

export function constellationCapabilityContract(
	object: DataConstellationObject
): ConstellationCapabilityContract {
	switch (object.type) {
		case 'campaign': {
			const status = object.campaign.status.toLowerCase();
			return {
				label: 'Action record',
				state:
					status === 'draft'
						? 'draft-only'
						: object.campaign.verifiedActions > 0
							? 'live'
							: object.campaign.totalActions > 0
								? 'partial'
								: 'partial',
				clusters: 'C-coordination-integrity / C-accountability',
				action: 'Open action record',
				handoff: 'Action record',
				effect:
					'Opens the campaign action record; proof delivery, receipt anchoring, and office response remain separate handoffs.',
				cite: 'OrgSpacesData.return.campaigns',
				gate: getGateEvidence('CP-receipt-anchoring', ['T6-1', 'T6-2'], {
					name: 'Receipt anchoring',
					downstream: 4,
					dependency: 'Receipt writer + mainnet anchoring'
				})
			};
		}
		case 'funnel':
			return {
				label: 'People verification signal',
				state:
					object.funnel.identityVerified > 0 || object.funnel.districtVerified > 0
						? 'live'
						: 'partial',
				clusters: 'C-reach / C-verification',
				action: 'Open People ledger',
				handoff: 'People ledger',
				effect: 'Opens aggregate people proof and reach ground before encrypted row drilldown.',
				cite: 'OrgSpacesData.base summary',
				gate: getGateEvidence('CP-platform-api-sync', ['T1-3'], {
					name: 'Direct platform sync',
					downstream: 1,
					dependency: 'Encrypted credential custody + direct sync execution'
				})
			};
		case 'email-health':
			return {
				label: 'Consent-bound reach',
				state: object.health.subscribed > 0 ? 'live' : 'partial',
				clusters: 'C-reach / C-data-sovereignty',
				action: 'Open consent-bound reach',
				handoff: 'Consent-bound reach',
				effect:
					'Opens the email health and suppression anchor; sender-domain authentication remains a separate gate.',
				cite: 'OrgSpacesData.base.emailHealth',
				gate: getGateEvidence('CP-custom-domain-dkim', ['T2-6'], {
					name: 'Sender domain authentication',
					downstream: 2,
					dependency: 'Per-org SES identity, DKIM, DMARC, and From-domain verification'
				})
			};
		case 'decision-maker':
			return {
				label: 'Power target',
				state: 'live',
				clusters: 'C-accountability',
				action: 'Open Power targets',
				handoff: 'Power targets',
				effect:
					'Opens followed power targets and discovery posture without claiming full state/local terrain.',
				cite: 'OrgSpacesData.landscape.followed',
				gate: getGateEvidence('CP-state-local-terrain', ['T3-1', 'T3-2', 'T3-10'], {
					name: 'State/local power terrain',
					downstream: 3,
					dependency: 'OpenStates, special-district officeholders, and per-district feeds'
				})
			};
		case 'bill':
			return {
				label: 'Bills terrain',
				state: object.bill.position ? 'live' : 'partial',
				clusters: 'C-accountability / C-quality-signaling',
				action: 'Open Bills terrain',
				handoff: 'Bills terrain',
				effect:
					'Opens watched bill terrain and relevance posture; state-bill ingestion remains bounded.',
				cite: 'OrgSpacesData.landscape.bills',
				gate: getGateEvidence('CP-state-bill-terrain', ['T6-6', 'T3-1'], {
					name: 'State bill terrain',
					downstream: 4,
					dependency: 'OpenStates or equivalent state-bill ingestion plus state legislator data'
				})
			};
		case 'scorecard':
			return {
				label: 'Accountability response',
				state: object.scorecard.reportsReceived > 0 ? 'live' : 'partial',
				clusters: 'C-accountability / C-reader-side',
				action: 'Open Accountability scores',
				handoff: 'Accountability scores',
				effect:
					'Opens scorecard rows and response evidence; reader-office workflows remain a separate gate.',
				cite: 'OrgSpacesData.landscape.scorecards',
				gate: getGateEvidence('CP-reader-office-profile', ['T8-1a', 'T8-1b', 'T8-8'], {
					name: 'Reader office response terrain',
					downstream: 4,
					dependency:
						'Decision-maker office profile enrichment, office-response workflow, and notification webhooks'
				})
			};
		case 'packet':
			return {
				label: 'Reader proof',
				state: object.packet.verified > 0 ? 'live' : 'partial',
				clusters: 'C-verification / C-reader-side',
				action: 'Open proof delivery',
				handoff: 'Proof delivery',
				effect:
					'Opens the proof delivery boundary for the campaign report; durable receipt anchoring stays gated.',
				cite: 'verification packet',
				gate: getGateEvidence('CP-receipt-anchoring', ['T6-1', 'T6-2'], {
					name: 'Receipt anchoring',
					downstream: 4,
					dependency: 'Receipt writer + mainnet anchoring'
				})
			};
	}
	const _exhaustive: never = object;
	return _exhaustive;
}
