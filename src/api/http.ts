import { MAX_CONCURRENT_REQUESTS } from '../config';

/**
 * A failed MI call, carrying enough detail to tell the four failure modes
 * apart: an application 405 (wrong URL/verb combination), a 403 (no access),
 * a 412 (session expired) and a 429 (throttled).
 */
export class MiError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'MiError';
  }

  /** MI returns 412 from `/data/page/*` when the session has gone. */
  get isSessionExpired(): boolean {
    return this.status === 412;
  }

  get isForbidden(): boolean {
    return this.status === 403 || this.status === 401;
  }

  /** `/p/` and `/data/page/*` share one 100 request/minute throttle. */
  get isThrottled(): boolean {
    return this.status === 429;
  }
}

/**
 * A small concurrency gate in front of every MI call.
 *
 * MI throttles `/p/`, `/pt/`, `/pl/` and `/data/page/*` together at 100
 * requests per minute, and a Custom Script invocation pins a PHP worker for
 * its whole run. Serialising past a low water mark keeps a screen that fans
 * out several reads from spending the minute's budget at once.
 */
let inFlight = 0;
const waiting: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (inFlight < MAX_CONCURRENT_REQUESTS) {
    inFlight += 1;

    return;
  }

  await new Promise<void>((resolve) => waiting.push(resolve));
  inFlight += 1;
}

function release(): void {
  inFlight -= 1;
  waiting.shift()?.();
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Query parameters. Nested objects are serialised as `key[sub]=value`. */
  query?: QueryParams;
  /** Sent as a JSON body. */
  body?: unknown;
  /** Sent as `application/x-www-form-urlencoded`. */
  form?: Record<string, string | number>;
  signal?: AbortSignal;
  /** Parse the response as text rather than JSON (Custom Script output). */
  raw?: boolean;
}

export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue | Record<string, QueryValue>>;

/** Serialises `{ req: { element_id: 29 } }` to `req[element_id]=29`. */
export function buildQuery(params: QueryParams): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === 'object') {
      for (const [subKey, subValue] of Object.entries(value)) {
        if (subValue === undefined || subValue === null) {
          continue;
        }

        search.append(`${key}[${subKey}]`, String(subValue));
      }
    } else {
      search.append(key, String(value));
    }
  }

  return search.toString();
}

/**
 * Issue a request against the MI origin.
 *
 * The App is served from `/p/access-request` on MI's own origin, so the
 * browser's session cookie authenticates every call: no token, no CORS, and no
 * secret in the bundle. `credentials: 'same-origin'` is explicit rather than
 * relied upon.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', query, body, form, signal, raw = false } = options;

  const queryString = query ? buildQuery(query) : '';
  const url = queryString ? `${path}?${queryString}` : path;

  const headers: Record<string, string> = { Accept: raw ? 'text/html, */*' : 'application/json' };
  let payload: BodyInit | undefined;

  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(Object.entries(form).map(([key, value]) => [key, String(value)])).toString();
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  await acquire();
  let response: Response;

  try {
    response = await fetch(url, {
      method,
      headers,
      body: payload,
      signal,
      credentials: 'same-origin',
    });
  } finally {
    release();
  }

  const text = await response.text();

  if (raw) {
    if (!response.ok) {
      throw new MiError(response.status, url, describe(response, text), text);
    }

    return text as T;
  }

  let parsed: unknown;

  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // A JSON endpoint that returned HTML almost always means the session
    // expired and MI served the login page, or the URL missed `/api`.
    throw new MiError(response.status, url, 'MI returned a non-JSON response', text.slice(0, 500));
  }

  if (!response.ok) {
    throw new MiError(response.status, url, describe(response, parsed), parsed);
  }

  // Several MI controllers answer 200 with a non-zero `resultCode` in the body.
  const resultCode = (parsed as { resultCode?: number } | null)?.resultCode;

  if (typeof resultCode === 'number' && resultCode !== 0 && resultCode !== 200) {
    throw new MiError(resultCode, url, describe(response, parsed), parsed);
  }

  return parsed as T;
}

function describe(response: Response, body: unknown): string {
  const fromBody =
    body && typeof body === 'object' && 'message' in body ? String((body as { message?: unknown }).message ?? '') : '';

  if (fromBody) {
    return fromBody;
  }

  if (response.status === 405) {
    // MI's own controllers return 405 for verbs they do not implement, and the
    // `element_info` / `custom_field_value` endpoints disagree about whether
    // the id belongs in the path or the query string. A 405 with no `Allow`
    // header is an application 405, i.e. a wrong URL/verb combination.
    const allow = response.headers.get('Allow');

    return allow
      ? `405 Method Not Allowed (no route for this verb; Allow: ${allow})`
      : '405 Method Not Allowed from MI — wrong URL/verb combination for this endpoint';
  }

  return `${response.status} ${response.statusText || 'Request failed'}`;
}
