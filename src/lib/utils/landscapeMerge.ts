/**
 * Landscape Merge — Power Landscape
 *
 * Merges template decision-makers (from agent pipeline) with district officials
 * (from Shadow Atlas). Groups by functional role. Deduplicates by name normalization.
 *
 * Each member carries a `deliveryRoute` indicating how messages reach them:
 *   'cwc'        Congressional Write Campaign (CWC API via ZK proof pipeline)
 *   'email'      Direct email via mailto
 *   'form'       Web contact form (external link)
 *   'phone_only' Only phone available (display number)
 *   'recorded'   Position recorded but no direct delivery channel
 */

import type { RoleCategory, ProcessedDecisionMaker } from '$lib/types/template';

// ============================================================================
// Types
// ============================================================================

/** How a message can be delivered to this person */
export type DeliveryRoute = 'cwc' | 'email' | 'form' | 'phone_only' | 'recorded';

export interface LandscapeMember {
  id: string;
  name: string;
  title: string;
  organization: string;
  accountabilityOpener: string | null;
  roleCategory: RoleCategory;
  relevanceRank: number;
  publicActions: string[];
  source: 'template' | 'district';
  // Delivery routing
  deliveryRoute: DeliveryRoute;
  cwcEligible: boolean;
  email: string | null;
  contactFormUrl: string | null;
  websiteUrl: string | null;
  phone: string | null;
  bioguideId: string | null;
  cwcCode: string | null;
  chamber: 'house' | 'senate' | null;
  // Email provenance (from agent grounding pipeline)
  emailGrounded: boolean;
  emailSource: string | null;
  emailSourceTitle: string | null;
}

export interface RoleGroupData {
  category: RoleCategory;
  label: string;
  members: LandscapeMember[];
}

export interface MergedLandscape {
  roleGroups: RoleGroupData[];
  districtGroup: {
    label: string;
    members: LandscapeMember[];
  } | null;
  personalPrompt: string | null;
  totalCount: number;
}

// ============================================================================
// Constants
// ============================================================================

const ROLE_LABELS: Record<RoleCategory, string> = {
  votes: 'VOTE ON IT',
  executes: 'EXECUTE IT',
  shapes: 'SHAPE IT',
  funds: 'FUND IT',
  oversees: 'OVERSEE IT'
};

const ROLE_ORDER: RoleCategory[] = ['votes', 'executes', 'funds', 'oversees', 'shapes'];

// ============================================================================
// District official input type (from Shadow Atlas)
// ============================================================================

export interface DistrictOfficialInput {
  name: string;
  title: string;
  organization: string;
  bioguideId: string | null;
  cwcCode: string | null;
  chamber: 'house' | 'senate' | null;
  phone: string | null;
  contactFormUrl: string | null;
  websiteUrl: string | null;
  email?: string;
}

// ============================================================================
// Helpers
// ============================================================================

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\b(rep|sen|cong|hon|mr|mrs|ms|dr)\.?\s*/g, '').trim();
}

/** Determine how messages can reach this person */
function resolveDeliveryRoute(member: {
  cwcCode?: string | null;
  email?: string | null;
  contactFormUrl?: string | null;
  phone?: string | null;
}): DeliveryRoute {
  if (member.cwcCode) return 'cwc';
  if (member.email) return 'email';
  if (member.contactFormUrl) return 'form';
  if (member.phone) return 'phone_only';
  return 'recorded';
}

// ============================================================================
// Main Function
// ============================================================================

export function mergeLandscape(
  templateDMs: ProcessedDecisionMaker[],
  districtOfficials: DistrictOfficialInput[] = []
): MergedLandscape {
  const seen = new Set<string>();
  const roleGroupMap = new Map<RoleCategory, LandscapeMember[]>();
  const districtMembers: LandscapeMember[] = [];

  let personalPrompt: string | null = null;
  for (const dm of templateDMs) {
    if (dm.personalPrompt) {
      personalPrompt = dm.personalPrompt;
      break;
    }
  }

  // Process template DMs first (higher priority)
  for (const dm of templateDMs) {
    const normalized = normalizeName(dm.name);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const category = dm.roleCategory || 'shapes';
    const member: LandscapeMember = {
      id: slugify(dm.name),
      name: dm.name,
      title: dm.title,
      organization: dm.organization,
      email: dm.email || null,
      accountabilityOpener: dm.accountabilityOpener || null,
      roleCategory: category,
      relevanceRank: dm.relevanceRank || 99,
      publicActions: dm.publicActions || [],
      source: 'template',
      deliveryRoute: resolveDeliveryRoute({ email: dm.email }),
      cwcEligible: false,
      contactFormUrl: null,
      websiteUrl: null,
      phone: null,
      bioguideId: null,
      cwcCode: null,
      chamber: null,
      emailGrounded: dm.emailGrounded ?? false,
      emailSource: dm.emailSource || null,
      emailSourceTitle: dm.emailSourceTitle || null
    };

    if (!roleGroupMap.has(category)) {
      roleGroupMap.set(category, []);
    }
    roleGroupMap.get(category)!.push(member);
  }

  // Process district officials (lower priority, deduped against template)
  for (const official of districtOfficials) {
    const normalized = normalizeName(official.name);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const deliveryRoute = resolveDeliveryRoute({
      cwcCode: official.cwcCode,
      email: official.email,
      contactFormUrl: official.contactFormUrl,
      phone: official.phone
    });

    districtMembers.push({
      id: slugify(official.name),
      name: official.name,
      title: official.title,
      organization: official.organization,
      email: official.email || null,
      accountabilityOpener: null,
      roleCategory: 'votes',
      relevanceRank: 50,
      publicActions: [],
      source: 'district',
      deliveryRoute,
      cwcEligible: !!official.cwcCode,
      contactFormUrl: official.contactFormUrl ?? null,
      websiteUrl: official.websiteUrl ?? null,
      phone: official.phone ?? null,
      bioguideId: official.bioguideId ?? null,
      cwcCode: official.cwcCode ?? null,
      chamber: official.chamber ?? null,
      emailGrounded: false,
      emailSource: null,
      emailSourceTitle: null
    });
  }

  const roleGroups: RoleGroupData[] = ROLE_ORDER
    .filter(cat => roleGroupMap.has(cat))
    .map(cat => ({
      category: cat,
      label: ROLE_LABELS[cat],
      members: roleGroupMap.get(cat)!.sort((a, b) => a.relevanceRank - b.relevanceRank)
    }));

  const districtGroup = districtMembers.length > 0
    ? { label: 'YOUR REPRESENTATIVES', members: districtMembers }
    : null;

  const totalCount = roleGroups.reduce((sum, g) => sum + g.members.length, 0) + districtMembers.length;

  return { roleGroups, districtGroup, personalPrompt, totalCount };
}
