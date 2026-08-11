import { POLICY_FIELD } from '../config';
import { normaliseKey } from './question-map';
import type { AccessData, CustomFieldValue } from '../types/mi';

/**
 * Reading the Group A policy fields off an asset's detail card.
 *
 * These are the fields that classify the asset and select the tier, the
 * approval route and the SLA. They arrive in `accessData.custom_fields`, which
 * MI filters to `display_in_access_dialog_ind='Y'` *and* non-empty — right for
 * policy fields, which carry values, and wrong for question fields, which do
 * not and would be silently dropped. Questions come from Custom Script A.
 */

export interface AssetPolicy {
  domain?: string;
  riskClassification?: string;
  tier?: string;
  accessType?: string;
  sourceSystem?: string;
  assetType?: string;
  tileType?: string;
  dataSteward?: string;
  systemOwner?: string;
  approvalRoute?: string;
  requiredControls: string[];
  targetTurnaround?: string;
  itAssessmentRequired: boolean;
}

/** Flattens MI's polymorphic custom-field value into display text. */
export function customFieldText(value: CustomFieldValue['value']): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry))
      .filter(Boolean)
      .join(', ');
  }

  if (typeof value === 'object') {
    return '';
  }

  return String(value);
}

function customFieldList(value: CustomFieldValue['value']): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).filter(Boolean);
  }

  const text = customFieldText(value);

  return text
    ? text
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function indexByTitle(fields: CustomFieldValue[] = []): Map<string, CustomFieldValue> {
  const index = new Map<string, CustomFieldValue>();

  for (const field of fields) {
    if (!field?.title) {
      continue;
    }

    index.set(normaliseKey(field.title), field);
  }

  return index;
}

/**
 * Extracts the policy fields.
 *
 * Matching is on the field's display label, tolerant of casing and internal
 * whitespace, because an administrator adjusting a label's capitalisation
 * should not silently break the tier display. A genuine rename does need
 * `POLICY_FIELD` updated.
 */
export function readAssetPolicy(input: AccessData | false | undefined): AssetPolicy {
  // MI returns `accessData: false` when the element has no discoverable row —
  // normalise it away so every read below is a plain optional lookup.
  const accessData: AccessData | undefined = input || undefined;

  const fields = indexByTitle(accessData?.custom_fields ?? []);
  const text = (label: string) => {
    const value = customFieldText(fields.get(normaliseKey(label))?.value ?? null);

    return value || undefined;
  };

  const itAssessment = text(POLICY_FIELD.itAssessmentRequired);

  return {
    domain: text(POLICY_FIELD.dataDomain),
    riskClassification: text(POLICY_FIELD.riskClassification),
    tier: text(POLICY_FIELD.tier),
    accessType: text(POLICY_FIELD.accessType),
    // MI's own Data Source name is the fallback: a Source System custom
    // field is only needed where the organisation's taxonomy diverges
    // from MI's.
    sourceSystem: text(POLICY_FIELD.sourceSystem) ?? accessData?.data_source_name ?? undefined,
    assetType: text(POLICY_FIELD.assetType) ?? accessData?.content_type ?? accessData?.reporting_tool_name ?? undefined,
    tileType: text(POLICY_FIELD.tileType) ?? accessData?.element_type ?? undefined,
    dataSteward: text(POLICY_FIELD.dataSteward) ?? accessData?.data_steward ?? undefined,
    systemOwner: text(POLICY_FIELD.systemOwner) ?? accessData?.technical_owner ?? undefined,
    approvalRoute: text(POLICY_FIELD.approvalRoute),
    requiredControls: customFieldList(fields.get(normaliseKey(POLICY_FIELD.requiredControls))?.value ?? null),
    targetTurnaround: text(POLICY_FIELD.targetTurnaround),
    itAssessmentRequired: /^(y|yes|true|required)$/i.test(itAssessment ?? ''),
  };
}

/** The policy fields shown to the requester, in the order they are useful. */
export function policySummary(policy: AssetPolicy): Array<{ label: string; value: string }> {
  const entries: Array<[string, string | undefined]> = [
    [POLICY_FIELD.dataDomain, policy.domain],
    [POLICY_FIELD.riskClassification, policy.riskClassification],
    [POLICY_FIELD.tier, policy.tier],
    [POLICY_FIELD.accessType, policy.accessType],
    [POLICY_FIELD.sourceSystem, policy.sourceSystem],
    [POLICY_FIELD.assetType, policy.assetType],
    [POLICY_FIELD.tileType, policy.tileType],
    [POLICY_FIELD.dataSteward, policy.dataSteward],
    [POLICY_FIELD.systemOwner, policy.systemOwner],
    [POLICY_FIELD.targetTurnaround, policy.targetTurnaround],
    [
      POLICY_FIELD.requiredControls,
      policy.requiredControls.length > 0 ? policy.requiredControls.join(', ') : undefined,
    ],
  ];

  return entries
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([label, value]) => ({ label, value }));
}

/**
 * The tier's short name, for a badge.
 *
 * The option values are long by design (`Tier 3: Sensitive (High Risk)`), so
 * the badge shows just the tier and the full string stays on the detail card.
 */
export function tierBadge(tier: string | undefined): string | undefined {
  if (!tier) {
    return undefined;
  }

  const match = /tier\s*([0-9]+)/i.exec(tier);

  return match ? `Tier ${match[1]}` : tier;
}
