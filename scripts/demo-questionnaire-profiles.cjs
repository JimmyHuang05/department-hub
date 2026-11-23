const field = (id, label, type, sample, extra = {}) => ({ id, label, type, sample, ...extra });
const single = (id, label, options, optionDisplay = 'vertical') =>
  field(id, label, 'single_choice', (index) => options[index % options.length], { options, optionDisplay, required: true });
const multiple = (id, label, options, optionDisplay = 'vertical') =>
  field(id, label, 'multiple_choice', (index) => index % 4 ? [options[index % options.length]] : [options[0], options[2]], { options, optionDisplay });
const section = (id, label, description) => field(id, label, 'section_break', null, { description });
const text = (id, label, sample, extra) => field(id, label, 'short_text', sample, extra);
const paragraph = (id, label, samples, extra) =>
  field(id, label, 'long_text', (index) => samples[index % samples.length], extra);
const rating = (id, label, max) =>
  field(id, label, 'rating', (index) => index % 13 === 0 ? 2 : max - index % Math.min(3, max), { ratingMax: max, required: true });
const date = (id, label) => field(id, label, 'date', (_index, { date }) => date);
const number = (id, label, base, span) => field(id, label, 'number', (index) => base + index * 17 % span);
const org = text('institution', '机构名称', (_index, { company }) => company, { required: true, placeholder: '填写机构全称' });
const email = field('email', '联系邮箱', 'email', (index) => `contact-${index + 1}@institution.example`);
const phone = field('phone', '联系电话', 'phone', (index) => `+1 202-555-01${String(index % 100).padStart(2, '0')}`);
const attachment = (label, visibility) => field('material', label, 'attachment', null, { visibility });
const equal = (fieldId, value) => ({ fieldId, value, operator: 'equals' });
const different = (fieldId, value) => ({ fieldId, value, operator: 'not_equals' });

module.exports = [
  {
    title: '机构客户年度服务满意度', description: '了解机构客户对报告、沟通及运营支持的实际体验。', status: 'published',
    fields: [
      section('overview', '服务体验', '请以最近一次业务往来为准。'), org,
      rating('overall', '整体满意度', 5), rating('reports', '报告清晰度', 5),
      single('followup', '是否希望客户经理回访', ['需要回访', '暂不需要'], 'horizontal'),
      { ...email, visibility: equal('followup', '需要回访'), required: true },
      paragraph('feedback', '改进建议', ['建议在月报首页增加指标摘要。', '希望估值差异能在对账单上直接标注。', '季度会议的频率合适。']),
    ],
  },
  {
    title: '跨境产品配置需求登记', description: '用于了解机构的配置偏好及资金安排。', status: 'published',
    fields: [
      org, single('currency', '计划配置币种', ['美元', '人民币', '港元', '多币种'], 'dropdown'),
      number('allocation', '预计配置规模（万元）', 800, 4900),
      multiple('assets', '关注资产类别', ['投资级债券', '现金管理工具', '多资产策略', '权益指数']),
      single('timing', '配置时间', ['本季度', '下季度', '暂未确定']),
      { ...date('target', '预计到款日期'), visibility: different('timing', '暂未确定') },
      text('route', '受理批次', null, { hidden: true, defaultValue: '机构配置需求' }),
    ],
  },
  {
    title: '合作机构准入材料提交', description: '登记机构信息并提交适用的资料清单。', status: 'published',
    fields: [
      section('entity', '主体资料', '请根据机构实际角色选择。'), org,
      single('entityType', '合作角色', ['交易对手', '渠道合作方', '资产服务方'], 'dropdown'),
      text('registration', '登记参考编号', (index) => `REG-${String(index + 1).padStart(5, '0')}`),
      section('support', '联系与材料', '可在提交材料前先登记经办方式。'),
      email, phone, attachment('准入材料清单'),
    ],
  },
  {
    title: '季度项目路演报名', description: '记录会议场次、参与方式和希望交流的议题。', status: 'published',
    fields: [
      text('department', '部门与职能', (index) => ['固定收益部', '资产配置部', '机构业务部'][index % 3], { required: true }),
      single('attendance', '参与方式', ['到场参会', '线上参会', '暂不参加'], 'horizontal'),
      single('session', '意向场次', ['上午场', '下午场'], 'horizontal'),
      { ...phone, visibility: equal('attendance', '到场参会') },
      { ...email, visibility: equal('attendance', '线上参会') },
      multiple('topics', '交流主题', ['投资级信用', '多币种组合', '组合风险', '交易结算'], 'horizontal'),
    ],
  },
  {
    title: '托管与估值问题反馈', description: '记录差异、影响和处理时限，便于运营团队跟进。', status: 'published',
    fields: [
      single('issue', '问题类别', ['估值差异', '交易结算', '账单数据', '其他'], 'dropdown'),
      date('observed', '发现日期'), number('count', '受影响记录数', 1, 37),
      single('severity', '影响级别', ['常规', '急需处理'], 'horizontal'),
      { ...phone, visibility: equal('severity', '急需处理'), required: true },
      paragraph('details', '问题描述', ['对账文件的净值精度与系统不同。', '同笔交易在两份对账单上的结算日期不一致。', '账单中缺少交易摘要。'], { required: true }),
      attachment('差异说明附件', equal('issue', '估值差异')),
    ],
  },
  {
    title: '管理报告阅读调研', description: '用于确定报告栏目、版式和发送频率。', status: 'published',
    fields: [
      multiple('chapters', '常用栏目', ['持仓变动', '风险指标', '净值表现', '月度摘要']),
      single('frequency', '期望发送频率', ['每周', '每月', '每季度'], 'dropdown'),
      rating('structure', '报告结构清晰度', 10),
      paragraph('example', '最希望补充一项什么内容', ['分类列示外汇敞口。', '增加本期调仓说明。', '附上指标口径对照表。']),
    ],
  },
  {
    title: '渠道资料交付回执', description: '收集渠道对资料接收、转交和补充要求的反馈。', status: 'published',
    fields: [
      section('receipt', '资料签收', '请选择文件当前所处的处理状态。'), org,
      single('delivery', '签收情况', ['已齐备', '部分缺失', '尚未收到'], 'horizontal'),
      { ...multiple('missing', '待补资料', ['产品说明', '对账单', '尽调摘要', '定期报告']), visibility: different('delivery', '已齐备') },
      { ...email, visibility: different('delivery', '已齐备') },
      date('received', '确认日期'),
    ],
  },
  {
    title: '运营交接信息登记', description: '记录项目交接范围、时间和后续处理安排。', status: 'published',
    fields: [
      text('reference', '项目编号', (index) => `OPS-${String(index + 1).padStart(5, '0')}`, { required: true }),
      date('handover', '计划交接日期'),
      multiple('scope', '交接材料', ['操作手册', '估值口径', '联络清单', '结算安排']),
      single('validation', '是否需要联合复核', ['需要', '已完成'], 'horizontal'),
      paragraph('risk', '待确认事项', ['需复核新版交易对账流程。', '部分历史归档待迁移。', '双方已确认职责分工。'], { visibility: equal('validation', '需要') }),
      attachment('交接清单附件'),
    ],
  },
  {
    title: '机构培训课程评价', description: '回收学员对课程内容和工具操作的反馈。', status: 'closed',
    fields: [
      single('course', '参加课程', ['项目台账', '管理周报', '运营协作'], 'dropdown'),
      rating('relevance', '内容与岗位的相关度', 5),
      rating('practice', '实操环节完成度', 5),
      paragraph('request', '希望增加的课程主题', ['数据汇总与导出。', '跨部门提醒的配置。', '历史报表的查阅。']),
    ],
  },
  {
    title: '下一季度客户走访计划', description: '部门内部正在评审的走访计划登记表。', status: 'draft',
    fields: [
      section('plan', '走访安排', '内部评审通过后发布。'), org,
      date('visit', '意向走访日期'),
      single('format', '走访形式', ['现场', '视频会议'], 'horizontal'),
      paragraph('agenda', '拟沟通议题', ['复盘季度合作情况。', '沟通追加配置计划。']),
    ],
  },
];
