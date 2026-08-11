import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * A hash router, deliberately.
 *
 * MI serves the App from `/p/access-request`, and any deeper path on that
 * route is handled by `PortalPage::processRequest` as a request for an
 * *asset*, not as a client-side route — so `/p/access-request/questions` would
 * 404 on refresh under the History API. Keeping routes in the fragment means
 * every screen is refreshable and the launch query string survives.
 */

export type Route =
  /** Reached with no element context — the App cannot do anything useful. */
  | { name: 'home' }
  | { name: 'asset'; elementId: number; segmentValueId: number }
  | { name: 'questionnaire'; elementId: number; segmentValueId: number }
  | { name: 'review'; elementId: number; segmentValueId: number }
  | { name: 'outcome'; requestId: string }
  | { name: 'requests' };

export function routeToHash(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'asset':
      return `#/asset/${route.elementId}/${route.segmentValueId}`;
    case 'questionnaire':
      return `#/request/${route.elementId}/${route.segmentValueId}`;
    case 'review':
      return `#/review/${route.elementId}/${route.segmentValueId}`;
    case 'outcome':
      return `#/outcome/${route.requestId}`;
    case 'requests':
      return '#/my-requests';
  }
}

function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').split('?')[0];
  const parts = path.split('/').filter(Boolean);

  if (parts.length === 0) {
    return { name: 'home' };
  }

  const elementId = Number(parts[1]) || 0;
  const segmentValueId = Number(parts[2]) || 0;

  switch (parts[0]) {
    case 'asset':
      return { name: 'asset', elementId, segmentValueId };
    case 'request':
      return { name: 'questionnaire', elementId, segmentValueId };
    case 'review':
      return { name: 'review', elementId, segmentValueId };
    case 'outcome':
      return { name: 'outcome', requestId: parts[1] ?? '' };
    case 'my-requests':
      return { name: 'requests' };
    default:
      return { name: 'home' };
  }
}

/**
 * The element the App was launched with.
 *
 * Content selection happens in Metric Insights' own catalog — its locked
 * tiles, folders, Global Search and Access Denied card are all native and
 * configuration-only, so there is no reason for this App to rebuild any of it.
 * The App's job starts where a requester has already chosen an asset and needs
 * to be asked about it.
 *
 * `element` is therefore the entry contract, and the *only* thing that travels
 * in the URL. Every other piece of asset metadata is read from MI
 * server-side: URL-borne metadata is spoofable by the requester, goes stale
 * the moment a steward edits the asset, and would force the launch link to be
 * configured per tile rather than once per Category.
 */
export function launchElement(): { elementId: number; segmentValueId: number } | null {
  const params = new URLSearchParams(window.location.search);
  const elementId = Number(params.get('element') ?? params.get('element_id') ?? 0);

  if (!elementId) {
    return null;
  }

  const segmentValueId = Number(params.get('dimension_value') ?? params.get('segment_value_id') ?? 0);

  return { elementId, segmentValueId: Number.isFinite(segmentValueId) ? segmentValueId : 0 };
}

export function useRouter() {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);

    window.addEventListener('hashchange', onHashChange);

    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const route = useMemo(() => parseHash(hash), [hash]);

  const navigate = useCallback((next: Route, options: { replace?: boolean } = {}) => {
    const target = routeToHash(next);

    if (window.location.hash === target) {
      return;
    }

    if (options.replace) {
      window.history.replaceState(null, '', target);
      setHash(target);
    } else {
      window.location.hash = target;
    }
  }, []);

  return { route, navigate };
}
