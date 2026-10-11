import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { groupedChatReactions, isChatReaction, type ChatReaction, type ChatReactionEmoji } from './chat-state';

/** Subscribe only to a visible, already-authorized message, never all private reactions. */
export function ChatMessageReactions({ messageId, uid, onReact }: { messageId: string; uid: string; onReact: (emoji: ChatReactionEmoji) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [reactions, setReactions] = useState<ChatReaction[]>([]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { root: element.closest('.chat-messages'), rootMargin: '80px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    return onSnapshot(collection(db, 'familyMessages', messageId, 'reactions'), snapshot => setReactions(snapshot.docs.flatMap(row => {
      const value = row.data();
      return value.uid === row.id && isChatReaction(value.emoji) ? [{ uid: row.id, emoji: value.emoji }] : [];
    })), () => setReactions([]));
  }, [visible, messageId]);
  const groups = groupedChatReactions(reactions);
  return <div ref={root} className="chat-message-reactions" aria-label="Reakcje na wiadomość">{groups.map(group => <button key={group.emoji} type="button" aria-pressed={group.uids.includes(uid)} aria-label={`${group.emoji}: ${group.uids.length} ${group.uids.includes(uid) ? '(Twoja reakcja)' : ''}`} onClick={() => onReact(group.emoji)}>{group.emoji} <span>{group.uids.length}</span></button>)}</div>;
}
