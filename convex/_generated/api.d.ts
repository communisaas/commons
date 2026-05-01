/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as _authHelpers from "../_authHelpers.js";
import type * as _credentialSelect from "../_credentialSelect.js";
import type * as _cwcXml from "../_cwcXml.js";
import type * as _downgradeGuard from "../_downgradeGuard.js";
import type * as _orgHash from "../_orgHash.js";
import type * as _orgKey from "../_orgKey.js";
import type * as _orgKeyUnseal from "../_orgKeyUnseal.js";
import type * as _rateLimit from "../_rateLimit.js";
import type * as analytics from "../analytics.js";
import type * as authOps from "../authOps.js";
import type * as backfill from "../backfill.js";
import type * as blastCleanup from "../blastCleanup.js";
import type * as blasts from "../blasts.js";
import type * as calls from "../calls.js";
import type * as campaigns from "../campaigns.js";
import type * as crons from "../crons.js";
import type * as cutover from "../cutover.js";
import type * as debates from "../debates.js";
import type * as delegation from "../delegation.js";
import type * as donations from "../donations.js";
import type * as email from "../email.js";
import type * as events from "../events.js";
import type * as http from "../http.js";
import type * as intelligence from "../intelligence.js";
import type * as invites from "../invites.js";
import type * as legislation from "../legislation.js";
import type * as messageJobs from "../messageJobs.js";
import type * as networks from "../networks.js";
import type * as organizations from "../organizations.js";
import type * as positions from "../positions.js";
import type * as resolvedContacts from "../resolvedContacts.js";
import type * as revocations from "../revocations.js";
import type * as seed from "../seed.js";
import type * as seedData from "../seedData.js";
import type * as segments from "../segments.js";
import type * as sms from "../sms.js";
import type * as submissions from "../submissions.js";
import type * as subscriptions from "../subscriptions.js";
import type * as supporters from "../supporters.js";
import type * as templatePage from "../templatePage.js";
import type * as templates from "../templates.js";
import type * as users from "../users.js";
import type * as v1api from "../v1api.js";
import type * as verify from "../verify.js";
import type * as waitlist from "../waitlist.js";
import type * as webhooks from "../webhooks.js";
import type * as workflows from "../workflows.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  _authHelpers: typeof _authHelpers;
  _credentialSelect: typeof _credentialSelect;
  _cwcXml: typeof _cwcXml;
  _downgradeGuard: typeof _downgradeGuard;
  _orgHash: typeof _orgHash;
  _orgKey: typeof _orgKey;
  _orgKeyUnseal: typeof _orgKeyUnseal;
  _rateLimit: typeof _rateLimit;
  analytics: typeof analytics;
  authOps: typeof authOps;
  backfill: typeof backfill;
  blastCleanup: typeof blastCleanup;
  blasts: typeof blasts;
  calls: typeof calls;
  campaigns: typeof campaigns;
  crons: typeof crons;
  cutover: typeof cutover;
  debates: typeof debates;
  delegation: typeof delegation;
  donations: typeof donations;
  email: typeof email;
  events: typeof events;
  http: typeof http;
  intelligence: typeof intelligence;
  invites: typeof invites;
  legislation: typeof legislation;
  messageJobs: typeof messageJobs;
  networks: typeof networks;
  organizations: typeof organizations;
  positions: typeof positions;
  resolvedContacts: typeof resolvedContacts;
  revocations: typeof revocations;
  seed: typeof seed;
  seedData: typeof seedData;
  segments: typeof segments;
  sms: typeof sms;
  submissions: typeof submissions;
  subscriptions: typeof subscriptions;
  supporters: typeof supporters;
  templatePage: typeof templatePage;
  templates: typeof templates;
  users: typeof users;
  v1api: typeof v1api;
  verify: typeof verify;
  waitlist: typeof waitlist;
  webhooks: typeof webhooks;
  workflows: typeof workflows;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
