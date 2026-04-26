/**
 * COMPREHENSIVE TYPE REPLACEMENTS FOR ANY TYPES
 *
 * This file provides specific type interfaces to replace all 'any' types
 * in the codebase with proper TypeScript types.
 */

import type { RequestEvent as _RequestEvent } from '@sveltejs/kit';

// =============================================================================
// API AND REQUEST/RESPONSE TYPES
// =============================================================================

export interface Logger {
	info: (message: string, ...args: unknown[]) => void;
	error: (message: string, ...args: unknown[]) => void;
	warn: (message: string, ...args: unknown[]) => void;
	debug: (message: string, ...args: unknown[]) => void;
}

// =============================================================================
// ERROR HANDLING TYPES
// =============================================================================

export interface ErrorWithCode extends Error {
	code?: string | number;
	status?: number;
	reason?: string;
	transaction?: unknown;
}

export interface ErrorDetails {
	message: string;
	stack?: string;
	context: string;
	timestamp: number;
	userAgent?: string;
	url?: string;
	code?: string | number;
	additionalData?: Record<string, unknown>;
}

// =============================================================================
// COMPONENT AND EVENT TYPES
// =============================================================================

export interface ComponentEventTarget<T = unknown> extends EventTarget {
	value?: T;
	checked?: boolean;
	files?: FileList | null;
	[key: string]: unknown;
}

export interface ComponentEvent<T = unknown> extends Event {
	target: ComponentEventTarget<T>;
	currentTarget: ComponentEventTarget<T>;
	detail?: T;
}

export interface SvelteComponentInstance {
	$on?(type: string, callback: (e: ComponentEvent) => void): () => void;
	$set?(props: Record<string, unknown>): void;
	$destroy?(): void;
}

export interface ComponentWithModal {
	open(): void;
	close(): void;
	toggle?(): void;
}

// =============================================================================
// USER AND PROFILE TYPES
// =============================================================================

export interface UserProfileData {
	id: string;
	name?: string | null;
	email: string;
	role?: string;
	connection?: string;
	organization?: string; // User's organization/company
	location?: string; // User's general location description
	street?: string | null;
	city?: string | null;
	state?: string | null;
	zip?: string | null;
	congressional_district?: string | null;
	is_verified?: boolean;
	verification_method?: string | null;
	verified_at?: Date | null;
	wallet_address?: string | null;
	trust_score?: number;
	reputation_tier?: string;
	profile_visibility?: string; // 'public', 'private', etc.
}

export interface ProfileUpdateData {
	section: string;
	data: Record<string, unknown>;
}

export interface Address {
	street: string;
	city: string;
	state: string;
	zip: string;
	congressional_district?: string;
}

export interface GeolocationData {
	congressional_district: string;
	latitude?: number;
	longitude?: number;
	postal_code?: string;
	[key: string]: unknown;
}

// =============================================================================
// TEMPLATE AND SUBMISSION TYPES
// =============================================================================

export interface RecipientConfig {
	type: 'representatives' | 'senators' | 'house' | 'custom';
	targets?: string[];
	[key: string]: unknown;
}

export interface DeliveryConfig {
	method: 'cwc' | 'email' | 'direct';
	options?: Record<string, unknown>;
	[key: string]: unknown;
}

// =============================================================================
// DATABASE AND QUERY TYPES
// =============================================================================

export interface PaginationParams {
	page?: number;
	limit?: number;
	offset?: number;
	orderBy?: string;
	sortDirection?: 'asc' | 'desc';
}

// =============================================================================
// ANALYTICS AND TRACKING TYPES
// =============================================================================

export interface CampaignMetrics {
	total_submissions: number;
	unique_users: number;
	completion_rate: number;
	avg_time_to_complete: number;
	geographic_distribution: Record<string, number>;
}

// =============================================================================
// VERIFICATION AND CERTIFICATION TYPES
// =============================================================================

export interface AddressVerificationResult {
	verified: boolean;
	/** Geocoder-standardized address (e.g. "12 MINT PLZ, SAN FRANCISCO, CA, 94103"). */
	correctedAddress?: string;
	representatives?: Representative[];
	zk_eligible?: boolean;
	zk_warning?: string;
	error?: string;
	district_source?: 'shadow_atlas';
	/** FU-1.1: geocoded coordinates passed back to the verify-address endpoint
	 *  so the server can recompute the expected districtCommitment from IPFS
	 *  cell data and authenticate the client-supplied value. */
	coordinates?: { lat: number; lng: number } | null;
	special_status?: {
		type: string;
		message: string;
		has_senators: boolean;
		has_voting_representative: boolean;
	};
}

export interface CertificationData {
	actionType: string;
	userAddress: string;
	templateId?: string;
	deliveryConfirmation?: string;
	personalConnection?: string;
	metadata?: Record<string, unknown>;
}

// =============================================================================
// DELIVERY AND MESSAGING TYPES
// =============================================================================

export interface MessageData {
	subject: string;
	body: string;
	recipients: string[];
	templateId: string;
	userId: string;
	metadata?: Record<string, unknown>;
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

export type UnknownRecord = Record<string, unknown>;
export type AnyFunction = (...args: unknown[]) => unknown;
export type AnyAsyncFunction = (...args: unknown[]) => Promise<unknown>;

// Type guard functions
export function isErrorWithCode(error: unknown): error is ErrorWithCode {
	return error instanceof Error && ('code' in error || 'status' in error);
}

export function isUserProfileData(obj: unknown): obj is UserProfileData {
	return (
		typeof obj === 'object' &&
		obj !== null &&
		'id' in obj &&
		typeof (obj as UserProfileData).id === 'string' &&
		'email' in obj &&
		typeof (obj as UserProfileData).email === 'string'
	);
}

export function isAddress(obj: unknown): obj is Address {
	return (
		typeof obj === 'object' &&
		obj !== null &&
		'street' in obj &&
		typeof (obj as Address).street === 'string' &&
		'city' in obj &&
		typeof (obj as Address).city === 'string' &&
		'state' in obj &&
		typeof (obj as Address).state === 'string' &&
		'zip' in obj &&
		typeof (obj as Address).zip === 'string'
	);
}

// Representative type from user.ts — supports DecisionMaker shapes
export interface Representative {
	id: string;
	bioguide_id?: string;
	name: string;
	party: string;
	state: string;
	district: string;
	chamber: string;
	office_code?: string;
	phone?: string;
	email?: string;
	office?: string;
	is_voting_member?: boolean;
	delegate_type?: 'delegate' | 'resident_commissioner' | string | null;
	/** DecisionMaker title — used to derive chamber when coming from DM model */
	title?: string;
	/** DecisionMaker jurisdiction — maps to state in legacy shape */
	jurisdiction?: string;
}

// Template and component types for AppHeader
export interface HeaderTemplate {
	id: string;
	title: string;
	slug: string;
	description?: string;
	category?: string;
	message_body?: string;
	status?: string;
	user_id?: string;
	deliveryMethod?: string;
	preview?: string;
	subject?: string | null;
	recipient_config?: unknown;
	recipientEmails?: string[];
	[key: string]: unknown;
}

export interface TemplateUseEvent {
	template: HeaderTemplate;
	requiresAuth: boolean;
}

/**
 * Org membership surfaced in the identity dropdown.
 * The bridge between individual and org layers:
 * you see your org as part of who you are, not a separate destination.
 */
export interface UserOrgMembership {
	orgSlug: string;
	orgName: string;
	orgAvatar: string | null;
	role: string; // 'owner' | 'editor' | 'member'
	activeCampaignCount: number;
}

export interface HeaderUser {
	id: string;
	email: string;
	name: string | null;
	picture?: string | null; // User avatar/profile picture URL
	street?: string | null;
	city?: string | null;
	state?: string | null;
	zip?: string | null;
	congressional_district?: string | null;
	is_verified?: boolean;
	verification_method?: string | null;
	verified_at?: Date | null;
	address?: string | null;
	// Graduated trust tier (0-5) — from deriveTrustTier()
	trust_tier?: number;
	// Wallet integration
	wallet_address?: string | null;
	wallet_type?: string | null;
	near_account_id?: string | null;
	near_derived_scroll_address?: string | null;
	// Org layer bridge — identity-integrated org membership
	orgMemberships?: UserOrgMembership[];
}

// UI Component types
export type ModalChildrenFunction = (data: UnknownRecord) => unknown;

export interface TriggerAction {
	trigger: () => void;
	'aria-controls': string;
}
