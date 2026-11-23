import { PRODUCT_HEADER_MAP } from './fieldMaps';

export const HEADER_MAP = PRODUCT_HEADER_MAP;

export function exportToCSV<T extends object>(data: T[], filename = 'export.csv') {
  if (!data.length) return;
  const records = data as Array<Record<string, unknown>>;
  const headers = Object.keys(records[0]);
  const csvContent = [
    headers.join(','),
    ...records.map(row => headers.map(header => {
      const value = String(row[header] ?? '');
      return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    }).join(',')),
  ].join('\n');
  downloadBlob(csvContent, filename);
}

export function downloadBlob(content: string, filename: string, mime = 'text/csv;charset=utf-8;') {
  const blob = new Blob(['\uFEFF' + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

export function mergeMultiLineRows(rawLines: string[]): string[] {
  const merged: string[] = [];
  let buffer = '';
  let inQuotes = false;
  for (const line of rawLines) {
    buffer = buffer ? `${buffer}\n${line}` : line;
    for (const char of line) if (char === '"') inQuotes = !inQuotes;
    if (!inQuotes) {
      merged.push(buffer);
      buffer = '';
    }
  }
  if (buffer) merged.push(buffer);
  return merged;
}

export function stripBOM(text: string): string {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}
