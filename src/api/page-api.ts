import { ENTITY, PAGE_DATA_BASE } from '../config';
import { MiError, request, type QueryParams } from './http';
import type {
  AppDatasetInsertResponse,
  AppDatasetListResponse,
  AuthInfoResponse,
  DatasetEntityResponse,
  UserIdentity,
} from '../types/mi';
import type { QuestionMapRow, ResolveQuestionsResult } from '../types/app';

const entityUrl = (name: string) => `${PAGE_DATA_BASE}/${name}`;

/* -------------------------------------------------------------------------- */
/* Identity                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The caller's session identity, including MI Group membership and user
 * Custom Attributes.
 *
 * Any logged-in user may call this; `/api/user` is admin-only. Groups and
 * attributes are what let the App pre-fill *Requester Type* instead of asking
 * the requester to self-declare a persona.
 */
export async function fetchAuthInfo(signal?: AbortSignal): Promise<UserIdentity> {
  const response = await request<AuthInfoResponse>(`${PAGE_DATA_BASE}/auth/info`, { signal });

  return response.user;
}

/* -------------------------------------------------------------------------- */
/* Custom Script entities                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Sentinel wrapping the JSON a Custom Script returns.
 *
 * A Custom Script's output is the `innerHTML` of a single `<div>` that
 * `cs.result()` appends to, and `PageDataController` echoes it back raw — no
 * JSON envelope. Two things follow: the payload arrives HTML-entity-encoded,
 * and it arrives mixed in with anything `cs.log()` wrote, because `log()` also
 * appends to that div.
 *
 * Base64 inside a sentinel sidesteps both. Base64's alphabet contains no
 * character `innerHTML` escapes, so the payload survives byte-for-byte, and
 * the sentinel lets the App find it regardless of surrounding log noise.
 */
const RESULT_PATTERN = /@@MIJSON@@([A-Za-z0-9+/=]*)@@ENDJSON@@/;

/** Decodes base64 to a string, treating the bytes as UTF-8. */
function decodeBase64Utf8(encoded: string): string {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

  return new TextDecoder().decode(bytes);
}

/**
 * Extracts a Custom Script's JSON payload from its raw HTML output.
 *
 * Exported so the failure path can be tested and so the questionnaire screen
 * can show the script's own log output when the sentinel is missing — which is
 * what a syntax error, a timeout, or a disabled `CUSTOM_SCRIPT_ENABLED` looks
 * like from here.
 */
export function parseCustomScriptResult<T>(rawOutput: string): T {
  const match = RESULT_PATTERN.exec(rawOutput);

  if (!match) {
    const plain = rawOutput
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    throw new MiError(
      502,
      'custom-script',
      plain
        ? `The Custom Script returned no result. Its output was: ${plain.slice(0, 400)}`
        : 'The Custom Script returned no output. Check that CUSTOM_SCRIPT_ENABLED is Y and that ' +
            'the script is assigned to the App Entity.',
      rawOutput,
    );
  }

  return JSON.parse(decodeBase64Utf8(match[1])) as T;
}

/**
 * Custom Script A — resolve the question set for an asset.
 *
 * The requester cannot call `/api/custom_field_value` themselves: it requires
 * view access on the element, which is precisely what they are asking for. The
 * script calls it as its service account and returns the resolved,
 * rule-filtered set.
 *
 * Keep this read-only and fast. The Custom Script runner closes a run if 30
 * seconds pass since its last *successful* MI API call, so the nominal one
 * hour timeout is not the real ceiling, and every script shares a single
 * headless Chromium with the email digest and image export.
 */
export async function resolveQuestions(
  elementId: number,
  segmentValueId = 0,
  signal?: AbortSignal,
): Promise<ResolveQuestionsResult> {
  const raw = await request<string>(entityUrl(ENTITY.resolveQuestions), {
    query: { req: { element_id: elementId, segment_value_id: segmentValueId } },
    raw: true,
    signal,
  });

  return parseCustomScriptResult<ResolveQuestionsResult>(raw);
}

/* -------------------------------------------------------------------------- */
/* Dataset entities (read-only)                                                */
/* -------------------------------------------------------------------------- */

/**
 * The `questionMap` Dataset: respondent-driven branching, required flags and
 * field types, all admin-editable without a rebuild.
 */
export async function fetchQuestionMap(signal?: AbortSignal): Promise<QuestionMapRow[]> {
  const response = await request<DatasetEntityResponse<QuestionMapRow>>(entityUrl(ENTITY.questionMap), { signal });

  return response.data ?? [];
}

/* -------------------------------------------------------------------------- */
/* App Dataset entities (read / insert / update)                               */
/* -------------------------------------------------------------------------- */

/**
 * Read rows from an App Dataset entity.
 *
 * MI scopes the result by the entity's `access_type` before any filter here is
 * applied: `private` returns only rows the caller owns, and `managed` returns
 * rows the caller owns plus rows explicitly shared with them or their groups.
 * So this never needs — and must never rely on — a client-supplied owner
 * filter.
 *
 * Filters are `filters[column]=value` for equality, or
 * `filters[column][gte]=value` for a comparison (`eq`, `ne`, `gt`, `gte`,
 * `lt`, `lte`).
 */
export async function fetchAppDatasetRows<Row>(
  entityName: string,
  options: { filters?: Record<string, string | number>; limit?: number; offset?: number } = {},
  signal?: AbortSignal,
): Promise<{ rows: Row[]; count: number }> {
  const query: QueryParams = {};

  if (options.filters) {
    query.filters = options.filters;
  }

  if (options.limit) {
    query.limit = options.limit;
  }

  if (options.offset) {
    query.offset = options.offset;
  }

  const response = await request<AppDatasetListResponse<Row>>(entityUrl(entityName), {
    query,
    signal,
  });

  return { rows: response.data ?? [], count: Number(response.count ?? 0) };
}

/**
 * Insert rows into an App Dataset entity.
 *
 * MI stamps `owner_user_id` from `Em::guard()->getUserID()` — the session,
 * never request input — so the row's attribution is unforgeable by the
 * browser. For a `managed` entity MI also generates the row `id` and grants
 * the submitting user edit access to it.
 *
 * Beware the column-widening bug: an App Dataset text column takes its width
 * from the first value written to it and never grows afterwards, because the
 * widen branch compares the new length against itself. Pre-size wide columns
 * (`answer_value`, `payload`) in the Dataset column editor, where growing a
 * column does trigger a live DDL sync.
 */
export async function insertAppDatasetRows<Row extends object>(entityName: string, rows: Row[]): Promise<string[]> {
  if (rows.length === 0) {
    return [];
  }

  const response = await request<AppDatasetInsertResponse>(entityUrl(entityName), {
    method: 'POST',
    body: rows,
  });

  return response.ids ?? [];
}

/**
 * Update one App Dataset row by its `id`.
 *
 * MI re-applies the entity's ownership filter to the `where` clause, so a
 * caller can only ever update rows they own or have been granted edit access
 * to.
 */
export async function updateAppDatasetRow(
  entityName: string,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  await request(entityUrl(entityName), {
    method: 'PUT',
    query: { id },
    body: { data },
  });
}

/* -------------------------------------------------------------------------- */
/* Key/value entity (internal, is_app_dataset_ind='N') — draft state           */
/* -------------------------------------------------------------------------- */

/**
 * Read the caller's draft.
 *
 * `drafts` is a plain internal entity rather than an App Dataset: it stores a
 * JSON blob per key in `portal_page_entity_data`, which is upsert-only with no
 * history — exactly right for scratch state and exactly wrong for the answer
 * ledger. With `access_type='private'` MI filters on `owner_user_id`, so one
 * key per user is safe even though the key itself is not namespaced.
 *
 * Returns `null` when no draft exists yet.
 */
export async function fetchDraft<T>(key: string, signal?: AbortSignal): Promise<T | null> {
  const response = await request<{ data?: { id: string; value: T } }>(entityUrl(ENTITY.drafts), {
    query: { id: key },
    signal,
  });

  return response.data?.value ?? null;
}

/**
 * Write the caller's draft.
 *
 * The insert path is a bare `INSERT` with no unique constraint behind it, so
 * POSTing the same key twice silently creates a duplicate row. Update first
 * and fall back to insert only on MI's 404, which is the one ordering that
 * cannot duplicate.
 */
export async function saveDraft<T>(key: string, value: T): Promise<void> {
  try {
    await request(entityUrl(ENTITY.drafts), {
      method: 'PUT',
      query: { id: key },
      body: value,
    });

    return;
  } catch (error) {
    const notFound = error instanceof MiError && error.status === 404;

    if (!notFound) {
      throw error;
    }
  }

  await request(entityUrl(ENTITY.drafts), {
    method: 'POST',
    body: { id: key, value },
  });
}
