import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { arrayRemove, arrayUnion, collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Icon, SecondaryButton, StatusPill } from '../ui';
import { DEFAULT_NOTIFICATION_PREFERENCES, NOTIFICATION_CATEGORIES, normalizePreferences, notificationAllowed, sortNotifications, isNotificationModule, type NotificationCategory, type NotificationModule, type NotificationPreferences, type FamilyNotification, type LocalNotification } from './model';
import { disableLegacySystemNotifications } from './legacy-push';
import { useInAppNotificationRefresh } from './refresh';
import { playNotificationBell, unlockNotificationSound } from './sound';
import './notifications.css';
export { prepareNotificationLogout } from './legacy-push';
export type { LocalNotification } from './model';

type NotificationContextValue = {
  items: FamilyNotification[]; unread: number; prefs: NotificationPreferences; importantItems: string[]; busy: boolean; error: string;
  savePreferences: (value: NotificationPreferences) => Promise<void>; markRead: (item: FamilyNotification) => Promise<void>; toggleStar: (item: FamilyNotification) => Promise<void>; toggleImportant: (id: string) => Promise<void>; announceLocal: (item: LocalNotification) => void; openItem: (item: FamilyNotification) => void;
};
const Context = createContext<NotificationContextValue | null>(null);
function seenIds(uid: string): Set<string> { try { return new Set(JSON.parse(localStorage.getItem(`nr-notification-seen:${uid}`) || '[]')); } catch { return new Set(); } }
function persistSeen(uid: string, value: Set<string>): void { try { localStorage.setItem(`nr-notification-seen:${uid}`, JSON.stringify([...value].slice(-1000))); } catch { /* Private mode may disallow persistence. */ } }

export function NotificationProvider({ user, member, goTo, children }: { user: User; member: { name?: string; personKey?: string; role?: string } | null; goTo: (page: NotificationModule) => void; children: ReactNode }) {
  useInAppNotificationRefresh(user, member);
  const [prefs, setPrefs] = useState(DEFAULT_NOTIFICATION_PREFERENCES);
  const [importantItems, setImportantItems] = useState<string[]>([]);
  const [remoteItems, setRemoteItems] = useState<FamilyNotification[]>([]);
  const [localItems, setLocalItems] = useState<FamilyNotification[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const preferenceOperation = useRef(0);
  const busyRef = useRef(busy); busyRef.current = busy;
  const prefsRef = useRef(prefs); prefsRef.current = prefs;
  const seen = useRef(seenIds(user.uid));
  const initializedInbox = useRef(false);

  const notice = useCallback((id: string, category: NotificationCategory, important = false) => {
    if (seen.current.has(id) || !notificationAllowed(prefsRef.current, category, important)) return false;
    seen.current.add(id); persistSeen(user.uid, seen.current);
    playNotificationBell(prefsRef.current.sound);
    return true;
  }, [user.uid]);

  useEffect(() => {
    const unlock = () => { void unlockNotificationSound(); };
    window.addEventListener('pointerdown', unlock, { passive: true }); window.addEventListener('keydown', unlock);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, []);

  useEffect(() => {
    // Upgrade safety only: detach a possible older PWA push subscription.
    // This never registers a token or requests a browser permission.
    void disableLegacySystemNotifications();
  }, [user.uid]);

  useEffect(() => onSnapshot(doc(db, 'userPreferences', user.uid), snapshot => {
    const value = snapshot.data();
    const next = normalizePreferences(value?.notifications);
    // Keep the user's optimistic switch state while its write is in flight.
    // Otherwise a controlled checkbox briefly flips back before Firestore ACK.
    if (!busyRef.current) { setPrefs(next); prefsRef.current = next; }
    setImportantItems(Array.isArray(value?.importantItems) ? value.importantItems.filter((id: unknown) => typeof id === 'string') : []);
  }, () => setError('Nie udało się wczytać ustawień powiadomień.')), [user.uid]);

  useEffect(() => onSnapshot(query(collection(db, 'notificationInbox', user.uid, 'items'), orderBy('createdAt', 'desc'), limit(300)), snapshot => {
    const values = snapshot.docs.map(row => {
      const value = row.data();
      return { id: row.id, eventId: String(value.eventId || row.id), title: String(value.title || 'Nowe powiadomienie'), body: String(value.body || ''), category: NOTIFICATION_CATEGORIES.includes(value.category) ? value.category as NotificationCategory : 'important', module: isNotificationModule(value.module) ? value.module : 'Start', important: value.important === true, read: value.read === true, starred: value.starred === true, createdAt: value.createdAt instanceof Timestamp ? value.createdAt.toDate() : new Date(0), recordId: typeof value.recordId === 'string' ? value.recordId : undefined, importantKey: typeof value.importantKey === 'string' ? value.importantKey : undefined } satisfies FamilyNotification;
    });
    if (initializedInbox.current) {
      for (const change of snapshot.docChanges()) if (change.type === 'added') { const value = values.find(item => item.id === change.doc.id); if (value && !value.read) notice(value.eventId, value.category, value.important); }
    } else { for (const item of values) seen.current.add(item.eventId); persistSeen(user.uid, seen.current); initializedInbox.current = true; }
    setRemoteItems(values);
    setLocalItems(previous => previous.filter(item => !values.some(remote => remote.eventId === item.eventId)));
  }, () => setError('Nie udało się wczytać centrum powiadomień.')), [user.uid, notice]);

  const savePreferences = useCallback(async (next: NotificationPreferences) => {
    if (busyRef.current) return;
    const previous = prefsRef.current;
    const normalized = normalizePreferences(next);
    const operation = ++preferenceOperation.current;
    busyRef.current = true;
    setPrefs(normalized); prefsRef.current = normalized;
    setBusy(true); setError('');
    try {
      await setDoc(doc(db, 'userPreferences', user.uid), { notifications: normalized }, { merge: true });
    } catch {
      if (operation === preferenceOperation.current) { setPrefs(previous); prefsRef.current = previous; }
      setError('Nie udało się zapisać ustawień. Spróbuj ponownie.');
    }
    finally { busyRef.current = false; setBusy(false); }
  }, [user]);

  const announceLocal = useCallback((value: LocalNotification) => {
    if (!notice(value.id, value.category, value.important)) return;
    const item: FamilyNotification = { ...value, id: value.id, eventId: value.id, important: !!value.important, read: false, starred: false, createdAt: new Date(), local: true };
    setLocalItems(previous => [item, ...previous].slice(0, 100));
  }, [notice, user.uid]);

  const markRead = useCallback(async (item: FamilyNotification) => {
    if (item.read) return;
    if (item.local) setLocalItems(previous => previous.map(value => value.id === item.id ? { ...value, read: true } : value));
    else await updateDoc(doc(db, 'notificationInbox', user.uid, 'items', item.id), { read: true, readAt: serverTimestamp() });
  }, [user.uid]);
  const toggleImportant = useCallback(async (id: string) => {
    if (!id || id.length > 500) return;
    await setDoc(doc(db, 'userPreferences', user.uid), { importantItems: importantItems.includes(id) ? arrayRemove(id) : arrayUnion(id) }, { merge: true });
  }, [user.uid, importantItems]);
  const toggleStar = useCallback(async (item: FamilyNotification) => {
    if (item.importantKey) await toggleImportant(item.importantKey);
    else if (item.local) setLocalItems(previous => previous.map(value => value.id === item.id ? { ...value, starred: !value.starred } : value));
    else await updateDoc(doc(db, 'notificationInbox', user.uid, 'items', item.id), { starred: !item.starred });
  }, [user.uid, toggleImportant]);
  const openItem = useCallback((item: FamilyNotification) => { void markRead(item).catch(() => setError('Nie udało się oznaczyć jako przeczytane.')); goTo(item.module); }, [markRead, goTo]);
  const items = useMemo(() => sortNotifications([...remoteItems, ...localItems].map(item => item.importantKey ? { ...item, starred: importantItems.includes(item.importantKey) } : item)), [remoteItems, localItems, importantItems]);
  const value = useMemo(() => ({ items, unread: items.filter(item => !item.read).length, prefs, importantItems, busy, error, savePreferences, markRead, toggleStar, toggleImportant, announceLocal, openItem }), [items, prefs, importantItems, busy, error, savePreferences, markRead, toggleStar, toggleImportant, announceLocal, openItem]);
  return <Context.Provider value={value}>{children}<span className="notification-live-region" role="status" aria-live="polite">{items[0] && !items[0].read ? `${items[0].title}. ${items[0].body}` : ''}</span><span hidden data-notification-member={member?.name || ''}/></Context.Provider>;
}
export function useNotifications(): NotificationContextValue {
  const value = useContext(Context);
  if (!value) throw new Error('Powiadomienia wymagają NotificationProvider.');
  return value;
}
export function useImportantItems() {
  const { importantItems, toggleImportant } = useNotifications();
  return { isImportant: (id: string) => importantItems.includes(id), toggleImportant };
}

export function NotificationBell() {
  const { items, unread, toggleStar, openItem, error } = useNotifications();
  const [open, setOpen] = useState(false);
  const [onlyImportant, setOnlyImportant] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open && !dialog.current?.open) dialog.current?.showModal(); }, [open]);
  const visible = onlyImportant ? items.filter(item => item.starred || item.important) : items;
  return <div className="notification-bell-container family-ui"><button type="button" className="notification-bell" aria-label={`Powiadomienia${unread ? `: ${unread} nieprzeczytanych` : ''}`} data-testid="notification-bell" onClick={() => setOpen(true)}><Icon name="bell" size={25}/>{unread > 0 && <span className="notification-badge">{unread > 99 ? '99+' : unread}</span>}</button>{open && <dialog ref={dialog} className="notification-center family-ui" aria-labelledby="notification-center-title" onCancel={() => setOpen(false)} onClose={() => setOpen(false)}><header><span className="notification-heading-icon"><Icon name="bell" size={25}/></span><div><h2 id="notification-center-title">Powiadomienia</h2><p>{unread ? `${unread} nieprzeczytanych` : 'Wszystko na bieżąco'}</p></div><button type="button" aria-label="Zamknij powiadomienia" className="notification-close" onClick={() => { dialog.current?.close(); setOpen(false); }}><Icon name="x"/></button></header><div className="notification-center-tabs"><button type="button" className={!onlyImportant ? 'is-active' : ''} onClick={() => setOnlyImportant(false)}>Wszystkie</button><button type="button" className={onlyImportant ? 'is-active' : ''} onClick={() => setOnlyImportant(true)}>★ Ważne</button></div><div className="notification-center-list">{visible.length === 0 ? <div className="notification-empty"><Icon name="bell" size={40}/><strong>{onlyImportant ? 'Brak ważnych powiadomień' : 'Spokojnie, jesteś na bieżąco'}</strong><p>Nowe informacje pojawią się tutaj.</p></div> : visible.map(item => <article key={item.id} className={`notification-item ${item.read ? '' : 'is-unread'}`}><Icon name="bell" size={23}/><button type="button" className="notification-item-content" onClick={() => { openItem(item); dialog.current?.close(); setOpen(false); }}><strong>{item.title}</strong><span>{item.body}</span><small>{item.module} · {item.createdAt.toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {item.read ? 'Przeczytane' : 'Nieprzeczytane'}</small>{item.important && <StatusPill tone="important">Ważne</StatusPill>}</button><button type="button" className={`notification-star ${item.starred ? 'is-starred' : ''}`} aria-label={item.starred ? 'Usuń z ważnych' : 'Oznacz jako ważne'} aria-pressed={item.starred} onClick={() => void toggleStar(item).catch(() => {})}>{item.starred ? '★' : '☆'}</button></article>)}</div>{error && <p className="notification-feedback" role="status">{error}</p>}</dialog>}</div>;
}

const labels: Record<NotificationCategory, string> = { calendar: 'Kalendarz', tasks: 'Zadania', shopping: 'Zakupy', familyChat: 'Czat rodzinny', privateChat: 'Wiadomości prywatne', health: 'Zdrowie', school: 'Szkoła', important: 'Ważne informacje' };
export function NotificationSettings() {
  const { prefs, busy, error, savePreferences } = useNotifications();
  const toggle = (key: 'enabled' | 'sound') => { void unlockNotificationSound(); void savePreferences({ ...prefs, [key]: !prefs[key] }); };
  return <section className="notification-settings family-ui" aria-labelledby="notification-settings-title"><header><span className="notification-heading-icon"><Icon name="bell" size={26}/></span><div><h2 id="notification-settings-title">Powiadomienia</h2><p>Twoje preferencje na wszystkich urządzeniach</p></div></header><div className="notification-settings-toggles">{([['enabled', 'Powiadomienia'], ['sound', 'Dźwięk powiadomień']] as const).map(([key, label]) => <button type="button" key={key} role="switch" aria-checked={prefs[key]} className="notification-toggle" disabled={busy} onClick={() => toggle(key)}><strong>{label}</strong><span className={prefs[key] ? 'is-on' : ''}>{prefs[key] ? 'ON' : 'OFF'}</span></button>)}</div><div className="notification-categories" role="group" aria-label="Kategorie powiadomień">{NOTIFICATION_CATEGORIES.map(category => <label key={category}><input type="checkbox" checked={prefs.categories[category]} disabled={busy} onChange={() => void savePreferences({ ...prefs, categories: { ...prefs.categories, [category]: !prefs.categories[category] } })}/><span>{labels[category]}</span></label>)}</div><div className="notification-system-status"><span>Powiadomienia w aplikacji</span><StatusPill tone="success">IN-APP</StatusPill></div><p className="notification-note">Powiadomienia systemowe — dostępne w przyszłej aktualizacji.</p><div className="notification-settings-actions"><SecondaryButton icon="bell" disabled={!prefs.enabled || !prefs.sound} onClick={() => void unlockNotificationSound().then(() => playNotificationBell(prefs.enabled && prefs.sound))}>Posłuchaj dzwonka</SecondaryButton></div><p className="notification-note">Dzwonek i centrum powiadomień działają w otwartej aplikacji. Delikatny dźwięk usłyszysz tylko, gdy aplikacja jest widoczna i dźwięk jest włączony. Przy zamkniętej aplikacji nie wysyłamy powiadomień systemowych.</p>{error && <p role="status" className="notification-feedback">{error}</p>}</section>;
}
