import type { ChatMessage } from '../app-shared';
import { orderedFamilyProfiles } from '../family-directory';
import { memberPersonKey, type FamilyMemberProfile } from '../family-members';

/** Already generated occurrences: recurring events are never expanded here. */
export type StartCalendarOccurrence = {
  key?: string;
  source: { id?: string; person: string; allDay?: boolean; cancelled?: boolean };
  date?: Date;
  endDate?: Date;
};

export type StartSchoolRecord = {
  id: string;
  person: string;
  type: string;
  date?: string;
  time?: string;
  endTime?: string;
  weekday?: number;
  note?: string;
  source?: string;
  calendarEventId?: string;
};

export type FamilyTimeMember = {
  profile: FamilyMemberProfile;
  endAt: Date | null;
  incomplete: boolean;
  hasPlan: boolean;
};

export type FamilyTimeProjection = {
  members: FamilyTimeMember[];
  /** Latest known end; incomplete must also be checked before claiming availability. */
  endAt: Date | null;
  incomplete: boolean;
};

export type StartChatMessage = ChatMessage & { participants?: readonly string[] };
export type StartConversation = { message: StartChatMessage; label: string; profile?: FamilyMemberProfile };

export type StartShoppingItem = {
  id: string;
  title: string;
  category: string;
  quantity: string;
  unit: string;
  done: boolean;
  createdAt?: Date;
};

export type StartQuickProduct = {
  id: string;
  title: string;
  category: string;
  icon?: string;
  imageURL?: string;
  adultOnly?: boolean;
  hidden?: boolean;
  custom?: boolean;
  defaultQuantity?: string;
  defaultUnit?: string;
};
export type StartQuickProductOverride = { id: string } & Partial<Omit<StartQuickProduct, 'id'>>;
export type StartShoppingPreview<T extends StartShoppingItem = StartShoppingItem> = { item: T; product?: StartQuickProduct };

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function latestEnd(current: Date | null, next: Date | null) {
  return next && (!current || next > current) ? next : current;
}

function activeProfiles(profiles: readonly FamilyMemberProfile[]) {
  return orderedFamilyProfiles(profiles, '');
}

function uniqueProfiles(profiles: readonly FamilyMemberProfile[]) {
  const seen = new Set<string>();
  return activeProfiles(profiles).filter(profile => {
    const person = memberPersonKey(profile) || profile.uid || profile.id;
    if (seen.has(person)) return false;
    seen.add(person);
    return true;
  });
}

function forPerson(person: string, identity: string) {
  return person === 'family' || person === identity;
}

function isCancelledLesson(record: StartSchoolRecord) {
  const firstLine = (record.note || '').split(/\r?\n/).map(line => line.trim()).find(Boolean);
  return record.source === 'eduvulcan' && firstLine === 'Lekcja odwołana';
}

function schoolTime(value: string | undefined, now: Date) {
  if (!value || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  const result = new Date(now);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

/** Projects only the visible plan; absence of a plan never means a member is free. */
export function buildFamilyTime(
  profiles: readonly FamilyMemberProfile[],
  todayOccurrences: readonly StartCalendarOccurrence[],
  schoolRecords: readonly StartSchoolRecord[],
  now: Date,
): FamilyTimeProjection {
  const roster = uniqueProfiles(profiles);
  if (!validDate(now)) {
    return { members: roster.map(profile => ({ profile, endAt: null, incomplete: true, hasPlan: false })), endAt: null, incomplete: true };
  }
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const weekday = now.getDay() || 7;
  const todaySchool = schoolRecords.filter(record => {
    if (record.type !== 'lesson' && record.type !== 'activity') return false;
    const date = record.date?.trim();
    return date ? date === today : record.weekday === weekday;
  });
  const members = roster.map((profile): FamilyTimeMember => {
    const identity = memberPersonKey(profile) || profile.uid || profile.id;
    const ownSchool = todaySchool.filter(record => forPerson(record.person, identity));
    const cancelled = ownSchool.filter(isCancelledLesson);
    const occurrences = todayOccurrences.filter(occurrence => occurrence.source.cancelled !== true && forPerson(occurrence.source.person, identity)
      && !cancelled.some(record => record.calendarEventId && record.calendarEventId === occurrence.source.id));
    let endAt: Date | null = null;
    let hasPlan = false;
    let incomplete = false;
    for (const occurrence of occurrences) {
      hasPlan = true;
      if (occurrence.source.allDay || !validDate(occurrence.date) || !validDate(occurrence.endDate) || occurrence.endDate <= occurrence.date) {
        incomplete = true;
      } else {
        endAt = latestEnd(endAt, occurrence.endDate);
      }
    }
    for (const record of ownSchool) {
      if (isCancelledLesson(record)) continue;
      // A visible linked occurrence is authoritative, including its unknown all-day end.
      // A link alone cannot prove that an inaccessible/deleted calendar event exists.
      if (record.calendarEventId && occurrences.some(occurrence => occurrence.source.id === record.calendarEventId)) continue;
      hasPlan = true;
      const start = schoolTime(record.time, now), end = schoolTime(record.endTime, now);
      if (!start || !end || end <= start) incomplete = true;
      else endAt = latestEnd(endAt, end);
    }
    return { profile, endAt, hasPlan, incomplete: incomplete || !hasPlan };
  });
  return {
    members,
    endAt: members.reduce((end, member) => latestEnd(end, member.endAt), null as Date | null),
    incomplete: !members.length || members.some(member => member.incomplete),
  };
}

export function countdownText(endAt: Date | null, now: Date): string {
  if (!validDate(endAt) || !validDate(now)) return 'Brak danych o planie';
  const remaining = endAt.getTime() - now.getTime();
  if (remaining <= 0) return 'już wolni';
  const minutes = Math.ceil(remaining / 60_000);
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return `za ${hours ? `${hours} godz.${rest ? ' ' : ''}` : ''}${rest ? `${rest} min` : ''}`;
}

function compareText(first: string, second: string) {
  return first === second ? 0 : first < second ? -1 : 1;
}

function messageTime(message: { createdAt?: Date }) {
  return validDate(message.createdAt) ? message.createdAt.getTime() : 0;
}

function privateParticipants(message: StartChatMessage, currentUid: string): readonly string[] | null {
  const parts = message.channel.split(':');
  if (parts.length !== 3 || parts[0] !== 'private') return null;
  const fromChannel = parts.slice(1);
  const participants = message.participants === undefined ? fromChannel : message.participants;
  if (!Array.isArray(participants) || participants.length !== 2
    || participants.some(uid => typeof uid !== 'string' || !uid.trim() || uid.includes(':'))
    || participants[0] === participants[1] || !participants.includes(currentUid) || !participants.includes(message.uid)) return null;
  if (`private:${[...participants].sort().join(':')}` !== message.channel) return null;
  return participants;
}

/** Newest message per authorized channel, with a private label independent of sender. */
export function latestConversations(
  messages: readonly StartChatMessage[],
  profiles: readonly FamilyMemberProfile[],
  currentUid: string,
): StartConversation[] {
  const roster = activeProfiles(profiles);
  const profileForUid = (uid: string) => roster.find(profile => profile.uid === uid || profile.id === uid);
  const ordered = messages.filter(message => typeof message.id === 'string' && !!message.id.trim()
    && typeof message.uid === 'string' && !!message.uid.trim() && typeof message.text === 'string'
    && typeof message.channel === 'string'
    && (message.channel === 'family' || (!!currentUid && !!privateParticipants(message, currentUid))))
    .slice().sort((first, second) => messageTime(second) - messageTime(first)
      || compareText(second.id, first.id) || compareText(first.channel, second.channel)
      || compareText(first.uid, second.uid) || compareText(first.text, second.text));
  const ids = new Set<string>(), channels = new Set<string>();
  const result: StartConversation[] = [];
  for (const message of ordered) {
    if (ids.has(message.id)) continue;
    ids.add(message.id);
    if (channels.has(message.channel)) continue;
    channels.add(message.channel);
    if (message.channel === 'family') {
      result.push({ message, label: 'Rodzina', profile: profileForUid(message.uid) });
    } else {
      const other = privateParticipants(message, currentUid)!.find(uid => uid !== currentUid)!;
      const profile = profileForUid(other);
      result.push({ message, label: profile?.name || memberPersonKey(profile) || 'Rozmowa prywatna', profile });
    }
    if (result.length === 3) break;
  }
  return result;
}

function productTitle(title: string) {
  return title.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ł/g, 'l');
}

/** Catalog data supplies visuals only; quantities and purchase state stay on the item. */
export function shoppingPreview<T extends StartShoppingItem>(
  items: readonly T[],
  quickDefaults: readonly StartQuickProduct[],
  quickOverrides: readonly StartQuickProductOverride[],
  adult: boolean,
): StartShoppingPreview<T>[] {
  const catalog = new Map<string, StartQuickProduct>();
  for (const product of quickDefaults) catalog.set(product.id, { ...product });
  for (const override of quickOverrides) {
    const defined = Object.fromEntries(Object.entries(override).filter(([, value]) => value !== undefined));
    const merged = { ...catalog.get(override.id), ...defined };
    if (typeof merged.title === 'string' && typeof merged.category === 'string') catalog.set(override.id, merged as StartQuickProduct);
  }
  const byTitle = new Map<string, StartQuickProduct[]>();
  for (const product of catalog.values()) {
    if (product.hidden || (product.adultOnly && !adult)) continue;
    const title = productTitle(product.title);
    if (title) byTitle.set(title, [...(byTitle.get(title) || []), product]);
  }
  return items.filter(item => !item.done).slice()
    .sort((first, second) => messageTime(first) - messageTime(second) || compareText(first.id, second.id))
    .slice(0, 3).map(item => {
      const matches = byTitle.get(productTitle(item.title));
      return { item, ...(matches?.length === 1 ? { product: matches[0] } : {}) };
    });
}
