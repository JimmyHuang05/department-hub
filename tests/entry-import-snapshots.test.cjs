const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildImportedEntrySnapshots,
  collectImportedSnapshotWeekKeys,
} = require('../server/services/entryImportSnapshots.cjs');

test('worklog imports build a complete snapshot for every recognized historical week', () => {
  const entry = {
    id: 'entry-1',
    productName: '项目甲',
    subCategory: '资产管理',
    status: '运行中',
    personA: '经理甲',
    personB: '经理乙',
    activePassive: '主动',
    managementReport: '每季度',
    weekKey: '260116',
    navScale: '当前规模',
    weeklyProgress: {
      260104: '第一周进展',
      260109: '第二周进展',
      260116: '第三周进展',
    },
    navScaleHistory: {
      260104: '第一周规模',
      260116: '第三周规模',
    },
  };

  assert.deepEqual(collectImportedSnapshotWeekKeys(entry), ['260104', '260109', '260116']);
  const snapshots = buildImportedEntrySnapshots(entry);
  assert.equal(snapshots.length, 3);
  assert.ok(snapshots.every(snapshot => snapshot.subCategory === '资产管理'));
  assert.equal(snapshots[0].personA, '经理甲');
  assert.equal(snapshots[0].managementReport, '每季度');
  assert.deepEqual(snapshots[0].weeklyProgress, { 260104: '第一周进展' });
  assert.equal(snapshots[1].navScale, '第一周规模');
  assert.deepEqual(snapshots[1].weeklyProgress, {
    260104: '第一周进展',
    260109: '第二周进展',
  });
  assert.equal(snapshots[2].navScale, '第三周规模');
});

test('direct-sales rows create snapshots even when their weekly progress text is blank', () => {
  const snapshots = buildImportedEntrySnapshots({
    id: 'direct-1',
    category: '直销产品情况',
    productName: '直销产品甲',
    weekKey: '260731',
    weeklyProgress: {
      260717: '',
      260724: '',
      260731: '',
    },
    navScaleHistory: {},
    dynamicFields: { weeklyReview: '最新回顾' },
  });

  assert.deepEqual(snapshots.map(snapshot => snapshot.weekKey), ['260717', '260724', '260731']);
  assert.equal(snapshots[0].dynamicFields.weeklyReview, '最新回顾');
});
