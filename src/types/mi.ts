/**
 * Shapes returned by MI's own REST API.
 *
 * Every field below was read off the 7.2.x source rather than inferred from a
 * sample response, but MI's list endpoints return wide, loosely-typed rows and
 * add columns between releases — so anything the App does not strictly need is
 * left optional, and `YN` is used wherever MI returns its `'Y'|'N'` flags.
 */

export type YN = 'Y' | 'N';

/** MI's `respondOk` envelope. The payload key varies per controller. */
export interface MiEnvelope {
  resultCode?: number;
  message?: string;
}

/* -------------------------------------------------------------------------- */
/* auth/info — GET /data/page/{app}/auth/info                                  */
/* -------------------------------------------------------------------------- */

export interface UserGroup {
  group_id: number | string;
  name: string;
  description?: string;
  ldap_organizational_unit?: string | null;
  external_group_id?: string | null;
}

/** A user Custom Attribute (`custom_attribute` with `used_for_user_ind='Y'`). */
export interface UserAttribute {
  name?: string;
  external_id?: string | null;
  value?: string | null;
  [key: string]: unknown;
}

/** `UserModel::getUserIdentity()`. Available to any logged-in user. */
export interface UserIdentity {
  user_id: number | string;
  username: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  is_administrator: YN;
  is_power_user: YN;
  is_manage_pages_privilege: YN;
  groups: UserGroup[];
  attributes: UserAttribute[] | Record<string, unknown>;
}

export interface AuthInfoResponse extends MiEnvelope {
  user: UserIdentity;
  post?: unknown;
}

/* -------------------------------------------------------------------------- */
/* GET /api/element_info?element=N&access_request_info=Y                       */
/* -------------------------------------------------------------------------- */

/** A custom field as MI renders it for display: label + resolved value. */
export interface CustomFieldValue {
  cf_id: number | string;
  cfs_id: number | string;
  section: string;
  title: string;
  value: string | string[] | Record<string, unknown> | null;
}

export interface TopicGroup {
  name?: string;
  htmlIcon?: { icon_type?: string; icon?: string } | string;
  topics?: Array<{ topic_id?: number | string; name?: string }>;
  [key: string]: unknown;
}

/**
 * `DashboardModel::getElementWithoutAccessData()` — the richest asset-detail
 * payload MI exposes for content the caller cannot open.
 *
 * `custom_fields` here is filtered to `display_in_access_dialog_ind='Y'` *and*
 * non-empty, which makes it right for policy fields and wrong for question
 * fields: an unanswered question is silently dropped. Question definitions
 * come from Custom Script A instead.
 */
export interface AccessData {
  element_id: number | string;
  segment_value_id?: number | string;
  user_dashboard_element_instance_id?: string;
  element_dashboard_name?: string;
  description?: string | null;
  element_info?: string | null;
  content_type?: string | null;
  content_type_alias?: string | null;
  reporting_tool_name?: string | null;
  element_type?: string | null;
  category_id?: number | string;
  data_source_name?: string | null;
  business_owner?: string | null;
  business_owner_email?: string | null;
  technical_owner?: string | null;
  technical_owner_email?: string | null;
  data_steward?: string | null;
  data_steward_email?: string | null;
  certified_ind?: YN;
  last_certified_time?: string | null;
  last_certified_by_name?: string | null;
  certification_level_name?: string | null;
  certification_level_color?: string | null;
  refresh_frequency_text?: string | null;
  last_measurement_time?: string | null;
  global_total_view_count?: number | string | null;
  custom_fields?: CustomFieldValue[];
  topics?: Record<string, TopicGroup>;
  documents?: Array<Record<string, unknown>>;
  /** A ready-to-use blurred preview image (data URI or path). */
  image?: string | false;
  [key: string]: unknown;
}

/** `DashboardModel::accessRequestInfo()`. Fires only on the not-permitted branch. */
export interface AccessRequestInfo {
  type?: string;
  element_id: number | string;
  segment_value_id?: number | string;
  category_id?: number;
  name?: string;
  isPermittedForExternalTool?: YN;
  externalToolName?: string;
  /** The resolved Access Denied Message, already HTML. */
  html?: string;
  more_info_link?: string;
  accessData?: AccessData | false;
}

export interface AccessRequestInfoResponse extends MiEnvelope {
  data: AccessRequestInfo;
}

/** `element_info` on the *permitted* branch returns `info`, not `data`. */
export interface ElementInfoResponse extends MiEnvelope {
  info: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* PUT /api/element_info { call: 'request_access' }                            */
/* -------------------------------------------------------------------------- */

export interface RequestAccessResponse extends MiEnvelope {
  message?: string;
}

/* -------------------------------------------------------------------------- */
/* App Entity: dataset (entity_type='dataset')                                 */
/* -------------------------------------------------------------------------- */

export interface DatasetEntityResponse<Row> extends MiEnvelope {
  data?: Row[];
  columns?: Array<Record<string, unknown>>;
}

/* -------------------------------------------------------------------------- */
/* App Entity: App Dataset (entity_type='internal', is_app_dataset_ind='Y')    */
/* -------------------------------------------------------------------------- */

/** Every App Dataset row carries these two columns, both stamped by MI. */
export interface AppDatasetRowBase {
  id?: string;
  /** Set server-side from the session — never from request input. */
  owner_user_id?: number | string;
}

export interface AppDatasetListResponse<Row> extends MiEnvelope {
  data?: Row[];
  count?: number | string;
}

export interface AppDatasetItemResponse<Row> extends MiEnvelope {
  data?: Row;
}

export interface AppDatasetInsertResponse extends MiEnvelope {
  /** The `id` of each inserted row. Generated by MI for `managed` entities. */
  ids?: string[];
}
