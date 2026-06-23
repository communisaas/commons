import { describe, it, expect, vi, afterEach } from 'vitest';
import { tryNativeShare } from '$lib/utils/web-share';

function setNavigator(overrides: Record<string, unknown>): void {
	vi.stubGlobal('navigator', overrides);
}

describe('tryNativeShare', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('shares a single-URL payload — text only, never a url field (no duplicate link)', async () => {
		const share = vi.fn().mockResolvedValue(undefined);
		setNavigator({ share, canShare: () => true });

		const text = 'Join me — https://commons.email/s/abc?via=share';
		const result = await tryNativeShare({ title: 'Act', text });

		expect(result).toBe('shared');
		const payload = share.mock.calls[0][0];
		expect(payload).toEqual({ title: 'Act', text });
		// The URL lives only inside `text`; a `url` field would duplicate it in the sheet.
		expect(payload).not.toHaveProperty('url');
	});

	it('treats a missing canShare() as shareable (older browsers expose share without it)', async () => {
		const share = vi.fn().mockResolvedValue(undefined);
		setNavigator({ share });
		expect(await tryNativeShare({ text: 'x' })).toBe('shared');
	});

	it('reports a cancelled sheet as dismissed so callers never silently copy', async () => {
		const share = vi.fn().mockRejectedValue(Object.assign(new Error('cancel'), { name: 'AbortError' }));
		setNavigator({ share, canShare: () => true });
		expect(await tryNativeShare({ text: 'x' })).toBe('dismissed');
	});

	it('is unavailable when the platform has no share()', async () => {
		setNavigator({});
		expect(await tryNativeShare({ text: 'x' })).toBe('unavailable');
	});

	it('is unavailable (and never calls share) when canShare rejects the payload', async () => {
		const share = vi.fn();
		setNavigator({ share, canShare: () => false });
		expect(await tryNativeShare({ text: 'x' })).toBe('unavailable');
		expect(share).not.toHaveBeenCalled();
	});

	it('falls back to unavailable on a non-abort share error', async () => {
		const share = vi.fn().mockRejectedValue(new Error('boom'));
		setNavigator({ share, canShare: () => true });
		expect(await tryNativeShare({ text: 'x' })).toBe('unavailable');
	});
});
