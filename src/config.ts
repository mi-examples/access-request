/**
 * Static configuration for the App.
 *
 * A standalone App (`page_type='html'`, no `portal_page_template_id`) gets no
 * Page Template Variable substitution, so nothing here can come from
 * `window.PP_VARIABLES`. Anything an administrator needs to change without a
 * rebuild belongs in an App Entity instead — the question bank in Custom
 * Fields, the branching rules and required flags in the `questionMap` Dataset.
 */

/** The App's `internal_name`. Also its URL: `/p/access-request`. */
export const APP_SLUG = 'access-request';

/** Base path for every App Entity call. */
export const PAGE_DATA_BASE = `/data/page/${APP_SLUG}`;

/**
 * App Entity names, as created on the App's Entities tab.
 * `auth`, `access`, `user` and `group` are reserved by MI and cannot be used.
 */
export const ENTITY = {
  /** Custom Script A — resolves the applicable question set for an element. */
  resolveQuestions: 'resolveQuestions',
  /** Dataset — respondent-driven branching rules, field types, required flags. */
  questionMap: 'questionMap',
  /** App Dataset (`managed`) — one row per submitted request. */
  requests: 'requests',
  /** App Dataset (`managed`) — one row per answered question. */
  answers: 'answers',
  /** Internal entity (`private`) — in-progress questionnaire answers. */
  drafts: 'drafts',
} as const;

/**
 * How long a cached MI response stays fresh.
 *
 * `/p/`, `/pt/`, `/pl/` and `/data/page/*` share one 100 request/minute
 * throttle, so caching is a correctness concern here and not just a
 * performance one. Reference data that changes on an admin's timescale is held
 * far longer than per-request data.
 */
export const STALE_MS = {
  /** Session identity — stable for the life of the page. */
  session: Infinity,
  /** Per-asset detail card. */
  assetDetail: 5 * 60_000,
  /** Resolved question set — invokes a Custom Script, so cache it hard. */
  questions: 10 * 60_000,
  /** The question map dataset. */
  questionMap: 10 * 60_000,
  /** The caller's own submitted requests. */
  myRequests: 30_000,
} as const;

/**
 * Cap on concurrent in-flight requests to MI.
 *
 * The throttle is 100/minute across the whole `/p/` + `/data/page/*` surface,
 * and a Custom Script invocation occupies a PHP worker for its whole run.
 */
export const MAX_CONCURRENT_REQUESTS = 4;

/**
 * Status vocabulary written to the request header rows.
 *
 * **Placeholders — set these to the destination portal's own status strings**,
 * and keep `drainSubmissions.js` in step. The values below are a generic
 * lifecycle, not any particular portal's.
 *
 * The header row is authoritative, because MI's own `user_access_request_log`
 * only knows pending / accepted / rejected. MI's log stays underneath it as
 * the attestation record.
 *
 * `partiallyApproved` is worth keeping whatever the wording: an approval
 * process that can approve part of a request needs somewhere to say so, and
 * MI's own multi-tile representation cannot (it grants one tile and marks all
 * of them accepted).
 */
export const REQUEST_STATUS = {
  /** Written by the App at submit. Custom Script B drains this state. */
  pending: 'PENDING SUBMISSION',
  /** Written by Script B once the portal has accepted the request. */
  submitted: 'SUBMITTED',
  inReview: 'IN REVIEW',
  partiallyApproved: 'PARTIALLY APPROVED',
  approved: 'APPROVED',
  rejected: 'REJECTED',
  failed: 'SUBMISSION FAILED',
} as const;

export type RequestStatus = (typeof REQUEST_STATUS)[keyof typeof REQUEST_STATUS];

/**
 * Names of the Group A policy custom fields, as authored in MI.
 *
 * These are matched against the `title` returned by `element_info`'s
 * `accessData.custom_fields`, which is the field's display label. Matching is
 * case-insensitive and whitespace-tolerant (see `domain/policy.ts`), so an
 * administrator renaming a field's casing will not break the mapping — but a
 * genuine rename does need a change here.
 */
export const POLICY_FIELD = {
  dataDomain: 'Data Domain',
  riskClassification: 'Data Risk Classification',
  tier: 'Access Request Tier',
  accessType: 'Access Type',
  sourceSystem: 'Source System',
  assetType: 'Asset Type',
  tileType: 'Tile Type',
  dataSteward: 'Domain Data Steward',
  systemOwner: 'System / App Owner',
  approvalRoute: 'Approval Route',
  requiredControls: 'Required Controls',
  targetTurnaround: 'Target Turnaround',
  itAssessmentRequired: 'IT Assessment Required',
} as const;

/**
 * The question whose answer records the requester's persona.
 *
 * Pre-filled from `auth/info` and confirmed by the user rather than typed —
 * `visible_to='groups'` cannot carry persona, because it resolves against
 * whoever makes the call and admins bypass it entirely, and Custom Script A
 * calls as a service account.
 */
export const REQUESTER_TYPE_QUESTION = 'Requester Type';

/** The question pre-filled with the requester's own contact details. */
export const CONTACT_QUESTION = 'Contact Information';
