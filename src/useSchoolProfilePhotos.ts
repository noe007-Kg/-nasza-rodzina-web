import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { memberPersonKey, type FamilyMemberProfile } from './family-members';

type PhotoMember = { name?: string; personKey?: string; role?: string; photoURL?: string } | null;

/** Presentation-only read of existing member photos. No profile is created or changed. */
export function useSchoolProfilePhotos(uid: string, member: PhotoMember, familyMembers?: readonly FamilyMemberProfile[]): Map<string, string> {
  const parent = member?.role === 'parent';
  const ownPerson = member?.personKey || member?.name || '';
  const ownPhoto = member?.photoURL;
  const [photos, setPhotos] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    setPhotos(new Map());
    if (familyMembers) {
      const visible = parent ? familyMembers : familyMembers.filter((profile) => profile.id === uid);
      const existing = new Map<string, string>();
      for (const profile of visible) {
        const person = memberPersonKey(profile);
        if (person && profile.photoURL) existing.set(person, profile.photoURL);
      }
      if (!parent && ownPhoto) existing.set(ownPerson, ownPhoto);
      setPhotos(existing);
      return;
    }
    if (!parent) {
      if (ownPhoto && ownPerson) setPhotos(new Map([[ownPerson, ownPhoto]]));
      return;
    }
    return onSnapshot(collection(db, 'members'), (snapshot) => {
      const existing = new Map<string, string>();
      for (const document of snapshot.docs) {
        const profile = document.data();
        const person = profile.personKey || profile.name;
        if (typeof person === 'string' && person && typeof profile.photoURL === 'string' && profile.photoURL) {
          existing.set(person, profile.photoURL);
        }
      }
      setPhotos(existing);
    }, () => setPhotos(new Map())); // The existing avatar remains available on a read error.
  }, [uid, parent, ownPerson, ownPhoto, familyMembers]);
  return photos;
}
