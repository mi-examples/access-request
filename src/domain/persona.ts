import { normaliseKey } from './question-map';
import type { UserAttribute, UserIdentity } from '../types/mi';
import type { AnswerMap, Question } from '../types/app';
import { CONTACT_QUESTION, REQUESTER_TYPE_QUESTION } from '../config';

/**
 * Deriving the requester's persona from their session instead of asking for it.
 *
 * `auth/info` returns the caller's MI Groups (with their
 * `ldap_organizational_unit`) and their user Custom Attributes — which is
 * where a SAML assertion attribute such as `eduPersonAffiliation` lands, since
 * any `custom_attribute` with `used_for_user_ind='Y'` and a matching
 * `external_id` self-populates on every login.
 *
 * The persona is *pre-filled, then confirmed* rather than silently stamped.
 * Two reasons: the value has to be on the audit record where a steward needs
 * it, and the UI gate is advisory anyway — a determined user could reveal a
 * question meant for another persona, which is a cosmetic exposure rather than
 * a breach, because questions are not secrets and the answers are re-validated
 * before anything is provisioned.
 */

/** Attribute external ids searched, in order, for a persona value. */
const PERSONA_ATTRIBUTE_KEYS = [
  'edupersonaffiliation',
  'edupersonprimaryaffiliation',
  'affiliation',
  'persona',
  'requester_type',
  'requestertype',
];

function attributeList(identity: UserIdentity): UserAttribute[] {
  const { attributes } = identity;

  if (Array.isArray(attributes)) {
    return attributes;
  }

  if (attributes && typeof attributes === 'object') {
    return Object.entries(attributes).map(([name, value]) => ({ name, value: String(value ?? '') }));
  }

  return [];
}

/** Every string the session offers as a persona candidate, best guess first. */
export function personaCandidates(identity: UserIdentity): string[] {
  const candidates: string[] = [];

  for (const attribute of attributeList(identity)) {
    const key = normaliseKey(String(attribute.external_id ?? attribute.name ?? '')).replace(/\s/g, '');

    if (!PERSONA_ATTRIBUTE_KEYS.includes(key)) {
      continue;
    }

    const value = String(attribute.value ?? '').trim();

    if (value) {
      candidates.push(value);
    }
  }

  for (const group of identity.groups ?? []) {
    const name = String(group.name ?? '').trim();

    if (name) {
      candidates.push(name);
    }

    const unit = String(group.ldap_organizational_unit ?? '').trim();

    if (unit) {
      candidates.push(unit);
    }
  }

  return candidates;
}

/**
 * Picks the *Requester Type* option that best matches the session.
 *
 * A submitted value for a `single` field must already exist in that field's
 * option list, or MI rejects the write with `errors.not_found` and stores
 * nothing — the most common silent failure in the custom-field API. So this
 * only ever returns an option that is actually on the list, and returns
 * `undefined` rather than guess.
 */
export function matchPersonaOption(options: string[] | undefined, identity: UserIdentity): string | undefined {
  if (!options || options.length === 0) {
    return undefined;
  }

  const candidates = personaCandidates(identity).map(normaliseKey);

  if (candidates.length === 0) {
    return undefined;
  }

  // Exact match first, then containment in either direction — an MI group
  // called "All Reporting Analysts" should still select "Reporting Analyst".
  for (const option of options) {
    if (candidates.includes(normaliseKey(option))) {
      return option;
    }
  }

  for (const option of options) {
    const normalised = normaliseKey(option);
    const hit = candidates.find((candidate) => candidate.includes(normalised) || normalised.includes(candidate));

    if (hit) {
      return option;
    }
  }

  return undefined;
}

/**
 * The contact block pre-filled from the session.
 *
 * Where the directory login is also the organisation's own person identifier —
 * a NetID, an employee number, a UPN — MI's `username` already is that value,
 * so the coordinator's identity needs no typing. Relabel the second line to
 * whatever the organisation calls it.
 *
 * The sponsoring department is left blank because nothing in MI reliably
 * encodes it: that is one of the answers the App genuinely exists to collect.
 */
export function contactPrefill(identity: UserIdentity): string {
  const lines = [
    `Contact Person Name: ${identity.display_name ?? ''}`.trim(),
    `Username: ${identity.username ?? ''}`.trim(),
    `Email: ${identity.email ?? ''}`.trim(),
    'Sponsoring Department:',
  ];

  return lines.join('\n');
}

/**
 * Seeds answers for the questions the session can answer on the user's behalf.
 *
 * Only fills a question that is actually in this asset's set and currently
 * unanswered, so it never overwrites something the requester typed or a value
 * restored from a draft.
 */
export function prefillAnswers(questions: Question[], identity: UserIdentity, existing: AnswerMap): AnswerMap {
  const seeded: AnswerMap = {};

  for (const question of questions) {
    if (existing[question.title] !== undefined) {
      continue;
    }

    if (normaliseKey(question.title) === normaliseKey(CONTACT_QUESTION)) {
      seeded[question.title] = contactPrefill(identity);
      continue;
    }

    if (normaliseKey(question.title) === normaliseKey(REQUESTER_TYPE_QUESTION)) {
      const option = matchPersonaOption(question.options, identity);

      if (option) {
        seeded[question.title] = question.field_type === 'multi' ? [option] : option;
      }
    }
  }

  return seeded;
}
