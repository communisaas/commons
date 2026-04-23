# OAuth Authentication Setup

**Status**: ✅ IMPLEMENTED | 4 Providers Active + 2 Disabled

> ⚠️ **2026-04-23 audit — specific corrections applied inline, but note:**
>
> - **Session expiry is conditional, not always 90 days.** Social-funnel
>   routes (`template-modal`, `/s/`) get 90-day sessions; all other flows
>   get **30 days** (`src/lib/core/auth/oauth-callback-handler.ts:~302`).
>   The ASCII diagram below is accurate only for the funnel path.
> - **`oauth-security.ts` no longer exists** as a separate file; content
>   was merged into the callback handler. Line counts in the "Core Files"
>   section (468 / 361 / 206) are stale — actual `oauth-providers.ts` is
>   now ~894 lines, `oauth-callback-handler.ts` ~460 lines.
> - **Facebook uses PKCE via a custom `FacebookOAuth` class**;
>   `code_verifier` is mandatory. Not currently documented below.
> - **Coinbase is optional**: config function returns `null` if
>   `COINBASE_CLIENT_ID` / `COINBASE_CLIENT_SECRET` are unset — no hard
>   throw, silently unavailable.

---

**Unified OAuth authentication system with Sybil-resistance-aware provider hierarchy.**

### Provider Status (2026-01-31)

| Provider | Status | Sybil Resistance | Notes |
|----------|--------|------------------|-------|
| Google | ✅ Active | ⭐⭐⭐⭐ | Primary tier, featured provider |
| LinkedIn | ✅ Active | ⭐⭐⭐⭐ | Primary tier |
| Facebook | ✅ Active | ⭐⭐⭐ | Secondary tier |
| **Coinbase** | ✅ Active | ⭐⭐⭐⭐⭐ | KYC-verified, highest trust, see `specs/coinbase-auth-integration.md` |
| X/Twitter | ❌ DISABLED | ⭐⭐ | Routes return 403, low Sybil resistance, high bot prevalence |
| Discord | ❌ DISABLED | ⭐⭐ | Routes return 403, low Sybil resistance |

## Overview

Commons uses passwordless OAuth authentication to reduce friction and maximize conversion. Users authenticate with existing social accounts, enabling instant civic action without signup forms.

**Active Providers** (4 total, ordered by UI display):
1. Google OAuth 2.0 (Featured provider)
2. LinkedIn OAuth 2.0 (Primary tier)
3. Facebook Login (Secondary tier)
4. Coinbase OAuth 2.0 (KYC-verified, highest Sybil resistance)

**Disabled**: Discord OAuth 2.0 + Twitter/X OAuth 2.0 (low Sybil resistance)

**Architecture**: Arctic library + unified callback handler + session management

## Architecture

```
User clicks "Login with Google"
    ↓
/auth/prepare (generates PKCE state)
    ↓
Redirect to Google OAuth
    ↓
User authorizes
    ↓
/auth/google/callback (validates state)
    ↓
Exchange code for tokens
    ↓
Fetch user profile
    ↓
Create/update user in DB
    ↓
Create session (90 days)
    ↓
Redirect to pending intent or home
```

## Configuration

### Environment Variables

```bash
# Base OAuth redirect URL (required for all providers)
OAUTH_REDIRECT_BASE_URL=http://localhost:5173  # Dev
OAUTH_REDIRECT_BASE_URL=https://commons.email # Prod

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret

# Facebook OAuth
FACEBOOK_CLIENT_ID=your-facebook-app-id
FACEBOOK_CLIENT_SECRET=your-facebook-app-secret

# Twitter OAuth
TWITTER_CLIENT_ID=your-twitter-client-id
TWITTER_CLIENT_SECRET=your-twitter-client-secret

# LinkedIn OAuth
LINKEDIN_CLIENT_ID=your-linkedin-client-id
LINKEDIN_CLIENT_SECRET=your-linkedin-client-secret

# Discord OAuth
DISCORD_CLIENT_ID=your-discord-client-id
DISCORD_CLIENT_SECRET=your-discord-client-secret
```

### Provider Setup

#### Google OAuth

1. **Create OAuth Credentials**:
   - Visit [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   - Create new OAuth 2.0 Client ID
   - Application type: Web application

2. **Authorized Redirect URIs**:
   ```
   http://localhost:5173/auth/google/callback
   https://commons.email/auth/google/callback
   ```

3. **Scopes**: `profile email`

4. **User Info Endpoint**: `https://www.googleapis.com/oauth2/v2/userinfo`

#### Facebook Login

1. **Create Facebook App**:
   - Visit [Facebook Developers](https://developers.facebook.com/)
   - Create new app → Consumer
   - Add "Facebook Login" product

2. **Valid OAuth Redirect URIs**:
   ```
   http://localhost:5173/auth/facebook/callback
   https://commons.email/auth/facebook/callback
   ```

3. **Permissions**: `email`, `public_profile`

4. **User Info Endpoint**: `https://graph.facebook.com/me?fields=id,name,email,picture`

#### Twitter (X) OAuth

1. **Create Twitter App**:
   - Visit [Twitter Developer Portal](https://developer.twitter.com/en/portal/dashboard)
   - Create project → Add app
   - Enable OAuth 2.0

2. **Callback URL**:
   ```
   http://localhost:5173/auth/twitter/callback
   https://commons.email/auth/twitter/callback
   ```

3. **Scopes**: `users.read tweet.read users.email offline.access` — the `users.email` scope is required for Sybil-resistance verification; without it the provider returns no email and accounts get synthetic `@twitter.local` addresses.

4. **User Info Endpoint**: `https://api.twitter.com/2/users/me`

#### LinkedIn OAuth

1. **Create LinkedIn App**:
   - Visit [LinkedIn Developers](https://www.linkedin.com/developers/apps)
   - Create new app
   - Request access to "Sign In with LinkedIn"

2. **Authorized Redirect URLs**:
   ```
   http://localhost:5173/auth/linkedin/callback
   https://commons.email/auth/linkedin/callback
   ```

3. **Scopes**: `openid profile email` (LinkedIn OAuth 2.0 / "Sign In with LinkedIn v2" — the legacy `r_liteprofile r_emailaddress` scopes are v1 and rejected by current LinkedIn apps).

4. **User Info Endpoint**: `https://api.linkedin.com/v2/userinfo`

#### Discord OAuth

1. **Create Discord Application**:
   - Visit [Discord Developer Portal](https://discord.com/developers/applications)
   - Create new application
   - Add OAuth2 redirect

2. **Redirect URIs**:
   ```
   http://localhost:5173/auth/discord/callback
   https://commons.email/auth/discord/callback
   ```

3. **Scopes**: `identify email`

4. **User Info Endpoint**: `https://discord.com/api/users/@me`

## Code Architecture

### Core Files

**Provider Configurations**: `src/lib/core/auth/oauth-providers.ts` (468 lines)
- Provider-specific configs (Google, Facebook, Twitter, LinkedIn, Discord)
- Type guards for each provider's user response format
- Token exchange implementations
- User data extraction logic

**Unified Callback Handler**: `src/lib/core/auth/oauth-callback-handler.ts` (361 lines)
- Generic OAuth flow orchestration
- State validation (CSRF protection)
- Code verifier validation (PKCE)
- User creation/update logic
- Session creation

**Security Layer**: `src/lib/core/auth/oauth-security.ts` (206 lines)
- Session validation
- Rate limiting by user ID
- Analytics permission checks

**Session Management**: `src/lib/core/auth/auth.ts` (120 lines)
- Session creation (90-day expiry)
- Session deletion (logout)
- Active session queries

**Route Handlers**: `src/routes/auth/` (12 files)
- Each provider has 2 routes: initiation + callback
- `/auth/{provider}/+server.ts` - OAuth flow start
- `/auth/{provider}/callback/+server.ts` - OAuth callback handler
- `/auth/logout/+server.ts` - Session termination

### Provider Configuration Structure

```typescript
interface OAuthCallbackConfig {
  provider: OAuthProvider;
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
  userInfoUrl: string;
  requiresCodeVerifier: boolean;
  scope: string;

  createOAuthClient: () => OAuthClient;
  exchangeTokens: (client: OAuthClient, code: string, codeVerifier?: string) => Promise<OAuthTokens>;
  fetchUserInfo: (tokens: OAuthTokens) => Promise<UserData>;
  extractUserData: (userInfo: unknown) => UserData;
}
```

### Type Guards for Provider Responses

Each provider returns user data in a different format. Type guards ensure type safety:

```typescript
// Google: { id, email, name, picture }
function isGoogleUser(user: unknown): user is GoogleUser {
  return typeof user === 'object' &&
         'id' in user &&
         'email' in user &&
         'name' in user;
}

// Twitter: { data: { id, username, name, email } }
function isTwitterUser(user: unknown): user is TwitterUser {
  return typeof user === 'object' &&
         'data' in user &&
         typeof user.data === 'object';
}

// Similar guards for Facebook, LinkedIn, Discord...
```

## Security Features

### PKCE (Proof Key for Code Exchange)

Prevents authorization code interception attacks:

```typescript
// Generate code verifier
const codeVerifier = generateRandomString(64);
const codeChallenge = await sha256Hash(codeVerifier);

// Store in session for callback validation
cookies.set('oauth_code_verifier', codeVerifier, {
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  maxAge: 600 // 10 minutes
});

// Include in authorization URL
const authUrl = client.createAuthorizationURL(
  state,
  codeChallenge,
  'S256' // Challenge method
);
```

### State Parameter (CSRF Protection)

Prevents cross-site request forgery:

```typescript
// Generate cryptographically random state
const state = generateRandomString(32);

// Store in secure cookie
cookies.set('oauth_state', state, {
  path: '/',
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 600
});

// Validate on callback
const storedState = cookies.get('oauth_state');
const returnedState = url.searchParams.get('state');

if (storedState !== returnedState) {
  throw new Error('State mismatch - possible CSRF attack');
}
```

### Session Security

```typescript
interface SessionOptions {
  httpOnly: true;           // Prevent XSS attacks
  secure: true;             // HTTPS only in production
  sameSite: 'lax';          // CSRF protection
  maxAge: 90 * 24 * 60 * 60; // 90 days
  path: '/';
}
```

### Rate Limiting

Prevents abuse of OAuth endpoints:

```typescript
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS = 10; // 10 requests per minute per user

export async function checkRateLimit(userId: string, endpoint: string): Promise<boolean> {
  const key = `${userId}:${endpoint}`;
  const limit = userRateLimits.get(key);

  if (!limit || Date.now() - limit.window_start > RATE_LIMIT_WINDOW) {
    // Reset window
    userRateLimits.set(key, { count: 1, window_start: Date.now() });
    return true;
  }

  if (limit.count >= MAX_REQUESTS) {
    return false; // Rate limited
  }

  limit.count++;
  return true;
}
```

## User Flow

### First-Time User

1. **Land on template page** (`/s/climate-action`)
2. **Click "Send Message"**
3. **Redirect to `/auth/prepare`** (generate OAuth state)
4. **Choose OAuth provider** (Google, Facebook, Twitter, etc.)
5. **Authorize on provider site**
6. **Return to `/auth/{provider}/callback`**
7. **Create user account** (email, name, profile picture)
8. **Create session** (90-day cookie)
9. **Redirect to template** with pending intent restored
10. **Send message immediately**

### Returning User

1. **Land on template page**
2. **Session cookie automatically validates**
3. **Click "Send Message"**
4. **Message sent immediately** (no re-auth needed)

### Pending Intent Restoration

User's intent is preserved across OAuth flow:

```typescript
// Before OAuth redirect
cookies.set('pending_intent', JSON.stringify({
  action: 'send_template',
  template_id: 'climate-action',
  source: 'twitter'
}), { maxAge: 600 });

// After OAuth callback
const pendingIntent = cookies.get('pending_intent');
if (pendingIntent) {
  const { action, template_id } = JSON.parse(pendingIntent);
  return redirect(`/s/${template_id}?auth=complete`);
}
```

## Database Integration

### User Creation/Update

```typescript
// Check if user exists by email
let user = await db.user.findUnique({
  where: { email: userData.email }
});

if (!user) {
  // Create new user
  user = await db.user.create({
    data: {
      email: userData.email,
      name: userData.name,
      avatar_url: userData.picture,
      oauth_provider: provider,
      oauth_id: userData.id,
      created_at: new Date(),
      updated_at: new Date()
    }
  });
} else {
  // Update existing user
  user = await db.user.update({
    where: { id: user.id },
    data: {
      name: userData.name,
      avatar_url: userData.picture,
      oauth_provider: provider,
      oauth_id: userData.id,
      updated_at: new Date()
    }
  });
}
```

### Session Creation

```typescript
const session = await db.session.create({
  data: {
    id: generateSessionId(),
    userId: user.id,
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
    createdAt: new Date()
  }
});

cookies.set('auth-session', session.id, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 90 * 24 * 60 * 60,
  path: '/'
});
```

## Testing

```bash
# Integration tests
npm run test:integration -- oauth-flow.test.ts
npm run test:integration -- oauth-callback-security.test.ts

# E2E tests (requires OAuth credentials)
GOOGLE_CLIENT_ID=test GOOGLE_CLIENT_SECRET=test npm run test:e2e
```

## Error Handling

### Common OAuth Errors

```typescript
// User denies authorization
if (url.searchParams.get('error') === 'access_denied') {
  return redirect('/?error=auth_cancelled');
}

// Invalid credentials
if (!clientId || !clientSecret) {
  throw new Error('OAuth credentials not configured');
}

// State mismatch (CSRF attempt)
if (state !== storedState) {
  throw new Error('State mismatch - possible CSRF attack');
}

// Token exchange failure
try {
  const tokens = await client.validateAuthorizationCode(code, codeVerifier);
} catch (error) {
  return redirect('/?error=oauth_failed');
}

// User info fetch failure
try {
  const userInfo = await fetchUserInfo(tokens);
} catch (error) {
  return redirect('/?error=user_info_failed');
}
```

## Production Deployment

### Security Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use HTTPS for all OAuth redirects
- [ ] Enable `secure: true` on all cookies
- [ ] Rotate OAuth client secrets regularly
- [ ] Monitor failed auth attempts
- [ ] Set up rate limiting on OAuth endpoints
- [ ] Log all OAuth errors for security review
- [ ] Implement session refresh mechanism

### Provider-Specific Notes

**Google**:
- Requires domain verification for production
- OAuth consent screen must be approved
- Can take 1-2 days for approval

**Facebook**:
- App must be in "Live" mode (not Development)
- Requires business verification for certain permissions
- Privacy policy URL required

**Twitter**:
- Elevated access required for production use
- Application review process
- Rate limits per app (not per user)

**LinkedIn**:
- "Sign In with LinkedIn" product must be approved
- May require marketing use case review
- Limited to specific redirect URLs

**Discord**:
- Bot/user token distinction
- Public bot requires verification at 100+ servers
- Rate limits enforced per application

## Roadmap

### Near Term (P1)
- Session refresh tokens (extend 90-day expiry)
- **Coinbase On-Chain Verifications** — EAS attestations on Base L2 (see `specs/coinbase-auth-integration.md`)

### Medium Term
- Apple Sign In (device-bound identity)
- WebAuthn/Passkey support (passwordless++)
- Account linking (merge multiple OAuth accounts)

### Long Term
- Self-hosted OAuth provider (Commons SSO)
- OAuth for API access (external integrations)
- Federated identity (cross-platform reputation)

### Removed
- ~~Discord OAuth~~ — Disabled due to low Sybil resistance (2026-01-31)
- ~~Twitter/X OAuth~~ — Disabled due to low Sybil resistance, high bot prevalence (2026-01-31)

## References

- **Code**: `src/lib/core/auth/` and `src/routes/auth/`
- **Arctic Library**: [https://github.com/pilcrowOnPaper/arctic](https://github.com/pilcrowOnPaper/arctic)
- **Tests**: `tests/integration/oauth-*.test.ts`
- **Session Management**: `docs/authentication/sessions.md` (TODO)

---

This OAuth system provides secure, frictionless authentication while maintaining privacy and enabling instant civic action.
