export type QuestionnaireStatus = 'draft' | 'published' | 'closed';
export type QuestionnaireConditionOperator = 'equals' | 'not_equals';

export interface QuestionnaireVisibilityRule {
  fieldId: string;
  operator: QuestionnaireConditionOperator;
  value: string;
}
export type QuestionnaireFieldType =
  | 'short_text'
  | 'long_text'
  | 'single_choice'
  | 'multiple_choice'
  | 'number'
  | 'date'
  | 'phone'
  | 'email'
  | 'attachment'
  | 'rating'
  | 'section_break';

export interface QuestionnaireField {
  id: string;
  label: string;
  type: QuestionnaireFieldType;
  required: boolean;
  placeholder?: string;
  description?: string;
  hidden?: boolean;
  defaultValue?: string;
  visibility?: QuestionnaireVisibilityRule | null;
  optionDisplay?: 'vertical' | 'horizontal' | 'dropdown';
  options: string[];
  ratingMax?: number;
}

export interface QuestionnaireAttachment {
  fileId: string;
  fileName: string;
  fileSize: number;
  mimeType?: string;
}

export interface Questionnaire {
  id: string;
  title: string;
  description: string;
  status: QuestionnaireStatus;
  publicToken: string;
  fields: QuestionnaireField[];
  thankYouMessage?: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  submissionCount: number;
}

export interface QuestionnaireShareHistory {
  id: string;
  note: string;
  createdAt: string;
  lastUsedAt: string;
  useCount: number;
  shareToken: string;
}

export interface PublicQuestionnaireData {
  title: string;
  description: string;
  fields: QuestionnaireField[];
  thankYouMessage?: string;
}

export interface QuestionnaireSubmission {
  id: string;
  answers: Record<string, string | number | string[] | QuestionnaireAttachment>;
  submittedAt: string;
  status?: 'new' | 'viewed' | 'handled';
  updatedAt?: string;
  sourceUserId?: string;
  sourceUserName?: string;
  sourceNote?: string;
}

export interface QuestionnaireSubmissionRecord extends QuestionnaireSubmission {
  questionnaireId: string;
  questionnaireTitle: string;
  fields: QuestionnaireField[];
}

export interface QuestionnaireFieldStat {
  fieldId: string;
  label: string;
  type: QuestionnaireFieldType;
  required: boolean;
  answered: number;
  total: number;
  fillRate: number;
  isChoice: boolean;
  options: { option: string; count: number }[];
  otherCount: number;
}

export interface QuestionnaireWeeklyStat {
  key: string;
  label: string;
  count: number;
}

export interface QuestionnaireStats {
  total: number;
  allTotal: number;
  range: { from: string | null; to: string | null };
  summary: { weeklyAvg: number; weeklyPeak: number; countedWeeks: number };
  statusCounts: { new: number; viewed: number; handled: number };
  sourceCounts: { sourceUserName: string; count: number }[];
  weekly: QuestionnaireWeeklyStat[];
  fieldStats: QuestionnaireFieldStat[];
}
