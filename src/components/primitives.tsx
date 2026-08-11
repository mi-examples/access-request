import clsx from 'clsx';
import type { ReactNode } from 'react';
import { MiError } from '../api/http';

export function Badge({
  children,
  variant,
}: {
  children: ReactNode;
  variant?: 'locked' | 'certified' | 'count' | 'tier1' | 'tier2' | 'tier3';
}) {
  return <span className={clsx('badge', variant && `badge--${variant}`)}>{children}</span>;
}

/** Maps a tier label to its badge variant, defaulting to a neutral badge. */
export function TierBadge({ tier }: { tier?: string }) {
  if (!tier) {
    return null;
  }

  const match = /tier\s*([123])/i.exec(tier);
  const variant = match ? (`tier${match[1]}` as 'tier1' | 'tier2' | 'tier3') : undefined;

  return <Badge variant={variant}>{tier}</Badge>;
}

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'error' | 'warn' | 'ok';
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className={clsx('notice', tone !== 'info' && `notice--${tone}`)} role={tone === 'error' ? 'alert' : undefined}>
      {title ? <div className="notice__title">{title}</div> : null}
      {children}
    </div>
  );
}

/**
 * Renders a failed MI call in terms the requester or the administrator
 * reading over their shoulder can act on.
 *
 * The four cases worth distinguishing are a dead session, a permissions gap,
 * the shared 100 requests/minute throttle, and an application 405 — which
 * almost always means the App called an endpoint with the wrong URL/verb
 * combination rather than anything being wrong with the deployment.
 */
export function ErrorNotice({ error, context }: { error: unknown; context?: string }) {
  if (!error) {
    return null;
  }

  if (error instanceof MiError) {
    if (error.isSessionExpired) {
      return (
        <Notice tone="error" title="Your session has expired">
          <p>Reload the page to sign in to Metric Insights again.</p>
          <button type="button" className="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </Notice>
      );
    }

    if (error.isThrottled) {
      return (
        <Notice tone="warn" title="Too many requests">
          Metric Insights limits this App to 100 requests a minute. Wait a moment and try again.
        </Notice>
      );
    }

    if (error.isForbidden) {
      return (
        <Notice tone="error" title="You do not have access to this">
          {context ? <p>{context}</p> : null}
          <p className="small mono">{error.message}</p>
        </Notice>
      );
    }

    return (
      <Notice tone="error" title={context ?? 'Metric Insights returned an error'}>
        <p className="small mono">
          {error.status} — {error.message}
        </p>
      </Notice>
    );
  }

  return (
    <Notice tone="error" title={context ?? 'Something went wrong'}>
      <p className="small mono">{error instanceof Error ? error.message : String(error)}</p>
    </Notice>
  );
}

export function Skeleton({ height = 18, width = '100%' }: { height?: number; width?: number | string }) {
  return <div className="skeleton" style={{ height, width }} aria-hidden="true" />;
}

export function LoadingBlock({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height={index === 0 ? 24 : 16} width={index === 0 ? '40%' : '100%'} />
      ))}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
