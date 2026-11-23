export function normalizeLoginIdentifier(value: string) {
  const trimmed = String(value || '').trim();
  const numericMatch = trimmed.match(/^(?:IBD\s*-?\s*)?(\d{1,5})$/i);
  if (!numericMatch) return trimmed;
  return `IBD-${numericMatch[1].padStart(5, '0')}`;
}

export function isNumericLoginIdentifier(value: string) {
  return /^(?:IBD\s*-?\s*)?\d{1,5}$/i.test(String(value || '').trim());
}
