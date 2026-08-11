import { useMyRequests } from '../api/queries';
import { ErrorNotice, LoadingBlock, Notice, TierBadge } from '../components/primitives';
import { REQUEST_STATUS } from '../config';
import type { Route } from '../state/router';

/**
 * What happens next.
 *
 * Deliberately explicit about the asynchrony. MI has no instant-notification
 * primitive, so the outbound call into the approval portal is a scheduled
 * Custom Script drain rather than part of the submit: the requester gets a
 * confirmation the moment their answers are recorded, and the external ticket
 * number appears on the next drain. Saying so here is better than showing a
 * spinner over a call that was never synchronous.
 *
 * The external reference matters. MI's own Access Request Profile discards the
 * ticket number the provider returns and shows a generic message, so a
 * requester used to quoting a reference has nothing to quote.
 */
export function OutcomeScreen({ requestId, navigate }: { requestId: string; navigate: (route: Route) => void }) {
  const requests = useMyRequests();

  if (requests.isLoading) {
    return <LoadingBlock label="Confirming your request" rows={4} />;
  }

  if (requests.error) {
    return <ErrorNotice error={requests.error} context="Could not confirm your request" />;
  }

  const row = (requests.data ?? []).find((entry) => entry.request_id === requestId);

  return (
    <div className="stack">
      <Notice tone="ok" title="Your request has been recorded">
        <p>It is stored against your Metric Insights account and visible to the data steward for this asset.</p>
      </Notice>

      {!row ? (
        // The `requests` App Dataset is read through a cached query layer, and
        // a freshly inserted row can lag a beat behind the redirect.
        <Notice tone="warn" title="Your request is still being written">
          <p className="small">It has been submitted — this page just has not caught up yet.</p>
          <button type="button" className="button button--small" onClick={() => requests.refetch()}>
            Refresh
          </button>
        </Notice>
      ) : (
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>{row.element_name}</h3>
          <dl className="definition-list">
            <dt>Tier</dt>
            <dd>
              <TierBadge tier={row.tier} />
            </dd>
            <dt>Approval route</dt>
            <dd>{row.approval_route || '—'}</dd>
            <dt>Reference</dt>
            <dd className="mono">{row.destination_ref || 'Pending'}</dd>
            <dt>Status</dt>
            <dd>{row.status}</dd>
            <dt>Submitted</dt>
            <dd>{row.submitted_time}</dd>
          </dl>
        </div>
      )}

      {!row || row.status === REQUEST_STATUS.pending ? (
        <Notice title="What happens next">
          <ol>
            <li>Your answers are stored and visible to the data steward for this asset.</li>
            <li>
              A scheduled job forwards the request to the approval portal and writes the portal&apos;s reference number
              back here — usually within about ten minutes.
            </li>
            <li>
              The steward, and where required an architecture or security review, consider it. You will be contacted
              through the approval portal.
            </li>
          </ol>
        </Notice>
      ) : null}

      <div className="row">
        <a className="button" href="/home">
          Back to the catalog
        </a>
        <button type="button" className="button button--primary" onClick={() => navigate({ name: 'requests' })}>
          View my requests
        </button>
      </div>
    </div>
  );
}
