import type { QuestionnaireField } from '../types/questionnaire';

export interface QuestionnaireTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  title: string;
  intro?: string;
  fields: QuestionnaireField[];
}

// 生成带唯一 id 的题目副本，避免共用引用
function makeFields(fields: Array<Partial<QuestionnaireField> & { id?: string }>): QuestionnaireField[] {
  return fields.map(field => ({
    ...field,
    id: field.id || `${field.type}-${Math.random().toString(36).slice(2, 10)}`,
  })) as QuestionnaireField[];
}

export const QUESTIONNAIRE_TEMPLATES: QuestionnaireTemplate[] = [
  {
    id: 'blank',
    name: '空白问卷',
    description: '从零开始创建，自由添加题目',
    icon: 'FilePlus2',
    title: '未命名问卷',
    fields: [],
  },
  {
    id: 'customer-need',
    name: '客户需求调查',
    description: '收集客户基本信息与业务需求',
    icon: 'Users',
    title: '客户需求调查问卷',
    intro: '为便于我们更准确地了解您的需求，请填写以下信息。',
    fields: makeFields([
      { label: '客户姓名', type: 'short_text', required: true },
      { label: '公司名称', type: 'short_text', required: true },
      { label: '联系电话', type: 'phone', required: true },
      { label: '电子邮箱', type: 'email', required: false },
      { label: '业务需求或关注事项', type: 'long_text', required: true, placeholder: '请简要描述您的需求' },
    ]),
  },
  {
    id: 'satisfaction',
    name: '客户满意度回访',
    description: '含 NPS 评分与改进建议，评估服务满意度',
    icon: 'Star',
    title: '客户满意度调查',
    intro: '感谢您接受回访，请根据真实感受作答，您的意见对我们很重要。',
    fields: makeFields([
      { label: '客户姓名', type: 'short_text', required: false },
      { label: '您对本次服务的整体满意度如何？', type: 'rating', required: true, ratingMax: 5 },
      { label: '您向朋友或同事推荐我们的可能性有多大？', type: 'rating', required: true, ratingMax: 10 },
      { label: '您认为我们做得最好的地方是？', type: 'single_choice', required: true, options: ['响应速度', '专业能力', '服务态度', '方案质量'] },
      { label: '您认为需要改进的地方是？', type: 'multiple_choice', required: false, options: ['响应速度', '专业能力', '服务态度', '方案质量', '价格'] },
      { label: '其他建议或意见', type: 'long_text', required: false },
    ]),
  },
  {
    id: 'event-register',
    name: '活动报名表',
    description: '收集活动报名信息与参与偏好',
    icon: 'Calendar',
    title: '活动报名表',
    intro: '请填写报名信息，我们将在活动前与您确认。',
    fields: makeFields([
      { label: '姓名', type: 'short_text', required: true },
      { label: '手机号', type: 'phone', required: true },
      { label: '电子邮箱', type: 'email', required: false },
      { label: '所在公司/单位', type: 'short_text', required: false },
      { label: '您的职位', type: 'short_text', required: false },
      { label: '是否确定参加本次线下活动？', type: 'single_choice', required: true, options: ['确定参加', '可能参加', '不参加'] },
      { label: '有无饮食忌口？', type: 'single_choice', required: false, optionDisplay: 'horizontal', options: ['无', '素食', '清真', '其他'] },
    ]),
  },
  {
    id: 'product-request',
    name: '产品需求收集',
    description: '收集产品功能建议与优先级',
    icon: 'Lightbulb',
    title: '产品需求收集',
    intro: '您的每个建议我们都认真对待，感谢您的反馈。',
    fields: makeFields([
      { label: '您的角色', type: 'single_choice', required: true, options: ['客户', '合作方', '内部同事'] },
      { label: '需求/建议标题', type: 'short_text', required: true },
      { label: '请详细描述您的需求或建议', type: 'long_text', required: true },
      { label: '该需求的紧急程度', type: 'single_choice', required: true, options: ['很紧急', '一般', '不紧急'] },
      { label: '如方便，请留下联系方式', type: 'phone', required: false },
    ]),
  },
];
