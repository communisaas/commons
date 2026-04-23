# Address Flow Testing Strategy

**Status**: 🚨 CRITICAL | Regression Prevention for Address Verification & Saving

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).** Use this guide for the
> *testing philosophy* (contract tests, field-naming rigor, end-to-end
> coverage). Specific paths, endpoints, and DB references below are
> stale:
>
> - **Test files don't exist as named.**
>   `tests/integration/address-verification-api.test.ts` and
>   `tests/integration/address-save-api.test.ts` are fictional. The
>   real address test is
>   `tests/integration/api/address-verification-e2e.test.ts` (save is
>   folded into this E2E, not a separate test).
> - **Endpoints are wrong.** `/api/address/verify` and
>   `/api/user/address` don't exist. Real routes are
>   `POST /api/location/resolve-address` (census + district resolution)
>   and `POST /api/identity/verify-address` (credential issuance,
>   representative upsert).
> - **Backend is Convex, not Prisma.** `db.user.findUnique(...)`,
>   `db.congressionalRep.*`, and any `prisma.*` samples describe the
>   removed ORM. New tests should use Convex testing harnesses; the
>   existing E2E retains `db`-shaped helpers as legacy plumbing only.
> - **Helpers like `verifyAddress()` / `saveAddress()` are pedagogical
>   placeholders**, not real utilities.
> - **Related:** `docs/development/e2e-testing-guide.md` has its own
>   divergence banner with complementary corrections; read both before
>   writing new tests.

---

## The Problem We Had

Between January and October 2025, we shipped **5 critical bugs** in the address-to-profile saving flow that went undetected:

1. ❌ **Lost Address Components** - Only concatenated string passed, not individual fields
2. ❌ **Missing Congressional District** - District data dropped between verify and save
3. ❌ **Field Name Mismatch** - API returned `bioguideId` but database expected `bioguide_id`
4. ❌ **Missing `office_code`** - Critical field for CWC submissions not included
5. ❌ **Database Field Errors** - Code used `_representative` instead of `representative`

**Root Cause**: Our tests checked the **wrong field names** and had **zero coverage** for the save endpoint.

**Impact**: Every address saved to profiles had incomplete or incorrect data. CWC submissions would fail.

---

## Testing Layers

### Layer 1: API Contract Tests (MOST CRITICAL)

**Purpose**: Ensure data structure compatibility between endpoints

**Location**: `tests/integration/address-verification-api.test.ts`

```typescript
it('[CONTRACT TEST] should return data structure compatible with save endpoint', async () => {
  const data = await verifyAddress();

  // CRITICAL: Check EXACT field names (snake_case)
  expect(data.representatives[0].bioguide_id).toBeDefined(); // NOT bioguideId
  expect(data.representatives[0].office_code).toBeDefined();
  expect(data.representatives[0].state).toBeDefined();

  // Field naming validation - these should NOT exist
  expect(data.representatives[0].bioguideId).toBeUndefined();
  expect(data.representatives[0].officeCode).toBeUndefined();
});
```

**Why This Matters**: This test would have caught the `bioguideId` vs `bioguide_id` mismatch immediately.

### Layer 2: Field Presence Tests

**Purpose**: Verify ALL required fields exist and are populated

```typescript
it('should include all fields required for CWC submission', async () => {
  const rep = data.representatives[0];

  expect(rep.bioguide_id).toBeTruthy(); // Not just defined, but has value
  expect(rep.office_code).toBeTruthy();
  expect(rep.state).toBeTruthy();
  expect(rep.name).toBeTruthy();
  expect(rep.party).toBeTruthy();
  expect(rep.chamber).toBeDefined();

  // Verify bioguide_id and office_code match (contract requirement)
  expect(rep.bioguide_id).toBe(rep.office_code);
});
```

### Layer 3: Save Endpoint Tests

**Purpose**: Test complete verify → save → database flow

**Location**: `tests/integration/address-save-api.test.ts`

```typescript
it('should save address with individual components', async () => {
  const saveData = {
    street: '1600 Pennsylvania Avenue NW',
    city: 'Washington',
    state: 'DC',
    zip: '20500',
    congressional_district: 'DC-AL',
    representatives: [...]
  };

  await saveAddress(saveData);

  // Verify in database
  const user = await db.user.findUnique({ where: { id: testUserId }});
  expect(user.street).toBe('1600 Pennsylvania Avenue NW');
  expect(user.congressional_district).toBe('DC-AL');
});
```

### Layer 4: Representative Storage Tests

**Purpose**: Ensure representatives are stored with correct field names

```typescript
it('should store representatives with snake_case field names', async () => {
  await saveAddress(addressData);

  const rep = await db.congressionalRep.findFirst({
    where: { bioguide_id: 'N000147' }
  });

  expect(rep.bioguide_id).toBe('N000147');
  expect(rep.office_code).toBe('N000147');
  expect(rep.bioguide_id).not.toMatch(/^temp_/); // No fallback IDs
});
```

---

## Critical Assertions Checklist

### For `/api/address/verify` Response

- [ ] `data.verified` is boolean
- [ ] `data.district` exists and matches format (e.g., "DC-AL", "CA-12")
- [ ] `data.representatives` is array with length > 0
- [ ] Each representative has:
  - [ ] `name` (string, non-empty)
  - [ ] `chamber` ('house' | 'senate')
  - [ ] `party` (string, non-empty)
  - [ ] `state` (string, non-empty)
  - [ ] `district` (string)
  - [ ] `bioguide_id` (string, non-empty, snake_case)
  - [ ] `office_code` (string, non-empty)
- [ ] `bioguide_id === office_code` for all representatives
- [ ] NO camelCase variants exist (`bioguideId`, `officeCode`)

### For `/api/user/address` Request Body

- [ ] Individual address components provided:
  - [ ] `street` (not just `address` string)
  - [ ] `city`
  - [ ] `state`
  - [ ] `zip`
- [ ] `congressional_district` included
- [ ] `representatives` array included with correct field names

### For Database Verification

- [ ] User record has all address fields populated
- [ ] `congressional_district` saved correctly
- [ ] Representatives stored in `representative` table (not `_representative`)
- [ ] User-representative links in `user_representatives` table
- [ ] Representative records have real `bioguide_id` (not temp IDs)

---

## Regression Prevention Rules

### Rule 1: Field Naming Convention

**ALWAYS use snake_case for API responses that will be saved to database:**

```typescript
// ✅ CORRECT
{
  bioguide_id: "N000147",
  office_code: "N000147",
  congressional_district: "DC-AL"
}

// ❌ WRONG
{
  bioguideId: "N000147",      // camelCase will break database save
  officeCode: "N000147",
  congressionalDistrict: "DC-AL"
}
```

### Rule 2: Contract Tests for All Data Pipelines

**Whenever data flows between endpoints, write a contract test:**

```typescript
it('[CONTRACT] verify → save data pipeline', async () => {
  const verifyResponse = await verifyAddress();
  const saveRequest = buildSaveRequest(verifyResponse);

  // This should not throw type errors or require transformations
  await saveAddress(saveRequest);
});
```

### Rule 3: Test Against Real Database Schema

**Always verify field names match Prisma schema:**

```typescript
// Check schema before writing test
const user = await db.user.findFirst(); // Uses snake_case
const rep = await db.congressionalRep.findFirst(); // Legacy table (table: representative)

// Test should match schema exactly
expect(savedUser.congressional_district).toBe('DC-AL');
expect(savedRep.bioguide_id).toBe('N000147');
```

### Rule 4: No Mocking for Integration Tests

**For address flow, use real external APIs in integration tests:**

- ✅ Call real Census Bureau API
- ✅ Call real Congress.gov API
- ✅ Write to real test database
- ❌ Don't mock API responses (masks field name mismatches)

---

## Test Execution Strategy

### Pre-commit Checks

```bash
# These MUST pass before any commit
npm run test:integration -- address-verification-api
npm run test:integration -- address-save-api
```

### CI Pipeline

```yaml
# .github/workflows/test.yml
- name: Address Flow Integration Tests
  run: npm run test:integration -- address
  env:
    CONGRESS_API_KEY: ${{ secrets.CONGRESS_API_KEY }}
```

### Manual Verification (for major changes)

```bash
# 1. Start dev server
npm run dev

# 2. Test full flow manually
curl -X POST http://localhost:5173/api/address/verify \
  -H 'Content-Type: application/json' \
  -d '{"street":"1600 Pennsylvania Avenue NW","city":"Washington","state":"DC","zipCode":"20500"}' \
  | jq '.representatives[0] | {bioguide_id, office_code, state}'

# 3. Verify output has correct field names
# Expected: {"bioguide_id":"N000147","office_code":"N000147","state":"District of Columbia"}
```

---

## Known Edge Cases to Test

### At-Large Districts

- DC (delegate, not representative)
- Vermont, Wyoming, Alaska, Montana, Delaware, North Dakota, South Dakota

```typescript
it('should handle at-large district representatives', async () => {
  const data = await verifyAddress('DC');
  expect(data.district).toBe('DC-AL'); // or DC-00
  expect(data.representatives[0].district).toMatch(/DC/);
});
```

### Non-Voting Delegates

DC delegate has `district: undefined` in Congress API:

```typescript
it('should match delegate with undefined district', async () => {
  // Eleanor Holmes Norton has district=undefined, not district=0
  expect(data.representatives[0].name).toBe('Eleanor Holmes Norton');
  expect(data.representatives[0].bioguide_id).toBe('N000147');
});
```

### State Name Variations

Congress API returns full names ("District of Columbia"), not abbreviations:

```typescript
it('should handle state name variations', async () => {
  expect(rep.state).toMatch(/District of Columbia|DC/);
});
```

---

## Metrics to Track

### Test Coverage

- [ ] 100% of `/api/address/verify` response fields tested
- [ ] 100% of `/api/user/address` request fields tested
- [ ] Database schema alignment verified

### Regression Detection

- **Before these tests**: 5 bugs shipped, 0 caught
- **After these tests**: 0 bugs should ship

### Test Execution Time

- Target: < 30 seconds for full address flow tests
- Current: ~5 seconds per test (acceptable)

---

## Future Improvements

### 1. Add E2E Tests for UI Components

Test the full user interaction flow:

```typescript
// tests/e2e/address-collection.spec.ts
test('user can verify and save address', async ({ page }) => {
  await page.fill('[name="street"]', '1600 Pennsylvania Avenue NW');
  await page.click('button:text("Verify Address")');
  await expect(page.locator('.representative-name')).toContainText('Eleanor Holmes Norton');
  await page.click('button:text("Save Address")');
  await expect(page.locator('.success-message')).toBeVisible();
});
```

### 2. Add Snapshot Tests for API Responses

```typescript
it('should match expected response structure', async () => {
  const data = await verifyAddress();
  expect(data).toMatchSnapshot();
  // Will fail if field names or structure changes
});
```

### 3. Add Performance Tests

```typescript
it('should complete verify → save in < 3 seconds', async () => {
  const start = Date.now();
  await verifyAndSaveAddress();
  const duration = Date.now() - start;
  expect(duration).toBeLessThan(3000);
});
```

---

## Questions to Ask During Code Review

1. **Does this change affect the address verification or saving flow?**
   - If yes, have you added/updated tests?

2. **Are you adding new fields to the API response?**
   - Are they snake_case to match database schema?
   - Have you added tests verifying they're populated?

3. **Are you changing field names?**
   - Have you updated ALL tests to check new names?
   - Have you checked for camelCase → snake_case mismatches?

4. **Are you modifying the data pipeline?**
   - Have you added a contract test?
   - Have you verified the end-to-end flow still works?

---

## Conclusion

**The address flow is mission-critical infrastructure.** These bugs cost us development cycles and data integrity issues. With this testing strategy in place, we should **NEVER** ship these types of regressions again.

**Key Principle**: Test field names EXACTLY as they appear in the code. If the database uses `bioguide_id`, tests must check `bioguide_id`, not `bioguideId`.
