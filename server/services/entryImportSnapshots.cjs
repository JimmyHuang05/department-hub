const WEEK_KEY_PATTERN = /^\d{6}$/;

function collectImportedSnapshotWeekKeys(entry) {
  const keys = new Set();
  for (const source of [entry.weeklyProgress, entry.navScaleHistory]) {
    if (!source || typeof source !== 'object') continue;
    for (const key of Object.keys(source)) {
      if (WEEK_KEY_PATTERN.test(key)) keys.add(key);
    }
  }
  if (WEEK_KEY_PATTERN.test(String(entry.weekKey || ''))) keys.add(entry.weekKey);
  return Array.from(keys).sort();
}

function historyThroughWeek(history, weekKey) {
  if (!history || typeof history !== 'object') return {};
  return Object.fromEntries(
    Object.entries(history).filter(([key]) => WEEK_KEY_PATTERN.test(key) && key <= weekKey)
  );
}

function historicalNavScale(entry, weekKey) {
  const history = entry.navScaleHistory || {};
  if (history[weekKey]) return history[weekKey];
  const inheritedKey = Object.keys(history)
    .filter(key => WEEK_KEY_PATTERN.test(key) && key <= weekKey && history[key])
    .sort()
    .at(-1);
  return inheritedKey ? history[inheritedKey] : (entry.navScale || '');
}

function buildImportedEntrySnapshots(entry) {
  return collectImportedSnapshotWeekKeys(entry).map(weekKey => ({
    ...JSON.parse(JSON.stringify(entry)),
    weekKey,
    navScale: historicalNavScale(entry, weekKey),
    weeklyProgress: historyThroughWeek(entry.weeklyProgress, weekKey),
    navScaleHistory: historyThroughWeek(entry.navScaleHistory, weekKey),
  }));
}

module.exports = {
  buildImportedEntrySnapshots,
  collectImportedSnapshotWeekKeys,
};
