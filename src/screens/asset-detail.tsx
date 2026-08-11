import { useAssetDetail } from '../api/queries';
import { policySummary, readAssetPolicy } from '../domain/policy';
import { Badge, ErrorNotice, LoadingBlock, Notice, TierBadge } from '../components/primitives';
import type { Route } from '../state/router';

/**
 * The asset the request is about — the App's landing screen.
 *
 * Everything here comes from one call:
 * `GET /api/element_info?element=N&access_request_info=Y`. That endpoint fires
 * only on the not-permitted branch, and it returns the richest
 * asset-description payload MI exposes — description, all three owner roles
 * with emails, certification, freshness, engagement, topics grouped by type,
 * the policy custom fields, a ready-made blurred preview image, and the
 * resolved Access Denied Message.
 *
 * Only the element id arrives by URL. URL-borne metadata is spoofable by the
 * requester, goes stale the moment a steward edits the asset, and would force
 * the launch link to be configured per tile — so every value below is read
 * from MI at the moment it is shown.
 *
 * Which fields appear is administrator-configurable under Brand Theme →
 * Metadata Settings, and this card reads the **Viewer** column. Tuning the
 * Info Tooltip column changes nothing here, which is the usual reason a field
 * shows on a tile but is missing from this screen.
 */
export function AssetDetailScreen({
  elementId,
  segmentValueId,
  navigate,
}: {
  elementId: number;
  segmentValueId: number;
  navigate: (route: Route) => void;
}) {
  const detail = useAssetDetail(elementId, segmentValueId);

  if (detail.isLoading) {
    return <LoadingBlock label="Loading asset details" rows={6} />;
  }

  if (detail.error) {
    return <ErrorNotice error={detail.error} context="Could not load this asset" />;
  }

  // `fetchAccessRequestInfo` returns null when MI answered on the *permitted*
  // branch, i.e. the caller can already open this asset.
  if (!detail.data) {
    return (
      <Notice tone="ok" title="You already have access to this content">
        <p>No request is needed. Open it from your Metric Insights homepage.</p>
        <a className="button" href="/home">
          Back to the catalog
        </a>
      </Notice>
    );
  }

  const info = detail.data;
  const accessData = info.accessData || undefined;
  const policy = readAssetPolicy(accessData);
  const name = accessData?.element_dashboard_name || info.name || `Element ${elementId}`;

  return (
    <div className="stack">
      <div className="row row--between">
        <div className="stack" style={{ gap: 4 }}>
          <h2>{name}</h2>
          <div className="row">
            <Badge variant="locked">Request required</Badge>
            {accessData?.certified_ind === 'Y' ? (
              <Badge variant="certified">{accessData.certification_level_name ?? 'Certified'}</Badge>
            ) : null}
            <TierBadge tier={policy.tier} />
            {policy.itAssessmentRequired ? <Badge>IT assessment required</Badge> : null}
          </div>
        </div>

        <button
          type="button"
          className="button button--primary"
          onClick={() => navigate({ name: 'questionnaire', elementId, segmentValueId })}
        >
          Start request
        </button>
      </div>

      <div className="detail">
        <div className="stack">
          {info.html ? (
            <div className="card">
              <h3>Why you cannot open this</h3>
              {/*
                MI resolves the Access Denied Message per element, falling back
                to its Category and then up the ancestor chain, and returns it
                as HTML with `[Element Name]` and `[More Info]` already
                substituted. It is authored by an administrator in MI, not by
                this App or by any user, so it is rendered as authored.
              */}
              <div className="access-denied-message" dangerouslySetInnerHTML={{ __html: info.html }} />
            </div>
          ) : null}

          {accessData?.description || accessData?.element_info ? (
            <div className="card">
              <h3>Description</h3>
              <div
                dangerouslySetInnerHTML={{
                  __html: String(accessData.description || accessData.element_info || ''),
                }}
              />
            </div>
          ) : null}

          {policySummary(policy).length > 0 ? (
            <div className="card">
              <h3>Governance</h3>
              <dl className="definition-list">
                {policySummary(policy).map((entry) => (
                  <div key={entry.label} style={{ display: 'contents' }}>
                    <dt>{entry.label}</dt>
                    <dd>{entry.value}</dd>
                  </div>
                ))}
              </dl>
              {policy.targetTurnaround ? (
                <p className="muted small" style={{ marginTop: 12 }}>
                  Requests at this tier are typically answered in {policy.targetTurnaround}.
                </p>
              ) : null}
            </div>
          ) : (
            <Notice tone="warn" title="This asset has not been classified yet">
              <p>
                No governance custom fields are set on it, so the tier, approval route and turnaround are unknown. A
                steward can add them under the asset&apos;s Custom Fields, or a Collibra metadata-propagation rule can
                populate them nightly.
              </p>
            </Notice>
          )}
        </div>

        <aside className="stack">
          {accessData?.image ? (
            <div className="card card--flush">
              {/*
                MI supplies a deliberately blurred preview for content the
                caller cannot open, so the requester can see the shape of the
                thing without seeing the data.
              */}
              <img className="detail__preview" src={String(accessData.image)} alt="" />
            </div>
          ) : null}

          <div className="card">
            <h3>Contacts</h3>
            <dl className="definition-list">
              <Contact
                label="Business owner"
                name={accessData?.business_owner}
                email={accessData?.business_owner_email}
              />
              <Contact label="Data steward" name={accessData?.data_steward} email={accessData?.data_steward_email} />
              <Contact
                label="Technical owner"
                name={accessData?.technical_owner}
                email={accessData?.technical_owner_email}
              />
              {policy.dataSteward ? (
                <>
                  <dt>Domain steward</dt>
                  <dd>{policy.dataSteward}</dd>
                </>
              ) : null}
              {policy.systemOwner ? (
                <>
                  <dt>System owner</dt>
                  <dd>{policy.systemOwner}</dd>
                </>
              ) : null}
            </dl>
          </div>

          <div className="card">
            <h3>About the content</h3>
            <dl className="definition-list">
              {accessData?.content_type ? (
                <>
                  <dt>Type</dt>
                  <dd>{accessData.content_type}</dd>
                </>
              ) : null}
              {accessData?.data_source_name ? (
                <>
                  <dt>Source</dt>
                  <dd>{accessData.data_source_name}</dd>
                </>
              ) : null}
              {accessData?.refresh_frequency_text ? (
                <>
                  <dt>Refresh</dt>
                  <dd>{accessData.refresh_frequency_text}</dd>
                </>
              ) : null}
              {accessData?.last_measurement_time ? (
                <>
                  <dt>Last updated</dt>
                  <dd>{accessData.last_measurement_time}</dd>
                </>
              ) : null}
              {accessData?.global_total_view_count ? (
                <>
                  <dt>Views</dt>
                  <dd>{accessData.global_total_view_count}</dd>
                </>
              ) : null}
            </dl>
          </div>

          <TopicList accessData={accessData} />
        </aside>
      </div>
    </div>
  );
}

function Contact({ label, name, email }: { label: string; name?: string | null; email?: string | null }) {
  if (!name) {
    return null;
  }

  return (
    <>
      <dt>{label}</dt>
      <dd>
        {name}
        {/*
          MI blanks the email column entirely when
          `HIDE_USER_EMAIL_ADDRESSES='Y'`, so an absent address is a
          configuration choice rather than missing data.
        */}
        {email ? (
          <>
            <br />
            <a href={`mailto:${email}`}>{email}</a>
          </>
        ) : null}
      </dd>
    </>
  );
}

function TopicList({ accessData }: { accessData?: { topics?: Record<string, unknown> } }) {
  const groups = accessData?.topics;

  if (!groups || Object.keys(groups).length === 0) {
    return null;
  }

  const entries = Object.entries(groups).flatMap(([key, group]) => {
    const record = group as { name?: string; topics?: Array<{ name?: string }> };
    const topics = (record.topics ?? []).map((topic) => String(topic?.name ?? '')).filter(Boolean);

    if (topics.length === 0) {
      return [];
    }

    return [{ key, label: record.name ?? 'Tags', topics }];
  });

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="card">
      <h3>Tags</h3>
      <div className="stack" style={{ gap: 8 }}>
        {entries.map((entry) => (
          <div key={entry.key}>
            <div className="field-group-title">{entry.label}</div>
            <div className="row">
              {entry.topics.map((topic) => (
                <Badge key={topic}>{topic}</Badge>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
