export const NOTIFICATION_CATEGORIES = ['calendar', 'tasks', 'shopping', 'familyChat', 'privateChat', 'health', 'school', 'important'] as const;
export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number];
export type NotificationModule = 'Kalendarz' | 'Zadania' | 'Zakupy' | 'Czat' | 'Zdrowie' | 'Szkoła' | 'Start';
export type NotificationPreferences = { enabled: boolean; sound: boolean; categories: Record<NotificationCategory, boolean> };
export type FamilyNotification = { id: string; eventId: string; title: string; body: string; category: NotificationCategory; module: NotificationModule; important: boolean; read: boolean; starred: boolean; createdAt: Date; recordId?: string; importantKey?: string; local?: boolean };
export type LocalNotification = { id: string; title: string; body: string; category: NotificationCategory; module: NotificationModule; important?: boolean };
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = { enabled: true, sound: true, categories: Object.fromEntries(NOTIFICATION_CATEGORIES.map(category => [category, true])) as Record<NotificationCategory, boolean> };
export function normalizePreferences(value: unknown): NotificationPreferences {
  const input = value && typeof value === 'object' ? value as Partial<NotificationPreferences> : {};
  return { enabled: input.enabled !== false, sound: input.sound !== false, categories: Object.fromEntries(NOTIFICATION_CATEGORIES.map(category => [category, input.categories?.[category] !== false])) as Record<NotificationCategory, boolean> };
}
export function notificationAllowed(prefs: NotificationPreferences, category: NotificationCategory, important = false): boolean {
  return prefs.enabled && prefs.categories[category] && (!important || prefs.categories.important);
}
export function sortNotifications(items: FamilyNotification[]): FamilyNotification[] {
  return [...items].sort((a, b) => Number(b.starred || b.important) - Number(a.starred || a.important) || b.createdAt.getTime() - a.createdAt.getTime());
}
export function isNotificationModule(value: unknown): value is NotificationModule { return typeof value === 'string' && ['Kalendarz', 'Zadania', 'Zakupy', 'Czat', 'Zdrowie', 'Szkoła', 'Start'].includes(value); }
