import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Template } from '$lib/types/template';

const { toggleBodyScroll } = vi.hoisted(() => ({
	toggleBodyScroll: vi.fn()
}));

vi.mock('$lib/utils/browserUtils', () => ({ toggleBodyScroll }));
vi.mock('$lib/utils/timerCoordinator', () => ({
	coordinated: {
		autoClose: vi.fn()
	}
}));

import {
	createModalStore,
	isModalOpen,
	modalActions,
	modalSystem
} from '$lib/stores/modalSystem.svelte';

const TEMPLATE = { id: 'template-1', slug: 'template-1' } as Template;

describe('modal system legacy and unified open-state contracts', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		modalActions.reset();
		toggleBodyScroll.mockClear();
	});

	afterEach(() => {
		vi.runOnlyPendingTimers();
		modalActions.reset();
		vi.useRealTimers();
	});

	it('keeps the unified modal-id predicate callable', () => {
		expect(typeof modalSystem.isModalOpen).toBe('function');
		expect(modalSystem.isModalOpen('auth-dialog')).toBe(false);

		modalActions.openModal('auth-dialog', 'auth');

		expect(modalSystem.isModalOpen('auth-dialog')).toBe(true);
		expect(createModalStore('auth-dialog', 'auth').isOpen).toBe(true);
		expect(isModalOpen()).toBe(false);

		modalActions.closeModal('auth-dialog');
		expect(modalSystem.isModalOpen('auth-dialog')).toBe(false);
	});

	it('reports the legacy template-modal boolean without shadowing the unified predicate', () => {
		expect(isModalOpen()).toBe(false);

		modalActions.open(TEMPLATE, { id: 'user-1' });

		expect(isModalOpen()).toBe(true);
		expect(modalSystem.isModalOpen('legacy-template-modal')).toBe(true);
		expect(typeof modalSystem.isModalOpen).toBe('function');

		modalActions.close();
		expect(isModalOpen()).toBe(false);
		expect(modalSystem.isModalOpen('legacy-template-modal')).toBe(false);
	});
});
