import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { SCHOOL_PEOPLE } from './school-import';

type PhotoMember = { name?: string; personKey?: string; role?: string; photoURL?: string } | null;

/** Presentation-only read of existing member photos. No profile is created or changed. */
export function useSchoolProfilePhotos(uid: string, member: PhotoMember): Map<string, string> {
  const parent = member?.role === 'parent';
  const ownPerson = member?.personKey || member?.name || '';
  const ownPhoto = member?.photoURL;
  const [photos, setPhotos] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    setPhotos(new Map());
    if (!parent) {
      if (ownPhoto && (SCHOOL_PEOPLE as readonly string[]).includes(ownPerson)) setPhotos(new Map([[ownPerson, ownPhoto]]));
      return;
    }
    return onSnapshot(collection(db, 'members'), (snapshot) => {
      const existing = new Map<string, string>();
      for (const document of snapshot.docs) {
        const profile = document.data();
        const person = profile.personKey || profile.name;
        if ((SCHOOL_PEOPLE as readonly string[]).includes(person) && typeof profile.photoURL === 'string' && profile.photoURL) {
          existing.set(person, profile.photoURL);
        }
      }
      setPhotos(existing);
    }, () => setPhotos(new Map())); // The existing avatar remains available on a read error.
  }, [uid, parent, ownPerson, ownPhoto]);
  return photos;
}
