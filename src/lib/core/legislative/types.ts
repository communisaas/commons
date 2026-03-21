/**
 * Legislative Delivery Types
 *
 * Universal interface for interacting with legislative bodies.
 * Country-agnostic — CWC (US Congress) is one adapter among many.
 */

export interface Representative {
	name: string;
	party: string;
	chamber: 'house' | 'senate' | string;
	state: string;
	district: string;
	bioguideId?: string;
	email?: string;
	/** DecisionMaker title — used to derive chamber when coming from DM model */
	title?: string;
	/** DecisionMaker jurisdiction — maps to state in legacy shape */
	jurisdiction?: string;
}

/** A specific legislative office that can receive constituent messages. */
export interface LegislativeOffice {
	bioguideId: string;
	name: string;
	chamber: 'house' | 'senate';
	officeCode: string;
	state: string;
	district: string;
	party: string;
}

/** Result of a single delivery attempt to one office. */
export interface DeliveryResult {
	success: boolean;
	messageId?: string;
	confirmationNumber?: string;
	status: 'submitted' | 'queued' | 'failed' | 'rejected';
	office: string;
	timestamp: string;
	error?: string;
	cwcResponse?: Record<string, unknown>;
}

/** Result of ZK-proof delivery path. */
export interface ZkDeliveryResult {
	success: boolean;
	cwcSubmissionId?: string;
	error?: string;
}

/**
 * Resolved constituent data for CWC delivery.
 *
 * Ephemeral — exists only in memory during delivery, never persisted in plaintext.
 * Resolved by ConstituentResolver (TEE abstraction) from encrypted witness data.
 */
export interface ConstituentData {
	name: string;
	email: string;
	phone?: string;
	address: {
		street: string;
		city: string;
		state: string;
		zip: string;
	};
	congressionalDistrict?: string;
}

export interface LegislativeProvider {
	getRepresentatives(address: {
		street: string;
		city: string;
		state: string;
		zip: string;
	}): Promise<Representative[]>;

	submitMessage(
		representative: Representative,
		message: {
			subject: string;
			body: string;
			topic?: string;
		},
		constituent: {
			firstName: string;
			lastName: string;
			email: string;
			address: {
				street: string;
				city: string;
				state: string;
				zip: string;
			};
			phone?: string;
		}
	): Promise<{
		success: boolean;
		confirmationCode?: string;
		error?: string;
	}>;
}

/** @deprecated Use LegislativeOffice */
export type CongressionalOffice = LegislativeOffice;
