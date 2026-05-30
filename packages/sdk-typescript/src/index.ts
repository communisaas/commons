import { HttpClient } from './client.js';
import type { ClientOptions } from './client.js';
import { CursorPage } from './pagination.js';
import type {
  Supporter,
  CreateSupporterInput,
  UpdateSupporterInput,
  ListSupportersParams,
  Campaign,
  CampaignDetail,
  CampaignFull,
  CreateCampaignInput,
  UpdateCampaignInput,
  ListCampaignsParams,
  CampaignAction,
  ListCampaignActionsParams,
  Tag,
  Usage,
  OrgInfo,
  ApiKeyCreated,
  CreateApiKeyInput,
  Event,
  EventDetail,
  ListEventsParams,
  Donation,
  DonationDetail,
  ListDonationsParams,
  Workflow,
  WorkflowDetail,
  ListWorkflowsParams,
  SmsBlast,
  ListSmsParams,
  PatchThroughCall,
  ListCallsParams,
  Representative,
  ListRepresentativesParams,
  Network,
  NetworkDetail,
  NetworkStats,
  NetworkMember,
  ListNetworksParams,
  Webhook,
  WebhookCreated,
  WebhookSecretRotated,
  WebhookEvent,
  CreateWebhookInput,
  UpdateWebhookInput,
  PaginationMeta
} from './types.js';

// Re-export everything consumers need
export type {
  ClientOptions,
  Supporter,
  CreateSupporterInput,
  UpdateSupporterInput,
  ListSupportersParams,
  Campaign,
  CampaignDetail,
  CampaignFull,
  CreateCampaignInput,
  UpdateCampaignInput,
  ListCampaignsParams,
  CampaignAction,
  ListCampaignActionsParams,
  Tag,
  Usage,
  OrgInfo,
  ApiKeyCreated,
  CreateApiKeyInput,
  Event,
  EventDetail,
  ListEventsParams,
  Donation,
  DonationDetail,
  ListDonationsParams,
  Workflow,
  WorkflowDetail,
  ListWorkflowsParams,
  SmsBlast,
  ListSmsParams,
  PatchThroughCall,
  ListCallsParams,
  Representative,
  ListRepresentativesParams,
  Network,
  NetworkDetail,
  NetworkStats,
  NetworkMember,
  ListNetworksParams,
  Webhook,
  WebhookCreated,
  WebhookSecretRotated,
  WebhookEvent,
  CreateWebhookInput,
  UpdateWebhookInput,
  PaginationMeta
};
export { CursorPage } from './pagination.js';
export {
  CommonsError,
  AuthenticationError,
  ForbiddenError,
  NotFoundError,
  RateLimitError
} from './errors.js';

// ---- Resource classes ----

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildListQuery(params?: any): Record<string, string | number | boolean | undefined> {
  if (!params) return {};
  const query: Record<string, string | number | boolean | undefined> = {};
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (v !== undefined) {
      query[k] = v as string | number | boolean;
    }
  }
  return query;
}

function makePage<T>(
  client: HttpClient,
  path: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any,
  data: T[],
  meta: PaginationMeta
): CursorPage<T> {
  const baseQuery = buildListQuery(params);
  return new CursorPage<T>(data, meta, async (cursor) => {
    const res = await client.request<T[]>('GET', path, {
      query: { ...baseQuery, cursor: cursor ?? undefined }
    });
    return {
      data: res.data,
      meta: res.meta ?? { cursor: null, hasMore: false, total: 0 }
    };
  });
}

class OrgResource {
  constructor(private readonly _client: HttpClient) {}

  async get(): Promise<OrgInfo> {
    const { data } = await this._client.request<OrgInfo>('GET', '/orgs');
    return data;
  }
}

class SupporterResource {
  constructor(private readonly _client: HttpClient) {}

  async list(params?: ListSupportersParams): Promise<CursorPage<Supporter>> {
    const { data, meta } = await this._client.request<Supporter[]>('GET', '/supporters', {
      query: buildListQuery(params)
    });
    return makePage(this._client, '/supporters', params, data, meta ?? { cursor: null, hasMore: false, total: 0 });
  }

  async get(id: string): Promise<Supporter> {
    const { data } = await this._client.request<Supporter>('GET', `/supporters/${encodeURIComponent(id)}`);
    return data;
  }

  async create(input: CreateSupporterInput): Promise<Supporter> {
    const { data } = await this._client.request<Supporter>('POST', '/supporters', { body: input });
    return data;
  }

  async update(id: string, input: UpdateSupporterInput): Promise<{ id: string; updatedAt: string }> {
    const { data } = await this._client.request<{ id: string; updatedAt: string }>(
      'PATCH',
      `/supporters/${encodeURIComponent(id)}`,
      { body: input }
    );
    return data;
  }

  async delete(id: string): Promise<{ deleted: true }> {
    const { data } = await this._client.request<{ deleted: true }>(
      'DELETE',
      `/supporters/${encodeURIComponent(id)}`
    );
    return data;
  }
}

class CampaignResource {
  constructor(private readonly _client: HttpClient) {}

  async list(params?: ListCampaignsParams): Promise<CursorPage<Campaign>> {
    const { data, meta } = await this._client.request<Campaign[]>('GET', '/campaigns', {
      query: buildListQuery(params)
    });
    return makePage(this._client, '/campaigns', params, data, meta ?? { cursor: null, hasMore: false, total: 0 });
  }

  async get(id: string): Promise<CampaignFull> {
    const { data } = await this._client.request<CampaignFull>('GET', `/campaigns/${encodeURIComponent(id)}`);
    return data;
  }

  async create(input: CreateCampaignInput): Promise<CampaignDetail> {
    const { data } = await this._client.request<CampaignDetail>('POST', '/campaigns', { body: input });
    return data;
  }

  async update(id: string, input: UpdateCampaignInput): Promise<{ id: string; updatedAt: string }> {
    const { data } = await this._client.request<{ id: string; updatedAt: string }>(
      'PATCH',
      `/campaigns/${encodeURIComponent(id)}`,
      { body: input }
    );
    return data;
  }

  async actions(id: string, params?: ListCampaignActionsParams): Promise<CursorPage<CampaignAction>> {
    const path = `/campaigns/${encodeURIComponent(id)}/actions`;
    const { data, meta } = await this._client.request<CampaignAction[]>('GET', path, {
      query: buildListQuery(params)
    });
    return makePage(this._client, path, params, data, meta ?? { cursor: null, hasMore: false, total: 0 });
  }
}

class TagResource {
  constructor(private readonly _client: HttpClient) {}

  async list(): Promise<Tag[]> {
    const { data } = await this._client.request<Tag[]>('GET', '/tags');
    return data;
  }

  async create(name: string): Promise<{ id: string; name: string }> {
    const { data } = await this._client.request<{ id: string; name: string }>('POST', '/tags', {
      body: { name }
    });
    return data;
  }

  async update(id: string, name: string): Promise<{ id: string; name: string }> {
    const { data } = await this._client.request<{ id: string; name: string }>(
      'PATCH',
      `/tags/${encodeURIComponent(id)}`,
      { body: { name } }
    );
    return data;
  }

  async delete(id: string): Promise<{ deleted: true }> {
    const { data } = await this._client.request<{ deleted: true }>(
      'DELETE',
      `/tags/${encodeURIComponent(id)}`
    );
    return data;
  }
}

class EventResource {
  constructor(private readonly _client: HttpClient) {}

  async list(params?: ListEventsParams): Promise<CursorPage<Event>> {
    const { data, meta } = await this._client.request<Event[]>('GET', '/events', {
      query: buildListQuery(params)
    });
    return makePage(this._client, '/events', params, data, meta ?? { cursor: null, hasMore: false, total: 0 });
  }

  async get(id: string): Promise<EventDetail> {
    const { data } = await this._client.request<EventDetail>('GET', `/events/${encodeURIComponent(id)}`);
    return data;
  }
}

class DonationResource {
  constructor(private readonly _client: HttpClient) {}

  async list(params?: ListDonationsParams): Promise<CursorPage<Donation>> {
    const { data, meta } = await this._client.request<Donation[]>('GET', '/donations', {
      query: buildListQuery(params)
    });
    return makePage(this._client, '/donations', params, data, meta ?? { cursor: null, hasMore: false, total: 0 });
  }

  async get(id: string): Promise<DonationDetail> {
    const { data } = await this._client.request<DonationDetail>('GET', `/donations/${encodeURIComponent(id)}`);
    return data;
  }
}

class WorkflowResource {
  constructor(private readonly _client: HttpClient) {}

  async list(params?: ListWorkflowsParams): Promise<CursorPage<Workflow>> {
    const { data, meta } = await this._client.request<Workflow[]>('GET', '/workflows', {
      query: buildListQuery(params)
    });
    return makePage(this._client, '/workflows', params, data, meta ?? { cursor: null, hasMore: false, total: 0 });
  }

  async get(id: string): Promise<WorkflowDetail> {
    const { data } = await this._client.request<WorkflowDetail>('GET', `/workflows/${encodeURIComponent(id)}`);
    return data;
  }
}

class SmsResource {
  constructor(private readonly _client: HttpClient) {}

  async list(params?: ListSmsParams): Promise<CursorPage<SmsBlast>> {
    const { data, meta } = await this._client.request<SmsBlast[]>('GET', '/sms', {
      query: buildListQuery(params)
    });
    return makePage(this._client, '/sms', params, data, meta ?? { cursor: null, hasMore: false, total: 0 });
  }
}

class CallResource {
  constructor(private readonly _client: HttpClient) {}

  async list(params?: ListCallsParams): Promise<CursorPage<PatchThroughCall>> {
    const { data, meta } = await this._client.request<PatchThroughCall[]>('GET', '/calls', {
      query: buildListQuery(params)
    });
    return makePage(this._client, '/calls', params, data, meta ?? { cursor: null, hasMore: false, total: 0 });
  }
}

class NetworkResource {
  constructor(private readonly _client: HttpClient) {}

  async list(params?: ListNetworksParams): Promise<CursorPage<Network>> {
    const { data, meta } = await this._client.request<Network[]>('GET', '/networks', {
      query: buildListQuery(params)
    });
    return makePage(this._client, '/networks', params, data, meta ?? { cursor: null, hasMore: false, total: 0 });
  }

  async get(id: string): Promise<NetworkDetail> {
    const { data } = await this._client.request<NetworkDetail>('GET', `/networks/${encodeURIComponent(id)}`);
    return data;
  }

  async stats(id: string): Promise<NetworkStats> {
    const { data } = await this._client.request<NetworkStats>('GET', `/networks/${encodeURIComponent(id)}/stats`);
    return data;
  }
}

class RepresentativeResource {
  constructor(private readonly _client: HttpClient) {}

  async list(params?: ListRepresentativesParams): Promise<CursorPage<Representative>> {
    const { data, meta } = await this._client.request<Representative[]>('GET', '/representatives', {
      query: buildListQuery(params)
    });
    return makePage(this._client, '/representatives', params, data, meta ?? { cursor: null, hasMore: false, total: 0 });
  }
}

class UsageResource {
  constructor(private readonly _client: HttpClient) {}

  async get(): Promise<Usage> {
    const { data } = await this._client.request<Usage>('GET', '/usage');
    return data;
  }
}

class KeyResource {
  constructor(private readonly _client: HttpClient) {}

  async create(input: CreateApiKeyInput): Promise<ApiKeyCreated> {
    const { data } = await this._client.request<ApiKeyCreated>('POST', '/keys', { body: input });
    return data;
  }

  async rename(id: string, orgSlug: string, name: string): Promise<{ id: string; name: string }> {
    const { data } = await this._client.request<{ id: string; name: string }>(
      'PATCH',
      `/keys/${encodeURIComponent(id)}`,
      { query: { orgSlug }, body: { name } }
    );
    return data;
  }

  async revoke(id: string, orgSlug: string): Promise<{ revoked: true }> {
    const { data } = await this._client.request<{ revoked: true }>(
      'DELETE',
      `/keys/${encodeURIComponent(id)}`,
      { query: { orgSlug } }
    );
    return data;
  }
}

class WebhookResource {
  constructor(private readonly _client: HttpClient) {}

  async list(): Promise<Webhook[]> {
    const { data } = await this._client.request<Webhook[]>('GET', '/webhooks');
    return data;
  }

  async get(id: string): Promise<Webhook> {
    const { data } = await this._client.request<Webhook>('GET', `/webhooks/${encodeURIComponent(id)}`);
    return data;
  }

  async create(input: CreateWebhookInput): Promise<WebhookCreated> {
    const { data } = await this._client.request<WebhookCreated>('POST', '/webhooks', { body: input });
    return data;
  }

  async update(id: string, input: UpdateWebhookInput): Promise<Webhook> {
    const { data } = await this._client.request<Webhook>(
      'PATCH',
      `/webhooks/${encodeURIComponent(id)}`,
      { body: input }
    );
    return data;
  }

  async rotateSecret(id: string): Promise<WebhookSecretRotated> {
    const { data } = await this._client.request<WebhookSecretRotated>(
      'POST',
      `/webhooks/${encodeURIComponent(id)}/rotate-secret`
    );
    return data;
  }

  async delete(id: string): Promise<{ deleted: true }> {
    const { data } = await this._client.request<{ deleted: true }>(
      'DELETE',
      `/webhooks/${encodeURIComponent(id)}`
    );
    return data;
  }
}

// ---- Main client ----

export class Commons {
  readonly org: OrgResource;
  readonly supporters: SupporterResource;
  readonly campaigns: CampaignResource;
  readonly tags: TagResource;
  readonly events: EventResource;
  readonly donations: DonationResource;
  readonly workflows: WorkflowResource;
  readonly sms: SmsResource;
  readonly calls: CallResource;
  readonly representatives: RepresentativeResource;
  readonly networks: NetworkResource;
  readonly usage: UsageResource;
  readonly keys: KeyResource;
  readonly webhooks: WebhookResource;

  constructor(options: ClientOptions) {
    const client = new HttpClient(options);
    this.org = new OrgResource(client);
    this.supporters = new SupporterResource(client);
    this.campaigns = new CampaignResource(client);
    this.tags = new TagResource(client);
    this.events = new EventResource(client);
    this.donations = new DonationResource(client);
    this.workflows = new WorkflowResource(client);
    this.sms = new SmsResource(client);
    this.calls = new CallResource(client);
    this.representatives = new RepresentativeResource(client);
    this.networks = new NetworkResource(client);
    this.usage = new UsageResource(client);
    this.keys = new KeyResource(client);
    this.webhooks = new WebhookResource(client);
  }
}

/**
 * Verify a webhook signature.
 *
 * Reconstructs HMAC-SHA256(timestamp + "." + payload, signingSecret) and
 * constant-time compares it against the v1 component of the
 * `X-Commons-Signature-256` header (format: `t=<ts>,v1=<hex>`).
 *
 * If you have rotated secrets recently, pass both current and previous —
 * either is accepted within the rotation window.
 */
export async function verifyWebhookSignature(args: {
  payload: string;
  header: string;
  secrets: string[] | string;
  toleranceSeconds?: number;
}): Promise<boolean> {
  const tolerance = (args.toleranceSeconds ?? 300) * 1000;
  const parts = args.header.split(',').reduce<Record<string, string>>((acc, p) => {
    const [k, v] = p.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  const ts = Number(parts.t);
  const sig = parts.v1;
  if (!ts || !sig) return false;
  if (Math.abs(Date.now() - ts) > tolerance) return false;

  const secrets = Array.isArray(args.secrets) ? args.secrets : [args.secrets];
  const message = `${parts.t}.${args.payload}`;
  const enc = new TextEncoder();

  for (const secret of secrets) {
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const macBuf = await crypto.subtle.sign('HMAC', key, enc.encode(message));
    const mac = Array.from(new Uint8Array(macBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    if (constantTimeEqual(mac, sig)) return true;
  }
  return false;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
