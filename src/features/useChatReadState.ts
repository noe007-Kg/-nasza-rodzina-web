import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import type { ChatMessage } from '../app-shared';
import { chatUnreadCounts } from './chat-state';
import { familyV2WritesAllowed } from '../family-v2-client';

/** Read receipts belong only to the signed-in UID, independently from alert preferences. */
export function useChatReadState(uid: string, messages: readonly ChatMessage[], channel: string, participants: readonly string[]) {
  const [readAt, setReadAt] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const lastWrite = useRef('');
  const inflight = useRef(new Set<string>());
  useEffect(() => {
    setReadAt({}); lastWrite.current = '';
    return onSnapshot(collection(db, 'chatReadStates', uid, 'channels'), snapshot => {
      setReadAt(Object.fromEntries(snapshot.docs.flatMap(row => {
        const value = row.data();
        return value.channel === row.id && value.lastReadAt instanceof Timestamp ? [[row.id, value.lastReadAt.toMillis()]] : [];
      })));
      setError('');
    }, () => setError('Zapamiętywanie przeczytanych wiadomości wymaga aktualnych reguł Firebase.'));
  }, [uid]);
  const latest = messages.filter(message => message.channel === channel).at(-1);
  const participantKey = participants.join(':');
  useEffect(() => {
    if (!channel || !latest?.createdAt) return;
    const writeKey = `${uid}:${channel}:${latest.id}`;
    const save = () => {
      if (!familyV2WritesAllowed() || document.visibilityState !== 'visible' || lastWrite.current === writeKey || inflight.current.has(writeKey)) return;
      if ((readAt[channel] ?? 0) >= latest.createdAt!.getTime()) { lastWrite.current = writeKey; return; }
      inflight.current.add(writeKey);
      // Cursor is the latest message actually received, not the time a write
      // reaches Firestore. A new message arriving meanwhile must stay unread.
      void setDoc(doc(db, 'chatReadStates', uid, 'channels', channel), { channel, participants: [...participants], lastReadAt: Timestamp.fromDate(latest.createdAt!), updatedAt: serverTimestamp(), lastMessageId: latest.id }).then(() => {
        lastWrite.current = writeKey;
      }).catch(() => setError('Nie udało się zapisać stanu odczytu. Spróbuj ponownie.')).finally(() => inflight.current.delete(writeKey));
    };
    save();
    document.addEventListener('visibilitychange', save);
    window.addEventListener('focus', save);
    return () => { document.removeEventListener('visibilitychange', save); window.removeEventListener('focus', save); };
  }, [uid, channel, latest?.id, latest?.createdAt?.getTime(), participantKey, readAt]);
  const unread = useMemo(() => chatUnreadCounts(messages, uid, readAt), [messages, uid, readAt]);
  return { unread, error };
}
