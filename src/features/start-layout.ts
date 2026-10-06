/** Stored per Firebase UID. Missing cards are appended after an application update. */
export const START_CARD_IDS = ['family-time', 'calendar', 'tasks', 'shopping', 'chat', 'health', 'school'] as const;
export type StartCardId = typeof START_CARD_IDS[number];

export function normalizeDashboardOrder(value: unknown): StartCardId[] {
  const valid = Array.isArray(value) ? value.filter((item): item is StartCardId => START_CARD_IDS.includes(item)) : [];
  return [...new Set([...valid, ...START_CARD_IDS])];
}

/** Call on drop only. Movement does not change the stored order. */
export function reorderDashboardCards(order: readonly StartCardId[], active: unknown, over: unknown): StartCardId[] {
  const next = normalizeDashboardOrder(order);
  const from = next.indexOf(active as StartCardId);
  const to = next.indexOf(over as StartCardId);
  if (from < 0 || to < 0 || from === to) return next;
  const [card] = next.splice(from, 1);
  next.splice(to, 0, card);
  return next;
}

export const dashboardCacheKey = (uid: string) => `nr-dashboard-order:${uid}`;
