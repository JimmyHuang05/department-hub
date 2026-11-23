function normalizeIdentifier(value) {
  return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
}

function integrationIdentifiers(item = {}) {
  const dynamicFields = item.dynamicFields && typeof item.dynamicFields === 'object' ? item.dynamicFields : {};
  const productName = String(item.productName || '');
  const contractFromName = productName.match(/\d{10}_\d{4}\([A-Z]\)/i)?.[0] || '';
  const aliasesValue = item.aliases ?? dynamicFields.aliases ?? dynamicFields.productAliases ?? '';
  const aliases = Array.isArray(aliasesValue)
    ? aliasesValue.map(value => String(value || '').trim()).filter(Boolean)
    : String(aliasesValue || '').split(/[;,；，\n]/).map(value => value.trim()).filter(Boolean);
  return {
    projectId: String(item.projectId || dynamicFields.projectId || '').trim(),
    projectCode: String(item.projectCode || dynamicFields.projectCode || '').trim(),
    contractNo: String(item.contractNo || dynamicFields.contractNo || contractFromName).trim(),
    aliases,
    channel: String(item.channel || item.brokerChannel || item.channelSales || dynamicFields.channel || '').trim(),
  };
}

function matchesIdentifiers(item, filters = {}) {
  const identifiers = integrationIdentifiers(item);
  if (filters.projectCode && normalizeIdentifier(identifiers.projectCode) !== normalizeIdentifier(filters.projectCode)) return false;
  if (filters.contractNo && normalizeIdentifier(identifiers.contractNo) !== normalizeIdentifier(filters.contractNo)) return false;
  if (filters.projectId && normalizeIdentifier(identifiers.projectId) !== normalizeIdentifier(filters.projectId)) return false;
  return true;
}

module.exports = { integrationIdentifiers, matchesIdentifiers, normalizeIdentifier };
