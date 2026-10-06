import type { User } from 'firebase/auth';
import { memberEmoji, personRole } from './app-shared';
import { useFamilyDirectory, orderedFamilyProfiles } from './family-directory';
import type { FamilyMemberProfile } from './family-members';
import { NotificationBell } from './notifications';
import './family-shell.css';

export function FamilyTopBar({ user, onSelect }: { user: User; onSelect: (profile: FamilyMemberProfile) => void }) {
  const profiles = orderedFamilyProfiles(useFamilyDirectory(), user.uid);
  return <header className="top-header family-top-header" data-testid="family-profile-bar">
    <nav className="family-top-profiles" aria-label="Profile rodziny">
      {profiles.map(profile => <button key={profile.id} type="button" data-uid={profile.id} data-testid="family-profile"
        className={`family-top-profile ${profile.id === user.uid ? 'is-current' : ''}`}
        aria-current={profile.id === user.uid ? 'true' : undefined}
        aria-label={`Profil: ${profile.name || 'Członek rodziny'}`} onClick={() => onSelect(profile)}>
        <span className="family-top-avatar" aria-hidden="true"><span>{profile.emoji || memberEmoji(profile.personKey || profile.name || '')}</span>
          {profile.photoURL && <img src={profile.photoURL} alt="" loading="lazy" onError={event => { event.currentTarget.hidden = true; }} />}
        </span>
        <span className="family-top-copy"><strong>{profile.name}</strong><small>{profile.id === user.uid ? 'Twoje konto' : personRole(profile.personKey || profile.name || '', profile.role)}</small></span>
      </button>)}
    </nav>
    <NotificationBell />
  </header>;
}
