const path = require('node:path');
const { TASK_ATTACHMENTS_DIR } = require('../server/paths.cjs');
const { createNotification, taskAudience } = require('../server/services/notifications.cjs');

const DAY = 86_400_000;
const HOUR = 3_600_000;
const stages = { todo: '待处理', in_progress: '进行中', waiting: '待回复', done: '已完成', cancelled: '已取消' };
const regions = ['east', 'central', 'west', 'north', 'south'];

const taskStories = [
  {
    title: '核对准入资料',
    request: '核对营业执照、授权范围和联系人。主体名称与前期底稿不一致的，请列明差异。',
    progress: '主体登记信息已核过，授权书的签署日期还需要和业务方对一下。',
    review: '旧授权书仍在有效期内，但覆盖范围少了一项。请在清单里标明补件要求。',
    done: '补充授权书已收齐，已更新准入清单和联络记录。',
    waiting: '资料已退回补充，收到签章版再继续审核。',
    attachment: '准入材料核对表',
  },
  {
    title: '复核托管对账',
    request: '按交易流水、托管对账单和内部台账逐笔核对结算日期、净额与币种。',
    progress: '本金能对上，有两笔结算费在托管单里合并列示，明细还在拆分。',
    review: '请把费用差异和净值差异分开列，便于运营统一给托管方发确认。',
    done: '托管方已确认两笔费用归属，内部台账和归档文件已同步。',
    waiting: '差异明细已发托管方，等对方确认费用计提口径。',
    attachment: '对账差异核对记录',
  },
  {
    title: '更新估值说明',
    request: '补充估值来源、取价时点和异常处理口径，保留上一版说明。',
    progress: '取价时点已补上，正在确认非交易日用前一日估值还是周末价格。',
    review: '请在脚注写明缺失价格的处理，并标出这次调整从哪期报表起生效。',
    done: '已按复核意见更新说明，并在报表附注加了生效日期。',
    waiting: '需要确认供应商对停牌标的的取价规则，先保留原口径。',
    attachment: '估值口径修订说明',
  },
  {
    title: '准备投委会材料',
    request: '整合方案摘要、历史回撤、约束条件和风险应对措施，供会前预读。',
    progress: '主体材料整理完了，压力情景还差外汇部分的两组测算。',
    review: '收益和风险放在同一张摘要表，方案里的调整点另外标一页。',
    done: '会前材料已归档，摘要和测算口径都已复核。',
    waiting: '还缺风控页的复核意见，先不发会议材料。',
    attachment: '投委会会前事项清单',
  },
  {
    title: '整理季度回访纪要',
    request: '记录客户对报告频率、配置方向和后续沟通安排的意见，明确需要回访的事项。',
    progress: '已经完成两轮沟通，会后补发了报告说明和预计出具日期。',
    review: '请把客户明确要求和可选建议分开写，避免下次跟进时遗漏。',
    done: '纪要已纳入客户联络记录，下一次回访由项目团队跟进。',
    waiting: '对方尚未确认参会人，下周再约一次简短沟通。',
    attachment: '季度回访事项清单',
  },
  {
    title: '检查投资限制',
    request: '复核币种、集中度和久期限制，检查拟调整组合在压力情景下的余量。',
    progress: '集中度仍在约束范围内，久期接近内部观察线。',
    review: '请把最大单一发行人和行业集中度都列出来，注明测算日期。',
    done: '限制检查通过，观察项目已加入下一轮风险复核。',
    waiting: '交易台还在确认拟调整指令，等最新头寸再重算。',
    attachment: '投资约束复核表',
  },
  {
    title: '汇总申赎与资金安排',
    request: '汇总预计申赎、产品现金余额和后续到期安排，标明资金缺口及责任人。',
    progress: '预计赎回已汇总，机构直销端还有一笔金额未最终确认。',
    review: '把预计到账和确认到账分开，实际头寸表月底前再核一次。',
    done: '到账确认已同步给交易团队，现金安排按新版表执行。',
    waiting: '还未收到最终赎回指令，资金安排先保留缓冲。',
    attachment: '现金安排跟踪表',
  },
  {
    title: '发布存续管理报告',
    request: '更新净值、规模及当期变化说明，核对定期报告附件与接收名单。',
    progress: '规模字段已更正，正在检查报告里是否还有引用旧数据的表格。',
    review: '请同时核对正文和摘要附件，并把历史版本存到归档目录。',
    done: '定期报告已提交，归档目录保留了上一期的完整版本。',
    waiting: '当期估值表未定稿，暂缓发送存续报告。',
    attachment: '报告出具复核清单',
  },
  {
    title: '梳理权限交接',
    request: '逐项确认到期权限、交接负责人和业务连续性安排。',
    progress: '各系统联络人已经核对，归档目录的负责人还待确认。',
    review: '明天先复核交接清单中的共享目录，之后再归档旧版本。',
    done: '交接清单已确认并归档，后续由资产服务组维护。',
    waiting: '原负责人本周休假，已约下一次交接时间。',
    attachment: '权限交接记录',
  },
  {
    title: '补充运营问题台账',
    request: '记录问题来源、影响范围、临时处理与待确认口径，便于下次例会跟进。',
    progress: '已补上受影响范围及临时处理步骤，正在复核首笔样本。',
    review: '处理纪要补一个回溯范围，外部说明里先不写未确认的数字。',
    done: '相关账务已核对，已向业务方反馈最终处理结果。',
    waiting: '供应方反馈还在复核，待收到确认后更新结论。',
    attachment: '运营问题跟踪清单',
  },
  {
    title: '汇总部门月度台账',
    request: '复核部门月度项目、问卷和资料移交情况，标出需要跨组跟进的条目。',
    progress: '项目部分已回收，问卷答复和资料移交还有一个团队未填。',
    review: '重复事项合并一下，未关闭的工作都保留下一次跟进时间。',
    done: '台账已完成交叉核对，未关闭事项已分派。',
    waiting: '正在等最后一个团队确认月度统计口径。',
    attachment: '月度事项复核记录',
  },
];

const notices = [
  {
    title: '管理周报收集',
    content: '本周请更新项目进展和下步安排。完成记录若涉及跨组交接，请在台账中标明接手人。',
    audience: 'team',
  },
  {
    title: '托管对账截点调整',
    content: '本批对账单请于工作日下午完成复核。发现币种、日期或金额不一致的记录，请单独说明。',
    audience: 'partners',
  },
  {
    title: '定期报告归档提醒',
    content: '报告定稿后请同时归档正文和估值表。若本期沿用上期口径，请保留原版本和修改说明。',
    audience: 'team',
  },
  {
    title: '客户回访材料准备',
    content: '请提前准备月度摘要、最近一期估值及上次回访记录。本次沟通重点是报告体验和配置方向。',
    audience: 'small',
  },
  {
    title: '本月文件夹归档规则',
    content: '请按业务线与月份归档交付文件。草稿保留在小组目录，定稿只在业务归档目录留一份。',
    audience: 'department',
  },
  {
    title: '产品风险复核安排',
    content: '下一轮复核将重点检查集中度和现金头寸。请提前提交近一期的持仓变动和待确认口径。',
    audience: 'partners',
  },
  {
    title: '本周项目复盘会场次',
    content: '请勾选方便参会的时段。议题是近期项目推进、问题处置和跨组依赖。',
    audience: 'partners',
    options: ['周二上午', '周三下午', '周四下午'],
  },
  {
    title: '下期管理报告栏目征集',
    content: '下期报告计划补充一个常用栏目。请选出最希望优先看到的内容。',
    audience: 'department',
    options: ['头寸与敞口', '项目里程碑', '净值波动解释', '待办汇总'],
  },
  {
    title: '运营培训方式确认',
    content: '培训将讲解台账、对账和文件归档的常用流程。请按日程选择参与方式。',
    audience: 'team',
    options: ['线下实操', '线上直播', '会后观看回放'],
  },
  {
    title: '季度客户反馈已汇总',
    content: '资料交付和评估口径是反馈最多的两项。各组的跟进清单已整理，可据此安排下一次回访。',
    audience: 'small',
  },
];

function randomSource(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function activityTools(now) {
  const random = randomSource(4837);
  const integer = (max) => Math.floor(random() * max);
  const pick = (items) => items[integer(items.length)];
  const iso = (value) => new Date(value).toISOString();
  const at = (user, wantedAge) => {
    const oldest = user.joinedDaysAgo - 5;
    const newest = (user.inactiveDaysAgo || 0) + 1;
    const date = new Date(now - Math.max(newest, Math.min(oldest, wantedAge)) * DAY);
    const weekday = date.getUTCDay();
    if (weekday === 0 || weekday === 6) date.setUTCDate(date.getUTCDate() - (weekday === 0 ? 2 : 1));
    date.setUTCHours(1 + integer(9), integer(60), integer(57), 0);
    return date.getTime();
  };
  const sample = (items, count) => {
    const candidates = [...items];
    const result = [];
    while (candidates.length && result.length < count) result.push(candidates.splice(integer(candidates.length), 1)[0]);
    return result;
  };
  const canParticipate = (user, from, until = from) => from >= now - user.joinedDaysAgo * DAY
    && (!user.inactiveDaysAgo || until < now - user.inactiveDaysAgo * DAY);
  return { now, integer, pick, iso, at, sample, canParticipate, probability: random };
}

function auditTrail(db) {
  let sequence = 0;
  return (user, action, targetType, targetId, detail, timestamp) => {
    db.run(`INSERT INTO audit_log
      (id,user_id,user_name,action,target_type,target_id,detail,created_at) VALUES (?,?,?,?,?,?,?,?)`, [
      `demo-audit-${String(++sequence).padStart(6, '0')}`, user.id, user.name,
      action, targetType, targetId, detail, timestamp,
    ]);
  };
}

function deliveryRecorder(db, tools) {
  const { now, iso, probability, integer } = tools;
  return (id, sender, recipients, data) => {
    const created = Date.parse(data.createdAt);
    if (recipients.length === 0) return;
    const result = createNotification(db, {
      ...data, id, senderId: sender.id, senderName: sender.name,
      recipientIds: recipients.map(user => user.id),
    });
    const recipientById = new Map(recipients.map(user => [user.id, user]));
    for (const userId of result.recipientIds) {
      const { inactiveDaysAgo } = recipientById.get(userId);
      const lastActive = inactiveDaysAgo ? now - inactiveDaysAgo * DAY - 60_000 : now;
      if (lastActive <= created) continue;
      const age = (lastActive - created) / DAY;
      const expires = data.expiresAt ? Date.parse(data.expiresAt) : lastActive;
      const voteWindow = data.componentData?.options?.length && Math.min(expires, lastActive) - created;
      const vote = voteWindow > 0 && (age >= 1 || probability() < 0.45) && probability() < 0.62
        ? created + Math.round(voteWindow * (0.1 + probability() * 0.8))
        : null;
      const read = vote || (probability() < (age > 45 ? 0.97 : age > 7 ? 0.89 : 0.68)
        ? Math.min(lastActive, created + (10 + integer(age > 7 ? 2880 : 560)) * 60_000)
        : null);
      const archive = read && age > 24 && probability() < 0.14 ? Math.min(lastActive, read + (1 + integer(12)) * DAY) : null;
      if (read) {
        db.run('UPDATE notification_recipients SET read_at=?,archived_at=? WHERE notification_id=? AND user_id=?',
          [iso(read), archive ? iso(archive) : null, id, userId]);
      }
      if (archive) db.run('INSERT INTO notification_archives (notification_id,user_id,archived_at) VALUES (?,?,?)', [id, userId, iso(archive)]);
      if (vote) db.run('INSERT INTO notification_votes (notification_id,user_id,option_index,voted_at) VALUES (?,?,?,?)', [
        id, userId, integer(data.componentData.options.length), iso(vote),
      ]);
    }
  };
}

function chooseTaskStatus(age, probability) {
  if (age < 4) {
    if (probability < 0.44) return 'todo';
    if (probability < 0.79) return 'in_progress';
    return probability < 0.92 ? 'waiting' : 'done';
  }
  if (age < 40) {
    if (probability < 0.18) return 'todo';
    if (probability < 0.49) return 'in_progress';
    if (probability < 0.65) return 'waiting';
    return probability < 0.95 ? 'done' : 'cancelled';
  }
  if (probability < 0.88) return 'done';
  if (probability < 0.96) return 'cancelled';
  return 'waiting';
}

function writeTaskAttachment(writeAsset, taskId, title, story, creator, submittedAt, status) {
  const id = `${taskId}-attachment`;
  const storedName = `${id}.txt`;
  const fileName = `${story.attachment}.txt`;
  const contents = `${title}\n\n提交人：${creator.name}\n记录时间：${submittedAt}\n处理说明：${story.progress}\n复核事项：${story.review}\n状态：${stages[status]}\n`;
  const bytes = writeAsset(TASK_ATTACHMENTS_DIR, storedName, contents);
  return { id, storedName, fileName, fileSize: bytes.length, mimeType: 'text/plain', uploadedAt: submittedAt };
}

function seedTasks(db, members, projects, context) {
  const { tools, audit, deliver, keyFor, writeAsset } = context;
  const { now, integer, pick, iso, at, sample, canParticipate, probability } = tools;
  const byId = new Map(members.map(member => [member.id, member]));
  const teamLeads = members.filter(member => ['admin', 'developer'].includes(member.businessRole));
  for (let index = 0; index < 1680; index++) {
    const id = keyFor('task', index);
    const creator = index < members.length
      ? members[index]
      : probability() < 0.15 ? pick(teamLeads) : pick(members);
    const desiredAge = probability() < 0.45 ? 1 + integer(55) : 31 + integer(1610);
    const created = at(creator, desiredAge);
    const creatorEnd = creator.inactiveDaysAgo ? now - creator.inactiveDaysAgo * DAY - HOUR : now - 60_000;
    const actualAge = (creatorEnd - created) / DAY;
    const statusRoll = probability();
    const status = creator.inactiveDaysAgo ? (statusRoll < 0.9 ? 'done' : 'cancelled') : chooseTaskStatus(actualAge, statusRoll);
    const activitySpan = Math.min(Math.max(30 * 60_000, (2 + integer(225)) * HOUR), Math.max(30 * 60_000, (creatorEnd - created) * 0.78));
    const updated = status === 'todo' ? created : created + activitySpan;
    const available = members.filter(user => user.id !== creator.id && canParticipate(user, created, updated));
    const sameTeam = available.filter(user => user.team === creator.team);
    const admin = available.find(user => user.businessRole === 'developer');
    const suitableProjects = projects.filter(project => Date.parse(project.createdAt) <= created
      && (!project.projectStoppedDate || project.projectStoppedDate >= iso(created).slice(0, 10)));
    const ownProjects = suitableProjects.filter(project => project.trustManager === creator.name || project.trustManagerB === creator.name);
    const project = probability() < 0.9 && suitableProjects.length
      ? pick(ownProjects.length && probability() < 0.58 ? ownProjects : suitableProjects)
      : null;
    const projectManager = available.find(user => project?.trustManager === user.name);
    const assigned = projectManager && probability() < 0.44 ? projectManager
      : probability() < 0.1 ? creator
      : pick(sameTeam.length && probability() < 0.7 ? sameTeam : available) || creator;
    const candidateCollaborators = available.filter(user => user.id !== assigned.id);
    const collaborators = sample(candidateCollaborators, status === 'todo' ? integer(2) : integer(4));
    if (admin && admin.id !== assigned.id && probability() < 0.055 && !collaborators.some(user => user.id === admin.id)) {
      collaborators.push(admin);
    }
    const recipients = [...new Map([assigned, ...collaborators].map(user => [user.id, user])).values()];
    const story = project ? pick(taskStories.slice(0, 8)) : pick(taskStories.slice(8));
    const createdAt = iso(created);
    const updatedAt = iso(updated);
    const contextLabel = project?.productName || `${creator.team}组 · ${createdAt.slice(0, 7)}`;
    const title = `${story.title} · ${contextLabel}`;
    const dueAt = probability() < 0.08 ? null : iso(created + (1 + integer(13)) * DAY).slice(0, 10);
    const ownershipType = project && probability() < 0.37 ? 'business_center' : 'self_developed';
    const attachmentAt = iso(created + Math.floor((updated - created) * 0.56));
    const attachment = status !== 'todo' && probability() < 0.16
      ? writeTaskAttachment(writeAsset, id, title, story, assigned, attachmentAt, status)
      : null;
    const task = {
      id, title, createdAt, updatedAt, status, projectId: project?.id || '', dueAt,
      description: story.request,
      remark: status === 'waiting' ? story.waiting : status === 'cancelled' ? '范围已调整，本事项并入下一轮复核。' : '',
      priority: pick(['normal', 'normal', 'normal', 'normal', 'high', 'high', 'low', 'urgent']),
      itemType: 'task', ownershipType, businessRegion: ownershipType === 'business_center' ? pick(regions) : '',
      assignedToId: assigned.id, assignedToName: assigned.name,
      createdById: creator.id, createdByName: creator.name,
      recipientIds: recipients.map(user => user.id), recipientNames: recipients.map(user => user.name),
      attachments: attachment ? [attachment] : [],
    };
    db.run(`INSERT INTO tasks (id,data,created_by,assigned_to,project_id,status,due_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`, [id, JSON.stringify(task), creator.id, assigned.id, task.projectId, status, dueAt, updatedAt]);
    recipients.forEach(recipient => db.run('INSERT INTO task_recipients (task_id,user_id,created_at) VALUES (?,?,?)', [id, recipient.id, createdAt]));
    audit(creator, 'task.create', 'task', id, title, createdAt);
    if (attachment) audit(assigned, 'task.attachment.upload', 'task', id, attachment.fileName, attachmentAt);

    const taskUrl = `/discussions?taskId=${encodeURIComponent(id)}`;
    const notifyTask = (suffix, actor, type, label, content, when, exclude = null) => {
      const audience = taskAudience(task, actor.id).filter(userId => userId !== exclude).map(userId => byId.get(userId));
      deliver(`${id}-${suffix}`, actor, audience, { type, title: label, content, createdAt: when, actionUrl: taskUrl });
    };
    notifyTask('assigned', creator, 'task_created', '你收到了一项新任务', title, createdAt);

    const commentCount = status === 'todo' ? 0 : probability() < 0.12 ? 0 : 1 + integer(6);
    const comments = [story.progress, story.review, story.waiting, '我已按上面口径重新核对，差异项单列保留。', '更新后的文件已归档，原记录也保留了。'];
    for (let commentIndex = 0; commentIndex < commentCount; commentIndex++) {
      const commentId = `${id}-comment-${commentIndex + 1}`;
      const author = commentIndex === 0 ? assigned : commentIndex === 1 ? creator : pick([assigned, creator, ...collaborators]);
      const others = [creator, ...recipients].filter(user => user.id !== author.id);
      const mention = others.length && probability() < 0.24 ? pick(others) : null;
      const lastComment = commentIndex === commentCount - 1;
      const message = lastComment && status === 'done' ? story.done
        : lastComment && status === 'waiting' ? story.waiting
        : lastComment && status === 'cancelled' ? '这项先并入新的复核清单，当前任务可以关闭。'
        : comments[commentIndex % comments.length];
      const content = mention ? `@${mention.name} ${message}` : message;
      const moment = created + Math.floor((updated - created) * (commentIndex + 1) / (commentCount + 1));
      const timestamp = iso(moment);
      const edited = probability() < 0.08
        ? iso(Math.min(updated, moment + (1 + integer(9)) * 60_000))
        : timestamp;
      const mentionData = mention ? [{ id: mention.id, name: mention.name }] : [];
      db.run(`INSERT INTO task_comments (id,task_id,user_id,user_name,content,mention_data,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?)`, [commentId, id, author.id, author.name, content, JSON.stringify(mentionData), timestamp, edited]);
      audit(author, 'task.comment.create', 'task', id, content, timestamp);
      notifyTask(`comment-${commentIndex + 1}`, author, 'task_comment', '任务有了新回复',
        `${author.name} 回复了“${title}”：${content}`, timestamp, mention?.id);
      if (mention) {
        deliver(`${commentId}-mention`, author, [mention], {
          type: 'task_mention', title: `${author.name} 在任务回复中提到了你`, content: `${title}：${content}`,
          createdAt: timestamp, actionUrl: `${taskUrl}&commentId=${encodeURIComponent(commentId)}`,
        });
      }
    }
    if (status !== 'todo') {
      const actor = probability() < 0.8 ? assigned : creator;
      audit(actor, 'task.update', 'task', id, `${title}：${stages[status]}`, updatedAt);
      notifyTask('updated', actor, 'task_status', '任务阶段已更新',
        `${title}：${stages.todo} → ${stages[status]}`, updatedAt);
    }
  }
}

function seedAnnouncements(db, members, context) {
  const { tools, audit, deliver, keyFor } = context;
  const { probability, integer, pick, at, iso, sample, canParticipate } = tools;
  for (let index = 0; index < 460; index++) {
    const id = keyFor('notice', index);
    const sender = index < members.length ? members[index] : pick(members);
    const template = index < 9 ? notices[(index + 2) % notices.length] : pick(notices);
    const age = index < 12 ? 1 + integer(9) : probability() < 0.49 ? 1 + integer(85) : 42 + integer(1630);
    const created = at(sender, age);
    const createdAt = iso(created);
    const audience = members.filter(user => user.id !== sender.id && canParticipate(user, created));
    const teammates = audience.filter(user => user.team === sender.team);
    const partners = audience.filter(user => user.team !== sender.team);
    let recipients;
    switch (template.audience) {
      case 'department': recipients = sample(audience, 14 + integer(18)); break;
      case 'partners': recipients = [...sample(teammates, 2 + integer(3)), ...sample(partners, 1 + integer(4))]; break;
      case 'team': recipients = sample(teammates, 3 + integer(4)); break;
      default: recipients = sample(audience, 1 + integer(3)); break;
    }
    if (!recipients.length) recipients = sample(audience, 1);
    const title = `${template.title} · ${template.audience === 'team' ? sender.team + '组' : createdAt.slice(0, 7)}`;
    deliver(id, sender, recipients, {
      type: 'manual', title, content: template.content, createdAt,
      componentType: template.options ? 'poll' : 'none',
      componentData: template.options ? { options: template.options } : undefined,
      expiresAt: template.options ? iso(created + (4 + integer(7)) * DAY) : null,
    });
    audit(sender, 'notification.create', 'notification', id, title, createdAt);
  }
}

function seedCollaboration(db, members, projects, { now, keyFor, writeAsset, audit }) {
  const tools = activityTools(now.getTime());
  const deliver = deliveryRecorder(db, tools);
  const context = { tools, audit, deliver, keyFor, writeAsset };
  seedTasks(db, members, projects, context);
  seedAnnouncements(db, members, context);
}

module.exports = { seedCollaboration, auditTrail };
