import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import type { ChatMessage } from '../app-shared';
import { chatUnreadCounts } from './chat-state';
import { familyV2WritesAllowed } from '../family-v2-client';

/** Immutable per-message receipts merge naturally across devices, including gaps in history. */
export function useChatReadState(uid: string, messages: readonly ChatMessage[], channel: string, _participants: readonly string[], displayed: readonly string[] = []) {
  const [state, setState] = useState<{uid: string; readAt: Record<string, number>; seen: Set<string>}>({uid, readAt: {}, seen: new Set()});
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const wake = () => { if (document.visibilityState === 'visible') setRetry(value => value + 1); };
    window.addEventListener('focus', wake); window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    return () => { window.removeEventListener('focus', wake); window.removeEventListener('online', wake); document.removeEventListener('visibilitychange', wake); };
  }, []);
  const [error, setError] = useState('');
  // Retry rejected receipts even when the tablet stays focused after reconnecting.
  useEffect(() => {
    if (!error) return;
    const timer = window.setInterval(() => { if (navigator.onLine && document.visibilityState === 'visible') setRetry(value => value + 1); }, 15000);
    return () => window.clearInterval(timer);
  }, [error]);
  const inflight = useRef(new Set<string>());
  useEffect(() => {
    setState({uid, readAt: {}, seen: new Set()}); setError('');
    const legacy = onSnapshot(collection(db, 'chatReadStates', uid, 'channels'), snapshot => {
      const readAt = Object.fromEntries(snapshot.docs.flatMap(row => {
        const value = row.data();
        return value.channel === row.id && value.lastReadAt instanceof Timestamp ? [[row.id, value.lastReadAt.toMillis()]] : [];
      }));
      setState(previous => previous.uid === uid ? {...previous, readAt} : previous);
    }, () => setError('Nie udało się odczytać stanu rozmów. Sprawdź reguły Firebase.'));
    const receipts = onSnapshot(collection(db, 'chatReadStates', uid, 'messages'), {includeMetadataChanges: true}, snapshot => {
      setState(previous => previous.uid === uid ? {...previous, seen: new Set(snapshot.docs.filter(row => !row.metadata.hasPendingWrites).map(row => row.id))} : previous);
    }, () => setError('Zapamiętywanie przeczytanych wiadomości wymaga aktualnych reguł Firebase.'));
    return () => { legacy(); receipts(); };
  }, [uid]);
  const seen = state.uid === uid ? state.seen : new Set<string>();
  useEffect(() => {
    if (!channel || document.visibilityState !== 'visible' || !familyV2WritesAllowed()) return;
    for (const id of displayed) {
      const message = messages.find(row => row.id === id && row.channel === channel && row.uid !== uid);
      const key = `${uid}:${id}`;
      if (!message?.createdAt || seen.has(id) || inflight.current.has(key)) continue;
      inflight.current.add(key);
      void setDoc(doc(db, 'chatReadStates', uid, 'messages', id), { read: true, updatedAt: serverTimestamp() })
        .then(() => setError(''))
        .catch(() => setError('Nie udało się zapisać stanu odczytu. Spróbuj ponownie.'))
        .finally(() => inflight.current.delete(key));
    }
  }, [uid, channel, displayed, messages, state, retry]);
  const unread = useMemo(() => chatUnreadCounts(messages.filter(row => state.uid !== uid || !state.seen.has(row.id)), uid, state.uid === uid ? state.readAt : {}), [messages, uid, state]);
  return { unread, error };
}
