/**
 * TYPES MODULE - Centralized Type System
 *
 * Single source of truth for all application types.
 * Organized by domain with clear separation of concerns.
 */

// API & Network Types
export * from './api';
export * from './errors';

// Analytics & Metrics Types
export * from './analytics';

// Core Domain Types
export * from './template';
export {
	// RecipientConfig intentionally excluded — exported from './template' instead
	type DeliveryConfig,
	type CwcConfig,
	type TemplateMetrics,
	type TypedTemplate,
	isValidRecipientConfig,
	isValidDeliveryConfig,
	extractRecipientEmails,
	extractDeliveryConfig,
	extractTemplateMetrics
} from './templateConfig';
export * from './user';

// Geographic & Location Types
export * from './location';
export * from './jurisdiction';

// UI Component Types
export * from './modal';
export * from './popover';

// Convenience re-exports for commonly used types
export type {
	ApiResponse,
	AnalyticsEventCreate as AnalyticsEvent,
	EnrichedAnalyticsEvent,
	AddressUpdateRequest,
	AddressUpdateResponse,
	ProfileUpdateRequest
} from './api';
export type { ApiError, ErrorType, AppError } from './errors';
export type { Template, TemplateFormData, MinimalUser } from './template';
export type {
	EmailServiceUser,
	UserProfile,
	Representative,
	UserForEmail
} from './user';
export { toEmailServiceUser } from './user';
export type { Jurisdiction, Office, TemplateScope } from './jurisdiction';
export type { NormalizedAddress, GeoFence } from './location';
export type { ModalScrollState } from './modal';
export type { PopoverSlots, TriggerAction } from './popover';
// Error helper functions
export { createApiError, createValidationError, ERROR_CODES, ERROR_MESSAGES } from './errors';
