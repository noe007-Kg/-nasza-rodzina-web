import { createHash } from 'node:crypto';

// Shared, dependency-free event semantics used by Vercel IN-APP backends.
export const CATEGORIES = Object.freeze(['calendar', 'tasks', 'shopping', 'familyChat', 'privateChat', 'health', 'school', 'important']);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clean = value => typeof value === 'string' ? value.slice(0, 500) : '';
export function notificationPreferences(value) {
  const source = value && typeof value === 'object' ? value : {};
  return { enabled: source.enabled !== false, sound: source.sound !== false, categories: Object.fromEntries(CATEGORIES.map(key => [key, source.categories?.[key] !== false])) };
}
export function wantsNotification(preferences, event) {
  const prefs = notificationPreferences(preferences);
  return prefs.enabled && prefs.categories[event.category] !== false && (!event.important || prefs.categories.important !== false);
}
const semanticFields = ['type', 'title', 'subject', 'date', 'time', 'endTime', 'weekday', 'note', 'sender', 'cancelled', 'status', 'endDate', 'allDay', 'description', 'location', 'person', 'private', 'privateToParents', 'done', 'approvalStatus', 'dueDate', 'priority', 'medicineTime', 'confirmedDate', 'participants', 'channel', 'text', 'repeat', 'repeatUntil', 'repeatCount', 'repeatBefore', 'recurrence', 'recurrenceExceptions', 'recurrenceOverrides', 'timeZone'];
function stableValue(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  return value ?? null;
}
export function semanticRecord(record) { return Object.fromEntries(semanticFields.filter(key => record?.[key] !== undefined).map(key => [key, stableValue(record[key])])); }
export function deriveNotificationEvent(collectionName, id, before, after) {
  if (!after && !(collectionName === 'schoolItems' && before?.type === 'lesson')) return null;
  const value = after || before;
  if (before && after && hash(semanticRecord(before)) === hash(semanticRecord(after))) return null;
  if (['schoolItems', 'schoolParentMessages', 'schoolStudentMessages'].includes(collectionName)) {
    const type = collectionName === 'schoolItems' ? value.type : 'message';
    if (!['grade', 'test', 'homework', 'lesson', 'message'].includes(type)) return null;
    // Provider read receipts and bookkeeping are not new messages or grades.
    if (before && ['grade', 'message', 'homework', 'test'].includes(type)) {
      if (hash(semanticRecord(before)) === hash(semanticRecord(after))) return null;
    }
    const studentId = clean(value.sourceProfileId || value.person);
    const sourceId = clean(value.sourceRecordId || id);
    const action = !after ? 'lesson-cancelled' : type === 'lesson' && before ? 'lesson-change' : type;
    const titles = { grade: before ? 'Zmiana oceny' : 'Nowa ocena', test: 'Nowy sprawdzian', homework: 'Nowe zadanie', message: 'Nowa wiadomość ze szkoły', lesson: 'Nowa lekcja', 'lesson-change': 'Zmiana w planie lekcji', 'lesson-cancelled': 'Odwołanie lekcji' };
    return { id: `school:${action}:${studentId}:${sourceId}${before || !after ? ':' + hash(semanticRecord(after || before)).slice(0, 24) : ''}`, category: 'school', module: 'Szkoła', title: `${titles[action]}${type === 'message' ? '' : ' — ' + clean(value.person)}`, body: 'Otwórz Szkołę, aby zobaczyć szczegóły.', important: action.includes('cancelled') || action.includes('change'), collection: collectionName, recordId: id, record: value, excludeUid: '' };
  }
  const config = {
    calendarEvents: ['calendar', 'Kalendarz', before ? 'Zmiana w kalendarzu' : 'Nowe wydarzenie rodzinne'],
    privateCalendarEvents: ['calendar', 'Kalendarz', before ? 'Zmiana w Twoim kalendarzu' : 'Nowe wydarzenie w Twoim kalendarzu'],
    tasks: ['tasks', 'Zadania', before ? value.done ? 'Zadanie ukończone' : 'Zmiana zadania' : 'Nowe zadanie'],
    shoppingItems: ['shopping', 'Zakupy', before ? 'Zmiana listy zakupów' : 'Nowy produkt na liście'],
    healthRecords: ['health', 'Zdrowie', before ? 'Aktualizacja w Zdrowiu' : 'Nowy wpis w Zdrowiu'],
    familyMessages: [value.channel === 'family' ? 'familyChat' : 'privateChat', 'Czat', value.channel === 'family' ? 'Nowa wiadomość rodzinna' : 'Nowa wiadomość prywatna'],
  }[collectionName];
  if (!config || (collectionName === 'familyMessages' && before)) return null;
  return { id: `${config[0]}:${id}${before ? ':' + hash(semanticRecord(after)).slice(0, 24) : ''}`, category: config[0], module: config[1], title: config[2], body: 'Otwórz aplikację, aby zobaczyć szczegóły.', important: value.priority === 'high', collection: collectionName, recordId: id, record: value, excludeUid: clean(value.uid || value.updatedBy || value.createdBy) };
}
export function canReceiveNotification(member, event) {
  if (!member || member.active !== true || member.canLogin !== true || member.archived === true || !['parent', 'adult', 'child'].includes(member.role)) return false;
  if (member.id === event.excludeUid) return false;
  const record = event.record || {};
  const ownPerson = member.personKey || member.name;
  if (event.collection === 'schoolParentMessages') return member.role === 'parent';
  if (event.collection === 'schoolStudentMessages') return member.role === 'child' && member.id === record.sourceOwnerUid && record.person === ownPerson;
  if (event.collection === 'schoolItems') return record.sourceConnectionScope === 'student'
    ? member.role === 'child' && member.id === record.sourceOwnerUid && record.person === ownPerson
    : member.role === 'parent' || member.role === 'child' && record.person === ownPerson;
  if (event.collection === 'familyMessages') return record.channel === 'family' || Array.isArray(record.participants) && record.participants.includes(member.id);
  if (event.collection === 'privateCalendarEvents' || event.collection === 'calendarEvents' && record.private === true) return (record.ownerUid || record.createdBy) === member.id;
  if (event.collection === 'healthRecords') return member.role === 'parent' || record.privateToParents !== true && ['family', ownPerson].includes(record.person);
  return true;
}
export function inboxEvent(event, now) {
  return { eventId: event.id, title: event.title, body: event.body, category: event.category, module: event.module, recordId: event.recordId, importantKey: event.collection === 'schoolParentMessages' ? `school:message:${event.record.person}:${event.recordId}` : event.collection === 'familyMessages' ? `chat:message:${event.recordId}` : '', important: !!event.important, read: false, starred: false, createdAt: now };
}
export function eventDocumentId(event) { return hash(event.id); }
export function safePushData(uid, event, sound) {
  return { recipientUid: uid, eventId: event.id, title: 'Nasza Rodzina', body: 'Masz nowe powiadomienie. Otwórz aplikację.', module: event.module, category: event.category, important: event.important ? '1' : '0', sound: sound ? '1' : '0', tag: eventDocumentId(event), link: '/#' + encodeURIComponent(event.module) };
}
