import type { ReactNode } from 'react';
import type { Route } from '../state/router';

/**
 * The App's frame — deliberately almost nothing.
 *
 * When the App is embedded (its "Display without Metric Insights navigation
 * bar" setting left unchecked), MI renders it inside `layouts/index.php`:
 * a fixed 40px navigation bar, then `.frame > .container-fluid > .main-side`
 * holding this component. MI's bar already carries the product navigation and
 * the signed-in user, so drawing another one here would duplicate both and
 * push the content down twice.
 *
 * What is left is a thin page header: where the user is, plus the one link
 * MI's own navigation cannot offer — their request history.
 *
 * `.ar-app` is the scope every rule in `app.css` hangs off. Without it, this
 * App's `input`, `.row` and `.card` rules would restyle MI's own chrome.
 */
export function AppShell({
  route,
  navigate,
  children,
}: {
  route: Route;
  navigate: (route: Route) => void;
  children: ReactNode;
}) {
  return (
    <div className="ar-app">
      <div className="page-header">
        <span className="page-header__title">Request Access</span>

        <button
          type="button"
          className="button button--ghost button--small"
          aria-current={route.name === 'requests'}
          onClick={() => navigate({ name: 'requests' })}
        >
          My requests
        </button>
      </div>

      {children}
    </div>
  );
}
