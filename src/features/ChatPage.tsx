import { addDoc, type ChatMessage, collection, db, deleteDoc, doc, EmptyState, errorMessage, formatTime, isParent, type Member, ModuleHeader, notify, onSnapshot, personRole, query, React, Timestamp, useEffect, type User, useRef, useState, where } from "../app-shared";

import { useImportantItems } from '../notifications';
import { Icon } from '../ui';
import { ChatComposer } from './ChatComposer';
import { useFamilyAggregate, useFamilyDirectory } from '../family-directory';
import { ProfileAvatar } from '../account/ProfileSettings';
import { chatEligibleProfiles } from '../account/profile-avatar';

import { availableChatHeight } from './chat-layout';
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
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const { isImportant, toggleImportant } = useImportantItems();

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
      setMessages([...groups.family, ...groups.private].sort((a,b)=>(a.createdAt?.getTime() || 0)-(b.createdAt?.getTime() || 0)).slice(-300));
    }
    const stopFamily = onSnapshot(query(collection(db, 'familyMessages'), where('channel', '==', 'family')), snap=>load('family', snap));
    const stopPrivate = onSnapshot(query(collection(db, 'familyMessages'), where('participants', 'array-contains', user.uid)), snap=>load('private', snap));
    return () => { stopFamily(); stopPrivate(); };
  }, [user.uid]);

  const channel = mode === 'family' ? 'family' : selectedUid ? privateChannel(user.uid, selectedUid) : '';
  const visible = messages.filter((m) => m.channel === channel).sort((a, b) => {
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

  const selectedMember = members.find((m) => m.id === selectedUid);

  async function send(e: React.FormEvent) {
    e.preventDefault(); if (!text.trim() || !channel || sendingRef.current || !navigator.onLine) return;
    sendingRef.current = true; setSending(true);
    try {
      const body = replyTo ? `↩ ${replyTo.name}: ${replyTo.text.slice(0, 60)}\n${text.trim()}` : text.trim();
      await addDoc(collection(db, 'familyMessages'), { text:body, name:member?.name || 'Rodzina', uid:user.uid, channel, participants:mode === 'private' ? [user.uid, selectedUid].sort() : [], createdAt:Timestamp.now() });
      setText(''); setReplyTo(null);
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { sendingRef.current = false; setSending(false); }
  }

  async function removeMessage(message: ChatMessage) {
    if (message.uid !== user.uid && !(isParent(member) && message.channel === 'family')) return;
    await deleteDoc(doc(db, 'familyMessages', message.id));
    setMessageMenu(null);
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
          <div className="chat-mode-tabs"><button className={mode === 'family' ? 'active' : ''} onClick={() => { setMode('family'); setSelectedUid(''); }}>Rodzina</button><button className={mode === 'private' ? 'active' : ''} onClick={() => setMode('private')}>Prywatne</button></div>
          {mode === 'family' ? <button className="conversation-row active"><ProfileAvatar profile={{ ...aggregate, emoji: aggregate.emoji || '👨‍👩‍👧‍👦' }} className="conversation-group-avatar" /><div><strong>Czat rodzinny</strong><small>{[...messages].reverse().find((m) => m.channel === 'family')?.text || 'Wspólna rozmowa całej rodziny'}</small></div></button> : <div className="private-list">{members.filter((m) => m.id !== user.uid).map((person) => { const last=lastForChannel(person.id); return <button key={person.id} className={`conversation-row ${selectedUid === person.id ? 'active' : ''}`} onClick={() => setSelectedUid(person.id)}><ProfileAvatar profile={person} className="chat-avatar" /><div><strong>{person.name}</strong><small>{last ? last.text : 'Rozpocznij rozmowę'}</small></div><time>{last?.createdAt ? formatTime(last.createdAt) : ''}</time></button>; })}</div>}
        </aside>

        <section className="chat-shell">
          <header className="chat-room-header"><ProfileAvatar profile={mode === 'family' ? { ...aggregate, emoji: aggregate.emoji || '👨‍👩‍👧‍👦' } : selectedMember || { emoji: '💬' }} className="chat-avatar large" /><div><strong>{mode === 'family' ? 'Czat rodzinny' : selectedMember?.name || 'Wybierz osobę'}</strong><small>{mode === 'family' ? members.map((m) => m.name).join(', ') : selectedMember ? personRole(selectedMember.name || '', selectedMember.role) : 'Prywatna rozmowa 1:1'}</small></div></header>
          <div ref={messagesRef} className="chat-messages" role="log" aria-label="Wiadomości" aria-live="polite" aria-relevant="additions">
            {!channel ? <EmptyState icon="👤" text="Wybierz osobę z listy prywatnych rozmów." /> : visible.length === 0 ? <EmptyState icon="💬" text="Napisz pierwszą wiadomość." /> : visible.map((message, index) => {
              const previous = visible[index - 1];
              const showIdentity = !previous || previous.uid !== message.uid;
              const person = directory.find((m) => m.id === message.uid);
              return <div key={message.id} className={`chat-message-line ${message.uid === user.uid ? 'mine' : ''}`} onContextMenu={(e) => { e.preventDefault(); setMessageMenu(message); }}>
                {message.uid !== user.uid && <ProfileAvatar profile={showIdentity ? person || { name: message.name } : { emoji: ' ' }} className={`chat-avatar ${showIdentity ? '' : 'ghost'}`} />}
                <div className={`chat-bubble ${message.uid === user.uid ? 'mine' : ''} ${isImportant(`chat:message:${message.id}`) ? 'chat-important' : ''}`}>
                  {isImportant(`chat:message:${message.id}`) && <span className="chat-important-label">★ Ważne</span>}
                  {showIdentity && message.uid !== user.uid && <strong>{message.name}</strong>}
                  <p>{message.text}</p>
                  <div className="chat-message-footer"><small>{message.createdAt ? formatTime(message.createdAt) : ''}</small>
                  <button className="chat-message-star" type="button" aria-label={isImportant(`chat:message:${message.id}`) ? 'Usuń wiadomość z ważnych' : 'Oznacz wiadomość jako ważną'} aria-pressed={isImportant(`chat:message:${message.id}`)} onClick={() => {
                    const starred = isImportant(`chat:message:${message.id}`);
                    void toggleImportant(`chat:message:${message.id}`).then(() => {
                      if (!starred && mode === 'family') requestAnimationFrame(() => { if (messagesRef.current) messagesRef.current.scrollTop = 0; });
                    }).catch((error) => notify(errorMessage(error), 'error'));
                  }}><Icon name="grade" size={18} fill={isImportant(`chat:message:${message.id}`) ? 'currentColor' : 'none'} /></button>
                  <button className="message-more" type="button" aria-label="Opcje wiadomości" onClick={() => setMessageMenu(message)}>⋯</button></div>
                </div>
              </div>;
            })}
          </div>
          {replyTo && <div className="reply-banner"><span>Odpowiadasz: <strong>{replyTo.name}</strong> — {replyTo.text.slice(0,80)}</span><button onClick={() => setReplyTo(null)}>✕</button></div>}
          <ChatComposer text={text} onTextChange={setText} onSubmit={send} enabled={Boolean(channel)} sending={sending} />
        </section>
      </section>

      {messageMenu && <div className="quick-product-menu-backdrop" onClick={() => setMessageMenu(null)}><div className="message-menu" onClick={(e) => e.stopPropagation()}><div className="reaction-row"><button onClick={() => setText((v) => `${v} ❤️`)}>❤️</button><button onClick={() => setText((v) => `${v} 👍`)}>👍</button><button onClick={() => setText((v) => `${v} 😂`)}>😂</button></div><button onClick={() => { setReplyTo(messageMenu); setMessageMenu(null); }}>↩ Odpowiedz</button><button onClick={() => { void navigator.clipboard?.writeText(messageMenu.text); setMessageMenu(null); }}>📋 Kopiuj</button>{(messageMenu.uid === user.uid || (isParent(member) && messageMenu.channel === 'family')) && <button className="danger" onClick={() => void removeMessage(messageMenu)}>🗑️ Usuń</button>}</div></div>}
    </div>
  );
}
