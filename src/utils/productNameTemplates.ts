import { ProductNameTemplate } from '../types';
import { generateId } from './id';

export const PRODUCT_NAME_TEMPLATE_SLOT = '$$';

export const normalizeProductNameTemplateSlots = (value: string): string => (
  value
    .replace(/（\s*）/g, () => PRODUCT_NAME_TEMPLATE_SLOT)
    .replace(/\(\s*\)/g, () => PRODUCT_NAME_TEMPLATE_SLOT)
    .replace(/\$+/g, () => PRODUCT_NAME_TEMPLATE_SLOT)
    .trim()
);

export const normalizeProductNameTemplate = (value: string): string => (
  normalizeProductNameTemplateSlots(value).replace(/\s+/g, '').trim()
);

export const inferProductNameTemplate = (productName: string): string => {
  const name = productName.trim();
  if (!name) return '';
  return name.replace(/\d+(?:\.\d+)?/g, () => PRODUCT_NAME_TEMPLATE_SLOT);
};

export type ProductNameTemplateScope = 'workLog' | 'project';

export const scopedProductNameTemplateKey = (
  scope: ProductNameTemplateScope,
  templateOrKey: string
): string => `${scope}:${normalizeProductNameTemplate(templateOrKey)}`;

export const createProductNameTemplate = (
  template: string,
  scope: ProductNameTemplateScope = 'workLog'
): ProductNameTemplate => {
  const cleanTemplate = normalizeProductNameTemplateSlots(template);
  const blockId = generateId();
  return {
    id: generateId(),
    name: cleanTemplate,
    scope,
    blocks: [{ id: blockId, label: cleanTemplate, template: cleanTemplate }],
    composition: [blockId],
  };
};

export const getTemplateText = (rule: ProductNameTemplate): string => (
  rule.blocks[0]?.template || rule.name || ''
);

export const countProductNameTemplateSlots = (template: string): number => (
  (normalizeProductNameTemplateSlots(template).match(/\$\$/g) || []).length
);

export const calculateProductNameTemplateWeight = ({
  template,
  count = 0,
  source = 'auto',
  query = '',
}: {
  template: string;
  count?: number;
  source?: 'manual' | 'auto';
  query?: string;
}): number => {
  const cleanTemplate = template.trim();
  const cleanQuery = query.trim().toLowerCase();
  const slotCount = countProductNameTemplateSlots(cleanTemplate);
  let weight = count * 10;

  if (source === 'manual') weight += 15;
  if (slotCount > 0) weight += slotCount * 3;
  if (cleanTemplate.length >= 12) weight += 5;
  if (cleanTemplate.length <= 4) weight -= 10;

  if (cleanQuery) {
    const index = cleanTemplate.toLowerCase().indexOf(cleanQuery);
    if (index === 0) weight += 30;
    else if (index > 0) weight += 10;
  }

  return Math.max(0, weight);
};
