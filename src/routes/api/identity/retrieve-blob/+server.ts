import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () =>
	json(
		{
			error: 'deprecated_identity_blob_path',
			message: 'Encrypted identity blobs have been retired. Use the ground vault state API.'
		},
		{ status: 410 }
	);
