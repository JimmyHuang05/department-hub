const fs = require('fs');
const path = require('path');
const express = require('express');
const XLSX = require('xlsx');
const { REPORT_SAVE_PATH, REPORT_SOURCE_PATH } = require('../paths.cjs');
const router = express.Router();

const FILE_PATH = REPORT_SOURCE_PATH;

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/** 解析 Excel 中「直销产品情况」Sheet，返回 series 数组 */
function parseDirectSalesExcel() {
  if (!fs.existsSync(FILE_PATH)) return { error: '文件不存在', series: [] };
  const wb = XLSX.readFile(FILE_PATH);
  const sheet = wb.Sheets['直销产品情况'];
  if (!sheet) return { error: 'Sheet不存在', series: [] };
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const series = [];
  let i = 0;
  while (i < data.length) {
    const row = data[i];
    const first = String(row[0] || '').trim();
    if (/^\d+[、]/.test(first)) {
      const title = first.replace(/^\d+[、]\s*/, '');
      i++;
      while (i < data.length && !String(data[i][0] || '').trim().startsWith('产品名称')) i++;
      const statusHeaders = [];
      const statusRows = [];
      if (i < data.length) {
        const hRow = data[i];
        hRow.forEach(c => statusHeaders.push(String(c).trim()));
        i++;
        while (i < data.length) {
          const dRow = data[i];
          if (!dRow.some(c => c != null && c !== '')) break;
          const dFirst = String(dRow[0] || '').trim();
          if (dFirst === '一周回顾' || dFirst === '该产品销售渠道' || /^\d+[、]/.test(dFirst)) break;
          statusRows.push(dRow.map(c => String(c).trim()));
          i++;
        }
      }
      const operationItems = [];
      while (i < data.length) {
        const dRow = data[i];
        const dFirst = String(dRow[0] || '').trim();
        if (!dFirst) { i++; continue; }
        if (dFirst === '该产品销售渠道' || /^\d+[、]/.test(dFirst)) break;
        if (dFirst === '一周回顾' || dFirst === '后续计划') {
          operationItems.push({ label: dFirst, value: String(dRow[1] || '').trim() });
        }
        i++;
      }
      const salesHeaders = [];
      const salesRows = [];
      if (i < data.length && String(data[i][0] || '').trim() === '该产品销售渠道') {
        const hRow = data[i];
        hRow.forEach(c => salesHeaders.push(String(c).trim()));
        i++;
        while (i < data.length) {
          const dRow = data[i];
          if (!dRow.some(c => c != null && c !== '')) break;
          const dFirst = String(dRow[0] || '').trim();
          if (/^\d+[、]/.test(dFirst)) break;
          salesRows.push(dRow.map(c => String(c).trim()));
          i++;
        }
      }
      series.push({ title, statusTable: { headers: statusHeaders, rows: statusRows }, operationTable: { items: operationItems }, salesTable: { headers: salesHeaders, rows: salesRows } });
    } else { i++; }
  }
  return { series };
}

function buildSeriesHtml(series) {
  let html = '<div style="max-width:1200px;margin:30px auto;font-family:-apple-system,sans-serif;padding:0 20px">';
  html += '<h1 style="color:#1e40af;border-bottom:2px solid #e2e8f0;padding-bottom:15px">直销产品情况数据报表</h1>';
  if (series.length === 0) {
    html += '<p style="color:#94a3b8;text-align:center;padding:40px">未解析到系列数据</p>';
  }
  series.forEach(s => {
    html += '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:30px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)">';
    html += '<div style="background:linear-gradient(135deg,#eff6ff,#eef2ff);padding:15px 20px;border-bottom:1px solid #e2e8f0">';
    html += '<h2 style="margin:0;font-size:18px;color:#1e293b">' + escapeHtml(s.title) + '</h2></div><div style="padding:20px">';

    // Table 1
    html += '<h3 style="font-size:14px;color:#475569;margin:0 0 12px;display:flex;align-items:center;gap:8px"><span style="width:22px;height:22px;border-radius:6px;background:#dbeafe;color:#2563eb;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700">1</span> 产品现状表</h3>';
    html += '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:24px"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0">';
    s.statusTable.headers.forEach(h => html += '<th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#64748b;border-right:1px solid #f1f5f9;white-space:nowrap">' + escapeHtml(h) + '</th>');
    html += '</tr></thead><tbody>';
    if (s.statusTable.rows.length === 0) {
      html += '<tr><td colspan="' + Math.max(s.statusTable.headers.length,1) + '" style="padding:20px;text-align:center;color:#94a3b8;font-size:12px">暂无数据</td></tr>';
    } else {
      s.statusTable.rows.forEach((row, ri) => {
        html += '<tr style="' + (ri % 2 === 0 ? 'background:#fff' : 'background:#f8fafc') + '">';
        row.forEach(cell => html += '<td style="padding:8px 12px;color:#334155;border-right:1px solid #f1f5f9;white-space:pre-wrap">' + escapeHtml(cell) + '</td>');
        html += '</tr>';
      });
    }
    html += '</tbody></table></div>';

    // Table 2
    html += '<h3 style="font-size:14px;color:#475569;margin:0 0 12px;display:flex;align-items:center;gap:8px"><span style="width:22px;height:22px;border-radius:6px;background:#dcfce7;color:#16a34a;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700">2</span> 产品后期运作表</h3>';
    html += '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:24px"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0"><th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#64748b;width:120px;border-right:1px solid #f1f5f9">项目</th><th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#64748b">内容</th></tr></thead><tbody>';
    if (s.operationTable.items.length === 0) {
      html += '<tr><td colspan="2" style="padding:20px;text-align:center;color:#94a3b8;font-size:12px">暂无数据</td></tr>';
    } else {
      s.operationTable.items.forEach(item => {
        html += '<tr><td style="padding:8px 12px;font-weight:500;color:#334155;border-right:1px solid #f1f5f9">' + escapeHtml(item.label) + '</td>';
        html += '<td style="padding:8px 12px;color:#334155;white-space:pre-wrap">' + escapeHtml(item.value) + '</td></tr>';
      });
    }
    html += '</tbody></table></div>';

    // Table 3
    html += '<h3 style="font-size:14px;color:#475569;margin:0 0 12px;display:flex;align-items:center;gap:8px"><span style="width:22px;height:22px;border-radius:6px;background:#f3e8ff;color:#9333ea;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700">3</span> 产品销售表</h3>';
    html += '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:8px"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0">';
    s.salesTable.headers.forEach(h => html += '<th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#64748b;border-right:1px solid #f1f5f9;white-space:nowrap">' + escapeHtml(h) + '</th>');
    html += '</tr></thead><tbody>';
    if (s.salesTable.rows.length === 0) {
      html += '<tr><td colspan="' + Math.max(s.salesTable.headers.length,1) + '" style="padding:20px;text-align:center;color:#94a3b8;font-size:12px">暂无数据</td></tr>';
    } else {
      s.salesTable.rows.forEach((row, ri) => {
        html += '<tr style="' + (ri % 2 === 0 ? 'background:#fff' : 'background:#f8fafc') + '">';
        row.forEach(cell => html += '<td style="padding:8px 12px;color:#334155;border-right:1px solid #f1f5f9">' + escapeHtml(cell) + '</td>');
        html += '</tr>';
      });
    }
    html += '</tbody></table></div>';
    html += '</div></div>';
  });
  html += '<p style="text-align:center;color:#94a3b8;font-size:12px;margin-top:20px">数据来源: temp_check.xlsx | 生成时间: ' + new Date().toLocaleString('zh-CN') + '</p>';
  html += '</div>';
  return html;
}

router.get('/', (req, res) => {
  const { error, series } = parseDirectSalesExcel();
  if (error) return res.send(`<h2 style="color:red">${escapeHtml(error)}</h2>`);
  res.send(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>直销产品情况数据报表</title></head><body style="margin:0;background:#f1f5f9">${buildSeriesHtml(series)}</body></html>`);
});

router.get('/data', (req, res) => {
  try {
    const { error, series } = parseDirectSalesExcel();
    if (error) return res.json({ error, series: [] });
    res.json({ series });
  } catch (e) {
    res.json({ error: e.message, series: [] });
  }
});

router.post('/save', (req, res) => {
  try {
    const { series } = req.body;
    if (!series || !Array.isArray(series)) {
      return res.json({ success: false, error: '数据格式错误' });
    }
    const savePath = REPORT_SAVE_PATH;
    const saveDir = path.dirname(savePath);
    if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
    fs.writeFileSync(savePath, JSON.stringify({ series, savedAt: new Date().toISOString() }, null, 2));
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

module.exports = router;
