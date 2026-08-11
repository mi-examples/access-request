import { request } from './http';
import type { AccessRequestInfo, AccessRequestInfoResponse, RequestAccessResponse } from '../types/mi';

/**
 * Calls against MI's public REST API (`/api/*`).
 *
 * Only two are needed. Browsing and selecting content happens in Metric
 * Insights' own catalog — locked tiles, folders, Global Search and the Access
 * Denied card are all native and configuration-only — so this App reads one
 * asset's detail and files one request against it.
 *
 * Note that `element_info` and `custom_field_value` disagree about where the
 * element id goes, which is the usual cause of a 405: `element_info` takes it
 * as the `element` query parameter on the *collection* URL (`?id=` flips
 * dispatch to `getAction`, which is not implemented), while
 * `custom_field_value` accepts either `/id/{n}` or `?element=`.
 */

/**
 * The Access Denied detail card for an element the caller cannot open.
 *
 * `access_request_info=Y` only takes effect on the not-permitted branch. On the
 * permitted branch MI answers with `info` instead of `data`, and this returns
 * `null` — the App treats "you already have access" as a distinct outcome
 * rather than an error.
 *
 * Which metadata the card carries is administrator-configurable under Brand
 * Theme → Metadata Settings, and it reads the **Viewer** column — not the Info
 * Tooltip column, which is the usual reason a field that shows on a tile is
 * missing here.
 */
export async function fetchAccessRequestInfo(
  elementId: number,
  segmentValueId = 0,
  signal?: AbortSignal,
): Promise<AccessRequestInfo | null> {
  const response = await request<AccessRequestInfoResponse | { info: unknown }>('/api/element_info', {
    query: {
      element: elementId,
      dimension_value: segmentValueId,
      access_request_info: 'Y',
    },
    signal,
  });

  if (!('data' in response) || !response.data) {
    return null;
  }

  return response.data;
}

/**
 * File MI's own access request for the element.
 *
 * This is the second half of the identity attestation: the call is
 * session-authenticated, callable by a regular user, and writes
 * `user_access_request_log` + `user_access_request_tiles` with the
 * authenticated user and the element both resolved server-side. Nothing the
 * browser sends can claim to be somebody else.
 *
 * One element per call, which is also all MI's approval path can honour:
 * `setRequestStatus` fetches a single tile row, grants that one, then marks
 * every tile in the request accepted. A batched request would report success
 * for content it never granted.
 *
 * A 409 means the caller already has access — a benign race, not a failure.
 */
export async function submitNativeAccessRequest(
  elementId: number,
  segmentValueId = 0,
): Promise<{ ok: boolean; alreadyPermitted: boolean; message?: string }> {
  try {
    const response = await request<RequestAccessResponse>('/api/element_info', {
      method: 'PUT',
      form: {
        id: elementId,
        dimension_value: segmentValueId,
        call: 'request_access',
      },
    });

    return { ok: true, alreadyPermitted: false, message: response.message };
  } catch (error) {
    if (error instanceof Error && 'status' in error && (error as { status: number }).status === 409) {
      return { ok: true, alreadyPermitted: true };
    }

    throw error;
  }
}
