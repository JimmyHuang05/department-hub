import type ExcelJS from 'exceljs';
import type { Questionnaire, QuestionnaireSubmissionRecord } from '../types/questionnaire';

function answerText(value: QuestionnaireSubmissionRecord['answers'][string] | undefined) {
  if (Array.isArray(value)) return value.join('、');
  if (value && typeof value === 'object') return value.fileName || '附件';
  return value == null ? '' : String(value);
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 80) || '问卷';
}

function styleHeader(row: ExcelJS.Row) {
  row.height = 24;
  row.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2754D7' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
  });
}

export async function exportQuestionnaireExcel(questionnaire: Questionnaire, submissions: QuestionnaireSubmissionRecord[]) {
  const { default: ExcelJSModule } = await import('exceljs');
  const workbook = new ExcelJSModule.Workbook();
  workbook.creator = 'GCO Link';
  workbook.created = new Date();

  const detail = workbook.addWorksheet('答卷明细', { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] });
  detail.addRow(['提交时间', '来源经理', '来源备注', '处理状态', ...questionnaire.fields.map(field => field.label)]);
  styleHeader(detail.getRow(1));
  submissions.forEach(record => detail.addRow([
    new Date(record.submittedAt), record.sourceUserName || '公共链接', record.sourceNote || '',
    ({ new: '新提交', viewed: '已查看', handled: '已处理' } as const)[record.status || 'new'],
    ...questionnaire.fields.map(field => answerText(record.answers[field.id])),
  ]));
  detail.getColumn(1).numFmt = 'yyyy-mm-dd hh:mm:ss';
  detail.columns.forEach((column, index) => { column.width = index === 0 ? 21 : index < 4 ? 16 : 24; });
  detail.eachRow((row, rowNumber) => { if (rowNumber > 1) row.alignment = { vertical: 'top', wrapText: true }; });
  detail.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 4 + questionnaire.fields.length } };

  const stats = workbook.addWorksheet('题目统计');
  stats.addRow(['问卷名称', questionnaire.title]);
  stats.addRow(['答卷数量', submissions.length]);
  stats.addRow(['导出时间', new Date()]);
  stats.getCell('B3').numFmt = 'yyyy-mm-dd hh:mm:ss';
  stats.addRow([]);
  stats.addRow(['题号', '题目', '题型', '填写数', '未填写数', '填写率', '选项/答案', '数量']);
  styleHeader(stats.getRow(5));
  questionnaire.fields.forEach((field, fieldIndex) => {
    const values = submissions.map(record => record.answers[field.id]).filter(value => answerText(value).trim() !== '');
    const counts = new Map<string, number>();
    if (field.type === 'single_choice' || field.type === 'multiple_choice' || field.type === 'rating') {
      values.forEach(value => (Array.isArray(value) ? value : [value]).forEach(option => {
        const label = String(option);
        counts.set(label, (counts.get(label) || 0) + 1);
      }));
    }
    const options = counts.size ? [...counts.entries()] : [['—', 0] as [string, number]];
    options.forEach(([option, count], optionIndex) => stats.addRow([
      optionIndex === 0 ? fieldIndex + 1 : '', optionIndex === 0 ? field.label : '', optionIndex === 0 ? field.type : '',
      optionIndex === 0 ? values.length : '', optionIndex === 0 ? submissions.length - values.length : '',
      optionIndex === 0 ? (submissions.length ? values.length / submissions.length : 0) : '', option, count,
    ]));
  });
  stats.getColumn(6).numFmt = '0.0%';
  stats.columns = [{ width: 8 }, { width: 34 }, { width: 16 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 28 }, { width: 10 }];
  stats.eachRow((row, rowNumber) => { if (rowNumber > 5) row.alignment = { vertical: 'top', wrapText: true }; });

  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeFileName(questionnaire.title)}_统计.xlsx`;
  anchor.click();
  URL.revokeObjectURL(url);
}
