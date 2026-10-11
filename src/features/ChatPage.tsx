import { addDoc, type ChatMessage, collection, db, deleteDoc, doc, EmptyState, errorMessage, formatTime, isParent, type Member, ModuleHeader, notify, onSnapshot, personRole, query, React, Timestamp, useEffect, type User, useRef, useState, where } from "../app-shared";

import { useImportantItems, useNotifications } from '../notifications';
import { getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Icon } from '../ui';
import { ChatComposer } from './ChatComposer';
import { useFamilyAggregate, useFamilyDirectory } from '../family-directory';
import { ProfileAvatar } from '../account/ProfileSettings';
import { chatEligibleProfiles } from '../account/profile-avatar';

import { availableChatHeight } from './chat-layout';
import { CHAT_REACTIONS, sameChatDay, type ChatReactionEmoji } from './chat-state';
import { ChatMessageReactions } from './ChatMessageReactions';
import { useChatReadState } from './useChatReadState';
import { assertFamilyV2WriteAllowed, familyV2WritesAllowed } from '../family-v2-client';
import './chat-health.css';

export function privateChannel(a: string, b: string) {
  return `private:${[a, b].sort().join(':')}`;
}

export function ChatPage({ user, member }: { user: User; member: Member | null }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const directory = useFamilyDirectory();
  const members = chatEligibleProfiles(directory);
  const aggregate = useFamilyAggregate();
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'family' | 'private'>('family');
  const [selectedUid, setSelectedUid] = useState<string>('');
  const [messageMenu, setMessageMenu] = useState<ChatMessage | null>(null);
  const messageMenuRef = useRef<HTMLDivElement>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const { isImportant, toggleImportant } = useImportantItems();
  const { items: notifications, markRead } = useNotifications();
  const notificationReads = useRef(new Set<string>());
  const reactionWrites = useRef(new Set<string>());

  useEffect(() => {
    if (!messageMenu) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const buttons = () => Array.from(messageMenuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
    buttons()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMessageMenu(null); }
      if (event.key !== 'Tab') return;
      const available = buttons();
      const first = available[0]; const last = available.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); if (previouslyFocused?.isConnected) previouslyFocused.focus(); };
  }, [messageMenu]);

  useEffect(() => {
    const root = pageRef.current;
    if (!root) return;
    const viewport = window.visualViewport;
    let frame = 0;
    let restingHeight = viewport?.height ?? window.innerHeight;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const height = viewport?.height ?? window.innerHeight;
        const composerFocused = root.querySelector('.chat-composer')?.contains(document.activeElement);
        const keyboard = Boolean(composerFocused && (height < window.innerHeight - 100 || height < restingHeight - 100));
        if (!composerFocused) restingHeight = height;
        setKeyboardOpen(keyboard);
        const navigation = document.querySelector<HTMLElement>('.mobile-navigation');
        const viewportOffsetTop = viewport?.offsetTop ?? 0;
        // The mobile navigation floats above the screen edge. Reserve its
        // entire obstruction, including that gap and any safe-area offset.
        const bottomObstruction = !keyboard && navigation && getComputedStyle(navigation).display !== 'none'
          ? Math.max(0, viewportOffsetTop + height - navigation.getBoundingClientRect().top) : 0;
        root.style.setProperty('--chat-available-height', `${availableChatHeight({
          viewportHeight: height,
          viewportOffsetTop,
          pageTop: root.getBoundingClientRect().top,
          bottomObstruction,
        })}px`);
      });
    };
    const observer = new ResizeObserver(measure);
    const header = document.querySelector<HTMLElement>('.family-top-header, .app-topbar, .global-family-profiles, .family-topbar');
    if (header) observer.observe(header);
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    document.addEventListener('focusin', measure);
    document.addEventListener('focusout', measure);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      viewport?.removeEventListener('resize', measure);
      viewport?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
      document.removeEventListener('focusin', measure);
      document.removeEventListener('focusout', measure);
    };
  }, []);

  useEffect(() => {
    const groups: Record<string, ChatMessage[]> = { family: [], private: [] };
    function load(group: string, snap: import('firebase/firestore').QuerySnapshot) {
      groups[group] = snap.docs.map((d): ChatMessage => {
        const x = d.data();
        return { id:d.id, text:String(x.text || ''), name:String(x.name || 'Rodzina'), uid:String(x.uid || ''), channel:String(x.channel || 'family'), createdAt:x.createdAt instanceof Timestamp ? x.createdAt.toDate() : undefined };
      });
      // Both existing queries already deliver the history. Keep it for accurate
      // unread counts, while rendering only the latest messages of this channel.
      setMessages([...groups.family, ...groups.private].sort((a,b)=>(a.createdAt?.getTime() || 0)-(b.createdAt?.getTime() || 0)));
    }
    const stopFamily = onSnapshot(query(collection(db, 'familyMessages'), where('channel', '==', 'family')), snap=>load('family', snap));
    const stopPrivate = onSnapshot(query(collection(db, 'familyMessages'), where('participants', 'array-contains', user.uid)), snap=>load('private', snap));
    return () => { stopFamily(); stopPrivate(); };
  }, [user.uid]);

  const channel = mode === 'family' ? 'family' : selectedUid ? privateChannel(user.uid, selectedUid) : '';
  const { unread, error: readStateError } = useChatReadState(user.uid, messages, channel, mode === 'private' && selectedUid ? [user.uid, selectedUid].sort() : []);
  const familyUnread = unread.family || 0;
  const privateUnread = Object.entries(unread).filter(([key]) => key !== 'family').reduce((total, [, count]) => total + count, 0);
  const visible = messages.filter((m) => m.channel === channel).slice(-300).sort((a, b) => {
    if (mode === 'private') return (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0);
    const firstImportant = isImportant(`chat:message:${a.id}`);
    const secondImportant = isImportant(`chat:message:${b.id}`);
    if (firstImportant !== secondImportant) return firstImportant ? -1 : 1;
    const difference = (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0);
    return firstImportant ? -difference : difference;
  });
  useEffect(() => {
    const scroller = messagesRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [visible.length, channel]);
  useEffect(() => { setReplyTo(null); }, [channel]);

  useEffect(() => {
    if (!channel || document.visibilityState !== 'visible' || !familyV2WritesAllowed()) return;
    const ids = new Set(messages.filter(message => message.channel === channel).map(message => message.id));
    for (const item of notifications) {
      if (item.read || !item.recordId || !ids.has(item.recordId) || !['familyChat', 'privateChat'].includes(item.category) || notificationReads.current.has(item.id)) continue;
      notificationReads.current.add(item.id);
      void markRead(item).catch(() => notificationReads.current.delete(item.id));
    }
  }, [channel, messages, notifications, markRead]);

  const selectedMember = members.find((m) => m.id === selectedUid);

  async function send(e: React.FormEvent) {
    e.preventDefault(); if (!text.trim() || !channel || sendingRef.current || !navigator.onLine) return;
    sendingRef.current = true; setSending(true);
    try {
      const body = replyTo ? `↩ ${replyTo.name}: ${replyTo.text.slice(0, 60)}\n${text.trim()}` : text.trim();
      await addDoc(collection(db, 'familyMessages'), { text:body, name:member?.name || 'Rodzina', uid:user.uid, channel, participants:mode === 'private' ? [user.uid, selectedUid].sort() : [], createdAt:serverTimestamp() });
      setText(''); setReplyTo(null);
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { sendingRef.current = false; setSending(false); }
  }

  async function removeMessage(message: ChatMessage) {
    if (message.uid !== user.uid && !(isParent(member) && message.channel === 'family')) return;
    await deleteDoc(doc(db, 'familyMessages', message.id));
    setMessageMenu(null);
  }

  async function reactToMessage(message: ChatMessage, emoji: ChatReactionEmoji) {
    if (reactionWrites.current.has(message.id)) return;
    reactionWrites.current.add(message.id);
    try {
      assertFamilyV2WriteAllowed();
      const target = doc(db, 'familyMessages', message.id, 'reactions', user.uid);
      const current = await getDoc(target);
      if (current.exists() && current.data().emoji === emoji) await deleteDoc(target);
      else await setDoc(target, { uid: user.uid, emoji, updatedAt: serverTimestamp() });
      setMessageMenu(null);
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { reactionWrites.current.delete(message.id); }
  }

  const lastForChannel = (uid: string) => {
    const ch = privateChannel(user.uid, uid);
    return [...messages].reverse().find((m) => m.channel === ch);
  };

  return (
    <div ref={pageRef} className="page-content compact-page chat-page chat-v130" data-keyboard-open={keyboardOpen}>
      <ModuleHeader icon="💬" title="Czat" text="Czat rodzinny i prywatne rozmowy 1:1." />
      <section className="chat-layout-v130">
        <aside className="chat-conversations">
          <div className="chat-mode-tabs"><button aria-label="Rodzina" aria-pressed={mode === 'family'} className={mode === 'family' ? 'active' : ''} onClick={() => { setMode('family'); setSelectedUid(''); }}>Rodzina{familyUnread > 0 && <span className="chat-unread-badge" aria-hidden="true">{familyUnread > 99 ? '99+' : familyUnread}</span>}</button><button aria-label="Prywatne" aria-pressed={mode === 'private'} className={mode === 'private' ? 'active' : ''} onClick={() => setMode('private')}>Prywatne{privateUnread > 0 && <span className="chat-unread-badge" aria-hidden="true">{privateUnread > 99 ? '99+' : privateUnread}</span>}</button></div>
          {mode === 'family' ? <button className="conversation-row active"><ProfileAvatar profile={{ ...aggregate, emoji: aggregate.emoji || '👨‍👩‍👧‍👦' }} className="conversation-group-avatar" /><div><strong>Czat rodzinny</strong><small>{[...messages].reverse().find((m) => m.channel === 'family')?.text || 'Wspólna rozmowa całej rodziny'}</small></div>{familyUnread > 0 && <span className="chat-unread-badge" aria-label={`${familyUnread} nieprzeczytanych`}>{familyUnread > 99 ? '99+' : familyUnread}</span>}</button> : <div className="private-list">{members.filter((m) => m.id !== user.uid).map((person) => { const last=lastForChannel(person.id); const count=unread[privateChannel(user.uid, person.id)] || 0; return <button key={person.id} className={`conversation-row ${selectedUid === person.id ? 'active' : ''}`} onClick={() => setSelectedUid(person.id)}><ProfileAvatar profile={person} className="chat-avatar" /><div><strong>{person.name}</strong><small>{last ? last.text : 'Rozpocznij rozmowę'}</small></div><span className="conversation-trailing"><time>{last?.createdAt ? formatTime(last.createdAt) : ''}</time>{count > 0 && <span className="chat-unread-badge" aria-label={`${count} nieprzeczytanych`}>{count > 99 ? '99+' : count}</span>}</span></button>; })}</div>}
          {readStateError && <small className="chat-read-status" role="status">{readStateError}</small>}
        </aside>

        <section className="chat-shell">
          <header className="chat-room-header"><ProfileAvatar profile={mode === 'family' ? { ...aggregate, emoji: aggregate.emoji || '👨‍👩‍👧‍👦' } : selectedMember || { emoji: '💬' }} className="chat-avatar large" /><div><strong>{mode === 'family' ? 'Czat rodzinny' : selectedMember?.name || 'Wybierz osobę'}</strong><small>{mode === 'family' ? members.map((m) => m.name).join(', ') : selectedMember ? personRole(selectedMember.name || '', selectedMember.role) : 'Prywatna rozmowa 1:1'}</small></div></header>
          <div ref={messagesRef} className="chat-messages" role="log" aria-label="Wiadomości" aria-live="polite" aria-relevant="additions">
            {!channel ? <EmptyState icon="👤" text="Wybierz osobę z listy prywatnych rozmów." /> : visible.length === 0 ? <EmptyState icon="💬" text="Napisz pierwszą wiadomość." /> : visible.map((message, index) => {
              const previous = visible[index - 1];
              const showIdentity = !previous || previous.uid !== message.uid;
              const person = directory.find((m) => m.id === message.uid);
              const showDate = !sameChatDay(previous?.createdAt, message.createdAt);
              return <React.Fragment key={message.id}>
                {showDate && message.createdAt && <div className="chat-date-divider"><time dateTime={message.createdAt.toISOString()}>{sameChatDay(message.createdAt, new Date()) ? 'Dzisiaj' : message.createdAt.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })}</time></div>}
                <div className={`chat-message-line ${message.uid === user.uid ? 'mine' : ''}`} onContextMenu={(e) => { e.preventDefault(); setMessageMenu(message); }}>
                {message.uid !== user.uid && <ProfileAvatar profile={showIdentity ? person || { name: message.name } : { emoji: ' ' }} className={`chat-avatar ${showIdentity ? '' : 'ghost'}`} />}
                <div className={`chat-bubble ${message.uid === user.uid ? 'mine' : ''} ${isImportant(`chat:message:${message.id}`) ? 'chat-important' : ''}`}>
                  {isImportant(`chat:message:${message.id}`) && <span className="chat-important-label">★ Ważne</span>}
                  {showIdentity && message.uid !== user.uid && <strong>{message.name}</strong>}
                  <p>{message.text}</p>
                  <ChatMessageReactions messageId={message.id} uid={user.uid} onReact={emoji => void reactToMessage(message, emoji)}/>
                  <div className="chat-message-footer"><small><time dateTime={message.createdAt?.toISOString()} title={message.createdAt?.toLocaleString('pl-PL')}>{message.createdAt ? formatTime(message.createdAt) : ''}</time></small>
                  <button className="chat-message-star" type="button" aria-label={isImportant(`chat:message:${message.id}`) ? 'Usuń wiadomość z ważnych' : 'Oznacz wiadomość jako ważną'} aria-pressed={isImportant(`chat:message:${message.id}`)} onClick={() => {
                    const starred = isImportant(`chat:message:${message.id}`);
                    void toggleImportant(`chat:message:${message.id}`).then(() => {
                      if (!starred && mode === 'family') requestAnimationFrame(() => { if (messagesRef.current) messagesRef.current.scrollTop = 0; });
                    }).catch((error) => notify(errorMessage(error), 'error'));
                  }}><Icon name="grade" size={18} fill={isImportant(`chat:message:${message.id}`) ? 'currentColor' : 'none'} /></button>
                  <button className="message-more" type="button" aria-label="Opcje wiadomości" onClick={() => setMessageMenu(message)}>⋯</button></div>
                </div>
              </div></React.Fragment>;
            })}
          </div>
          {replyTo && <div className="reply-banner"><span>Odpowiadasz: <strong>{replyTo.name}</strong> — {replyTo.text.slice(0,80)}</span><button onClick={() => setReplyTo(null)}>✕</button></div>}
          <ChatComposer text={text} onTextChange={setText} onSubmit={send} enabled={Boolean(channel)} sending={sending} />
        </section>
      </section>

      {messageMenu && <div className="quick-product-menu-backdrop" onClick={() => setMessageMenu(null)}><div ref={messageMenuRef} className="message-menu" role="dialog" aria-modal="true" aria-label="Opcje wiadomości" onClick={(e) => e.stopPropagation()}><div className="reaction-row">{CHAT_REACTIONS.map(emoji => <button type="button" key={emoji} aria-label={`Zareaguj ${emoji}`} onClick={() => void reactToMessage(messageMenu, emoji)}>{emoji}</button>)}</div><button onClick={() => { setReplyTo(messageMenu); setMessageMenu(null); }}>↩ Odpowiedz</button><button onClick={() => { void navigator.clipboard?.writeText(messageMenu.text); setMessageMenu(null); }}>📋 Kopiuj</button>{(messageMenu.uid === user.uid || (isParent(member) && messageMenu.channel === 'family')) && <button className="danger" onClick={() => void removeMessage(messageMenu).catch(error => notify(errorMessage(error), 'error'))}>🗑️ Usuń</button>}<button type="button" onClick={() => setMessageMenu(null)}>Zamknij</button></div></div>}
    </div>
  );
}
