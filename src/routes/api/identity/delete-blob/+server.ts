import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async () =>
	json(
		{
			error: 'deprecated_identity_blob_path',
			message: 'Encrypted identity blobs have been retired. Ground vault records are managed separately.'
		},
		{ status: 410 }
	);
