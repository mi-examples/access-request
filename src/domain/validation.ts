import type { AnswerMap, AnswerValue, Question, QuestionStep } from '../types/app';

/**
 * Client-side answer validation.
 *
 * This is the *only* place required-ness is enforced at submit time, and
 * that is a deliberate consequence of the architecture rather than an
 * oversight: `custom_field` carries no `required_ind`, and the App→Custom
 * Script call at 7.2.1 passes no user identity, so there is no server-side
 * hook inside the App's own request that could re-check an answer against the
 * requester who gave it.
 *
 * The backstop is deferred, not absent. Custom Script B holds an admin token
 * and re-derives both the submitter's groups and the asset's applicable
 * question set before it creates a ticket, flagging rows that do not belong.
 * Deferring is safe here because nothing is provisioned until the request is
 * approved.
 *
 * The rules below also mirror the constraints MI would apply on replay into
 * `PUT /api/custom_field_value`, so an answer that passes here is an answer
 * that endpoint would accept.
 */

export type FieldErrors = Record<string, string>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** `date` fields require `Y-m-d`; MI appends ` 00:00:00` itself. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isBlank(value: AnswerValue | undefined): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return value.trim() === '';
}

/** Validates one answer. Returns an error message, or `undefined` if valid. */
export function validateAnswer(question: Question, value: AnswerValue | undefined): string | undefined {
  if (value === undefined || isBlank(value)) {
    return question.required ? 'This question is required.' : undefined;
  }

  const values: string[] = Array.isArray(value) ? value : [value];

  switch (question.field_type) {
    case 'single':
    case 'multi': {
      // A submitted value must already exist in the option list or MI rejects
      // the whole write with `errors.not_found` and stores nothing.
      const options = question.options ?? [];

      if (options.length === 0) {
        break;
      }

      const unknown = values.filter((entry) => !options.includes(entry));

      if (unknown.length > 0) {
        return `Not an available option: ${unknown.join(', ')}`;
      }

      if (question.field_type === 'single' && values.length > 1) {
        return 'Select a single option.';
      }

      break;
    }

    case 'email': {
      const invalid = values.filter((entry) => !EMAIL_PATTERN.test(entry.trim()));

      if (invalid.length > 0) {
        return 'Enter a valid email address.';
      }

      break;
    }

    case 'date': {
      const invalid = values.filter((entry) => !DATE_PATTERN.test(entry.trim()));

      if (invalid.length > 0) {
        return 'Enter a date as YYYY-MM-DD.';
      }

      break;
    }

    case 'users':
    case 'textarea':
      break;
  }

  return undefined;
}

/** Validates every visible question in one step. */
export function validateStep(step: QuestionStep, answers: AnswerMap): FieldErrors {
  const errors: FieldErrors = {};

  for (const question of step.questions) {
    const error = validateAnswer(question, answers[question.title]);

    if (error) {
      errors[question.title] = error;
    }
  }

  return errors;
}

/** Validates every visible question across every step. */
export function validateAll(steps: QuestionStep[], answers: AnswerMap): FieldErrors {
  return steps.reduce<FieldErrors>((errors, step) => Object.assign(errors, validateStep(step, answers)), {});
}
