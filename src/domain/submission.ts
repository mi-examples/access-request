import { ENTITY, REQUEST_STATUS, REQUESTER_TYPE_QUESTION } from '../config';
import { insertAppDatasetRows } from '../api/page-api';
import { submitNativeAccessRequest } from '../api/mi-api';
import { normaliseKey } from './question-map';
import type { AssetPolicy } from './policy';
import type { UserIdentity } from '../types/mi';
import type {
  AnswerMap,
  AnswerRow,
  AnswerValue,
  Question,
  QuestionStep,
  RequestRow,
  RequestSubject,
} from '../types/app';

/**
 * Turning a completed questionnaire into rows MI has attested.
 *
 * Nothing here trusts the browser for identity. Two independent
 * session-authenticated writes carry the attestation:
 *
 * 1. **The App Dataset insert.** MI stamps `owner_user_id` from
 *    `Em::guard()->getUserID()` — the session, never request input — so a row
 *    cannot claim to belong to somebody else. The `user_id` / `username`
 *    columns written below are a denormalised convenience for reporting, and
 *    `owner_user_id` remains the authoritative one.
 * 2. **The native access request.** `PUT /api/element_info {call:
 *    'request_access'}` writes `user_access_request_log` with the
 *    authenticated user and the element both resolved server-side, so MI's own
 *    admin grid and digest see the request too.
 *
 * The Custom Script tier is deliberately not on this path. At 7.2.1 the
 * App→Custom Script call carries no user identity, so a script asked to write
 * the ledger would have to be trusted with an identity it cannot verify.
 * Keeping the write in the App means it never has to be.
 */

/** RFC 4122 v4, from the platform CSPRNG. */
function uuid(): string {
  // `crypto.randomUUID` needs a secure context; MI is served over HTTPS, but
  // a plain-HTTP development instance would not have it.
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);

  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** MI's `Y-m-d H:i:s`, in the browser's local time. */
export function miTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/**
 * Flattens an answer to the single string an `answer_value` column holds.
 *
 * A `multi` answer becomes a comma-joined string in one row rather than one
 * row per selected value, so that "one row per question asked" stays a true
 * statement and a reviewer reading the ledger sees the answer as the requester
 * gave it.
 */
export function serialiseAnswer(value: AnswerValue | undefined): string {
  if (value === undefined || value === null) {
    return '';
  }

  return Array.isArray(value) ? value.join(', ') : String(value);
}

export interface SubmissionInput {
  identity: UserIdentity;
  subject: RequestSubject;
  steps: QuestionStep[];
  answers: AnswerMap;
  policy: AssetPolicy;
}

export interface SubmissionResult {
  request_id: string;
  client_request_uid: string;
  element_id: number;
  element_name: string;
  answerRowCount: number;
  /** True when MI reported the caller already had access (HTTP 409). */
  alreadyPermitted: boolean;
  /**
   * Set when the answer ledger was written but MI's own request log was not.
   * The request is still real and Script B will still drain it; only MI's
   * internal digest and admin grid are missing it.
   */
  nativeRequestError?: string;
}

/** Builds the answer rows for one element's completed questionnaire. */
export function buildAnswerRows(input: SubmissionInput, requestId: string, submittedAt: string): AnswerRow[] {
  const { identity, subject, steps, answers } = input;
  const rows: AnswerRow[] = [];

  let seq = 0;

  for (const step of steps) {
    for (const question of step.questions) {
      const value = answers[question.title];

      if (value === undefined) {
        continue;
      }

      seq += 1;
      rows.push({
        request_id: requestId,
        element_id: subject.element_id,
        segment_value_id: subject.segment_value_id,
        user_id: Number(identity.user_id) || 0,
        username: identity.username ?? '',
        cf_id: question.cf_id,
        cfs_id: question.cfs_id,
        section: question.section,
        title: question.title,
        answer_value: serialiseAnswer(value),
        // The question this one branched from, so a reviewer can read a
        // follow-up in the context that produced it.
        parent_cf_id: parentCfId(question, steps),
        seq,
        submitted_time: submittedAt,
      });
    }
  }

  return rows;
}

function parentCfId(question: Question, steps: QuestionStep[]): number {
  if (!question.applies_when) {
    return 0;
  }

  const wanted = normaliseKey(question.applies_when.question_key);

  for (const step of steps) {
    for (const candidate of step.questions) {
      if (normaliseKey(candidate.title) === wanted) {
        return candidate.cf_id;
      }
    }
  }

  return 0;
}

function findAnswer(steps: QuestionStep[], answers: AnswerMap, label: string): string {
  const wanted = normaliseKey(label);

  for (const step of steps) {
    for (const question of step.questions) {
      if (normaliseKey(question.title) === wanted) {
        return serialiseAnswer(answers[question.title]);
      }
    }
  }

  return '';
}

/** Builds the request header row for one element. */
export function buildRequestRow(
  input: SubmissionInput,
  requestId: string,
  clientRequestUid: string,
  submittedAt: string,
): RequestRow {
  const { subject, policy, steps, answers } = input;

  return {
    request_id: requestId,
    client_request_uid: clientRequestUid,
    element_id: subject.element_id,
    segment_value_id: subject.segment_value_id,
    element_name: subject.name,
    requester_type: findAnswer(steps, answers, REQUESTER_TYPE_QUESTION),
    submitted_time: submittedAt,
    tier: policy.tier ?? '',
    domain: policy.domain ?? '',
    risk_classification: policy.riskClassification ?? '',
    approval_route: policy.approvalRoute ?? '',
    // Script B resolves the concrete destination from the approval route; the
    // column exists so a drain can record where it actually went.
    destination: policy.approvalRoute ?? '',
    destination_ref: '',
    status: REQUEST_STATUS.pending,
    notified_ind: 'N',
    // Tier 3 mandates time-bound access, but nothing in MI expires a grant.
    // The column records the intent; enforcing it would be a scheduled
    // revocation job, which is out of scope here.
    expires_on: '',
  };
}

/**
 * Submit one element's request.
 *
 * Order matters. The answer ledger is written first, because it is the record
 * the whole exercise exists to produce and the one Script B drains. MI's
 * native request is filed second and its failure is reported but not fatal:
 * losing MI's internal digest is a smaller harm than losing the answers, and
 * a request that exists in the ledger can always be reconciled.
 */
export async function submitRequest(input: SubmissionInput): Promise<SubmissionResult> {
  const requestId = uuid();
  const clientRequestUid = uuid();
  const submittedAt = miTimestamp();

  const answerRows = buildAnswerRows(input, requestId, submittedAt);
  const requestRow = buildRequestRow(input, requestId, clientRequestUid, submittedAt);

  if (answerRows.length > 0) {
    await insertAppDatasetRows(ENTITY.answers, answerRows);
  }

  await insertAppDatasetRows(ENTITY.requests, [requestRow]);

  let alreadyPermitted = false;
  let nativeRequestError: string | undefined;

  try {
    const native = await submitNativeAccessRequest(input.subject.element_id, input.subject.segment_value_id);

    alreadyPermitted = native.alreadyPermitted;
  } catch (error) {
    nativeRequestError = error instanceof Error ? error.message : String(error);
  }

  return {
    request_id: requestId,
    client_request_uid: clientRequestUid,
    element_id: input.subject.element_id,
    element_name: input.subject.name,
    answerRowCount: answerRows.length,
    alreadyPermitted,
    nativeRequestError,
  };
}
