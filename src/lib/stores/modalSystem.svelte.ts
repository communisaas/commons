/**
 * CENTRALIZED MODAL STATE MANAGEMENT SYSTEM (Svelte 5)
 *
 * Eliminates scattered modal states across 12+ components.
 * Single source of truth for all modal coordination.
 */

import { toggleBodyScroll } from '$lib/utils/browserUtils';
import { coordinated } from '$lib/utils/timerCoordinator';
import type { Template } from '$lib/types/template';

// Modal Type Registry - All possible modals in the system
export type ModalType =
	| 'auth'
	| 'address'
	| 'email_loading'
	| 'mobile_preview'
	| 'template_creator'
	| 'onboarding'
	| 'template_modal'
	| 'sign-in'
	| 'debate'
	| 'wallet-connect'
	| 'identity-verification';

// Modal State Interface
interface ModalState {
	type: ModalType;
	isOpen: boolean;
	data?: unknown; // Modal-specific payload
	zIndex: number;
	closeOnBackdrop?: boolean;
	closeOnEscape?: boolean;
}

// Central Modal Store
interface ModalSystemState {
	activeModals: Record<string, ModalState>; // Use object instead of Map for Svelte 5 reactivity
	modalStack: string[]; // Z-index management
	baseZIndex: number;
}

// Legacy modal state types from modalState.ts
export type LegacyModalState =
	| 'closed'
	| 'auth_required'
	| 'loading'
	| 'confirmation'
	| 'trust-upgrade' // Graduated trust: offer identity verification before sending
	| 'ground-restore' // Delivery address exists server-side but needs unlock/re-entry locally
	| 'cwc-submission' // ZKP proof generation + Congressional submission
	| 'proof-generation' // ZK proof generation (Phase 2)
	| 'celebration'
	| 'tracking'
	| 'error'
	| 'retry_needed';

interface LegacyModalContext {
	template: Template | null;
	user: unknown;
	state: LegacyModalState;
	mailtoUrl?: string;
	sendConfirmed: boolean;
	showModal: boolean;
}

function createModalSystem() {
	// Core modal system state
	const modalSystemState = $state<ModalSystemState>({
		activeModals: {}, // Plain object for Svelte 5 reactivity
		modalStack: [],
		baseZIndex: 1000
	});

	// Legacy modal context state
	const legacyModalState = $state<LegacyModalContext>({
		template: null,
		user: null,
		state: 'closed',
		sendConfirmed: false,
		showModal: false
	});

	// Original Modal Management Actions
	const originalModalActions = {
		/**
		 * Open a modal with proper z-index management
		 */
		open(
			id: string,
			type: ModalType,
			data?: unknown,
			options?: {
				closeOnBackdrop?: boolean;
				closeOnEscape?: boolean;
				autoClose?: number; // Auto-close after N milliseconds
			}
		): void {
			// Close existing modal of same type to prevent conflicts
			const existingId = this.findModalByType(type);
			if (existingId && existingId !== id) {
				this.close(existingId);
			}

			const zIndex = modalSystemState.baseZIndex + modalSystemState.modalStack.length;

			const modalState: ModalState = {
				type,
				isOpen: true,
				data,
				zIndex,
				closeOnBackdrop: options?.closeOnBackdrop ?? true,
				closeOnEscape: options?.closeOnEscape ?? true
			};

			modalSystemState.activeModals[id] = modalState; // Object assignment triggers reactivity
			modalSystemState.modalStack.push(id);

			// DOM body scroll lock using unified utility
			toggleBodyScroll(true);

			// Auto-close timer
			if (options?.autoClose) {
				coordinated.autoClose(
					() => {
						this.close(id);
					},
					options.autoClose,
					`modal_${id}`
				);
			}
		},

		/**
		 * Close specific modal with proper out animation timing
		 */
		close(id: string): void {
			const modal = modalSystemState.activeModals[id];
			if (!modal) return;

			// First set isOpen to false to trigger out animations
			modalSystemState.activeModals[id] = {
				...modal,
				isOpen: false
			};

			// Give time for out animations to complete before removing from DOM
			setTimeout(() => {
				delete modalSystemState.activeModals[id];
				modalSystemState.modalStack = modalSystemState.modalStack.filter(
					(stackId) => stackId !== id
				);

				// Restore body scroll if no modals remain
				if (modalSystemState.modalStack.length === 0) {
					toggleBodyScroll(false);
				}
			}, 300); // Longer than scale out animation (200ms)
		},

		/**
		 * Close all modals
		 */
		closeAll(): void {
			modalSystemState.activeModals = {}; // Reset object triggers reactivity
			modalSystemState.modalStack = [];

			toggleBodyScroll(false);
		},

		/**
		 * Close top modal (ESC key behavior)
		 */
		closeTop(): void {
			const topId = modalSystemState.modalStack[modalSystemState.modalStack.length - 1];
			if (topId) {
				this.close(topId);
			}
		},

		/**
		 * Find modal ID by type
		 */
		findModalByType(type: ModalType): string | null {
			for (const [id, modal] of Object.entries(modalSystemState.activeModals)) {
				if (modal.type === type) {
					return id;
				}
			}
			return null;
		},

		/**
		 * Check if modal is open
		 */
		isOpen(id: string): boolean {
			const modal = modalSystemState.activeModals[id];
			return modal?.isOpen ?? false;
		},

		/**
		 * Get modal data
		 */
		getData(id: string): unknown {
			const modal = modalSystemState.activeModals[id];
			return modal?.data ?? null;
		}
	};

	// Enhanced modalActions that includes both new API and legacy compatibility
	const modalActions = {
		// =========================================================================
		// NEW UNIFIED API (from original modalSystem.ts)
		// =========================================================================

		openModal(
			id: string,
			type: ModalType,
			data?: unknown,
			options?: {
				closeOnBackdrop?: boolean;
				closeOnEscape?: boolean;
				autoClose?: number;
			}
		) {
			return originalModalActions.open(id, type, data, options);
		},

		closeModal(id: string) {
			return originalModalActions.close(id);
		},

		closeAll() {
			return originalModalActions.closeAll();
		},

		closeTop() {
			return originalModalActions.closeTop();
		},

		findModalByType(type: ModalType): string | null {
			return originalModalActions.findModalByType(type);
		},

		isModalOpen(id: string): boolean {
			return originalModalActions.isOpen(id);
		},

		getModalData(id: string): unknown {
			return originalModalActions.getData(id);
		},

		// =========================================================================
		// LEGACY API COMPATIBILITY (from modalState.ts)
		// =========================================================================

		// Legacy template modal API - preserves exact behavior
		open(template: Template, user: unknown): void {
			// Update legacy store to maintain backward compatibility
			legacyModalState.template = template;
			legacyModalState.user = user;
			legacyModalState.state = user ? 'loading' : 'auth_required';
			legacyModalState.showModal = true;
			legacyModalState.sendConfirmed = false;

			// Also register in new unified system for consistency
			originalModalActions.open('legacy-template-modal', 'template_modal', { template, user });
		},

		// Legacy template modal state management
		setState(state: LegacyModalState): void {
			legacyModalState.state = state;
		},

		setMailtoUrl(url: string): void {
			legacyModalState.mailtoUrl = url;
		},

		confirmSend(): void {
			legacyModalState.sendConfirmed = true;
			legacyModalState.state = 'celebration';
		},

		// Legacy close method
		close(): void {
			// Legacy template modal close
			legacyModalState.showModal = false;
			legacyModalState.state = 'closed';

			// Also close in unified system
			originalModalActions.close('legacy-template-modal');
		},

		reset(): void {
			legacyModalState.template = null;
			legacyModalState.user = null;
			legacyModalState.state = 'closed';
			legacyModalState.sendConfirmed = false;
			legacyModalState.showModal = false;
			legacyModalState.mailtoUrl = undefined;

			originalModalActions.closeAll();
		}
	};

	return {
		// Core system getters
		get activeModals() {
			return modalSystemState.activeModals;
		},
		get modalStack() {
			return modalSystemState.modalStack;
		},
		get topModal() {
			const topId = modalSystemState.modalStack[modalSystemState.modalStack.length - 1];
			return topId ? modalSystemState.activeModals[topId] : null;
		},
		get hasActiveModal() {
			return modalSystemState.modalStack.length > 0;
		},

		// Legacy compatibility getters
		get modalContext() {
			return legacyModalState;
		},
		get modalState() {
			return legacyModalState.state;
		},
		get isModalOpen() {
			return legacyModalState.showModal;
		},
		get currentTemplate() {
			return legacyModalState.template;
		},

		// Actions
		...modalActions
	};
}

// Create the store instance
export const modalSystem = createModalSystem();

// Export individual stores for backward compatibility
export const activeModals = {
	get activeModals() {
		return modalSystem.activeModals;
	}
};

export const topModal = {
	get topModal() {
		return modalSystem.topModal;
	}
};

export const hasActiveModal = {
	get hasActiveModal() {
		return modalSystem.hasActiveModal;
	}
};

export const modalContext = {
	get modalContext() {
		return modalSystem.modalContext;
	}
};

export const modalState = {
	get modalState() {
		return modalSystem.modalState;
	}
};

// Export the main modal system - access properties directly for reactivity
export const modalActions = modalSystem;

// For backwards compatibility, export getter functions that maintain reactivity
export function isModalOpen() {
	return modalSystem.isModalOpen;
}

export function currentTemplate() {
	return modalSystem.currentTemplate;
}

// Modal Component Utilities
export function createModalStore(id: string, type: ModalType) {
	return {
		get isOpen() {
			const modal = modalSystem.activeModals[id];
			return modal?.isOpen ?? false;
		},
		get data() {
			const modal = modalSystem.activeModals[id];
			return modal?.data ?? null;
		},
		get zIndex() {
			const modal = modalSystem.activeModals[id];
			return modal?.zIndex ?? 1000;
		},
		open: (
			data?: unknown,
			options?: { closeOnBackdrop?: boolean; closeOnEscape?: boolean; autoClose?: number }
		) => modalSystem.openModal(id, type, data, options),
		close: () => modalSystem.closeModal(id)
	};
}

// Global Event Listeners for Modal System (browser only)
if (typeof window !== 'undefined') {
	// ESC key closes top modal
	window.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') {
			const topModal = modalSystem.topModal;
			if (topModal && (topModal.closeOnEscape ?? true)) {
				modalActions.closeTop();
			}
		}
	});

	// Click outside closes modal (if enabled)
	window.addEventListener('click', (e) => {
		const target = e.target as Element;
		if (target.classList.contains('modal-backdrop')) {
			const topModal = modalSystem.topModal;
			if (topModal && (topModal.closeOnBackdrop ?? true)) {
				modalActions.closeTop();
			}
		}
	});
}

export default modalActions;
