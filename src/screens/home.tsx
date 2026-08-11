import { EmptyState, Notice } from '../components/primitives';
import type { Route } from '../state/router';

/**
 * Reached with no element context.
 *
 * The App exists to ask about *one asset*. Content is discovered and chosen in
 * Metric Insights' own catalog — locked tiles, folders, Global Search and the
 * Access Denied card are all native — so arriving here without an `element`
 * parameter means the launch link is misconfigured, not that the user took a
 * wrong turn.
 *
 * The message therefore names the fix as well as the next step: an
 * administrator sets the per-Category Access Denied Message to link to
 * `/p/access-request?element=<id>`, which is the one place that link needs to
 * exist.
 */
export function HomeScreen({ navigate }: { navigate: (route: Route) => void }) {
  return (
    <div className="stack">
      <EmptyState title="Start from the content you need">
        <p className="muted">
          Find the dashboard, report or dataset in Metric Insights and use its <strong>Request Access</strong> link.
          This form opens with that content already selected.
        </p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <a className="button button--primary" href="/home">
            Browse the catalog
          </a>
          <button type="button" className="button" onClick={() => navigate({ name: 'requests' })}>
            View my requests
          </button>
        </div>
      </EmptyState>

      <Notice tone="warn" title="Arrived here from a Request Access link?">
        <p className="small">
          Then the link is missing its element. It should point at{' '}
          <span className="mono">/p/access-request?element=&lt;element id&gt;</span> — an administrator can set that on
          the Category&apos;s Access Denied Message, which covers every asset beneath it.
        </p>
      </Notice>
    </div>
  );
}
