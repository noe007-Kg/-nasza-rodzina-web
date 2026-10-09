import { useEffect, useId, useState, type FormEvent } from 'react';
import { deleteObject, ref, uploadBytesResumable } from 'firebase/storage';
import type { User } from 'firebase/auth';
import { storage } from '../firebase';
import { memberEmoji, type Member } from '../app-shared';
import type { FamilyAggregateProfile, FamilyMemberProfile } from '../family-members';
import { Card, Icon, PrimaryButton, SecondaryButton } from '../ui';
import { accountActionMessage, accountRequest } from './account-client';
import { avatarFileExtension, profileAvatarPath, validProfileAvatarPath } from './profile-avatar';
import './account.css';

export function ProfileAvatar({ profile, className = 'family-admin-avatar' }: { profile: { name?: string; emoji?: string; photoURL?: string }; className?: string }) {
  return <span className={className} aria-hidden="true"><span>{profile.emoji || memberEmoji(profile.name || '')}</span>{profile.photoURL && <img key={profile.photoURL} src={profile.photoURL} alt="" loading="lazy" onLoad={event => { event.currentTarget.hidden = false; }} onError={event => { event.currentTarget.hidden = true; }} />}</span>;
}

export function ProfileEditor({ user, profile, family = false, onClose }: { user: User; profile: FamilyMemberProfile | FamilyAggregateProfile; family?: boolean; onClose: () => void }) {
  const photoFieldId = useId();
  const [name, setName] = useState('name' in profile ? profile.name || '' : '');
  const [emoji, setEmoji] = useState(profile.emoji || (family ? '👨‍👩‍👧‍👦' : memberEmoji(name)));
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [reset, setReset] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const targetId = family ? null : (profile as FamilyMemberProfile).id;
  const defaultEmoji = family ? '👨‍👩‍👧‍👦' : memberEmoji((profile as FamilyMemberProfile).personKey || ('name' in profile ? profile.name || '' : ''));
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(''); setSuccess(''); setProgress(null);
    let uploadedPath = '';
    let metadataSaved = false;
    try {
      const body: Record<string, unknown> = family ? { action: 'family', emoji: emoji.trim() } : { action: 'update', uid: targetId, name: name.trim(), emoji: emoji.trim() };
      if (file) {
        const extension = avatarFileExtension(file);
        uploadedPath = profileAvatarPath(targetId, user.uid, extension, crypto.randomUUID());
        setProgress(0);
        await new Promise<void>((resolve, reject) => {
          const upload = uploadBytesResumable(ref(storage, uploadedPath), file, { contentType: file.type });
          upload.on('state_changed', snapshot => setProgress(Math.min(99, Math.floor(100 * snapshot.bytesTransferred / snapshot.totalBytes))), reject, () => { setProgress(100); resolve(); });
        });
        body.avatarAction = 'set'; body.avatarPath = uploadedPath;
      } else if (reset) body.avatarAction = 'reset';
      await accountRequest('profile', body, user);
      metadataSaved = true;
      if ((file || reset) && profile.avatarPath && profile.avatarPath !== uploadedPath && validProfileAvatarPath(profile.avatarPath, targetId ?? undefined)) {
        // Metadata is already safe; an optional cleanup failure does not hide a successful save.
        await deleteObject(ref(storage, profile.avatarPath)).catch(() => {});
      }
      setSuccess('Zapisano profil. Konto i historia pozostały bez zmian.');
      setFile(null); setReset(false);
    } catch (reason) {
      if (uploadedPath && !metadataSaved) await deleteObject(ref(storage, uploadedPath)).catch(() => {});
      setError(reason instanceof Error && !('code' in reason) ? reason.message : accountActionMessage(reason));
    } finally { setBusy(false); }
  }
  return <form className="account-change-form profile-edit-form" data-testid={family ? 'family-aggregate-editor' : 'member-profile-editor'} onSubmit={save} aria-busy={busy}>
    <h3>{family ? 'Profil „Cała rodzina”' : `Zdjęcie i profil: ${'name' in profile ? profile.name : ''}`}</h3>
    <div className="profile-edit-preview"><ProfileAvatar profile={{ name, emoji, photoURL: reset ? undefined : preview || profile.photoURL }} className="profile-photo-preview" /><p>{family ? 'Wspólny widok rodziny, bez osobnego konta i loginu.' : 'Zdjęcie możesz zmienić niezależnie od metody logowania.'}</p></div>
    {!family && <label>Imię profilu<input value={name} onChange={event => setName(event.target.value)} required maxLength={80} disabled={busy} /></label>}
    <label>Ikona / emoji<input value={emoji} onChange={event => setEmoji(event.target.value)} maxLength={24} disabled={busy} /></label>
    <div className="account-field"><label htmlFor={photoFieldId}>Zdjęcie profilu<input id={photoFieldId} aria-describedby={`${photoFieldId}-help`} type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={busy} onChange={event => {
      const next = event.target.files?.[0]; setError(''); setSuccess('');
      if (!next) return;
      try { avatarFileExtension(next); setFile(next); setReset(false); }
      catch (reason) { setFile(null); setError(reason instanceof Error ? reason.message : 'Nieprawidłowe zdjęcie.'); event.target.value = ''; }
    }} /></label><small className="account-field-help" id={`${photoFieldId}-help`}>JPG, PNG, WebP lub GIF, maksymalnie 5 MB. Zdjęcie jest dostępne wyłącznie po zalogowaniu.</small></div>
    <div className="account-actions"><SecondaryButton disabled={busy} onClick={() => { setReset(true); setFile(null); setSuccess(''); }}>Usuń zdjęcie</SecondaryButton><SecondaryButton disabled={busy} onClick={() => { setEmoji(defaultEmoji); setReset(true); setFile(null); setSuccess(''); }}>Domyślna ikona</SecondaryButton></div>
    {progress !== null && <div className="profile-upload-progress" role="status"><span>{progress === 100 ? 'Transfer zdjęcia zakończony' : 'Przesyłanie zdjęcia'} {progress}%</span><progress value={progress} max={100} /></div>}
    <div className="account-actions"><PrimaryButton type="submit" disabled={busy}>{busy ? 'Zapisywanie…' : 'Zapisz profil'}</PrimaryButton><SecondaryButton disabled={busy} onClick={onClose}>Zamknij</SecondaryButton></div>
    {success && <p className="account-success" role="status"><Icon name="check" />{success}</p>}
    {error && <p className="account-error" role="alert">{error}</p>}
  </form>;
}

export function OwnProfileSettings({ user, member }: { user: User; member: Member | null }) {
  const [editing, setEditing] = useState(false);
  if (!member) return null;
  const profile = { ...member, id: user.uid };
  return <Card as="section" tone="violet" className="settings-section own-profile-settings family-ui" id="own-profile-settings" aria-labelledby="own-profile-title">
    <header className="account-section-heading"><ProfileAvatar profile={profile} /><div><h2 id="own-profile-title">Twój profil</h2><p>Imię, ikona i zdjęcie bez zmiany konta.</p></div></header>
    <SecondaryButton onClick={() => setEditing(!editing)}>{editing ? 'Zamknij edycję profilu' : 'Edytuj swój profil'}</SecondaryButton>
    {editing && <ProfileEditor user={user} profile={profile} onClose={() => setEditing(false)} />}
  </Card>;
}
