const JSZip = require('jszip');

const STATUS_LABELS = { new: '新提交', viewed: '已查看', handled: '已处理' };

function xml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '—');
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date).replaceAll('/', '-');
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes >= 1024 ** 2) return `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function answerText(value) {
  if (Array.isArray(value)) return value.length ? value.join('、') : '未填写';
  if (value && typeof value === 'object') {
    const name = String(value.fileName || '附件');
    return `${name}（${formatBytes(value.fileSize)}）`;
  }
  if (value === 0) return '0';
  const text = String(value ?? '').trim();
  return text || '未填写';
}

function textRun(value, options = {}) {
  const lines = String(value ?? '').split(/\r?\n/);
  const properties = [
    options.bold ? '<w:b/>' : '',
    options.color ? `<w:color w:val="${options.color}"/>` : '',
    options.size ? `<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>` : '',
  ].join('');
  return lines.map((line, index) => `${index ? '<w:br/>' : ''}<w:r><w:rPr>${properties}<w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:eastAsia="Microsoft YaHei"/></w:rPr><w:t xml:space="preserve">${xml(line)}</w:t></w:r>`).join('');
}

function paragraph(value, options = {}) {
  const spacing = options.spacing || '160';
  const pPr = [
    options.style ? `<w:pStyle w:val="${options.style}"/>` : '',
    options.center ? '<w:jc w:val="center"/>' : '',
    options.keepNext ? '<w:keepNext/>' : '',
    `<w:spacing w:after="${spacing}" w:line="360" w:lineRule="auto"/>`,
    options.shaded ? '<w:shd w:val="clear" w:color="auto" w:fill="F5F7FA"/><w:ind w:left="180" w:right="180"/>' : '',
  ].join('');
  return `<w:p><w:pPr>${pPr}</w:pPr>${textRun(value, options)}</w:p>`;
}

function metadataTable(rows) {
  const cell = (label, value) => `<w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/><w:shd w:val="clear" w:fill="F8FAFC"/><w:tcMar><w:top w:w="120" w:type="dxa"/><w:left w:w="160" w:type="dxa"/><w:bottom w:w="120" w:type="dxa"/><w:right w:w="160" w:type="dxa"/></w:tcMar></w:tcPr>${paragraph(label, { bold: true, color: '64748B', size: '18', spacing: '40' })}${paragraph(value, { size: '20', spacing: '0' })}</w:tc>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="E2E8F0"/><w:left w:val="single" w:sz="4" w:color="E2E8F0"/><w:bottom w:val="single" w:sz="4" w:color="E2E8F0"/><w:right w:val="single" w:sz="4" w:color="E2E8F0"/><w:insideH w:val="single" w:sz="4" w:color="E2E8F0"/><w:insideV w:val="single" w:sz="4" w:color="E2E8F0"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid>${rows.map(row => `<w:tr>${cell(row[0][0], row[0][1])}${cell(row[1][0], row[1][1])}</w:tr>`).join('')}</w:tbl>`;
}

function makeDocumentXml({ title, fields, answers, submittedAt, status, sourceUserName, submissionId }) {
  let questionNumber = 0;
  const content = [];
  for (const field of fields) {
    if (field.type === 'section_break') {
      content.push(paragraph(field.label, { style: 'Heading1', keepNext: true }));
      if (field.description) content.push(paragraph(field.description, { color: '64748B', size: '19' }));
      continue;
    }
    questionNumber += 1;
    const badges = [field.required ? '必填' : '', field.hidden ? '内部字段' : ''].filter(Boolean);
    content.push(paragraph(`${questionNumber}. ${field.label}${badges.length ? `  [${badges.join(' · ')}]` : ''}`, { style: 'Heading2', keepNext: true }));
    if (field.description) content.push(paragraph(field.description, { color: '64748B', size: '18', keepNext: true }));
    content.push(paragraph(answerText(answers[field.id]), { shaded: true, size: '21', spacing: '260' }));
  }
  if (!content.length) content.push(paragraph('该答卷没有可导出的题目。', { color: '64748B' }));

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${paragraph(title || '问卷答卷', { style: 'Title', center: true, spacing: '100' })}
${paragraph('单份答卷', { center: true, color: '64748B', size: '20', spacing: '320' })}
${metadataTable([
    [['提交时间', formatDateTime(submittedAt)], ['处理状态', STATUS_LABELS[status] || '新提交']],
    [['分享来源', sourceUserName || '公共链接'], ['答卷编号', submissionId]],
  ])}
${paragraph('', { spacing: '180' })}
${content.join('')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/><w:cols w:space="720"/><w:docGrid w:linePitch="312"/></w:sectPr>
</w:body></w:document>`;
}

async function buildQuestionnaireSubmissionDocx(data) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  zip.file('word/document.xml', makeDocumentXml(data));
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:eastAsia="Microsoft YaHei"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:color w:val="0F172A"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:color w:val="0F172A"/><w:sz w:val="34"/><w:szCs w:val="34"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="140"/></w:pPr><w:rPr><w:b/><w:color w:val="1D4ED8"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="100"/></w:pPr><w:rPr><w:b/><w:color w:val="334155"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style></w:styles>`);
  const created = new Date().toISOString();
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(data.title || '问卷答卷')}</dc:title><dc:creator>GCO Link</dc:creator><cp:lastModifiedBy>GCO Link</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>`);
  zip.file('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>GCO Link</Application><AppVersion>1.0</AppVersion></Properties>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

function safeDocxFilename(title, submittedAt) {
  const safeTitle = String(title || '问卷答卷').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 60) || '问卷答卷';
  const date = new Date(submittedAt);
  const suffix = Number.isNaN(date.getTime()) ? '' : `_${date.toISOString().slice(0, 10)}`;
  return `${safeTitle}_答卷${suffix}.docx`;
}

module.exports = { answerText, buildQuestionnaireSubmissionDocx, safeDocxFilename };
