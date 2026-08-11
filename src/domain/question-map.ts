import type {
  AnswerMap,
  AnswerValue,
  FieldType,
  Question,
  QuestionMapRow,
  QuestionStep,
  ResolvedQuestion,
} from '../types/app';

/**
 * Applying the `questionMap` Dataset to the question set Custom Script A
 * resolved.
 *
 * Two kinds of conditionality meet here, and only one of them is native:
 *
 * - **Asset-driven** ("Sensitivity Tier is 3, so ask the detailed
 *   justification questions") is a `custom_field_rule`, evaluated server-side
 *   against values stored *on the element*. By the time the script's output
 *   reaches this module those rules have already been applied — a question
 *   that does not apply to this asset simply is not in the set.
 * - **Respondent-driven** ("you answered Yes, so now answer these three")
 *   cannot be a `custom_field_rule` at all: a rule's antecedent must be a
 *   value stored on the asset, not an answer in flight. That is what the map
 *   rows below express, and why the App evaluates them rather than MI.
 *
 * The map also carries the two things no REST endpoint exposes: the field type
 * (`custom_field.field_type` is absent from every response) and required-ness
 * (`custom_field` has no `required_ind` — only content-workflow stages have
 * one, and this is not that flow).
 *
 * Persona-gating is deliberately *not* here. `visible_to='groups'` resolves
 * against whoever makes the call and admins bypass it entirely, so a service
 * account cannot evaluate it on the requester's behalf. Persona becomes a
 * pre-filled answer instead — see `domain/persona.ts`.
 */

const FIELD_TYPES: readonly FieldType[] = ['single', 'multi', 'textarea', 'email', 'date', 'users'];

/** Normalises a question key for matching: case- and whitespace-insensitive. */
export function normaliseKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isTrue(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  const text = String(value ?? '')
    .trim()
    .toLowerCase();

  return text === 'y' || text === 'yes' || text === 'true' || text === '1';
}

/** Splits a comma-separated map cell into trimmed, non-empty values. */
function splitValues(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export type QuestionMapIndex = Map<string, QuestionMapRow>;

export function indexQuestionMap(rows: QuestionMapRow[]): QuestionMapIndex {
  const index: QuestionMapIndex = new Map();

  for (const row of rows) {
    const key = row?.question_key;

    if (!key) {
      continue;
    }

    index.set(normaliseKey(String(key)), row);
  }

  return index;
}

/**
 * Infers a field type when the map does not override it.
 *
 * An option list means a pick list, and `single` is the safe default of the
 * two: rendering a `multi` field as `single` collects one valid value, whereas
 * the reverse collects a comma-joined string that MI would reject on replay
 * because the composite is not in the option list. Everything else defaults to
 * `textarea`, because MI has no single-line free-text type — `single` is a
 * pick list, not a text box.
 */
function inferFieldType(question: ResolvedQuestion): FieldType {
  return question.options && question.options.length > 0 ? 'single' : 'textarea';
}

function resolveFieldType(question: ResolvedQuestion, row?: QuestionMapRow): FieldType {
  const declared = String(row?.field_type ?? '')
    .trim()
    .toLowerCase();

  if ((FIELD_TYPES as readonly string[]).includes(declared)) {
    return declared as FieldType;
  }

  return inferFieldType(question);
}

/** Merges the resolved question set with its map rows. */
export function applyQuestionMap(questions: ResolvedQuestion[], mapIndex: QuestionMapIndex): Question[] {
  return questions.map((question, index) => {
    const row = mapIndex.get(normaliseKey(question.title));
    const antecedentKey = row?.applies_when_question_key?.trim();
    const antecedentValues = splitValues(row?.applies_when_value);

    const seq = row?.seq;
    const order =
      seq === null || seq === undefined || seq === '' || Number.isNaN(Number(seq)) ? question.field_seq : Number(seq);

    return {
      ...question,
      field_type: resolveFieldType(question, row),
      required: isTrue(row?.required),
      help_text: row?.help_text?.trim() || question.description,
      applies_when:
        antecedentKey && antecedentValues.length > 0
          ? { question_key: antecedentKey, values: antecedentValues }
          : undefined,
      order,
      // Preserve a stable tiebreak when two questions declare the same order.
      field_seq: question.field_seq ?? index,
    } satisfies Question;
  });
}

/** True when an answer holds at least one of the values a branch waits for. */
function answerMatches(answer: AnswerValue | undefined, values: string[]): boolean {
  if (answer === undefined) {
    return false;
  }

  const held = Array.isArray(answer) ? answer : [answer];
  const wanted = values.map(normaliseKey);

  return held.some((value) => wanted.includes(normaliseKey(String(value))));
}

/**
 * Whether a question is currently visible, given the answers so far.
 *
 * Branches chain: a follow-up whose antecedent is itself hidden stays hidden,
 * matching how `custom_field_rule` chains transitively on the MI side. The
 * walk is depth-limited rather than cycle-detected, because the map is
 * admin-authored data and a cycle there should degrade to "hidden", not hang
 * the form.
 */
export function isQuestionVisible(
  question: Question,
  answers: AnswerMap,
  byKey: Map<string, Question>,
  depth = 0,
): boolean {
  if (!question.applies_when) {
    return true;
  }

  if (depth > 16) {
    return false;
  }

  const antecedent = byKey.get(normaliseKey(question.applies_when.question_key));

  if (!antecedent) {
    // The map points at a question that is not in this asset's set — either a
    // typo, or a question the asset-driven rules filtered out. Either way the
    // branch cannot fire.
    return false;
  }

  if (!isQuestionVisible(antecedent, answers, byKey, depth + 1)) {
    return false;
  }

  return answerMatches(answers[antecedent.title], question.applies_when.values);
}

/**
 * Groups questions into wizard steps.
 *
 * One step per `custom_field_section`, ordered by the section's authored `seq`
 * — which is why Custom Script A preserves the order MI returned rather than
 * re-sorting: `/api/custom_field_value` iterates the section set in `seq`
 * order, so position in its response *is* the authored order.
 */
export function buildSteps(questions: Question[]): QuestionStep[] {
  const steps = new Map<number, QuestionStep>();

  for (const question of questions) {
    let step = steps.get(question.cfs_id);

    if (!step) {
      step = {
        cfs_id: question.cfs_id,
        section: question.section,
        seq: question.section_seq,
        questions: [],
      };
      steps.set(question.cfs_id, step);
    }

    step.seq = Math.min(step.seq, question.section_seq);
    step.questions.push(question);
  }

  const ordered = [...steps.values()].sort((a, b) => a.seq - b.seq);

  for (const step of ordered) {
    step.questions.sort((a, b) => a.order - b.order || a.field_seq - b.field_seq);
  }

  return ordered;
}

/**
 * The steps a requester will actually see, with hidden questions removed.
 *
 * A step whose every question is hidden is dropped entirely: progress must
 * count the steps remaining for *this* request, not the full inventory. The
 * prototype's nineteen steps were largely an artefact of asking everyone
 * everything.
 */
export function visibleSteps(steps: QuestionStep[], answers: AnswerMap): QuestionStep[] {
  const byKey = new Map<string, Question>();

  for (const step of steps) {
    for (const question of step.questions) {
      byKey.set(normaliseKey(question.title), question);
    }
  }

  return steps
    .map((step) => ({
      ...step,
      questions: step.questions.filter((question) => isQuestionVisible(question, answers, byKey)),
    }))
    .filter((step) => step.questions.length > 0);
}
