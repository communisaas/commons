/**
 * External Service Mocks using MSW
 * 
 * Mocks only external services, not internal business logic.
 * This allows us to test real code paths with predictable external dependencies.
 */

import { http, HttpResponse } from 'msw';

// CWC (Communicating With Congress) API Mocks
export const cwcHandlers = [
  // House submission endpoint
  http.post('https://cwc-api.house.gov/submit', () => {
    return HttpResponse.json({
      success: true,
      submissionId: 'house-12345',
      status: 'queued',
      estimatedDelivery: '2024-10-04T08:00:00Z'
    });
  }),

  // Senate submission endpoint  
  http.post('https://cwc-api.senate.gov/submit', () => {
    return HttpResponse.json({
      success: true,
      submissionId: 'senate-67890',
      status: 'queued',
      estimatedDelivery: '2024-10-04T08:00:00Z'
    });
  }),

  // Job status check
  http.get('https://cwc-api.house.gov/jobs/:jobId', ({ params }) => {
    return HttpResponse.json({
      jobId: params.jobId,
      status: 'completed',
      deliveredAt: '2024-10-04T07:45:00Z',
      recipients: ['rep.smith@mail.house.gov']
    });
  }),

  // Error scenarios for testing
  http.post('https://cwc-api.house.gov/submit-error', () => {
    return HttpResponse.json(
      { error: 'Invalid ZIP code format', code: 'INVALID_ZIP' },
      { status: 400 }
    );
  })
];

// OAuth Provider Mocks
export const oauthHandlers = [
  // Google OAuth token exchange
  http.post('https://oauth2.googleapis.com/token', () => {
    return HttpResponse.json({
      access_token: 'mock-google-token',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'mock-refresh-token',
      scope: 'openid email profile'
    });
  }),

  // Google user info
  http.get('https://www.googleapis.com/oauth2/v2/userinfo', () => {
    return HttpResponse.json({
      id: 'google-123456',
      email: 'test@gmail.com',
      verified_email: true,
      name: 'Test User',
      picture: 'https://example.com/avatar.jpg'
    });
  }),

  // Facebook OAuth  
  http.post('https://graph.facebook.com/v18.0/oauth/access_token', () => {
    return HttpResponse.json({
      access_token: 'mock-facebook-token',
      token_type: 'bearer',
      expires_in: 5183944
    });
  }),

  // Twitter OAuth
  http.post('https://api.twitter.com/2/oauth2/token', () => {
    return HttpResponse.json({
      token_type: 'bearer',
      expires_in: 7200,
      access_token: 'mock-twitter-token',
      scope: 'tweet.read users.read'
    });
  })
];

// Self.xyz Identity Verification Mocks
// The Self.xyz SDK uses Celo blockchain RPC to verify ZK proofs on-chain
export const selfXyzHandlers = [
  // Celo Alfajores Testnet RPC (used when SELF_MOCK_PASSPORT=true)
  http.post('https://alfajores-forno.celo-testnet.org', async ({ request }) => {
    const body = await request.json() as any;
    const method = body.method;

    // Mock smart contract responses for ZK proof verification
    if (method === 'eth_call') {
      // Return mock data indicating valid verification
      // The actual verification logic runs in the SDK
      return HttpResponse.json({
        jsonrpc: '2.0',
        id: body.id,
        result: '0x0000000000000000000000000000000000000000000000000000000000000001' // true
      });
    }

    // Default response for other RPC methods
    return HttpResponse.json({
      jsonrpc: '2.0',
      id: body.id,
      result: '0x'
    });
  }),

  // Celo Mainnet RPC (used when SELF_MOCK_PASSPORT=false)
  http.post('https://forno.celo.org', async ({ request }) => {
    const body = await request.json() as any;
    const method = body.method;

    if (method === 'eth_call') {
      return HttpResponse.json({
        jsonrpc: '2.0',
        id: body.id,
        result: '0x0000000000000000000000000000000000000000000000000000000000000001' // true
      });
    }

    return HttpResponse.json({
      jsonrpc: '2.0',
      id: body.id,
      result: '0x'
    });
  })
];

// Congressional Data Services Mocks (Google Civic API removed — district resolution via Shadow Atlas)

// AWS SQS Mocks for async processing
export const sqsHandlers = [
  // Send message to queue
  http.post('https://sqs.us-west-2.amazonaws.com/123456789/cwc-submissions', () => {
    return HttpResponse.json({
      MessageId: 'msg-12345-67890',
      MD5OfBody: 'mock-md5-hash',
      MD5OfMessageAttributes: 'mock-attr-hash'
    });
  }),

  // Receive messages
  http.get('https://sqs.us-west-2.amazonaws.com/123456789/cwc-submissions', () => {
    return HttpResponse.json({
      Messages: [
        {
          MessageId: 'msg-12345-67890',
          ReceiptHandle: 'mock-receipt-handle',
          Body: JSON.stringify({
            templateId: 'template-123',
            userId: 'user-456',
            submissionType: 'congressional'
          })
        }
      ]
    });
  })
];

// Census and Congress.gov API Handlers
// Shared address mapping used by both Census endpoint handlers
const FIPS_TO_STUSAB: Record<string, string> = {
  '06': 'CA', '48': 'TX', '36': 'NY', '08': 'CO', '50': 'VT',
  '11': 'DC', '72': 'PR', '78': 'VI', '66': 'GU', '17': 'IL'
};

interface CensusTestAddress {
  match: (a: string) => boolean;
  cd: string;
  geoid: string;
  state: string;
  stusab: string;
  blockGeoid?: string;
  countyGeoid?: string;
  coordinates?: { x: number; y: number };
  matchedAddress?: string;
}

const censusAddressMap: CensusTestAddress[] = [
  // CA: San Francisco City Hall → CA-11
  { match: (a) => a.includes('san francisco') || (a.includes('ca') && a.includes('94102')), cd: '11', geoid: '0611', state: '06', stusab: 'CA', blockGeoid: '060750201001001', countyGeoid: '06075', coordinates: { x: -122.4194, y: 37.7749 }, matchedAddress: '1 DR CARLTON B GOODLETT PL, SAN FRANCISCO, CA, 94102' },
  // TX: Austin City Hall → TX-21
  { match: (a) => a.includes('austin') || (a.includes('tx') && a.includes('78701')), cd: '21', geoid: '4821', state: '48', stusab: 'TX', countyGeoid: '48453', coordinates: { x: -97.7431, y: 30.2672 }, matchedAddress: '301 W 2ND ST, AUSTIN, TX, 78701' },
  // NY: NYC City Hall → NY-10
  { match: (a) => a.includes('new york') || a.includes('350 fifth') || a.includes('350 5th') || (a.includes('ny') && a.includes('10007')), cd: '10', geoid: '3610', state: '36', stusab: 'NY', blockGeoid: '360610076001234', countyGeoid: '36061', coordinates: { x: -74.0060, y: 40.7128 }, matchedAddress: 'CITY HALL, NEW YORK, NY, 10007' },
  // CO: Denver City Hall → CO-01
  { match: (a) => a.includes('denver') || (a.includes('co') && a.includes('80202')), cd: '01', geoid: '0801', state: '08', stusab: 'CO', countyGeoid: '08031', coordinates: { x: -104.9903, y: 39.7392 }, matchedAddress: '1437 BANNOCK ST, DENVER, CO, 80202' },
  // VT: At-large → VT-AL (CD119=00)
  { match: (a) => a.includes('richmond') && a.includes('vt') || (a.includes('vt') && a.includes('05401')), cd: '00', geoid: '5000', state: '50', stusab: 'VT', coordinates: { x: -72.5778, y: 44.2601 }, matchedAddress: '115 STATE ST, MONTPELIER, VT, 05602' },
  // IL: Springfield → IL-18
  { match: (a) => a.includes('springfield') && (a.includes('il') || a.includes('62704')), cd: '18', geoid: '1718', state: '17', stusab: 'IL', blockGeoid: '170010001001001', countyGeoid: '17001', coordinates: { x: -89.6501, y: 39.7817 }, matchedAddress: '123 MAIN ST, SPRINGFIELD, IL, 62704' },
  // DC: Pennsylvania Ave → DC delegate (CD119=98)
  { match: (a) => a.includes('pennsylvania') || a.includes('washington') && a.includes('dc') || (a.includes('dc') && a.includes('20500')), cd: '98', geoid: '1100', state: '11', stusab: 'DC', blockGeoid: '110010062001001', countyGeoid: '11001', coordinates: { x: -77.0369, y: 38.8977 }, matchedAddress: '1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500' },
  // PR: San Juan → PR delegate (CD119=98)
  { match: (a) => a.includes('san juan') || a.includes('puerto rico') || (a.includes('pr') && a.includes('00901')), cd: '98', geoid: '7200', state: '72', stusab: 'PR', blockGeoid: '720070065003001', countyGeoid: '72001', coordinates: { x: -66.1057, y: 18.4655 }, matchedAddress: '100 SAN JUAN ST, SAN JUAN, PR, 00901' },
  // VI: Charlotte Amalie → VI delegate (CD119=98)
  { match: (a) => a.includes('virgin islands') || a.includes('vi') && a.includes('00802'), cd: '98', geoid: '7800', state: '78', stusab: 'VI', coordinates: { x: -64.9307, y: 18.3358 }, matchedAddress: '100 MAIN ST, CHARLOTTE AMALIE, VI, 00802' },
  // GU: Hagatna → GU delegate (CD119=98)
  { match: (a) => a.includes('guam') || (a.includes('gu') && a.includes('96910')), cd: '98', geoid: '6600', state: '66', stusab: 'GU', coordinates: { x: 144.7937, y: 13.4443 }, matchedAddress: '100 HAGATNA ST, HAGATNA, GU, 96910' },
];

/** Build full Census Bureau response from a matched entry */
function buildCensusResponse(matched: CensusTestAddress, address: string) {
  return {
    result: {
      addressMatches: [
        {
          matchedAddress: matched.matchedAddress || address.toUpperCase(),
          coordinates: matched.coordinates || { x: -89.6501, y: 39.7817 },
          geographies: {
            '119th Congressional Districts': [
              { CD119: matched.cd, GEOID: matched.geoid, STATE: matched.state }
            ],
            'States': [
              { STUSAB: matched.stusab || FIPS_TO_STUSAB[matched.state] || matched.state }
            ],
            ...(matched.blockGeoid ? {
              '2020 Census Blocks': [
                { GEOID: matched.blockGeoid, STATE: matched.state }
              ]
            } : {}),
            ...(matched.countyGeoid ? {
              'Counties': [
                { GEOID: matched.countyGeoid }
              ]
            } : {})
          }
        }
      ]
    }
  };
}

export const censusAndCongressHandlers = [
  // Census Bureau Geocoding API — onelineaddress (used by resolve-address fallback)
  http.get('https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress', ({ request }) => {
    const url = new URL(request.url);
    const address = (url.searchParams.get('address') || '').toLowerCase();
    const matched = censusAddressMap.find((entry) => entry.match(address));

    if (matched) return HttpResponse.json(buildCensusResponse(matched, address));
    return HttpResponse.json({ result: { addressMatches: [] } });
  }),

  // Census Bureau Geocoding API — structured address (used by resolve-address endpoint)
  http.get('https://geocoding.geo.census.gov/geocoder/geographies/address', ({ request }) => {
    const url = new URL(request.url);
    const street = (url.searchParams.get('street') || '').toLowerCase();
    const city = (url.searchParams.get('city') || '').toLowerCase();
    const state = (url.searchParams.get('state') || '').toLowerCase();
    const zip = (url.searchParams.get('zip') || '').toLowerCase();

    // Combine fields for matching (same as onelineaddress but structured)
    const combined = `${street} ${city} ${state} ${zip}`;
    const matched = censusAddressMap.find((entry) => entry.match(combined));

    if (matched) return HttpResponse.json(buildCensusResponse(matched, combined));
    return HttpResponse.json({ result: { addressMatches: [] } });
  }),

  // Congress.gov API - Representatives
  // Returns all current members for test states with correct districts
  http.get('https://api.congress.gov/v3/member', ({ request }) => {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '250', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    // All current members (119th Congress) matching test address expected districts
    const allMembers: Record<string, unknown>[] = [];

    // State members: 2 senators + House rep(s) per state
    const states: Array<{ name: string; abbr: string; districts: number[] }> = [
      { name: 'California', abbr: 'CA', districts: [11, 12] }, // SF=11, test mock=12
      { name: 'Texas', abbr: 'TX', districts: [21] },
      { name: 'New York', abbr: 'NY', districts: [10] },
      { name: 'Colorado', abbr: 'CO', districts: [1] },
      { name: 'Vermont', abbr: 'VT', districts: [] }, // At-large
    ];

    for (const state of states) {
      // 2 senators
      allMembers.push(
        {
          bioguideId: `${state.abbr}S001`,
          name: `Senator One (${state.name})`,
          partyName: 'Democratic',
          state: state.name,
          currentMember: true,
          terms: { item: [{ chamber: 'Senate', startYear: 2021 }] }
        },
        {
          bioguideId: `${state.abbr}S002`,
          name: `Senator Two (${state.name})`,
          partyName: 'Republican',
          state: state.name,
          currentMember: true,
          terms: { item: [{ chamber: 'Senate', startYear: 2019 }] }
        }
      );

      // House members
      if (state.districts.length === 0) {
        // At-large
        allMembers.push({
          bioguideId: `${state.abbr}H001`,
          name: `Representative (${state.name}-AL)`,
          partyName: 'Democratic',
          state: state.name,
          district: undefined,
          currentMember: true,
          terms: { item: [{ chamber: 'House of Representatives', startYear: 2023 }] }
        });
      } else {
        for (const dist of state.districts) {
          allMembers.push({
            bioguideId: `${state.abbr}H${String(dist).padStart(3, '0')}`,
            name: `Representative (${state.name}-${String(dist).padStart(2, '0')})`,
            partyName: 'Democratic',
            state: state.name,
            district: dist,
            currentMember: true,
            terms: { item: [{ chamber: 'House of Representatives', startYear: 2023 }] }
          });
        }
      }
    }

    // Territory delegates (no senators)
    const territories: Array<{ abbr: string; name: string }> = [
      { abbr: 'DC', name: 'Norton, Eleanor Holmes' },
      { abbr: 'PR', name: 'Hernández Rivera, Pablo José' },
      { abbr: 'VI', name: 'Plaskett, Stacey' },
      { abbr: 'GU', name: 'Moylan, James' },
    ];

    for (const t of territories) {
      allMembers.push({
        bioguideId: `${t.abbr}D001`,
        name: t.name,
        partyName: 'Democratic',
        state: t.abbr,
        district: undefined,
        currentMember: true,
        terms: { item: [{ chamber: 'House of Representatives', startYear: 2023 }] }
      });
    }

    // Apply pagination
    const paginatedMembers = allMembers.slice(offset, offset + limit);

    return HttpResponse.json({
      members: paginatedMembers,
      pagination: {
        count: paginatedMembers.length,
        next: offset + limit < allMembers.length ? `/v3/member?offset=${offset + limit}&limit=${limit}` : null
      }
    });
  }),

  // CWC Senate API (testing endpoint)
  http.post(/https:\/\/soapbox\.senate\.gov\/api\/testing-messages\/.*/, () => {
    return HttpResponse.json({
      messageId: `SEN-${Date.now()}`,
      status: 'submitted',
      timestamp: new Date().toISOString()
    });
  }),

  // CWC House API via proxy (expects XML in JSON envelope)
  http.post(/http:\/\/.*\/api\/house\/submit.*/, async ({ request }) => {
    const body = await request.json() as { xml?: string; jobId?: string };
    if (body.xml && body.xml.includes('<CWC')) {
      return HttpResponse.json({
        submissionId: body.jobId || 'house-mock-id',
        status: 'submitted'
      });
    }
    return HttpResponse.json(
      { error: 'Invalid request: missing XML payload', status: 'failed' },
      { status: 400 }
    );
  })
];

// Shadow Atlas API Mocks (localhost:3000 default in test environment)

export const shadowAtlasHandlers = [
  // District lookup (fire-and-forget from resolve-address endpoint)
  http.get('http://localhost:3000/v1/lookup', () => {
    return HttpResponse.json({
      districts: [{ code: 'CA-11', name: "California's 11th", type: 'congressional' }],
      cell_id: '060750201001'
    });
  }),

  // Health check
  http.get('http://localhost:3000/v1/health', () => {
    return HttpResponse.json({ status: 'ok' });
  }),

  // Address resolution (Shadow Atlas primary path — not deployed in test env)
  http.post('http://localhost:3000/v1/resolve-address', () => {
    return HttpResponse.json(
      { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Nominatim not deployed in test environment' } },
      { status: 503 }
    );
  }),

  // Location resolve (composite: district + officials)
  http.get('http://localhost:3000/v1/resolve', () => {
    return HttpResponse.json({ districts: [], cell_id: null });
  })
];

// Combine all handlers
export const externalServiceHandlers = [
  ...cwcHandlers,
  ...oauthHandlers,
  ...selfXyzHandlers,
  ...sqsHandlers,
  ...censusAndCongressHandlers,
  ...shadowAtlasHandlers
];

// Error scenario handlers for testing edge cases
export const errorHandlers = [
  // Network timeout simulation
  http.post('https://cwc-api.house.gov/timeout', () => {
    return new Promise(() => {}); // Never resolves - simulates timeout
  }),

  // Rate limiting
  http.post('https://cwc-api.house.gov/rate-limit', () => {
    return HttpResponse.json(
      { error: 'Rate limit exceeded', retry_after: 60 },
      { status: 429 }
    );
  }),

  // Server error
  http.post('https://cwc-api.house.gov/server-error', () => {
    return HttpResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  })
];

export { http, HttpResponse };