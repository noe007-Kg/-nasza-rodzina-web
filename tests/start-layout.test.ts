import test from 'node:test';
import assert from 'node:assert/strict';
import { START_CARD_IDS, normalizeDashboardOrder, reorderDashboardCards, dashboardCacheKey } from '../src/features/start-layout';

test('dashboard restores all cards once when saved preferences are incomplete or malformed', () => {
  assert.deepEqual(normalizeDashboardOrder(['school', 'school', 'unknown', 'chat']), ['school', 'chat', 'family-time', 'calendar', 'tasks', 'shopping', 'health']);
  assert.deepEqual(normalizeDashboardOrder(null), [...START_CARD_IDS]);
});

test('drop reorders a copy and cancelled / outside drops leave the order unchanged', () => {
  const initial = [...START_CARD_IDS];
  assert.deepEqual(reorderDashboardCards(initial, 'family-time', 'tasks'), ['calendar', 'tasks', 'family-time', 'shopping', 'chat', 'health', 'school']);
  assert.deepEqual(initial, [...START_CARD_IDS]);
  assert.deepEqual(reorderDashboardCards(initial, 'family-time', null), initial);
  assert.deepEqual(reorderDashboardCards(initial, 'family-time', 'family-time'), initial);
});

test('dashboard local caches belong to a UID, never to a display name or shared browser key', () => {
  assert.notEqual(dashboardCacheKey('sebastian-uid'), dashboardCacheKey('dominika-uid'));
  assert.equal(dashboardCacheKey('sebastian-uid'), 'nr-dashboard-order:sebastian-uid');
});
