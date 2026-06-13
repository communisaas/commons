# @commons-platform/sdk

Official TypeScript SDK for the Commons Public API. Zero dependencies, full type safety, auto-paginating async iterators.

## Install

```bash
npm install @commons-platform/sdk
```

## Quick start

```typescript
import { Commons } from '@commons-platform/sdk';

const client = new Commons({
	apiKey: 'ck_live_...',
	baseUrl: 'https://commons.so/api/v1' // optional, this is the default
});

// Get your organization
const org = await client.org.get();
console.log(org.name, org.counts.supporters);
```

## Resources

| Resource                 | Methods                                                                       |
| ------------------------ | ----------------------------------------------------------------------------- |
| `client.org`             | `.get()`                                                                      |
| `client.supporters`      | `.list()`, `.get(id)`, `.create(input)`, `.update(id, input)`, `.delete(id)`  |
| `client.campaigns`       | `.list()`, `.get(id)`, `.create(input)`, `.update(id, input)`, `.actions(id)` |
| `client.tags`            | `.list()`, `.create(name)`, `.update(id, name)`, `.delete(id)`                |
| `client.events`          | `.list()`, `.get(id)`                                                         |
| `client.donations`       | `.list()`, `.get(id)`                                                         |
| `client.workflows`       | `.list()`, `.get(id)`                                                         |
| `client.sms`             | `.list()`                                                                     |
| `client.calls`           | `.list()`                                                                     |
| `client.representatives` | `.list()`                                                                     |
| `client.usage`           | `.get()`                                                                      |
| `client.keys`            | `.create(input)`, `.rename(id, orgSlug, name)`, `.revoke(id, orgSlug)`        |

## Pagination

List methods return a `CursorPage<T>` that implements `AsyncIterable<T>`:

```typescript
// Iterate through all supporters automatically
for await (const supporter of client.supporters.list()) {
	console.log(supporter.emailStatus, supporter.postalCode);
}

// Or work with a single page
const page = await client.supporters.list({ limit: 10 });
console.log(page.data); // Supporter[]
console.log(page.meta.total); // total count
console.log(page.hasMore); // boolean

// Manually fetch next page
const next = await page.nextPage();
```

### Filtering

```typescript
// Filter supporters
const verified = await client.supporters.list({ verified: true, email_status: 'subscribed' });

// Filter campaigns
const active = await client.campaigns.list({ status: 'ACTIVE', type: 'LETTER' });

// Filter donations
const completed = await client.donations.list({ status: 'completed', campaignId: 'camp_123' });
```

## Supporter PII is encrypted — decrypting it is yours to do

Supporter contact fields come back as ciphertext: `encryptedEmail`, `encryptedName`,
`encryptedPhone`, and `encryptedCustomFields` are AES-256-GCM blobs encrypted with your
organization's key. The platform stores the blobs and never holds the key, so there is
deliberately **no server-side decrypt endpoint** — decryption happens wherever the key
lives: in your hands.

Each blob is a JSON string of `{ "ciphertext": "<base64>", "iv": "<base64>", "v": "org-1" | "org-2" }`.
The AES-GCM additional authenticated data (AAD) binds every blob to its row and field name:

| Blob version | AAD                      |
| ------------ | ------------------------ |
| `org-2`      | `eh:<emailHash>:<field>` |
| `org-1`      | `supporter:<id>:<field>` |

where `<field>` is `email`, `name`, `phone`, or `customFields`, and `emailHash` is the
org-scoped hash included in supporter API responses.

### Deriving the org key

The key derives from your organization passphrase and your org id (from `client.org.get()`):
PBKDF2 over the passphrase (salt = org id, 600,000 iterations, SHA-256) stretched to 256
bits, then HKDF (SHA-256, salt = `commons-org-pii-v1`, info = org id) into an AES-256-GCM key.

```typescript
const enc = new TextEncoder();

async function deriveOrgKey(passphrase: string, orgId: string): Promise<CryptoKey> {
	const pass = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, [
		'deriveBits'
	]);
	const stretched = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', salt: enc.encode(orgId), iterations: 600_000, hash: 'SHA-256' },
		pass,
		256
	);
	const hkdf = await crypto.subtle.importKey('raw', stretched, 'HKDF', false, ['deriveKey']);
	return crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: enc.encode('commons-org-pii-v1'),
			info: enc.encode(orgId)
		},
		hkdf,
		{ name: 'AES-GCM', length: 256 },
		false,
		['decrypt']
	);
}

function b64(s: string): Uint8Array {
	return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function decryptField(
	blobJson: string,
	orgKey: CryptoKey,
	emailHash: string,
	supporterId: string,
	field: 'email' | 'name' | 'phone' | 'customFields'
): Promise<string> {
	const blob = JSON.parse(blobJson);
	const entity = blob.v === 'org-2' ? `eh:${emailHash}` : `supporter:${supporterId}`;
	const plaintext = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: b64(blob.iv), additionalData: enc.encode(`${entity}:${field}`) },
		orgKey,
		b64(blob.ciphertext)
	);
	return new TextDecoder().decode(plaintext);
}
```

### Full-list takeout

```typescript
const org = await client.org.get();
const orgKey = await deriveOrgKey(process.env.ORG_PASSPHRASE!, org.id);

for await (const s of client.supporters.list()) {
	const email = s.encryptedEmail
		? await decryptField(s.encryptedEmail, orgKey, s.emailHash, s.id, 'email')
		: null;
	const name = s.encryptedName
		? await decryptField(s.encryptedName, orgKey, s.emailHash, s.id, 'name')
		: null;
	console.log(email, name, s.postalCode, s.emailStatus);
}
```

Treat the passphrase like the supporter list itself: anyone holding both an API key and
the passphrase can read every contact record, so keep it in your secret manager and out
of source control.

## Error handling

The SDK throws typed errors for different HTTP status codes:

```typescript
import { Commons, NotFoundError, RateLimitError, AuthenticationError } from '@commons-platform/sdk';

try {
	const supporter = await client.supporters.get('nonexistent');
} catch (err) {
	if (err instanceof NotFoundError) {
		console.log('Not found:', err.message);
	} else if (err instanceof RateLimitError) {
		console.log('Rate limited:', err.message);
	} else if (err instanceof AuthenticationError) {
		console.log('Auth failed:', err.message);
	}
}
```

## Error classes

| Class                 | HTTP Status | When                      |
| --------------------- | ----------- | ------------------------- |
| `AuthenticationError` | 401         | Missing/invalid API key   |
| `ForbiddenError`      | 403         | Key lacks required scope  |
| `NotFoundError`       | 404         | Resource not found        |
| `RateLimitError`      | 429         | Too many requests         |
| `CommonsError`        | other       | Base class for all errors |

## Requirements

- Node.js 18+ or any runtime with native `fetch`
- ESM only
