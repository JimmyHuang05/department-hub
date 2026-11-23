const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { APP_ROOT, WEEKLY_REPORT_DIR } = require('../paths.cjs');
const { getPreviousWeekKey } = require('./weekRollover.cjs');

const TEMPLATE_VERSION = '1.0.0';
const TEMPLATE_DIR = path.join(APP_ROOT, 'server', 'templates', 'weekly-summary', `v${TEMPLATE_VERSION}`);
const TEMPLATE_PATH = path.join(TEMPLATE_DIR, 'template.docx');
const TEMPLATE_MANIFEST_PATH = path.join(TEMPLATE_DIR, 'manifest.json');
const WEEK_KEY_PATTERN = /^\d{6}$/;
const FIXED_ZIP_DATE = new Date('2000-01-01T00:00:00.000Z');

const DEFAULT_NOTES = Object.freeze({
  highlights: [],
  qdQuota: '',
  fixedIncomeTeam: '固收研究组',
  optionTeam: '多资产策略组',
  equityTeam: '权益研究组',
  serviceTeam: '资产服务组',
  serviceRules: [
    '服务频次：每月发送估值表，每半年联系客户次数不少于1次；',
    '上年度未交易或者沟通未反馈的现场次年预约现场拜访不少于一次；',
    '新客户产品成立前后6个月内现场拜访一次；',
    '渠道联系每季度不少于1次；',
  ],
});

function parseResultRows(result, columnIndex = 0) {
  return (result[0]?.values || []).map(row => JSON.parse(row[columnIndex]));
}

function latestValueThroughWeek(values, weekKey) {
  if (!values || typeof values !== 'object') return '';
  if (Object.prototype.hasOwnProperty.call(values, weekKey)) return values[weekKey] || '';
  const key = Object.keys(values)
    .filter(candidate => WEEK_KEY_PATTERN.test(candidate) && candidate <= weekKey && values[candidate])
    .sort()
    .at(-1);
  return key ? values[key] : '';
}

function normalizeNotes(input = {}) {
  const highlights = Array.isArray(input.highlights)
    ? input.highlights.map(value => String(value || '').trim()).slice(0, 50)
    : [];
  const serviceRules = Array.isArray(input.serviceRules)
    ? input.serviceRules.map(value => String(value || '').trim()).slice(0, 4)
    : [];
  while (serviceRules.length < 4) serviceRules.push(DEFAULT_NOTES.serviceRules[serviceRules.length]);
  return {
    highlights,
    qdQuota: String(input.qdQuota || '').trim(),
    fixedIncomeTeam: String(input.fixedIncomeTeam || DEFAULT_NOTES.fixedIncomeTeam).trim(),
    optionTeam: String(input.optionTeam || DEFAULT_NOTES.optionTeam).trim(),
    equityTeam: String(input.equityTeam || DEFAULT_NOTES.equityTeam).trim(),
    serviceTeam: String(input.serviceTeam || DEFAULT_NOTES.serviceTeam).trim(),
    serviceRules,
  };
}

function normalizeCategory(value) {
  return String(value || '').replace(/\s+/g, '');
}

function isProblemEntry(entry) {
  return normalizeCategory(entry.category).includes('问题项目');
}

function isDirectSalesEntry(entry) {
  return normalizeCategory(entry.category).includes('直销产品');
}

function isServiceEntry(entry) {
  return !isProblemEntry(entry)
    && !isDirectSalesEntry(entry)
    && normalizeCategory(entry.subCategory).includes('资产服务');
}

function directSeries(entry) {
  const source = normalizeCategory(entry.subCategory || entry.productName);
  if (source.includes('固收')) return 'fixedIncome';
  if (source.includes('含权')) return 'option';
  if (source.includes('权益')) return 'equity';
  return 'equity';
}

function reportDateFromWeekKey(weekKey) {
  if (!WEEK_KEY_PATTERN.test(weekKey)) return '';
  return `20${weekKey.slice(0, 2)}-${weekKey.slice(2, 4)}-${weekKey.slice(4, 6)}`;
}

function formatDate(value) {
  if (!value) return '';
  const match = String(value).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return String(value);
  return `${match[1]}/${String(match[2]).padStart(2, '0')}/${String(match[3]).padStart(2, '0')}`;
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return value === 0 ? '0.00' : '';
  return number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function normalizeRate(value) {
  const number = Number(value) || 0;
  return number > 1 ? number / 100 : number;
}

function formatRate(value) {
  const rate = normalizeRate(value);
  if (!rate) return '';
  return `${(rate * 100).toFixed(2)}%`;
}

function dayDifference(startValue, endValue) {
  const start = startValue ? new Date(startValue) : null;
  const end = endValue ? new Date(endValue) : null;
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
}

function resolveAmounts(product, exchangeRate) {
  let usd = Number(product.usd) || 0;
  let rmb = Number(product.rmb) || 0;
  const rate = Number(exchangeRate) || 0;
  if (!rmb && usd && rate) rmb = usd * rate;
  if (!usd && rmb && rate) usd = rmb / rate;
  return { usd, rmb };
}

function buildProblemRows(entries, weekKey) {
  return entries.filter(isProblemEntry).map((entry, index) => [
    String(index + 1),
    entry.productName || '',
    entry.description || '',
    entry.clientType || '',
    entry.navScale || '',
    entry.deadline || '',
    entry.nextWeekPlan || '',
    latestValueThroughWeek(entry.weeklyProgress, weekKey),
    entry.dynamicFields?.progressExpectation || '',
    entry.personA || '',
    entry.personB || '',
  ]);
}

function buildPipelineRows(products, exchangeRate) {
  const candidates = products.filter(product => {
    const status = String(product.status || '').trim();
    return String(product.productName || '').trim() && !['已成立', '已落地', '项目中止'].includes(status);
  });
  return candidates.map((product, index) => {
    const { usd, rmb } = resolveAmounts(product, exchangeRate);
    const feeRate = normalizeRate(product.feeRate);
    const annualIncome = Number(product.annualIncome) || rmb * feeRate;
    const thisYearIncome = Number(product.thisYearIncome)
      || annualIncome * dayDifference(product.establishDate, product.deadline) / 365;
    const performanceIncome = Number(product.performanceIncome) || thisYearIncome / 1.06;
    return [
      String(index + 1),
      product.productName || '',
      formatNumber(usd),
      formatNumber(rmb),
      formatRate(feeRate),
      formatDate(product.establishDate),
      product.target || '',
      product.client || '',
      product.brokerChannel || '',
      product.strategy || '',
      formatNumber(annualIncome),
      formatNumber(thisYearIncome),
      formatNumber(performanceIncome),
      product.status || '',
      product.trustManager || '',
      product.trustManagerB || '',
    ];
  });
}

function formatPercentValue(value) {
  if (value === '' || value === null || value === undefined) return '';
  const text = String(value).trim();
  if (text.endsWith('%')) return text;
  const number = Number(text);
  if (!Number.isFinite(number)) return `${text}%`;
  const percent = Math.abs(number) <= 1 ? number * 100 : number;
  return `${Number(percent.toFixed(4))}%`;
}

function buildDirectSalesGroups(entries, weekKey) {
  const groups = { fixedIncome: [], option: [], equity: [] };
  entries.filter(isDirectSalesEntry).forEach(entry => {
    const type = directSeries(entry);
    const dynamic = entry.dynamicFields || {};
    const common = [
      entry.productName || '',
      entry.navScale || '',
      entry.productTerm || '',
      entry.nav === null || entry.nav === undefined ? '' : String(entry.nav),
      formatPercentValue(entry.changePercent),
    ];
    const extra = type === 'fixedIncome'
      ? [dynamic.holdingsOver10 || '']
      : type === 'option'
        ? [formatPercentValue(dynamic.equityAssetRatio), dynamic.warningLineStatus || '']
        : [dynamic.focusPoint || formatPercentValue(dynamic.equityAssetRatio), dynamic.warningLineStatus || ''];
    groups[type].push({
      statusRow: [...common, ...extra],
      weeklyReview: dynamic.weeklyReview || latestValueThroughWeek(entry.weeklyProgress, weekKey),
      nextWeekPlan: entry.nextWeekPlan || '',
      salesRow: [
        entry.channelSales || '',
        dynamic.channelContact || '',
        dynamic.subscriptionRedemption || '',
        dynamic.nextSalesPlan || entry.nextWeekPlan || '',
      ],
    });
  });
  return groups;
}

function serviceClassification(entry) {
  const value = String(entry.subCategory || '').trim();
  if (value) return value;
  return normalizeCategory(entry.activePassive).includes('主动')
    ? '资产服务（主动管理）'
    : '资产服务（事务管理）';
}

function buildServiceRows(entries, weekKey) {
  let previousClassification = '';
  return entries.filter(isServiceEntry).map(entry => {
    const classification = serviceClassification(entry);
    const displayedClassification = classification === previousClassification ? '' : classification;
    previousClassification = classification;
    return [
      displayedClassification,
      entry.status || '',
      entry.productName || '',
      entry.clientType || '',
      latestValueThroughWeek(entry.navScaleHistory, weekKey) || entry.navScale || '',
      entry.establishDate || '',
      entry.channelSales || '',
      latestValueThroughWeek(entry.weeklyProgress, weekKey),
      entry.nextWeekPlan || '',
      entry.personA || '',
      entry.personB || '',
    ];
  });
}

function validateReportModel(model, source) {
  const warnings = [];
  if (source.entries.length === 0) {
    warnings.push({ severity: 'error', code: 'NO_WEEK_DATA', message: '所选周次没有工作日志快照，无法生成工作小结。' });
  }
  if (model.problemProjects.some(row => !row[7])) {
    warnings.push({ severity: 'warning', code: 'PROBLEM_PROGRESS_MISSING', message: '部分问题项目缺少本周进展。' });
  }
  if (model.problemProjects.some(row => !row[8])) {
    warnings.push({ severity: 'warning', code: 'EXPECTATION_MISSING', message: '部分问题项目尚未填写“进展是否达预期”。' });
  }
  if (model.notes.highlights.every(value => !value) && !model.notes.qdQuota) {
    warnings.push({ severity: 'warning', code: 'HIGHLIGHTS_MISSING', message: '本周重点事项和 QD 额度尚未补充。' });
  }
  const unlinked = source.entries.filter(entry => !entry.projectId).length;
  if (unlinked > 0) {
    warnings.push({ severity: 'warning', code: 'UNLINKED_ENTRIES', message: `${unlinked} 条周报记录未关联项目，当前按周报快照直接生成。` });
  }
  if (model.pipelineProjects.length > 0) {
    warnings.push({ severity: 'warning', code: 'CURRENT_PROJECT_SNAPSHOT', message: '储备项目来自当前项目库；正式生成后会冻结到本次生成记录。' });
  }
  return warnings;
}

function buildWeeklyReportModel({ weekKey, entries, products, settings, notes }) {
  if (!WEEK_KEY_PATTERN.test(String(weekKey || ''))) {
    throw new Error('周次格式无效');
  }
  const normalizedNotes = normalizeNotes(notes);
  const exchangeRate = Number(settings?.exchangeRate) || 0;
  const model = {
    version: 1,
    weekKey,
    reportDate: reportDateFromWeekKey(weekKey),
    title: `${reportDateFromWeekKey(weekKey).slice(0, 4)}年度全球资本运营部周工作小结（讨论版）`,
    notes: normalizedNotes,
    problemProjects: buildProblemRows(entries, weekKey),
    pipelineProjects: buildPipelineRows(products, exchangeRate),
    directSales: buildDirectSalesGroups(entries, weekKey),
    serviceProjects: buildServiceRows(entries, weekKey),
  };
  model.counts = {
    problemProjects: model.problemProjects.length,
    pipelineProjects: model.pipelineProjects.length,
    fixedIncomeProducts: model.directSales.fixedIncome.length,
    optionProducts: model.directSales.option.length,
    equityProducts: model.directSales.equity.length,
    serviceProjects: model.serviceProjects.length,
  };
  model.validation = validateReportModel(model, { entries, products });
  return model;
}

function loadReportSource(db, weekKey) {
  const snapshotEntries = parseResultRows(db.exec(
    'SELECT data FROM entry_snapshots WHERE week_key=? ORDER BY snapshot_at DESC',
    [weekKey],
  ));
  const currentEntries = parseResultRows(db.exec(
    'SELECT data FROM entries WHERE week_key=? ORDER BY updated_at DESC',
    [weekKey],
  ));
  // A week can contain only a subset of snapshots (for example, records edited
  // after rollover). Merge both sources so the presence of one snapshot does
  // not hide every current entry that has not been snapshotted yet. Snapshots
  // remain authoritative for duplicate entry IDs.
  let entries = [...snapshotEntries, ...currentEntries];
  const seen = new Set();
  entries = entries.filter(entry => {
    if (!entry?.id || seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
  const products = parseResultRows(db.exec('SELECT data FROM products ORDER BY updated_at DESC'));
  const settingsResult = db.exec("SELECT data FROM settings WHERE id='main'");
  const settings = settingsResult[0]?.values?.[0]?.[0]
    ? JSON.parse(settingsResult[0].values[0][0])
    : {};
  return { entries, products, settings };
}

function loadLatestNotes(db, weekKey) {
  const result = db.exec(
    'SELECT manual_notes FROM weekly_report_runs WHERE week_key=? ORDER BY generated_at DESC LIMIT 1',
    [weekKey],
  );
  const value = result[0]?.values?.[0]?.[0];
  if (!value) return normalizeNotes();
  try {
    return normalizeNotes(JSON.parse(value));
  } catch {
    return normalizeNotes();
  }
}

function loadInitialNotes(db, weekKey, userId) {
  const currentRun = db.exec(
    'SELECT manual_notes FROM weekly_report_runs WHERE week_key=? ORDER BY generated_at DESC LIMIT 1',
    [weekKey],
  );
  const currentValue = currentRun[0]?.values?.[0]?.[0];
  if (currentValue) {
    try { return { notes: normalizeNotes(JSON.parse(currentValue)), inheritedFromWeekKey: '' }; } catch (_) {}
  }

  const previousWeekKey = getPreviousWeekKey(weekKey);
  const previousDraft = loadDraft(db, previousWeekKey, userId);
  if (previousDraft) return { notes: previousDraft.notes, inheritedFromWeekKey: previousWeekKey };

  const previousRun = db.exec(
    'SELECT manual_notes FROM weekly_report_runs WHERE week_key=? ORDER BY generated_at DESC LIMIT 1',
    [previousWeekKey],
  );
  const previousValue = previousRun[0]?.values?.[0]?.[0];
  if (previousValue) {
    try { return { notes: normalizeNotes(JSON.parse(previousValue)), inheritedFromWeekKey: previousWeekKey }; } catch (_) {}
  }
  return { notes: normalizeNotes(), inheritedFromWeekKey: '' };
}

function loadDraft(db, weekKey, userId) {
  const result = db.exec(
    'SELECT manual_notes,revision,updated_at FROM weekly_report_drafts WHERE week_key=? AND user_id=?',
    [weekKey, userId],
  );
  const row = result[0]?.values?.[0];
  if (!row) return null;
  try {
    return {
      notes: normalizeNotes(JSON.parse(row[0])),
      revision: Number(row[1]) || 1,
      updatedAt: String(row[2] || ''),
    };
  } catch {
    return null;
  }
}

function saveDraft(db, weekKey, userId, notes, updatedAt = new Date().toISOString()) {
  const normalized = normalizeNotes(notes);
  db.run(
    `INSERT INTO weekly_report_drafts(week_key,user_id,manual_notes,revision,updated_at)
     VALUES(?,?,?,?,?)
     ON CONFLICT(week_key,user_id) DO UPDATE SET
       manual_notes=excluded.manual_notes,
       revision=weekly_report_drafts.revision+1,
       updated_at=excluded.updated_at`,
    [weekKey, userId, JSON.stringify(normalized), 1, updatedAt],
  );
  return loadDraft(db, weekKey, userId);
}

function listAvailableWeeks(db) {
  const keys = new Set();
  for (const result of [
    db.exec('SELECT DISTINCT week_key FROM entry_snapshots ORDER BY week_key DESC'),
    db.exec("SELECT DISTINCT week_key FROM entries WHERE week_key IS NOT NULL AND week_key <> '' ORDER BY week_key DESC"),
    db.exec('SELECT DISTINCT week_key FROM weekly_report_drafts ORDER BY week_key DESC'),
    db.exec('SELECT DISTINCT week_key FROM weekly_report_runs ORDER BY week_key DESC'),
  ]) {
    (result[0]?.values || []).forEach(row => {
      if (WEEK_KEY_PATTERN.test(String(row[0] || ''))) keys.add(String(row[0]));
    });
  }
  return [...keys].sort().reverse();
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function visibleText(fragment) {
  return decodeXml(
    [...fragment.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map(match => match[1])
      .join(''),
  );
}

function replaceTextNodes(fragment, value) {
  let replaced = false;
  const updated = fragment.replace(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g, () => {
    if (replaced) return '<w:t></w:t>';
    replaced = true;
    return `<w:t xml:space="preserve">${escapeXml(value)}</w:t>`;
  });
  if (replaced) return updated;
  return fragment.replace(/<\/w:p>/, `<w:r><w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r></w:p>`);
}

function replaceParagraphByText(documentXml, matcher, value) {
  let replaced = false;
  return documentXml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, paragraph => {
    if (replaced || !matcher(visibleText(paragraph))) return paragraph;
    replaced = true;
    return replaceTextNodes(paragraph, value);
  });
}

function keepParagraphWithNext(documentXml, matcher) {
  return documentXml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, paragraph => {
    if (!matcher(visibleText(paragraph))) return paragraph;
    if (/<w:keepNext\b/.test(paragraph)) return paragraph;
    if (/<w:pPr\b/.test(paragraph)) {
      return paragraph.replace(/<w:pPr\b([^>]*)>/, '<w:pPr$1><w:keepNext/>');
    }
    return paragraph.replace(/^(<w:p\b[^>]*>)/, '$1<w:pPr><w:keepNext/></w:pPr>');
  });
}

function setRowCells(rowXml, values) {
  let index = 0;
  return rowXml.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, cell => {
    const value = values[index] ?? '';
    index += 1;
    return replaceTextNodes(cell, value);
  });
}

function setRowCell(rowXml, targetIndex, value) {
  let index = 0;
  return rowXml.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, cell => {
    const currentIndex = index;
    index += 1;
    return currentIndex === targetIndex ? replaceTextNodes(cell, value) : cell;
  });
}

function setCellVerticalMerge(rowXml, targetIndex, restart) {
  let index = 0;
  return rowXml.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, cell => {
    const currentIndex = index;
    index += 1;
    if (currentIndex !== targetIndex) return cell;
    const merge = restart ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>';
    if (/<w:tcPr\b[^>]*>[\s\S]*?<\/w:tcPr>/.test(cell)) {
      return cell.replace(/<w:tcPr\b([^>]*)>([\s\S]*?)<\/w:tcPr>/, (match, attrs, content) => (
        `<w:tcPr${attrs}>${content.replace(/<w:vMerge\b[^>]*\/>/g, '')}${merge}</w:tcPr>`
      ));
    }
    if (/<w:tcPr\b[^>]*\/>/.test(cell)) {
      return cell.replace(/<w:tcPr\b([^>]*)\/>/, `<w:tcPr$1>${merge}</w:tcPr>`);
    }
    return cell.replace(/^(<w:tc\b[^>]*>)/, `$1<w:tcPr>${merge}</w:tcPr>`);
  });
}

function ensureRowProperties(rowXml) {
  let updated = rowXml.replace(/<w:trHeight\b[^>]*\/>/g, '');
  const properties = '<w:cantSplit/>';
  if (/<w:trPr\b/.test(updated)) {
    return updated.replace(/<w:trPr\b([^>]*)>([\s\S]*?)<\/w:trPr>/, (match, attrs, content) => {
      const withoutHeader = content.replace(/<w:tblHeader\b[^>]*\/>/g, '');
      const withoutCantSplit = withoutHeader.replace(/<w:cantSplit\b[^>]*\/>/g, '');
      return `<w:trPr${attrs}>${withoutCantSplit}${properties}</w:trPr>`;
    });
  }
  return updated.replace(/^(<w:tr\b[^>]*>)/, `$1<w:trPr>${properties}</w:trPr>`);
}

function buildSimpleTable(tableXml, dataRows, headerOverrides = {}, mergeFirstColumn = false) {
  const rows = tableXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];
  if (rows.length < 2) return tableXml;
  const headerWithText = Object.entries(headerOverrides).reduce(
    (row, [index, value]) => setRowCell(row, Number(index), value),
    rows[0],
  );
  const header = ensureRowProperties(headerWithText);
  const template = rows[1];
  const effectiveRows = dataRows.length > 0 ? dataRows : [['暂无']];
  const generated = effectiveRows.map(values => {
    let row = setRowCells(template, values);
    if (mergeFirstColumn && dataRows.length > 0) {
      row = setCellVerticalMerge(row, 0, Boolean(values[0]));
    }
    return ensureRowProperties(row);
  });
  return tableXml.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, '').replace(/<\/w:tbl>/, `${header}${generated.join('')}</w:tbl>`);
}

function joinDistinct(items) {
  return [...new Set(items.map(value => String(value || '').trim()).filter(Boolean))].join('；');
}

function buildDirectSalesTable(tableXml, items) {
  const rows = tableXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];
  if (rows.length < 7) return tableXml;
  const effectiveItems = items.length > 0
    ? items
    : [{ statusRow: ['暂无'], weeklyReview: '', nextWeekPlan: '', salesRow: ['', '', '', ''] }];
  const generated = [
    ensureRowProperties(rows[0]),
    ...effectiveItems.map(item => ensureRowProperties(setRowCells(rows[1], item.statusRow))),
    ensureRowProperties(setRowCells(rows[2], ['一周回顾', joinDistinct(effectiveItems.map(item => item.weeklyReview))])),
    ensureRowProperties(setRowCells(rows[3], ['后续计划', joinDistinct(effectiveItems.map(item => item.nextWeekPlan))])),
    ensureRowProperties(rows[4]),
    ensureRowProperties(rows[5]),
    ...effectiveItems.map(item => ensureRowProperties(setRowCells(rows[6], item.salesRow))),
  ];
  return tableXml.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, '').replace(/<\/w:tbl>/, `${generated.join('')}</w:tbl>`);
}

function updateTables(documentXml, model) {
  let tableIndex = 0;
  return documentXml.replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/g, table => {
    const index = tableIndex;
    tableIndex += 1;
    if (index === 0) return buildSimpleTable(table, model.problemProjects, { 7: `上周进展（${model.weekKey}）` });
    if (index === 1) return buildSimpleTable(table, model.pipelineProjects);
    if (index === 2) return buildDirectSalesTable(table, model.directSales.fixedIncome);
    if (index === 3) return buildDirectSalesTable(table, model.directSales.option);
    if (index === 4) return buildDirectSalesTable(table, model.directSales.equity);
    if (index === 5) return buildSimpleTable(table, model.serviceProjects, { 7: `上周进展（${model.weekKey}）` }, true);
    return table;
  });
}

function updateParagraphs(documentXml, model) {
  let xml = documentXml;
  xml = replaceParagraphByText(xml, text => text.includes('年度全球资本运营部周工作小结'), model.title);
  xml = replaceParagraphByText(xml, text => text.startsWith('日期：'), `日期：${model.reportDate}`);
  xml = xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, paragraph => {
    if (visibleText(paragraph) !== '本周重点事项占位') return paragraph;
    return model.notes.highlights.map(value => replaceTextNodes(paragraph, value)).join('');
  });
  xml = replaceParagraphByText(
    xml,
    text => text.startsWith('QD额度使用情况：'),
    model.notes.qdQuota ? `QD额度使用情况：${model.notes.qdQuota}` : 'QD额度使用情况：',
  );
  xml = replaceParagraphByText(xml, text => text === `团队：${DEFAULT_NOTES.fixedIncomeTeam}`, `团队：${model.notes.fixedIncomeTeam}`);
  xml = replaceParagraphByText(xml, text => text === `团队：${DEFAULT_NOTES.optionTeam}`, `团队：${model.notes.optionTeam}`);
  xml = replaceParagraphByText(xml, text => text === `团队：${DEFAULT_NOTES.equityTeam}`, `团队：${model.notes.equityTeam}`);
  xml = replaceParagraphByText(xml, text => text === `团队：${DEFAULT_NOTES.serviceTeam}`, `团队：${model.notes.serviceTeam}`);
  xml = replaceParagraphByText(
    xml,
    text => text.startsWith('3、权益类'),
    model.directSales.equity.length > 0 ? '3、权益类' : '3、权益类：暂无',
  );
  DEFAULT_NOTES.serviceRules.forEach((source, index) => {
    xml = replaceParagraphByText(xml, text => text === source, model.notes.serviceRules[index] || '');
  });
  const serviceKeepTexts = new Set([
    '二、服务类',
    `团队：${model.notes.serviceTeam}`,
    ...model.notes.serviceRules.filter(Boolean),
  ]);
  xml = keepParagraphWithNext(xml, text => serviceKeepTexts.has(text));
  return xml;
}

async function renderWeeklySummary(model) {
  if (!fs.existsSync(TEMPLATE_PATH) || !fs.existsSync(TEMPLATE_MANIFEST_PATH)) {
    throw new Error('工作小结模板缺失');
  }
  const zip = await JSZip.loadAsync(fs.readFileSync(TEMPLATE_PATH));
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) throw new Error('工作小结模板结构无效');
  let documentXml = await documentFile.async('string');
  documentXml = updateTables(documentXml, model);
  documentXml = updateParagraphs(documentXml, model);
  zip.file('word/document.xml', documentXml, { date: FIXED_ZIP_DATE });
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'DOS',
  });
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function reportFileName(weekKey) {
  const date = reportDateFromWeekKey(weekKey).replace(/-/g, '');
  return `${date.slice(0, 4)}年度全球资本运营部周工作小结${date}.docx`;
}

async function createWeeklyReportRun(db, { weekKey, notes, user, generatedAt = new Date().toISOString() }) {
  const source = loadReportSource(db, weekKey);
  const model = buildWeeklyReportModel({ weekKey, ...source, notes });
  const blocking = model.validation.filter(item => item.severity === 'error');
  if (blocking.length > 0) {
    const error = new Error(blocking.map(item => item.message).join('；'));
    error.code = 'REPORT_VALIDATION_FAILED';
    error.validation = model.validation;
    throw error;
  }
  const sourcePayload = {
    weekKey,
    templateVersion: TEMPLATE_VERSION,
    entries: source.entries,
    products: source.products,
    settings: { exchangeRate: source.settings?.exchangeRate || 0 },
    notes: model.notes,
    model,
  };
  const buffer = await renderWeeklySummary(model);
  const id = crypto.randomUUID();
  const fileName = reportFileName(weekKey);
  fs.mkdirSync(WEEKLY_REPORT_DIR, { recursive: true });
  const storedPath = path.join(WEEKLY_REPORT_DIR, `${id}.docx`);
  fs.writeFileSync(storedPath, buffer);
  const payloadJson = stableStringify(sourcePayload);
  const payloadHash = sha256(payloadJson);
  const fileHash = sha256(buffer);
  db.run(
    `INSERT INTO weekly_report_runs(
      id,week_key,template_version,source_payload,manual_notes,validation_result,
      payload_hash,file_hash,file_name,stored_path,generated_by,generated_by_name,generated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      weekKey,
      TEMPLATE_VERSION,
      JSON.stringify(sourcePayload),
      JSON.stringify(model.notes),
      JSON.stringify(model.validation),
      payloadHash,
      fileHash,
      fileName,
      storedPath,
      user.id,
      user.display_name || '',
      generatedAt,
    ],
  );
  return {
    id,
    weekKey,
    templateVersion: TEMPLATE_VERSION,
    fileName,
    payloadHash,
    fileHash,
    generatedAt,
    generatedByName: user.display_name || '',
    validation: model.validation,
    counts: model.counts,
  };
}

module.exports = {
  DEFAULT_NOTES,
  TEMPLATE_VERSION,
  buildWeeklyReportModel,
  createWeeklyReportRun,
  listAvailableWeeks,
  loadLatestNotes,
  loadInitialNotes,
  loadDraft,
  loadReportSource,
  normalizeNotes,
  renderWeeklySummary,
  reportDateFromWeekKey,
  saveDraft,
};
