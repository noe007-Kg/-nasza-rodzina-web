import type { CalendarEventData } from './app-shared';
import { useFamilyDirectory } from './family-directory';
import { calendarOwnerColor, calendarOwnerProfile } from './calendar-v2';
import type { CSSProperties } from 'react';

export function CalendarOwnerBadge({ event }: { event: Pick<CalendarEventData, 'person' | 'ownerProfileId'> }) {
  const profile = calendarOwnerProfile(event, useFamilyDirectory());
  const name = event.person === 'family' ? 'Cała rodzina' : profile?.name || event.person;
  return <span className="calendar-owner-badge" style={{ '--calendar-owner-color': calendarOwnerColor(event.person, profile) } as CSSProperties}>
    <span className="calendar-owner-avatar" aria-hidden="true">{profile?.photoURL ? <img src={profile.photoURL} alt="" loading="lazy" onError={event => { event.currentTarget.hidden = true; }} /> : profile?.emoji || (event.person === 'family' ? '♡' : '●')}</span>
    <span>{name}</span>
  </span>;
}
