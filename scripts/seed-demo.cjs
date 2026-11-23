const fs = require('node:fs');
const path = require('node:path');
const xlsx = require('xlsx');
const { createHash, randomBytes } = require('node:crypto');
const bcrypt = require('bcryptjs');

const output = path.resolve(process.argv[2] || 'demo-data');
if (fs.existsSync(output)) {
  throw new Error('Choose a new output directory. The demo generator never opens an existing database.');
}
fs.mkdirSync(output, { mode: 0o700 });
process.env.IBD_DATA_DIR = output;
process.env.IBD_DB_PATH = path.join(output, 'data.db');
for (const [name, directory] of Object.entries({
  IBD_ASSETS_DIR: 'assets',
  IBD_UPLOAD_DIR: 'assets/cloud-drive',
  IBD_SKILLS_DIR: 'assets/skills',
  IBD_TOOLS_DIR: 'assets/tools',
  IBD_WEEKLY_REPORT_DIR: 'assets/weekly-reports',
  IBD_TASK_ATTACHMENTS_DIR: 'assets/task-attachments',
})) process.env[name] = path.join(output, directory);
delete process.env.IBD_TEST_PASSWORD;
delete process.env.IBD_LOCAL_ADMIN_PASSWORD;

const { getDb, saveDbImmediate, closeDb } = require('../server/db.cjs');
const { getBusinessCurrentWeekKey, getPreviousWeekKey } = require('../server/services/weekRollover.cjs');
const { initialize } = require('../modules/questionnaire/server/schema.cjs');

const { CLOUD_DIR, SKILLS_DIR, HTML_TOOLS_DIR } = require('../server/paths.cjs');
const { QUESTIONNAIRE_UPLOAD_DIR } = require('../modules/questionnaire/server/runtimePaths.cjs');

const { createWeeklyReportRun, listAvailableWeeks, reportDateFromWeekKey, saveDraft } = require('../server/services/weeklySummary.cjs');

const roster = require('./demo-members.cjs');
const { seedCollaboration, auditTrail } = require('./demo-collaboration.cjs');

const admin = {
  id: 'IBD-00001', name: '林启明', team: '部门办公室', role: 'admin', businessRole: 'developer',
  joinedDaysAgo: 1815, inactiveDaysAgo: null,
};
const regions = ['华东', '华南', '华北', '华中', '西南', '西北', '东北', '长三角'];
const sectors = ['工业设备', '现代物流', '电子制造', '新能源材料', '商业服务', '食品供应链'];
const channels = ['机构直销', '银行代销', '券商渠道', '企业客户转介'];
const markets = ['美元', '人民币', '港元', '多币种'];
const strategies = ['稳健固收', '现金管理', '多资产配置', '跨境债券', '权益增强', '指数跟踪'];
const statuses = ['材料收集', '报告撰写', '上会中', '已过会', '已成立', '已成立', '已成立', '项目中止'];
const actions = ['核对产品条款', '补齐尽调材料', '更新估值说明', '复核投资限制', '汇总渠道反馈', '准备投委会材料', '确认托管流程', '整理存续报告'];
const findings = ['材料已经归档，等待交叉复核。', '已收到对手方反馈，需补一份流动性说明。', '本轮检查完成，下次会议确认交付时间。', '已更新内部测算，继续跟踪情景变化。', '相关团队已确认分工，待复核后提交。'];
const day = 86_400_000;
const now = new Date();
const dateAt = (days, sequence) => {
  const date = new Date(now.getTime() + days * day);
  if (sequence === undefined) return date.toISOString();
  date.setUTCHours(1 + sequence * 7 % 9, sequence * 13 % 60, sequence * 19 % 60, 0);
  return new Date(Math.min(date.getTime(), now.getTime())).toISOString();
};
const pick = (items, index) => items[index % items.length];
const padded = (number) => String(number).padStart(5, '0');
const keyFor = (kind, index) => `demo-${kind}-${padded(index + 1)}`;
const company = (index) => `${pick(regions, index)}${pick(sectors, Math.floor(index / regions.length))}集团（${String(index + 1).padStart(3, '0')}）`;
const json = JSON.stringify;

function availableMembers(users, date, through = date) {
  return users.filter(user => date >= dateAt(-user.joinedDaysAgo)
    && (!user.inactiveDaysAgo || through < dateAt(-user.inactiveDaysAgo)));
}

function seedUsers(db) {
  const inaccessiblePassword = bcrypt.hashSync(randomBytes(32).toString('hex'), 10);
  db.run("UPDATE users SET display_name=?, business_role='developer', birthday=?, created_at=? WHERE id=?", [admin.name, '1988-06-18', dateAt(-admin.joinedDaysAgo), admin.id]);
  return roster.map((profile, index) => {
    const user = { ...profile, id: `IBD-${padded(index + 2)}` };
    db.run('INSERT INTO users (id,display_name,password,role,business_role,status,email,birthday,created_at) VALUES (?,?,?,?,?,?,?,?,?)', [
      user.id, user.name, inaccessiblePassword, user.role, user.businessRole,
      user.inactiveDaysAgo ? 'disabled' : 'active', `member-${index + 1}@gco.example`, `${1983 + index % 17}-${String(1 + index % 12).padStart(2, '0')}-${String(1 + (index * 7) % 28).padStart(2, '0')}`, dateAt(-user.joinedDaysAgo),
    ]);
    return user;
  });
}

function seedProjects(db, users, audit) {
  return Array.from({ length: 480 }, (_, index) => {
    const status = pick(statuses, index + Math.floor(index / 11));
    const age = 25 + (index * 97) % 1690;
    const createdAt = dateAt(-age, index);
    const updatedAt = dateAt(-Math.floor(age * (index % 9) / 20), index + 21);
    const eligible = availableMembers(users, createdAt, status === '项目中止' ? updatedAt : dateAt(0));
    const managerPool = eligible.filter(user => user.id !== admin.id && user.businessRole !== 'intern');
    const manager = pick(managerPool.length ? managerPool : eligible, index);
    const backupPool = eligible.filter(user => user.id !== manager.id);
    const backup = index % 6 === 0 && manager.id !== admin.id ? admin
      : backupPool.length ? pick(backupPool, index + 5) : manager;
    const usd = (7 + (index * 31) % 149) * 100_000;
    const feeRate = Number((0.2 + (index % 19) * 0.045).toFixed(3));
    const product = {
      id: keyFor('project', index), createdAt, updatedAt,
      productName: `${pick(markets, index)}${pick(strategies, index * 5 + Math.floor(index / 7))}${String(index + 1).padStart(3, '0')}号`,
      client: company((index * 17) % 96),
      usd, rmb: Math.round(usd * 7.12), feeRate, status,
      projectCreatedDate: createdAt.slice(0, 10),
      establishDate: status === '已成立' ? dateAt(-Math.floor(age * 0.65)).slice(0, 10) : '',
      projectStoppedDate: status === '项目中止' ? updatedAt.slice(0, 10) : '',
      deadline: dateAt(7 + (index * 13) % 120).slice(0, 10),
      target: pick(['离岸投资级债券', '货币市场组合', '区域市场指数', '多币种债券组合'], index),
      brokerChannel: pick(channels, index + Math.floor(index / 7)),
      strategy: pick(strategies, index),
      custodianBank: `${pick(regions, index + 2)}托管中心`,
      tradingBroker: `${pick(regions, index + 5)}机构交易部`,
      annualIncome: Math.round(usd * feeRate / 100),
      thisYearIncome: Math.round(usd * feeRate * (40 + index % 56) / 10_000),
      performanceIncome: index % 4 === 0 ? 1_000 + (index * 123) % 20_000 : 0,
      activePassive: index % 4 === 0 ? '被动' : '主动',
      collectiveSingle: index % 3 === 0 ? '单一' : '集合',
      trustManager: manager.name, trustManagerB: backup.name,
      remarks: pick(findings, index), dynamicFields: {},
    };
    db.run('INSERT INTO products (id,data,created_by,updated_at) VALUES (?,?,?,?)', [
      product.id, json(product), manager.id, updatedAt,
    ]);
    audit(manager, 'product.create', 'product', product.id, product.productName, createdAt);
    if (index % 4 !== 0) audit(backup, 'product.update', 'product', product.id, `${product.productName} · ${status}`, updatedAt);
    return product;
  });
}

function seedWorkLogs(db, users, projects) {
  const currentWeek = getBusinessCurrentWeekKey(now);
  const weeks = [currentWeek];
  while (weeks.length < 157) weeks.push(getPreviousWeekKey(weeks.at(-1)));

  const membersByName = new Map(users.map(user => [user.name, user]));
  projects.forEach((project, index) => {
    const owner = membersByName.get(project.trustManager);
    const category = index % 13 === 0 ? '问题项目' : index % 9 === 0 ? '直销产品情况' : '正常项目';
    const entry = {
      id: keyFor('worklog', index), projectId: project.id, createdAt: project.createdAt,
      category, subCategory: category === '直销产品情况'
        ? pick(['固收系列', '含权系列', '权益类'], Math.floor(index / 9))
        : category === '正常项目' && index % 4 === 0 ? pick(['资产服务（主动管理）', '资产服务（事务管理）'], index / 4) : '',
      productName: project.productName, status: project.status === '已成立' ? '运行中' : project.status === '项目中止' ? '终止清算' : project.status === '已过会' ? '已过会' : '推进中', clientType: project.client,
      description: pick(findings, index), establishDate: project.establishDate, deadline: project.deadline,
      productTerm: pick(['6个月', '12个月', '24个月'], index),
      personA: owner.name, personB: project.trustManagerB,
      activePassive: project.activePassive, collectiveSingle: project.collectiveSingle,
      advisorManager: `${pick(regions, index + 3)}投资顾问团队`, channelSales: project.brokerChannel,
      features: project.target, managementReport: '已更新存续管理台账。',
      riskReport: pick(['未触发风险预警。', '继续跟踪集中度变化。', '等待复核运营风险事项。'], index),
      salesReport: '已汇总渠道反馈。', nextWeekPlan: pick(actions, index + 2),
      yearStartNav: 1,
      dynamicFields: category === '问题项目'
        ? { progressExpectation: pick(['符合预期', '部分符合预期', '延后复核'], index) }
        : {
            holdingsOver10: '投资级债券组合', equityAssetRatio: 8 + index % 24,
            warningLineStatus: pick(['未触及', '持续观察'], index),
            subscriptionRedemption: pick(['本周有申购', '本周有赎回', '份额保持稳定'], index),
          },
    };
    const weeklyProgress = {};
    const navScaleHistory = {};
    for (let offset = weeks.length - 1; offset >= 0; offset--) {
      const weekKey = weeks[offset];
      const updatedAt = dateAt(-offset * 7);
      if (updatedAt < project.createdAt) continue;
      const oldWeek = weeks[offset + 12];
      delete weeklyProgress[oldWeek];
      delete navScaleHistory[oldWeek];
      const nav = Number((0.97 + ((index * 11 + (156 - offset) * 7) % 1050) / 10_000).toFixed(4));
      const navScale = `净值 ${nav.toFixed(4)} / 规模 ${(project.usd / 1_000_000 * nav).toFixed(2)} 百万美元`;
      weeklyProgress[weekKey] = `${pick(actions, index + offset * 3)}。${pick(findings, index * 2 + offset)}`;
      navScaleHistory[weekKey] = navScale;
      const dayKey = updatedAt.slice(0, 10);
      const historicalStatus = project.establishDate && dayKey >= project.establishDate ? '运行中'
        : project.projectStoppedDate && dayKey >= project.projectStoppedDate ? '终止清算'
        : project.status === '已过会' && dayKey >= project.updatedAt.slice(0, 10) ? '已过会' : '推进中';
      const record = {
        ...entry, status: offset ? historicalStatus : entry.status,
        weekKey, updatedAt, nav, navScale, changePercent: Number(((nav - 1) * 100).toFixed(2)),
        weeklyProgress, navScaleHistory,
        reviewStatus: offset ? 'approved' : pick(['draft', 'submitted', 'returned', 'approved'], index),
      };
      if (offset) {
        db.run('INSERT INTO entry_snapshots (id,week_key,entry_id,data,created_by,snapshot_at) VALUES (?,?,?,?,?,?)', [
          `${weekKey}:${entry.id}`, weekKey, entry.id, json(record), owner.id, updatedAt,
        ]);
      } else {
        db.run('INSERT INTO entries (id,data,created_by,updated_at,week_key) VALUES (?,?,?,?,?)', [
          entry.id, json(record), owner.id, updatedAt, weekKey,
        ]);
      }
    }
  });
}

function writeAsset(directory, fileName, contents) {
  fs.mkdirSync(directory, { recursive: true });
  const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8');
  fs.writeFileSync(path.join(directory, fileName), bytes, { flag: 'wx' });
  return bytes;
}

function seedCloud(db, users, projects, audit) {
  const folders = ['项目尽调', '存续管理', '渠道沟通', '季度复盘', '投委会材料', '风险台账', '客户回访', '操作指引'];
  const formats = [
    { ext: 'txt', mime: 'text/plain', title: '会议纪要' },
    { ext: 'csv', mime: 'text/csv', title: '进度台账' },
    { ext: 'md', mime: 'text/markdown', title: '资料核对清单' },
    { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', title: '规模测算' },
  ];
  const insert = (id, record) => db.run('INSERT INTO clouddrive_files (id,data) VALUES (?,?)', [id, json(record)]);
  folders.forEach((fileName, index) => {
    insert(keyFor('folder', index), {
      fileName, kind: 'folder', parentId: '', uploadedAt: dateAt(-1800 + index * 9, index),
      uploadedBy: admin.name, uploadedById: admin.id, fileSize: 0, mimeType: 'application/x-directory',
    });
  });
  for (let index = 0; index < 40; index++) {
    const year = dateAt(-365 * Math.floor(index / 8)).slice(0, 4);
    const folderCreatedAt = `${year}-01-01T00:00:00.000Z`;
    const uploadedAt = folderCreatedAt < dateAt(-1730) ? dateAt(-1730, index) : folderCreatedAt;
    const owner = pick(availableMembers(users, uploadedAt), index * 7);
    insert(keyFor('subfolder', index), {
      fileName: `${year}年度资料`, kind: 'folder', parentId: keyFor('folder', index % 8),
      uploadedAt,
      uploadedBy: owner.name, uploadedById: owner.id, fileSize: 0, mimeType: 'application/x-directory',
    });
  }
  for (let index = 0; index < 360; index++) {
    const format = pick(formats, index + Math.floor(index / 7));
    const id = keyFor('file', index);
    const storedName = `${id}.${format.ext}`;
    const folder = index % 40;
    const year = dateAt(-365 * Math.floor(folder / 8)).slice(0, 4);
    const yearStart = Math.max(Date.parse(`${year}-01-01T00:00:00.000Z`), Date.parse(dateAt(-1690)));
    const yearEnd = Math.min(Date.parse(`${Number(year) + 1}-01-01T00:00:00.000Z`), now.getTime());
    const yearPosition = ((index * 157 + 89) % 997) / 998;
    const uploadedAt = new Date(yearStart + Math.floor((yearEnd - yearStart) * yearPosition)).toISOString();
    const existingProjects = projects.filter(project => project.createdAt <= uploadedAt);
    const project = pick(existingProjects, index * 11);
    const owner = pick(availableMembers(users, uploadedAt), index * 5 + Math.floor(index / 3));
    const fileName = `${format.title}－${project.productName}.${format.ext}`;
    const lines = [
      ['项目', '客户机构', '负责人', '状态', '下一步'],
      [project.productName, project.client, owner.name, project.status, pick(actions, index)],
    ];
    let contents = `# ${format.title}\n\n${project.productName}\n\n- 日期：${uploadedAt.slice(0, 10)}\n- 负责人：${owner.name}\n- 进展：${pick(findings, index)}\n- 下一步：${pick(actions, index)}\n`;
    if (format.ext === 'csv') contents = '\uFEFF' + lines.map(row => row.join(',')).join('\r\n');
    if (format.ext === 'xlsx') {
      const workbook = xlsx.utils.book_new();
      const sheet = xlsx.utils.aoa_to_sheet([...lines, ['测算规模（美元）', project.usd]]);
      xlsx.utils.book_append_sheet(workbook, sheet, '业务测算');
      contents = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    }
    const bytes = writeAsset(CLOUD_DIR, storedName, contents);
    const deletedAt = index % 29 === 0 && uploadedAt < dateAt(-4) ? dateAt(-2, index) : null;
    insert(id, {
      kind: 'file', storedName, fileName,
      fileSize: bytes.length, mimeType: format.mime, parentId: keyFor('subfolder', folder),
      projectId: project.id, projectName: project.productName, uploadedAt,
      uploadedBy: owner.name, uploadedById: owner.id,
      ...(deletedAt ? { deletedAt, deletedBy: admin.name, deletedById: admin.id } : {}),
    });
    audit(owner, 'clouddrive.upload', 'clouddrive', id, fileName, uploadedAt);
    if (deletedAt) audit(admin, 'clouddrive.trash', 'clouddrive', id, fileName, deletedAt);
  }
}

function seedLibrary(db, users, audit) {
  const categories = ['项目管理', '报告写作', '数据分析', '合规复核', '客户沟通', '知识管理'];
  const names = [
    '尽调清单整理', '周报初稿提纲', '净值变动归因', '投资限制复核', '访谈纪要整理', '制度文档索引',
    '投委会材料校对', '季度复盘归纳', '规模测算复核', '材料完整性检查', '渠道反馈分类', '资料归档规则',
    '项目状态核验', '运营异常小结', '指标口径对照', '估值复核记录', '回访提纲生成', '业务术语维护',
    '立项材料复查', '研究摘要整理', '问卷结果概览', '风险记录复盘', '客户问题归类', '新人交接清单',
  ];
  const toolNames = ['费率试算', '周报清单', '汇率换算', '项目状态看板', '问卷指标预览', '文件命名检查'];
  [...names, ...toolNames].forEach((name, index) => {
    const isSkill = index < names.length;
    const id = keyFor(isSkill ? 'skill' : 'tool', index);
    const category = pick(categories, index);
    const createdAt = dateAt(-1580 + (index * 127) % 1350, index);
    const versionCount = 2 + index % 3;
    const updatedAt = new Date(Math.max(Date.parse(createdAt) + 30 * day, Date.parse(dateAt(-3 - (index * 37) % 950)))).toISOString();
    const eligible = availableMembers(users, createdAt, updatedAt);
    const owner = pick(eligible, index * 7);
    const versionId = (number) => `${id}-v${number}`;
    const type = isSkill ? 'skill' : 'html_tool';
    const description = `用于${category}场景，包含输入要求、操作步骤和复核要点。`;
    db.run('INSERT INTO tool_items (id,type,name,description,category,status,visibility,current_version_id,created_by,created_by_name,created_at,updated_at,view_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [
      id, type, name, description, category, index % 7 ? 'active' : 'draft', 'internal',
      versionId(versionCount), owner.id, owner.name, createdAt, updatedAt, (index * 31) % 600,
    ]);
    for (let number = 1; number <= versionCount; number++) {
      const fileName = isSkill ? 'SKILL.md' : 'index.html';
      const content = isSkill
        ? `---\nname: ${id}\ndescription: ${description}\n---\n\n# ${name}\n\n## 输入\n- 项目材料及其记录日期。\n- 已知的业务口径与复核负责人。\n\n## 步骤\n1. ${pick(actions, index)}。\n2. 标记来源、待确认项及其负责人。\n3. 以清单呈现结论，并保留可追溯的复核记录。\n\n## 输出\n提供业务摘要、口径说明、缺项和下一步计划。\n\n修订版：${number}\n`
        : `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${name}</title><h1>${name}</h1><p>业务参考 · 第 ${number} 版</p><dl><dt>当前状态</dt><dd>${pick(statuses, index)}</dd><dt>复核事项</dt><dd>${pick(actions, index)}</dd></dl></html>`;
      const bytes = writeAsset(path.join(isSkill ? SKILLS_DIR : HTML_TOOLS_DIR, id, `v${number}`), fileName, content);
      const uploadedAt = new Date(Date.parse(createdAt) + (Math.max(Date.parse(updatedAt), Date.parse(createdAt)) - Date.parse(createdAt)) * (number - 1) / (versionCount - 1)).toISOString();
      const reviewerPool = availableMembers(users, uploadedAt).filter(user => user.team === owner.team && user.id !== owner.id);
      const uploader = number === 1 || !reviewerPool.length ? owner : pick(reviewerPool, number + index);
      audit(uploader, `${isSkill ? 'skill' : 'tool'}.${number === 1 ? 'upload' : 'update'}`, 'tool_center',
        id, `${name} · 1.${number - 1}.0`, uploadedAt);
      db.run('INSERT INTO tool_versions (id,item_id,version_no,version_label,file_name,stored_name,stored_path,file_size,mime_type,checksum,changelog,uploaded_by,uploaded_by_name,uploaded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
        versionId(number), id, number, `1.${number - 1}.0`, fileName, fileName, '', bytes.length,
        isSkill ? 'text/markdown' : 'text/html', createHash('sha256').update(bytes).digest('hex'),
        pick(['初次发布', '补充输入案例', '更新复核步骤'], number - 1), uploader.id, uploader.name, uploadedAt,
      ]);
    }
  });
}

function seedQuestionnaires(db, users, audit) {
  const { _test: { normalizeFields, validateAnswers, getVisibleFieldIds } } = require('../modules/questionnaire/server/router.cjs');
  const profiles = require('./demo-questionnaire-profiles.cjs');

  profiles.forEach(({ title, description, status, fields: blueprint }, index) => {
    const id = keyFor('survey', index);
    const surveyAge = 45 + (index * 139) % 1250;
    const createdAt = dateAt(-surveyAge);
    const updatedAt = dateAt(-Math.floor(surveyAge / 5), index);
    const authors = availableMembers(users, createdAt, updatedAt).filter(user => user.id !== admin.id);
    const author = authors.length ? pick(authors, index * 11) : admin;
    const fields = normalizeFields(blueprint);
    if (!fields) throw new Error(`Invalid questionnaire fields: ${title}`);
    const fieldsJson = json(fields);
    db.run('INSERT INTO questionnaires (id,title,description,status,public_token,fields_json,thank_you_message,created_by,created_by_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [
      id, title, description, status, id, fieldsJson, '感谢提交。我们会根据反馈安排后续工作。', author.id, author.name, createdAt, updatedAt,
    ]);
    audit(author, 'questionnaire.create', 'questionnaire', id, title, createdAt);
    if (status === 'draft') return;
    audit(author, 'questionnaire.update', 'questionnaire', id, `${title} · ${status === 'closed' ? '停止收集' : '更新发布版本'}`, updatedAt);

    db.run('INSERT INTO questionnaire_versions (id,questionnaire_id,version_no,fields_json,created_at,created_by,reason) VALUES (?,?,?,?,?,?,?)', [
      `${id}-v1`, id, 1, json(normalizeFields(blueprint.slice(0, -1))), createdAt, author.id, '首次发布',
    ]);
    db.run('INSERT INTO questionnaire_versions (id,questionnaire_id,version_no,fields_json,created_at,created_by,reason) VALUES (?,?,?,?,?,?,?)', [
      `${id}-v2`, id, 2, fieldsJson, updatedAt, author.id, '更新问题及填写说明',
    ]);
    const shareSources = ['机构客户邮件', '季度沟通会议'];
    const shareActors = [author, admin];
    const sharedAt = dateAt(-surveyAge + 1);
    shareSources.forEach((note, channel) => {
      const actor = shareActors[channel];
      db.run('INSERT INTO questionnaire_share_history (id,questionnaire_id,user_id,user_name,note,created_at,last_used_at,use_count) VALUES (?,?,?,?,?,?,?,?)', [
        `${id}-share-${channel + 1}`, id, actor.id, actor.name, note, sharedAt, updatedAt, 2 + (index * 3 + channel) % 15,
      ]);
    });

    for (let response = 0; response < 185 + (index * 59) % 280; response++) {
      const captureWindow = status === 'closed' ? surveyAge - Math.floor(surveyAge / 5) : surveyAge;
      const responseAge = surveyAge - 1 - (response * 17 + index) % (captureWindow - 1);
      const submittedAt = dateAt(-responseAge, response + index);
      const submissionId = `${id}-answer-${padded(response + 1)}`;
      const sampleIndex = response * 7 + index;
      const context = { date: submittedAt.slice(0, 10), company: company((response * 13 + index) % 96) };
      const input = Object.fromEntries(blueprint.filter(item => item.sample).map(item => [item.id, item.sample(sampleIndex, context)]));
      const visible = getVisibleFieldIds(fields, input);
      const uploadedAttachments = {};
      if (visible.has('material') && response % 9 === 0) {
        const storedName = `${submissionId}.txt`;
        const fileName = `${title}补充材料.txt`;
        const mimeType = 'text/plain';
        const fileSize = writeAsset(QUESTIONNAIRE_UPLOAD_DIR, storedName,
          `${title}\n机构：${context.company}\n记录日期：${context.date}\n事项：${pick(findings, response)}\n`).length;
        uploadedAttachments.material = { storedName, fileName, mimeType, fileSize };
      }
      const { answers, error } = validateAnswers(fields, input, uploadedAttachments);
      if (error) throw new Error(`${title}: ${error}`);
      const sourceActor = response % 3 ? pick(shareActors, response) : null;
      const sourceNote = sourceActor ? pick(shareSources, response) : '';
      const responseStatus = responseAge <= 3 ? pick(['new', 'new', 'viewed'], response) : pick(['new', 'viewed', 'handled', 'handled', 'handled'], response + index);
      const handledAt = responseStatus === 'new' ? submittedAt : new Date(Math.min(now.getTime(), Date.parse(submittedAt) + (2 + response % 46) * 3_600_000)).toISOString();
      if (responseStatus !== 'new' && response % 6 === 0) {
        const reviewer = availableMembers(users, handledAt).find(user => user.team === author.team) || admin;
        audit(reviewer, 'questionnaire.submission.status', 'questionnaire_submission', submissionId, responseStatus, handledAt);
      }
      db.run('INSERT INTO questionnaire_submissions (id,questionnaire_id,answers_json,submitted_at,updated_at,status,source_user_id,source_user_name,source_note) VALUES (?,?,?,?,?,?,?,?,?)', [
        submissionId, id, json(answers), submittedAt, handledAt, responseStatus,
        sourceActor?.id || '', sourceActor?.name || '', sourceNote,
      ]);
      if (uploadedAttachments.material) {
        const { fileName, storedName, fileSize, mimeType } = uploadedAttachments.material;
        db.run('INSERT INTO questionnaire_attachments (id,submission_id,questionnaire_id,field_id,file_name,stored_name,file_size,mime_type,created_at) VALUES (?,?,?,?,?,?,?,?,?)', [
          `${submissionId}-material`, submissionId, id, 'material', fileName, storedName, fileSize, mimeType, submittedAt,
        ]);
      }
    }
  });
}

function weeklyReportNotes(index) {
  const milestones = [
    ['完成季度流动性压力测试，重点跟踪美元头寸到期安排。', '两项跨境债券策略进入投委会材料复核。'],
    ['完成托管对账抽样，已将两处估值口径差异登记在案。', '下周复核渠道回访记录及待补材料。'],
    ['已召开存续产品复盘会，更新风险台账和负责人。', '新一批客户资料按风险等级分组推进。'],
    ['完成多币种组合复核，已确认再平衡执行窗口。', '资产服务组将集中确认下月客户沟通计划。'],
    ['整理三类业务的交易与估值口径，完成跨部门交叉复核。', '下周优先跟进有到期安排的项目。'],
  ];
  const total = 18;
  const usage = 9.4 + (index * 17 % 65) / 10;
  return {
    highlights: pick(milestones, index),
    qdQuota: `核定额度 ${total.toFixed(2)} 亿美元，已使用 ${usage.toFixed(2)} 亿美元，使用率 ${(usage / total * 100).toFixed(1)}%。`,
    fixedIncomeTeam: '固收研究组', optionTeam: '多资产策略组',
    equityTeam: '权益研究组', serviceTeam: '资产服务组',
  };
}

async function seedWeeklyReports(db, users, audit) {
  const weeks = listAvailableWeeks(db).slice(0, 104);
  for (const [index, weekKey] of weeks.entries()) {
    const notes = weeklyReportNotes(index);
    const friday = new Date(`${reportDateFromWeekKey(weekKey)}T08:15:00.000Z`);
    const draftAt = new Date(Math.min(now.getTime(), friday.getTime() - 2 * day)).toISOString();
    saveDraft(db, weekKey, admin.id, notes, draftAt);
    if (index > 0 && (index <= 6 || index % 5 === 0)) {
      const generatedAt = friday.toISOString();
      const eligible = availableMembers(users, generatedAt).filter(user => user.role === 'admin' || ['资产服务', '固收研究', '风险合规'].includes(user.team));
      const author = pick(eligible, Math.floor(index / 2));
      if (author.id !== admin.id) saveDraft(db, weekKey, author.id, notes, draftAt);
      const run = await createWeeklyReportRun(db, {
        weekKey, notes, user: { id: author.id, display_name: author.name }, generatedAt,
      });
      audit(author, 'weekly-report.generate', 'weekly-report', run.id, `${weekKey} · ${run.fileName}`, generatedAt);
    }
  }
}

async function main() {
  const db = await getDb();
  initialize();
  db.run('PRAGMA foreign_keys = ON');
  db.run('BEGIN');
  try {
    db.run('INSERT INTO settings (id,data,updated_at) VALUES (?,?,?)', ['demo-dataset', json({ synthetic: true }), dateAt(0)]);
    const users = [admin, ...seedUsers(db)];
    const audit = auditTrail(db);
    db.run('INSERT INTO user_preferences (user_id,ui_state,updated_at) VALUES (?,?,?)', [
      admin.id, json({ worklogOnlyMine: false }), dateAt(0),
    ]);
    const projects = seedProjects(db, users, audit);
    seedWorkLogs(db, users, projects);
    seedCollaboration(db, users, projects, { now, keyFor, writeAsset, audit });
    seedCloud(db, users, projects, audit);
    seedLibrary(db, users, audit);
    seedQuestionnaires(db, users, audit);
    await seedWeeklyReports(db, users, audit);
    if (db.exec('PRAGMA foreign_key_check').length) throw new Error('Invalid demo record references');
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
  saveDbImmediate();
  closeDb();
  console.log(`演示数据库已生成到 ${process.env.IBD_DB_PATH}`);
}

main().catch((error) => {
  closeDb();
  console.error(error);
  process.exitCode = 1;
});


