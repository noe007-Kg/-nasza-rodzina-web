import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFamilyDirectory } from './family-directory';
import { legacyFamilyProfiles, memberPersonKey, memberSchoolEnabled } from './family-members';
import { schoolReadAccess } from './school/read-access';
import { createRoot } from 'react-dom/client';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  runTransaction,
  writeBatch,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL, getBlob, deleteObject } from 'firebase/storage';
import { auth, db, storage } from './firebase';
import { Feedback, ErrorBoundary, notify, errorMessage, onSnapshot } from './feedback';
import SchoolModule from './SchoolModule';
import { registerPwa } from './pwa';
import { startOfDay, endOfDay, startOfWeek, addDays, addMonths, addYears, sameDay, formatDateInput, formatTimeInput, parseLocalDate, isRepeatType, repeatLabel, occurrenceAt, generateOccurrences } from './calendar-utils';

export const APP_VERSION = '1.6.0';

export const APP_UPDATED = '03.10.2026';

export type Member = {
  id?: string;
  personKey?: string;
  birthDate?: string;
  adult?: boolean;
  name?: string;
  role?: string;
  photoURL?: string;
  emoji?: string;
  avatarPath?: string;
  avatarSource?: 'google' | 'custom' | 'default';
  active?: boolean;
  canLogin?: boolean;
  schoolEnabled?: boolean;
  archived?: boolean;
};

export type Page =
  | 'Start'
  | 'Kalendarz'
  | 'Zadania'
  | 'Zakupy'
  | 'Czat'
  | 'Zdrowie'
  | 'Szkoła'
  | 'Rodzina'
  | 'Ustawienia';

export type PersonKey = string;

export type CalendarView = 'day' | 'week' | 'month';

export type RepeatType = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'custom';

export type TaskPriority = 'low' | 'normal' | 'high';

export type CalendarEventData = {
  id: string;
  title: string;
  person: PersonKey;
  date: Date;
  endDate: Date;
  allDay: boolean;
  description: string;
  createdBy: string;
  repeat: RepeatType;
  repeatUntil: Date | null;
  recurrence?: { interval: number; unit: 'day' | 'week' | 'month' | 'year'; weekdays?: number[] };
  repeatCount?: number | null;
  recurrenceExceptions?: string[];
  recurrenceOverrides?: Record<string, { title?: string; person?: PersonKey; date: Date; endDate: Date; allDay?: boolean; description?: string; location?: string }>;
  repeatBefore?: Date | null;
  seriesId?: string;
  ownerUid?: string;
  private?: boolean;
  location?: string;
  timeZone?: string;
  /** Local read-only views; school projections are never written as calendar documents. */
  source?: 'manual' | 'sp4' | 'google';
  sourceRecordId?: string;
  sourceConnectionId?: string;
  sourceOwnerUid?: string;
  externalCalendarId?: string;
  externalEventId?: string;
  externalSeriesId?: string;
  sourceStartDate?: string;
  sourceEndDateExclusive?: string;
  ownerProfileId?: string;
  readOnly?: boolean;
  cancelled?: boolean;
};

export type CalendarOccurrence = {
  key: string;
  source: CalendarEventData;
  date: Date;
  endDate: Date;
  originalDate?: Date;
  originalIndex?: number;
};

export type EventForm = {
  title: string;
  person: PersonKey;
  date: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  description: string;
  repeat: RepeatType;
  repeatUntil: string;
  recurrenceInterval?: number;
  recurrenceUnit?: 'day' | 'week' | 'month' | 'year';
  recurrenceWeekdays?: number[];
  repeatEnd?: 'never' | 'date' | 'count';
  repeatCount?: number;
  private?: boolean;
  location?: string;
};

export type TaskApproval = 'none' | 'pending' | 'approved';

export type TaskRepeat = 'none' | 'daily' | 'weekly' | 'monthly';

export type TaskItem = {
  id: string;
  title: string;
  person: PersonKey;
  done: boolean;
  dueDate: string;
  priority: TaskPriority;
  note: string;
  points: number;
  requireApproval: boolean;
  approvalStatus: TaskApproval;
  repeat: TaskRepeat;
  createdAt?: Date;
  completedAt?: Date;
};

export type TaskForm = {
  title: string;
  person: PersonKey;
  dueDate: string;
  priority: TaskPriority;
  note: string;
  points: number;
  requireApproval: boolean;
  repeat: TaskRepeat;
};

export type ShoppingCategory =
  | 'owoce'
  | 'warzywa'
  | 'nabial'
  | 'pieczywo'
  | 'mieso'
  | 'mrozonki'
  | 'napoje'
  | 'chemia'
  | 'zwierzeta'
  | 'dzieci'
  | 'szkola'
  | 'inne';

export type ShoppingItem = {
  id: string;
  title: string;
  done: boolean;
  category: ShoppingCategory;
  quantity: string;
  unit: string;
  createdAt?: Date;
};

export type QuickProduct = {
  id: string;
  title: string;
  category: ShoppingCategory;
  icon?: string;
  imageURL?: string;
  adultOnly?: boolean;
  defaultQuantity: string;
  defaultUnit: string;
  custom?: boolean;
  hidden?: boolean;
};

export type ChatMessage = {
  id: string;
  text: string;
  name: string;
  uid: string;
  channel: string;
  createdAt?: Date;
};

export type HealthType = 'visit' | 'doctor' | 'medicine' | 'result' | 'history' | 'document';

export type HealthStatus = 'planned' | 'toBook' | 'booked' | 'done' | 'cancelled';

export type HealthRecord = {
  id: string;
  title: string;
  person: PersonKey;
  type: HealthType;
  date: string;
  time: string;
  doctor: string;
  location: string;
  note: string;
  specialty: string;
  status: HealthStatus;
  referralCode: string;
  nextControl: string;
  callReminderDate: string;
  documentURL: string;
  documentPath: string;
  privateToParents: boolean;
  dose: string;
  medicineTime: string;
  confirmedDate: string;
  createdAt?: Date;
};

export type HealthForm = Omit<HealthRecord, 'id' | 'createdAt' | 'confirmedDate' | 'documentURL' | 'documentPath'> & {
  addToCalendar: boolean;
  file: File | null;
};

export type MedicalContact = {
  id: string;
  person: PersonKey;
  specialty: string;
  name: string;
  doctor: string;
  phone: string;
  address: string;
  note: string;
};

export type SchoolType = 'lesson' | 'homework' | 'test' | 'grade' | 'message' | 'activity';

export type SchoolRecord = {
  id: string;
  title: string;
  person: PersonKey;
  type: SchoolType;
  subject: string;
  date: string;
  time: string;
  endTime: string;
  weekday: number;
  note: string;
  createdAt?: Date;
};

export type SchoolForm = Omit<SchoolRecord, 'id' | 'createdAt'> & {
  addToCalendar: boolean;
};

export type FamilyMemberDoc = {
  id: string;
  name: string;
  role: string;
  photoURL?: string;
  active?: boolean;
  birthDate?: string;
};

export const PEOPLE: PersonKey[] = ['family', 'Sebastian', 'Dominika', 'Paweł', 'Nikodem', 'Layla'];

export const FAMILY_ORDER = ['Sebastian', 'Dominika', 'Paweł', 'Nikodem', 'Layla'];

export const FAMILY_BIRTHDAYS: Partial<Record<PersonKey, string>> = {};

export function isParent(member: Member | null | undefined) {
  return member?.role === 'parent';
}

export function ownPerson(member: Member | null | undefined) {
  const value = member?.personKey || member?.name;
  return isPersonKey(value) ? value : 'family';
}

export function schoolQuery(member: Member | null) {
  const access = schoolReadAccess(member);
  if (!access) return null;
  return access.scope === 'parent' ? collection(db, 'schoolItems') : query(collection(db, 'schoolItems'), where('person', '==', access.person));
}

function normalizeProduct(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function ageFromBirthDate(value?: string) {
  if (!value) return null;
  const birth = new Date(`${value}T12:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

export function isAdultMember(member: Member | null | undefined) {
  if (isParent(member) || member?.role === 'adult' || member?.adult === true) return true;
  const age = ageFromBirthDate(member?.birthDate);
  return age !== null && age >= 18;
}

export function personRole(name: string, role?: string) {
  if (role === 'adult') return 'Dorosły';
  if (role && role !== 'parent' && role !== 'child') return role;
  if (name === 'Sebastian') return 'Tata';
  if (name === 'Dominika') return 'Mama';
  if (name === 'Paweł' || name === 'Nikodem') return 'Syn';
  if (name === 'Layla') return 'Córka';
  return 'Rodzina';
}

export function dateKey(date = new Date()) {
  return formatDateInput(date);
}

export function subjectIcon(subject: string) {
  const text = normalizeProduct(subject);
  if (text.includes('matem')) return 'π';
  if (text.includes('polski')) return '📖';
  if (text.includes('angiel')) return '🇬🇧';
  if (text.includes('niemiec')) return '🇩🇪';
  if (text.includes('informat')) return '💻';
  if (text.includes('fizyk')) return '⚛️';
  if (text.includes('chem')) return '🧪';
  if (text.includes('biolog') || text.includes('przyrod')) return '🌿';
  if (text.includes('histor')) return '🏛️';
  if (text.includes('geograf')) return '🌍';
  if (text.includes('wf') || text.includes('wychowanie fizycz')) return '⚽';
  if (text.includes('muzyk') || text.includes('fortepian')) return '🎹';
  if (text.includes('plast')) return '🎨';
  return '📚';
}

export function eventActivityIcon(title: string) {
  const text = normalizeProduct(title);
  if (text.includes('praca')) return '💼';
  if (text.includes('basen') || text.includes('ratownik')) return '🛟';
  if (text.includes('korepety')) return '📐';
  if (text.includes('szkol')) return '🎒';
  if (text.includes('fortepian') || text.includes('muzyk')) return '🎹';
  if (text.includes('kino')) return '🎬';
  if (text.includes('lekar') || text.includes('wizyta')) return '🩺';
  return '📅';
}

export function isPersonKey(value: unknown): value is PersonKey {
  return typeof value === 'string' && value.length > 0 && value.length <= 80
    && value.trim() === value && !/[\u0000-\u001f\u007f/]/.test(value);
}

export function personLabel(person: PersonKey) {
  return person === 'family' ? 'Cała rodzina' : person;
}

export function personColor(person: PersonKey) {
  switch (person) {
    case 'Sebastian': return '#3182f6';
    case 'Dominika': return '#8b5cf6';
    case 'Paweł': return '#22c55e';
    case 'Nikodem': return '#f59e0b';
    case 'Layla': return '#ec4899';
    default: return '#64748b';
  }
}

export function personEventClass(person: PersonKey) {
  switch (person) {
    case 'Sebastian': return 'event-sebastian';
    case 'Dominika': return 'event-dominika';
    case 'Paweł': return 'event-pawel';
    case 'Nikodem': return 'event-nikodem';
    case 'Layla': return 'event-layla';
    default: return 'event-family';
  }
}

export function formatTime(date: Date) {
  return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

export function formatShortDate(value: string) {
  if (!value) return 'Bez terminu';
  const date = new Date(`${value}T12:00:00`);
  return date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
}

export function capitalize(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

export function dynamicTodayLabel() {
  return capitalize(new Date().toLocaleDateString('pl-PL', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }));
}

export function weekTitle(weekStart: Date) {
  const end = addDays(weekStart, 6);
  const startMonth = weekStart.toLocaleDateString('pl-PL', { month: 'short' });
  const endMonth = end.toLocaleDateString('pl-PL', { month: 'short' });
  if (weekStart.getMonth() === end.getMonth()) {
    return `${weekStart.getDate()}–${end.getDate()} ${endMonth} ${end.getFullYear()}`;
  }
  return `${weekStart.getDate()} ${startMonth} – ${end.getDate()} ${endMonth} ${end.getFullYear()}`;
}

export function initials(name?: string) {
  if (!name) return '🙂';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '🙂';
}

export function memberEmoji(name: string) {
  const normalized = name.toLowerCase();
  if (normalized.includes('dominika')) return '👩';
  if (normalized.includes('sebastian')) return '👨';
  if (normalized.includes('nikodem')) return '👦';
  if (normalized.includes('layla')) return '👶';
  if (normalized.includes('paweł') || normalized.includes('pawel')) return '🧑';
  return '🙂';
}

export const PAGES: Page[] = ['Start', 'Kalendarz', 'Zadania', 'Zakupy', 'Czat', 'Zdrowie', 'Szkoła', 'Rodzina', 'Ustawienia'];

export function pageFromHash(): Page {
  try { const value = decodeURIComponent(location.hash.slice(1)) as Page; return PAGES.includes(value) ? value : 'Start'; } catch { return 'Start'; }
}

export function AppIcon({ page, size = 20 }: { page: Page; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (page) {
    case 'Start': return <svg {...common}><path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M9.5 20v-6h5v6"/></svg>;
    case 'Kalendarz': return <svg {...common}><rect x="3.5" y="5.5" width="17" height="15" rx="2.5"/><path d="M7 3.5v4M17 3.5v4M3.5 10h17"/><path d="M7.5 13.5h2M12 13.5h2M16.5 13.5h.1M7.5 17h2M12 17h2"/></svg>;
    case 'Zadania': return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 2.2 2.2L16.5 8"/></svg>;
    case 'Zakupy': return <svg {...common}><path d="M3 4h2l2.1 10.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L20.5 8H6"/><circle cx="9.5" cy="19" r="1"/><circle cx="17" cy="19" r="1"/></svg>;
    case 'Czat': return <svg {...common}><path d="M4 5.5h16v11H9l-5 4v-15Z"/><path d="M8 10h8M8 13h5"/></svg>;
    case 'Zdrowie': return <svg {...common}><path d="M12 20s-7.5-4.7-7.5-10.2A4.3 4.3 0 0 1 12 6.9a4.3 4.3 0 0 1 7.5 2.9C19.5 15.3 12 20 12 20Z"/></svg>;
    case 'Szkoła': return <svg {...common}><path d="m3 9 9-5 9 5-9 5-9-5Z"/><path d="M7 12.2V16c3 2 7 2 10 0v-3.8M21 9v6"/></svg>;
    case 'Rodzina': return <svg {...common}><circle cx="8" cy="8" r="2.5"/><circle cx="16.2" cy="8.8" r="2.1"/><path d="M3.8 19v-1.8A4.2 4.2 0 0 1 8 13h0a4.2 4.2 0 0 1 4.2 4.2V19M13.2 14.2a3.5 3.5 0 0 1 6.3 2.1V19"/></svg>;
    case 'Ustawienia': return <svg {...common}><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.1M12 19.1v2.1M21.2 12h-2.1M4.9 12H2.8M18.5 5.5 17 7M7 17l-1.5 1.5M18.5 18.5 17 17M7 7 5.5 5.5"/><circle cx="12" cy="12" r="7.1"/></svg>;
  }
}

export function ModuleHeader({ icon: _icon, title, text, action }: { icon: string; title: string; text: string; action?: React.ReactNode }) {
  const pageIcon = (['Kalendarz','Zadania','Zakupy','Czat','Zdrowie','Szkoła','Rodzina','Ustawienia'] as Page[]).includes(title as Page) ? title as Page : 'Start';
  return (
    <section className="page-header compact-header">
      <div className="module-heading"><span className="module-title-icon"><AppIcon page={pageIcon} size={20} /></span><div><small>Nasza Rodzina</small><h1>{title}</h1><p>{text}</p></div></div>
      {action}
    </section>
  );
}

export function PersonSelect({ value, onChange, includeFamily = true, schoolOnly = false, allowed }: { value: PersonKey; onChange: (v: PersonKey) => void; includeFamily?: boolean; schoolOnly?: boolean; allowed?: PersonKey[] }) {
  const directory = useFamilyDirectory();
  const members = (directory.length ? directory : legacyFamilyProfiles()).filter(profile => profile.active !== false && !profile.archived && !profile.disabled && (!schoolOnly || memberSchoolEnabled(profile)));
  const keys = [...new Set(members.map(memberPersonKey).filter(isPersonKey))];
  const options: PersonKey[] = allowed || (includeFamily && !schoolOnly ? ['family', ...keys] : keys);
  return (
    <select aria-label="Osoba" value={value} onChange={(e) => isPersonKey(e.target.value) && onChange(e.target.value)}>
      {options.map((person) => <option key={person} value={person}>{members.find(profile => memberPersonKey(profile) === person)?.name || personLabel(person)}</option>)}
    </select>
  );
}

export function EmptyState({ icon, text }: { icon: string; text: string }) {
  return <div className="empty-state"><span>{icon}</span><p>{text}</p></div>;
}

export function Modal({ title, subtitle, onClose, children, wide = false }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const element = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const titleId = React.useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.current?.focus();
    function keyboard(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
      if (e.key !== 'Tab') return;
      const options = Array.from(element.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') || []).filter(node=>node.getClientRects().length);
      if (!options.length) { e.preventDefault(); return; }
      const first = options[0], last = options[options.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === element.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === element.current)) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keyboard); previous?.focus(); };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section ref={element} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`modal-card ${wide ? 'wide' : ''}`}>
        <header className="modal-header"><div><small>{subtitle || 'Nasza Rodzina'}</small><h2 id={titleId}>{title}</h2></div><button type="button" onClick={onClose} aria-label="Zamknij">✕</button></header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

export function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="detail-row"><span>{label}</span><strong>{value}</strong></div>;
}

export const SCHOOL_META: Record<SchoolType, { label: string; icon: string }> = {
  lesson: { label: 'Plan lekcji', icon: '📚' }, homework: { label: 'Zadania domowe', icon: '📝' }, test: { label: 'Sprawdziany / kartkówki', icon: '📅' }, grade: { label: 'Oceny', icon: '⭐' }, message: { label: 'Wiadomości', icon: '💬' }, activity: { label: 'Zajęcia dodatkowe', icon: '🎯' },
};

export function isSchoolType(value: unknown): value is SchoolType { return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SCHOOL_META, value); }

export function downloadFile(contents:string, name:string, type:string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export { React, useEffect, useMemo, useRef, useState, createRoot, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, where, runTransaction, writeBatch, setDoc, Timestamp, updateDoc, storageRef, uploadBytes, getDownloadURL, getBlob, deleteObject, auth, db, storage, Feedback, ErrorBoundary, notify, errorMessage, onSnapshot, SchoolModule, registerPwa, startOfDay, endOfDay, startOfWeek, addDays, addMonths, addYears, sameDay, formatDateInput, formatTimeInput, parseLocalDate, isRepeatType, repeatLabel, occurrenceAt, generateOccurrences };
export type { User };
