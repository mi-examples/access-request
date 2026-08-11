import { useMyRequests } from '../api/queries';
import { EmptyState, ErrorNotice, LoadingBlock, TierBadge } from '../components/primitives';

/**
 * Screen 6 — the requester's own history.
 *
 * The only way to answer "where is my request?" inside MI. MI's
 * `user_access_request_log` has no REST surface a requester can read: the
 * admin grid is admin-only and the digest is an email. Reading the App's own
 * `requests` dataset back is what closes that loop.
 *
 * No owner filter is applied here on purpose. The entity's
 * `access_type='managed'` means MI scopes the read to rows the caller owns
 * plus rows explicitly shared with them or their groups — so a reviewer
 * granted per-row access sees exactly what they were granted, and a client-side
 * filter would only be able to weaken that, never strengthen it.
 */
export function MyRequestsScreen() {
  const requests = useMyRequests();

  if (requests.isLoading) {
    return <LoadingBlock label="Loading your requests" rows={5} />;
  }

  if (requests.error) {
    return <ErrorNotice error={requests.error} context="Could not load your requests" />;
  }

  const rows = [...(requests.data ?? [])].sort((a, b) =>
    String(b.submitted_time ?? '').localeCompare(String(a.submitted_time ?? '')),
  );

  if (rows.length === 0) {
    return (
      <EmptyState title="You have not requested anything yet">
        <p className="muted">
          Find the content you need in Metric Insights and use its <strong>Request Access</strong> link.
        </p>
        <a className="button button--primary" href="/home">
          Browse the catalog
        </a>
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      <div className="row row--between">
        <h2>My requests</h2>
        <button type="button" className="button button--small" onClick={() => requests.refetch()}>
          Refresh
        </button>
      </div>

      <div className="card card--flush">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Content</th>
              <th scope="col">Submitted</th>
              <th scope="col">Tier</th>
              <th scope="col">Route</th>
              <th scope="col">Reference</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.request_id || row.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{row.element_name}</div>
                  {row.domain ? <div className="muted small">{row.domain}</div> : null}
                </td>
                <td className="small">{row.submitted_time}</td>
                <td>
                  <TierBadge tier={row.tier} />
                </td>
                <td className="small">{row.approval_route || '—'}</td>
                <td className="mono">{row.destination_ref || '—'}</td>
                <td className="small">{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted small">
        Status is kept current by the approval portal. Until its webhook reports back, a request shows as pending here
        even if it has already moved on in the portal.
      </p>
    </div>
  );
}
