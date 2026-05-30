// ---- Envelope & pagination ----

export interface PaginationMeta {
  cursor: string | null;
  hasMore: boolean;
  total: number;
}

export interface ApiEnvelope<T> {
  data: T;
  meta?: PaginationMeta;
}

export interface ApiErrorBody {
  data: null;
  error: {
    code: string;
    message: string;
  };
}

// ---- Supporters ----

export interface Supporter {
  id: string;
  email: string;
  name: string | null;
  postalCode: string | null;
  country: string | null;
  phone: string | null;
  verified: boolean;
  emailStatus: string;
  source: string;
  customFields: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  tags: { id: string; name: string }[];
}

export interface CreateSupporterInput {
  email: string;
  name?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  source?: string;
  customFields?: Record<string, unknown>;
  tags?: string[];
}

export interface UpdateSupporterInput {
  name?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  customFields?: Record<string, unknown>;
}

export interface ListSupportersParams {
  cursor?: string;
  limit?: number;
  email?: string;
  verified?: boolean;
  email_status?: 'subscribed' | 'unsubscribed' | 'bounced' | 'complained';
  source?: 'csv' | 'action_network' | 'organic' | 'widget';
  tag?: string;
}

// ---- Campaigns ----

export interface Campaign {
  id: string;
  type: 'LETTER' | 'EVENT' | 'FORM';
  title: string;
  body: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETE';
  templateId: string | null;
  debateEnabled: boolean;
  debateThreshold: number | null;
  createdAt: string;
  updatedAt: string;
  counts: {
    actions: number;
    deliveries: number;
  };
}

export interface CampaignDetail {
  id: string;
  type: 'LETTER' | 'EVENT' | 'FORM';
  title: string;
  body: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETE';
  templateId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignFull {
  id: string;
  type: 'LETTER' | 'EVENT' | 'FORM';
  title: string;
  body: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETE';
  targets: Record<string, unknown> | null;
  templateId: string | null;
  debateEnabled: boolean;
  debateThreshold: number | null;
  createdAt: string;
  updatedAt: string;
  counts: {
    actions: number;
    deliveries: number;
  };
}

export interface CreateCampaignInput {
  title: string;
  type: 'LETTER' | 'EVENT' | 'FORM';
  body?: string;
  templateId?: string;
}

export interface UpdateCampaignInput {
  title?: string;
  body?: string;
  status?: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETE';
}

export interface ListCampaignsParams {
  cursor?: string;
  limit?: number;
  status?: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETE';
  type?: 'LETTER' | 'EVENT' | 'FORM';
}

// ---- Campaign actions ----

export interface CampaignAction {
  id: string;
  campaignId: string;
  supporterId: string | null;
  verified: boolean;
  engagementTier: number;
  districtHash: string | null;
  sentAt: string;
  createdAt: string;
}

export interface ListCampaignActionsParams {
  cursor?: string;
  limit?: number;
  verified?: boolean;
}

// ---- Tags ----

export interface Tag {
  id: string;
  name: string;
  supporterCount: number;
}

// ---- Usage ----

export interface Usage {
  verifiedActions: number;
  maxVerifiedActions: number;
  emailsSent: number;
  maxEmails: number;
}

// ---- Org ----

export interface OrgInfo {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  avatar: string | null;
  createdAt: string;
  counts: {
    supporters: number;
    campaigns: number;
    templates: number;
  };
}

// ---- API Keys ----

export interface ApiKeyCreated {
  id: string;
  key: string;
  prefix: string;
  name: string;
  scopes: string[];
  createdAt: string;
}

export interface CreateApiKeyInput {
  orgSlug: string;
  name?: string;
  scopes?: ('read' | 'write')[];
}

// ---- Events ----

export interface Event {
  id: string;
  title: string;
  description: string | null;
  eventType: 'IN_PERSON' | 'VIRTUAL' | 'HYBRID';
  startAt: string;
  endAt: string | null;
  timezone: string | null;
  venue: string | null;
  city: string | null;
  state: string | null;
  virtualUrl: string | null;
  capacity: number | null;
  status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';
  rsvpCount: number;
  attendeeCount: number;
  verifiedAttendees: number;
  campaignId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventDetail extends Event {
  address: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  waitlistEnabled: boolean;
  requireVerification: boolean;
}

export interface ListEventsParams {
  cursor?: string;
  limit?: number;
  status?: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';
  eventType?: 'IN_PERSON' | 'VIRTUAL' | 'HYBRID';
}

// ---- Donations ----

export interface Donation {
  id: string;
  campaignId: string | null;
  email: string;
  name: string | null;
  amountCents: number;
  currency: string;
  recurring: boolean;
  status: string;
  engagementTier: number;
  completedAt: string | null;
  createdAt: string;
}

export interface DonationDetail extends Donation {
  recurringInterval: string | null;
  districtHash: string | null;
  stripeSessionId: string | null;
}

export interface ListDonationsParams {
  cursor?: string;
  limit?: number;
  status?: 'pending' | 'completed' | 'refunded';
  campaignId?: string;
}

// ---- Workflows ----

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  trigger: string;
  stepCount: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowDetail extends Workflow {
  steps: unknown[];
}

export interface ListWorkflowsParams {
  cursor?: string;
  limit?: number;
  enabled?: boolean;
}

// ---- SMS ----

export interface SmsBlast {
  id: string;
  body: string;
  fromNumber: string;
  status: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  campaignId: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListSmsParams {
  cursor?: string;
  limit?: number;
  status?: string;
}

// ---- Calls ----

export interface PatchThroughCall {
  id: string;
  callerPhone: string;
  targetPhone: string;
  targetName: string | null;
  status: string;
  duration: number | null;
  twilioCallSid: string | null;
  campaignId: string | null;
  districtHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListCallsParams {
  cursor?: string;
  limit?: number;
  status?: string;
  campaignId?: string;
}

// ---- Networks ----

export interface Network {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: 'active' | 'suspended';
  ownerOrgId: string;
  memberCount: number;
  role: 'admin' | 'member';
  joinedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface NetworkMember {
  orgId: string;
  orgName: string;
  orgSlug: string;
  role: 'admin' | 'member';
  joinedAt: string;
}

export interface NetworkDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: 'active' | 'suspended';
  ownerOrgId: string;
  memberCount: number;
  ownerOrg: {
    id: string;
    name: string;
    slug: string;
  };
  members: NetworkMember[];
  createdAt: string;
  updatedAt: string;
}

export interface NetworkStats {
  memberCount: number;
  totalSupporters: number;
  uniqueSupporters: number;
  verifiedSupporters: number;
  totalCampaignActions: number;
  verifiedCampaignActions: number;
  stateDistribution: Record<string, number>;
}

export interface ListNetworksParams {
  cursor?: string;
  limit?: number;
}

// ---- Representatives ----

export interface Representative {
  id: string;
  countryCode: string;
  constituencyId: string | null;
  constituencyName: string | null;
  name: string;
  party: string | null;
  chamber: string | null;
  office: string | null;
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;
  photoUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListRepresentativesParams {
  cursor?: string;
  limit?: number;
  country?: string;
  constituency?: string;
}

// ---- Webhooks ----

export type WebhookEvent =
  | 'campaign_action.created'
  | 'campaign.updated'
  | 'supporter.created'
  | 'supporter.updated'
  | 'supporter.deleted'
  | 'donation.completed'
  | 'donation.refunded'
  | 'event.rsvp_created';

export interface Webhook {
  id: string;
  url: string;
  events: WebhookEvent[];
  enabled: boolean;
  description: string | null;
  createdAt: number;
  lastDeliveredAt: number | null;
  failureCount: number;
}

export interface WebhookCreated extends Webhook {
  signingSecret: string;
}

export interface WebhookSecretRotated {
  id: string;
  signingSecret: string;
}

export interface CreateWebhookInput {
  url: string;
  events: WebhookEvent[];
  description?: string;
}

export interface UpdateWebhookInput {
  url?: string;
  events?: WebhookEvent[];
  enabled?: boolean;
  description?: string;
}
