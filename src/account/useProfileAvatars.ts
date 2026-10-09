import { useEffect, useMemo, useState } from 'react';
import { getBlob, getMetadata, ref } from 'firebase/storage';
import { storage } from '../firebase';
import { AVATAR_MAX_BYTES, validProfileAvatarPath } from './profile-avatar';

type AvatarProfile = { id: string; avatarPath?: string; photoURL?: string; familyAggregate?: boolean };
/** Private photos use authenticated Storage reads, never public download tokens. */
export function useProfileAvatars<T extends AvatarProfile>(uid: string, profiles: readonly T[]): T[] {
  const key = JSON.stringify([uid, profiles.map(profile => [profile.id, profile.avatarPath || '', profile.familyAggregate === true])]);
  const [resolved, setResolved] = useState<{ key: string; urls: Map<string, string> }>({ key: '', urls: new Map() });
  useEffect(() => {
    let current = true;
    const urls = new Map<string, string>();
    const paths = JSON.parse(key)[1] as Array<[string, string, boolean]>;
    void Promise.all(paths.map(async ([id, path, familyAggregate]) => {
      if (!path || !validProfileAvatarPath(path, familyAggregate ? undefined : id)) return;
      try {
        const avatarRef = ref(storage, path);
        const metadata = await getMetadata(avatarRef);
        const mime = metadata.contentType || '';
        if (!current || !Number.isSafeInteger(metadata.size) || metadata.size <= 0
          || metadata.size > AVATAR_MAX_BYTES || !/^image\/(?:jpeg|png|webp|gif)$/.test(mime)) return;
        const blob = await getBlob(avatarRef, AVATAR_MAX_BYTES);
        if (!current || blob.size !== metadata.size) return;
        // Firebase 12 slices bounded downloads without preserving Blob.type.
        // Restore only the authorized, validated metadata MIME, never a URL token.
        urls.set(id, URL.createObjectURL(new Blob([blob], { type: mime })));
      } catch { /* Keep the existing emoji if the protected file cannot be read. */ }
    })).then(() => { if (current) setResolved({ key, urls }); });
    return () => { current = false; urls.forEach(url => URL.revokeObjectURL(url)); };
  }, [key]);
  return useMemo(() => profiles.map(profile => ({ ...profile,
    // A changed account/path must never render a URL from the previous scope.
    photoURL: profile.avatarPath ? (resolved.key === key ? resolved.urls.get(profile.id) : undefined) : profile.photoURL,
  })), [profiles, resolved, key]);
}
