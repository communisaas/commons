import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import StaleArtifactBanner from '$lib/components/template/StaleArtifactBanner.svelte';

describe('StaleArtifactBanner', () => {
	const baseProps = {
		builtForSubject: 'Fund the new library',
		currentSubject: 'Fund the new park',
		artifactLabel: 'message',
		onUpdate: () => {},
		onKeep: () => {}
	};

	it('renders an honest heading naming the artifact and shows old vs new subject', () => {
		const { getByText } = render(StaleArtifactBanner, { props: baseProps });

		expect(getByText('Built for a different subject')).toBeTruthy();
		expect(getByText(/rebuild the message/i)).toBeTruthy();
		expect(getByText('Fund the new library')).toBeTruthy();
		expect(getByText('Fund the new park')).toBeTruthy();
	});

	it('invokes onUpdate when the update button is clicked', async () => {
		const onUpdate = vi.fn();
		const { getByRole } = render(StaleArtifactBanner, {
			props: { ...baseProps, onUpdate }
		});

		await fireEvent.click(getByRole('button', { name: /update for new subject/i }));
		expect(onUpdate).toHaveBeenCalledTimes(1);
	});

	it('invokes onKeep when the keep button is clicked', async () => {
		const onKeep = vi.fn();
		const { getByRole } = render(StaleArtifactBanner, {
			props: { ...baseProps, onKeep }
		});

		await fireEvent.click(getByRole('button', { name: /keep these/i }));
		expect(onKeep).toHaveBeenCalledTimes(1);
	});

	it('disables both buttons while busy', () => {
		const { getByRole } = render(StaleArtifactBanner, {
			props: { ...baseProps, busy: true }
		});

		expect((getByRole('button', { name: /updating/i }) as HTMLButtonElement).disabled).toBe(true);
		expect((getByRole('button', { name: /keep these/i }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('truncates an overlong subject line', () => {
		const long = 'x'.repeat(200);
		const { container } = render(StaleArtifactBanner, {
			props: { ...baseProps, currentSubject: long }
		});

		// Truncated form ends with an ellipsis and is shorter than the input.
		expect(container.textContent).toContain('…');
		expect(container.textContent).not.toContain(long);
	});
});
