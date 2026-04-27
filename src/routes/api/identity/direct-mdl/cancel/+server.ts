import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireMdlDirectQrEnabled } from '$lib/config/features';
import {
	DIRECT_MDL_TRANSPORT,
	failDirectMdlSession,
	getDirectMdlSession
} from '$lib/server/direct-mdl-session';
import { readBoundedJson } from '$lib/server/bounded-json';

const MAX_CANCEL_BODY_BYTES = 1024;
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const POST: RequestHandler = async ({ request, locals, platform, url }) => {
	try {
		requireMdlDirectQrEnabled(platform?.env?.PUBLIC_APP_URL, url.origin);
	} catch {
		throw error(404, 'Not found');
	}

	const session = locals.session;
	if (!session?.userId) {
		throw error(401, 'Authentication required');
	}

	const body = await readBoundedJson(request, MAX_CANCEL_BODY_BYTES);
	const sessionId =
		body && typeof body === 'object' && 'sessionId' in body ? String(body.sessionId) : '';
	if (!SESSION_ID_RE.test(sessionId)) {
		throw error(400, 'sessionId is invalid');
	}

	const directSession = await getDirectMdlSession(sessionId, platform);
	if (!directSession) {
		return json({ success: true });
	}
	if (directSession.desktopUserId !== session.userId) {
		throw error(403, 'Session ownership mismatch');
	}

	await failDirectMdlSession(
		sessionId,
		'Direct QR session replaced',
		platform,
		DIRECT_MDL_TRANSPORT
	);
	return json({ success: true });
};
