import type { AppDatasetRowBase } from './mi';

/** The six field types a `custom_field` can have. There is no single-line text. */
export type FieldType = 'single' | 'multi' | 'textarea' | 'email' | 'date' | 'users';

/**
 * One question, as Custom Script A returns it.
 *
 * The script joins two endpoints because neither alone is sufficient:
 *
 * - `GET /api/custom_field_value?element=N` says *which* questions apply to
 *   this asset — it is the only endpoint that applies both the `used_for_*`
 *   scoping and `checkVisibility()`, so asset-driven `custom_field_rule`
 *   conditions are already resolved in its output. It needs view access on the
 *   element, which the requester lacks; hence the service-account script.
 * - `GET /api/custom_field` supplies `description` (help text) and the option
 *   list for pick-list fields.
 *
 * Neither exposes `field_type`, and `custom_field` has no `required_ind` at
 * all. Both come from the `questionMap` dataset — see `domain/question-map.ts`.
 */
export interface ResolvedQuestion {
  cf_id: number;
  cfs_id: number;
  /** Section display name — one wizard step per section. */
  section: string;
  /** The question label (`custom_field.name`, ≤100 chars, unique). */
  title: string;
  /** Helper text (`custom_field.description`, ≤1000 chars). */
  description?: string;
  /** Option list from `custom_field_value`. Present only for pick lists. */
  options?: string[];
  /** Index of the section in authored order (`custom_field_section.seq`). */
  section_seq: number;
  /** Index of the question within its section, in authored order. */
  field_seq: number;
  /** The element-level value, when the field carries one. Policy fields do. */
  value?: string | string[] | null;
}

/** Custom Script A's payload. */
export interface ResolveQuestionsResult {
  element_id: number;
  segment_value_id: number;
  questions: ResolvedQuestion[];
  /** Non-fatal problems the script wants surfaced (e.g. a partial join). */
  warnings?: string[];
}

/**
 * One row of the `questionMap` Dataset.
 *
 * This is the companion to `custom_field_rule`, carrying exactly the three
 * things Custom Fields cannot express:
 *
 * 1. **Respondent-driven branching.** A `custom_field_rule` antecedent must be
 *    a value stored *on the asset*, so MI can express "hide question B unless
 *    attribute A of this asset is X" but not "reveal question B because of the
 *    answer the user just gave". The rules are also not exposed over REST, so
 *    the App cannot evaluate the native graph itself.
 * 2. **Required-ness.** `custom_field` has no `required_ind`.
 * 3. **Field type.** No REST endpoint returns `custom_field.field_type`.
 *
 * Every column is optional except `question_key`, so an administrator only
 * writes the rows they need. A question absent from the map renders with
 * inferred defaults and no branching.
 */
export interface QuestionMapRow {
  /** Matches `custom_field.name`, i.e. `ResolvedQuestion.title`. */
  question_key: string;
  /** Overrides the inferred field type. */
  field_type?: string | null;
  /** `Y` makes the question required before its step can be left. */
  required?: string | null;
  /** Show this question only when `applies_when_question_key` has this value. */
  applies_when_question_key?: string | null;
  /** Comma-separated: the question shows if the antecedent matches any value. */
  applies_when_value?: string | null;
  /** Overrides authored order within the step. Lower sorts first. */
  seq?: number | string | null;
  /** Overrides `custom_field.description` as helper text. */
  help_text?: string | null;
  [key: string]: unknown;
}

/** A question after the map has been applied and its visibility evaluated. */
export interface Question extends ResolvedQuestion {
  field_type: FieldType;
  required: boolean;
  help_text?: string;
  /** The question this one branches from, if any. */
  applies_when?: { question_key: string; values: string[] };
  /** Effective sort order within the step. */
  order: number;
}

/** One wizard step — a `custom_field_section`. */
export interface QuestionStep {
  cfs_id: number;
  section: string;
  seq: number;
  questions: Question[];
}

/** An in-flight answer. `multi` and `users` hold arrays; everything else a string. */
export type AnswerValue = string | string[];

export type AnswerMap = Record<string, AnswerValue>;

/** The asset a request is about, resolved from `element_info`. */
export interface RequestSubject {
  element_id: number;
  segment_value_id: number;
  name: string;
}

/* -------------------------------------------------------------------------- */
/* App Dataset row shapes                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A row of the `requests` App Dataset — one per submitted request.
 *
 * `status` carries the destination approval portal's vocabulary, not MI's.
 * `destination_ref` is written back by Custom Script B once the portal returns
 * a ticket id.
 */
export interface RequestRow extends AppDatasetRowBase {
  request_id: string;
  /** Idempotency key generated by the App; Script B checks it before ticketing. */
  client_request_uid: string;
  element_id: number;
  segment_value_id: number;
  element_name: string;
  requester_type: string;
  submitted_time: string;
  tier: string;
  domain: string;
  risk_classification: string;
  approval_route: string;
  destination: string;
  destination_ref: string;
  status: string;
  /** Flipped by Script B so per-row notification dedupe is possible. */
  notified_ind: string;
  expires_on: string;
}

/**
 * A row of the `answers` App Dataset — one per answered question.
 *
 * Normalised rather than a JSON blob because MI cannot query JSON inside a
 * dataset column: derived fields are restricted to a numeric-only function
 * allow-list and dataset filters have no JSON operators. Rows are filterable,
 * groupable, chartable and alertable; a blob is `LIKE '%…%'`.
 *
 * The `{ section, title, value }` triple is deliberately the same shape
 * `PUT /api/custom_field_value` consumes, so a submission is replayable into
 * the custom-field API unchanged.
 */
export interface AnswerRow extends AppDatasetRowBase {
  request_id: string;
  element_id: number;
  segment_value_id: number;
  user_id: number;
  username: string;
  cf_id: number;
  cfs_id: number;
  section: string;
  title: string;
  answer_value: string;
  parent_cf_id: number;
  seq: number;
  submitted_time: string;
}

/** Questionnaire state persisted between steps, keyed by element id. */
export interface DraftPayload {
  answers: Record<string, AnswerMap>;
  updated_at: string;
}

export interface DraftRow extends AppDatasetRowBase {
  draft_key: string;
  payload: string;
  updated_at: string;
}
