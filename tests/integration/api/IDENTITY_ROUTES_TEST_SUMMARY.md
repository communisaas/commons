# Identity API Routes Integration Tests - Summary

## Overview

Integration coverage for the identity API now treats encrypted identity blob
routes as retired compatibility endpoints. Ground Vault PRF owns address
custody through `groundVaults`, `groundCellMetadata`,
`passkeyVaultWrappers`, and address re-entry fallback; these blob routes must
not store, retrieve, delete, or authorize access to legacy encrypted blobs.

Self.xyz and Didit.me provider routes were removed in Cycle 15. The active
identity-verification direction is mDL via the Digital Credentials API.

## Retired Routes Tested

| Route | Expected assertion |
| --- | --- |
| `POST /api/identity/store-blob` | Returns `410 Gone` with `deprecated_identity_blob_path` |
| `DELETE /api/identity/delete-blob` | Returns `410 Gone` with `deprecated_identity_blob_path` |
| `GET /api/identity/retrieve-blob` | Returns `410 Gone` with `deprecated_identity_blob_path` |

## Assertions Removed

The integration summary no longer expects legacy blob success behavior:

- No blob storage success assertion
- No blob retrieval success assertion
- No cross-user blob authorization matrix
- No database-backed encrypted blob dependency
- No encryption/decryption round-trip requirement for these retired routes

## Mocking Strategy

No Self.xyz, Didit, or legacy encrypted blob service mocks are required for
the retired-route behavior. Tests only need enough request/auth scaffolding to
prove the public routes terminate at the `410 Gone` retirement response.

## Usage

```bash
npm run test:integration -- tests/integration/api/identity-routes.test.ts
```

## Acceptance Criteria Status

- Retired blob routes assert `410 Gone`
- Legacy provider route tests remain removed
- Ground Vault PRF remains the documented address-custody path
