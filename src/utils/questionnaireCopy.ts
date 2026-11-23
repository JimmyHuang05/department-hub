import type { QuestionnaireField } from '../types/questionnaire';

export function questionnaireCopyTitle(value: string) {
  const title = String(value || '').trim() || '未命名问卷';
  return `${title}（副本）`;
}

export function cloneQuestionnaireFields(
  fields: QuestionnaireField[],
  createId: () => string,
): QuestionnaireField[] {
  const idMap = new Map(fields.map(field => [field.id, createId()]));
  return fields.map(field => ({
    ...field,
    id: idMap.get(field.id) as string,
    options: [...(field.options || [])],
    visibility: field.visibility
      ? { ...field.visibility, fieldId: idMap.get(field.visibility.fieldId) || field.visibility.fieldId }
      : null,
  }));
}
