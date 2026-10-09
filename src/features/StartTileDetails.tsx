import { formatTime, memberEmoji } from '../app-shared';
import type { FamilyMemberProfile } from '../family-members';
import { Icon } from '../ui';
import type { FamilyNotification } from '../notifications/model';
import { countdownText, type FamilyTimeProjection, type latestConversations, type shoppingPreview } from './start-tile-projections';
import { SHOPPING_META } from './ShoppingPage';

function PreviewAvatar({ profile, fallback = '👤' }: { profile?: FamilyMemberProfile; fallback?: string }) {
  return <span className="start-detail-avatar" aria-hidden="true"><span>{profile?.emoji || (profile ? memberEmoji(profile.personKey || profile.name || '') : fallback)}</span>
    {profile?.photoURL && <img src={profile.photoURL} alt="" loading="lazy" draggable={false} onError={event => { event.currentTarget.hidden = true; }}/>}</span>;
}

export function FamilyTimeDetails({ summary, now }: { summary: FamilyTimeProjection; now: Date }) {
  return <>
    <span className="start-family-time-summary"><span><span className="start-card-status">Wolni według widocznego planu od</span><span className="start-card-value">{summary.endAt ? (summary.endAt <= now ? 'Teraz' : formatTime(summary.endAt)) : '—'}</span></span>
      {summary.endAt && <span className="start-family-countdown"><Icon name="clock" size={15}/>{countdownText(summary.endAt, now)}</span>}</span>
    <span className="start-card-preview start-family-time-details">
      <span className="start-family-plan-note">{summary.incomplete ? 'Niepełny plan — tylko dostępne godziny.' : 'Praca, szkoła i zajęcia.'}</span>
      <span className="start-family-mini-profiles" data-testid="start-family-time-profiles">{summary.members.map(({ profile, endAt, hasPlan, incomplete }) => <span key={profile.id} className="start-family-mini-profile" data-profile-id={profile.id}>
        <PreviewAvatar profile={profile}/><strong>{profile.name || 'Członek rodziny'}</strong>
        <time>{endAt ? formatTime(endAt) : '—'}</time><small>{!hasPlan ? 'brak planu' : incomplete ? 'niepełny plan' : endAt && endAt <= now ? 'zakończone' : endAt ? `do ${formatTime(endAt)}` : 'brak godzin'}</small>
      </span>)}</span>
      {summary.members.length === 0 && <span>Oczekiwanie na profile rodziny.</span>}
    </span>
  </>;
}

export function ShoppingDetails({ rows, openCount, total, bought }: { rows: ReturnType<typeof shoppingPreview>; openCount: number; total: number; bought: number }) {
  const productLabel = openCount === 1 ? 'produkt' : openCount % 10 >= 2 && openCount % 10 <= 4 && (openCount % 100 < 12 || openCount % 100 > 14) ? 'produkty' : 'produktów';
  return <>
    <span className="start-shopping-summary"><span className="start-card-status">Pozostało: </span><span className="start-card-value">{openCount}</span><span className="start-card-status"> {productLabel}</span></span>
    <span className="start-shopping-progress"><span role="progressbar" aria-label="Kupione produkty" aria-valuemin={0} aria-valuemax={total} aria-valuenow={bought} aria-valuetext={`Kupione: ${bought} z ${total}`}><span style={{ width: total ? `${bought / total * 100}%` : '0%' }}/></span><small>Kupione: {bought} z {total}</small></span>
    <span className="start-card-preview start-rich-list">{rows.map(({ item, product }) => <span className="start-shopping-row" key={item.id} data-product-id={item.id}>
      <span className="start-product-picture" aria-hidden="true"><span>{product?.icon || SHOPPING_META[item.category as keyof typeof SHOPPING_META]?.icon || '📦'}</span>{product?.imageURL && <img src={product.imageURL} alt="" loading="lazy" draggable={false} onError={event => { event.currentTarget.hidden = true; }}/>}</span>
      <span className="start-rich-row-copy"><strong>{item.title}</strong><small>{[item.quantity, item.unit].filter(Boolean).join(' ') || 'Do kupienia'}</small></span><span className="start-detail-pill">Do kupienia</span>
    </span>)}{!rows.length && <span className="start-rich-empty">{total ? 'Wszystkie produkty są kupione.' : 'Lista zakupów jest pusta.'}</span>}</span>
    <span className="start-detail-footer">Otwórz listę zakupów <Icon name="arrow-right" size={16}/></span>
  </>;
}

export function ChatDetails({ conversations, notifications, messages, currentUid }: {
  conversations: ReturnType<typeof latestConversations>; notifications: readonly FamilyNotification[]; messages: readonly { id: string; channel: string }[]; currentUid: string;
}) {
  const unread = notifications.filter(item => !item.read && (item.category === 'familyChat' || item.category === 'privateChat'));
  const channels = new Map(messages.map(message => [message.id, message.channel]));
  return <>
    <span className="start-chat-summary"><span className="start-card-value">{conversations.length}</span><span className="start-card-status">ostatnie rozmowy</span>
      {unread.length > 0 && <span className="start-chat-unread" aria-label={`${unread.length} nieprzeczytanych powiadomień z czatu`}><Icon name="bell" size={13}/>{unread.length}<small>nowych powiadomień</small></span>}</span>
    <span className="start-card-preview start-rich-list">{conversations.map(({ message, label, profile }) => {
      const count = unread.filter(item => item.recordId && channels.get(item.recordId) === message.channel).length;
      return <span className="start-chat-row" key={message.channel} data-chat-channel={message.channel}>
        <PreviewAvatar profile={profile} fallback={message.channel === 'family' ? '👨‍👩‍👧‍👦' : '👤'}/>
        <span className="start-rich-row-copy"><strong>{label}</strong><small>{message.uid === currentUid ? 'Ty: ' : message.channel === 'family' ? `${message.name}: ` : ''}{message.text}</small></span>
        <span className="start-chat-row-meta"><time>{message.createdAt ? formatTime(message.createdAt) : '—'}</time>{count > 0 && <span className="start-detail-message-badge" aria-label={`${count} nieprzeczytanych powiadomień w rozmowie`}>{count}</span>}</span>
      </span>;
    })}{!conversations.length && <span className="start-rich-empty">Napisz pierwszą wiadomość.</span>}</span>
    <span className="start-detail-footer">Zobacz wszystkie <Icon name="arrow-right" size={16}/></span>
  </>;
}
