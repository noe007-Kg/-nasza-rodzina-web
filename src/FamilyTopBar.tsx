import type { User } from 'firebase/auth';
import { memberEmoji, personRole } from './app-shared';
import { useFamilyAggregate, useFamilyDirectory, orderedFamilyProfiles } from './family-directory';
import type { FamilyMemberProfile } from './family-members';
import { ProfileAvatar } from './account/ProfileSettings';
import { NotificationBell } from './notifications';
import './family-shell.css';

export function FamilyTopBar({ user, onSelect, onFamilySelect, parent = false }: { user: User; onSelect: (profile: FamilyMemberProfile) => void; onFamilySelect: () => void; parent?: boolean }) {
  const profiles = orderedFamilyProfiles(useFamilyDirectory(), user.uid);
  const aggregate = useFamilyAggregate();
  function profileButton(profile: FamilyMemberProfile) {
    return <button key={profile.id} type="button" data-uid={profile.id} data-testid="family-profile"
      className={`family-top-profile ${profile.id === user.uid ? 'is-current' : ''}`}
      aria-current={profile.id === user.uid ? 'true' : undefined}
      aria-label={`Profil: ${profile.name || 'Członek rodziny'}`} onClick={() => onSelect(profile)}>
      <span className="family-top-avatar" aria-hidden="true"><span>{profile.emoji || memberEmoji(profile.personKey || profile.name || '')}</span>
        {profile.photoURL && <img key={profile.photoURL} src={profile.photoURL} alt="" loading="lazy" onLoad={event => { event.currentTarget.hidden = false; }} onError={event => { event.currentTarget.hidden = true; }} />}
      </span>
      <span className="family-top-copy"><strong>{profile.name}</strong><small>{profile.id === user.uid ? 'Twoje konto' : personRole(profile.personKey || profile.name || '', profile.role)}</small></span>
    </button>;
  }
  return <header className="top-header family-top-header" data-testid="family-profile-bar">
    <nav className="family-top-profiles" aria-label="Profile rodziny">
      {profiles[0] && profileButton(profiles[0])}
      {parent && <button type="button" className="family-top-profile family-aggregate-profile" data-testid="family-aggregate-profile" aria-label="Cała rodzina — wspólny kalendarz" onClick={onFamilySelect}><ProfileAvatar profile={{ ...aggregate, emoji: aggregate.emoji || '👨‍👩‍👧‍👦' }} className="family-top-avatar" /><span className="family-top-copy"><strong>Cała rodzina</strong><small>Wspólny kalendarz</small></span></button>}
      {profiles.slice(1).map(profileButton)}
    </nav>
    <NotificationBell />
  </header>;
}
