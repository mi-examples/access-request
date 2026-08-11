import clsx from 'clsx';
import { useCallback, useId, useLayoutEffect, useRef } from 'react';
import type { AnswerValue, Question } from '../types/app';

/**
 * Renders one question.
 *
 * The field types are MI's six and only MI's six — `single`, `multi`,
 * `textarea`, `email`, `date`, `users`. Note there is no single-line free-text
 * type: `single` is a *pick list*, so every free-text answer is a `textarea`.
 * That surprises whoever authors the question bank, and it is the reason the
 * long prose questions below render as boxes rather than lines.
 *
 * Pick lists render only the options MI knows about, because a submitted value
 * that is not already in the option list is rejected with `errors.not_found`
 * and nothing is stored — a free-text fallback here would produce answers that
 * cannot be replayed into the custom-field API.
 */
export function QuestionField({
  question,
  value,
  error,
  prefilled,
  onChange,
}: {
  question: Question;
  value: AnswerValue | undefined;
  error?: string;
  /** True when the App filled this in from the session rather than the user. */
  prefilled?: boolean;
  onChange: (value: AnswerValue) => void;
}) {
  const fieldId = useId();
  const helpId = `${fieldId}-help`;
  const errorId = `${fieldId}-error`;

  const describedBy =
    [question.help_text ? helpId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={clsx('field', error && 'field--invalid')}>
      <label className="field__label" htmlFor={fieldId}>
        {question.title}
        {question.required ? (
          <span className="field__required" aria-hidden="true">
            *
          </span>
        ) : null}
        {question.required ? <span className="visually-hidden">(required)</span> : null}
      </label>

      {question.help_text ? (
        <div className="field__help" id={helpId}>
          {question.help_text}
        </div>
      ) : null}

      <Control
        question={question}
        fieldId={fieldId}
        describedBy={describedBy}
        invalid={Boolean(error)}
        value={value}
        onChange={onChange}
      />

      {prefilled ? (
        <div className="field__prefilled">
          Pre-filled from your Metric Insights account — please confirm or correct it.
        </div>
      ) : null}

      {error ? (
        <div className="field__error" id={errorId}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

function Control({
  question,
  fieldId,
  describedBy,
  invalid,
  value,
  onChange,
}: {
  question: Question;
  fieldId: string;
  describedBy?: string;
  invalid: boolean;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue) => void;
}) {
  const shared = {
    id: fieldId,
    'aria-describedby': describedBy,
    'aria-invalid': invalid || undefined,
    'aria-required': question.required || undefined,
  };

  switch (question.field_type) {
    case 'single': {
      const options = question.options ?? [];

      return (
        <select
          {...shared}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">— Select —</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }

    case 'multi': {
      const options = question.options ?? [];
      const selected = new Set(Array.isArray(value) ? value : value ? [value] : []);

      return (
        <div className="checklist" role="group" aria-labelledby={fieldId} aria-describedby={describedBy}>
          {options.map((option) => (
            <label key={option}>
              <input
                type="checkbox"
                checked={selected.has(option)}
                onChange={(event) => {
                  const next = new Set(selected);

                  if (event.target.checked) {
                    next.add(option);
                  } else {
                    next.delete(option);
                  }

                  // Emit in the option list's own order, so the stored answer
                  // reads the same regardless of the order they were ticked.
                  onChange(options.filter((entry) => next.has(entry)));
                }}
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      );
    }

    case 'email':
      return (
        <input
          {...shared}
          type="email"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case 'date':
      // MI stores `Y-m-d` and appends the time itself, which is exactly what
      // a native date input produces.
      return (
        <input
          {...shared}
          type="date"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case 'users':
      // A `users` field resolves a display name or username to a user id on
      // write, so the answer is free text here and MI does the resolution.
      return (
        <input
          {...shared}
          type="text"
          placeholder="Name or username"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case 'textarea':
    default:
      return (
        <AutoSizingTextarea
          {...shared}
          value={typeof value === 'string' ? value : Array.isArray(value) ? value.join(', ') : ''}
          onChange={onChange}
        />
      );
  }
}

/** Tallest a textarea grows before it starts scrolling. */
const TEXTAREA_MAX_HEIGHT = 320;

/**
 * A textarea that grows to fit its content.
 *
 * MI's own multiline Input is fixed at `minRows: 3`, which is right for a
 * box the user types into from empty. Two of these questions arrive
 * pre-filled from the session, and a fixed box clips the last line of the
 * pre-fill — the user cannot see part of what they are being asked to
 * confirm. Growing to fit keeps MI's three-row floor as the minimum while
 * making the whole answer visible.
 */
function AutoSizingTextarea({
  value,
  onChange,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const element = ref.current;

    if (!element) {
      return;
    }

    // Collapse first so `scrollHeight` reports the content height rather than
    // the height already applied.
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
  }, []);

  // Before paint, so a pre-filled box is never briefly rendered clipped.
  useLayoutEffect(resize, [resize, value]);

  return <textarea {...rest} ref={ref} value={value} onChange={(event) => onChange(event.target.value)} />;
}
