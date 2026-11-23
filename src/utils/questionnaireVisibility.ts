import type { QuestionnaireField, QuestionnaireVisibilityRule } from '../types/questionnaire';

type AnswerValue = string | number | string[] | undefined;

export function conditionMatches(rule: QuestionnaireVisibilityRule | null | undefined, answers: Record<string, AnswerValue>) {
  if (!rule?.fieldId) return true;
  const current = answers[rule.fieldId];
  const values = Array.isArray(current) ? current.map(String) : [String(current ?? '')];
  const matches = values.includes(rule.value);
  return rule.operator === 'not_equals' ? !matches : matches;
}

export function visibleQuestionnaireFields(fields: QuestionnaireField[], answers: Record<string, AnswerValue>) {
  const visibleIds = new Set<string>();
  return fields.filter(field => {
    if (field.hidden) return false;
    if (field.visibility?.fieldId && !visibleIds.has(field.visibility.fieldId)) return false;
    const visible = conditionMatches(field.visibility, answers);
    if (visible) visibleIds.add(field.id);
    return visible;
  });
}
