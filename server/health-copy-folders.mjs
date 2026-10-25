import { activeHealthMember } from './health-access.mjs';
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function configuredCopyFolder() {
  try {
    const value = JSON.parse(process.env.HEALTH_SHARED_COPY_FOLDER || 'null');
    return value && id(value.ownerProfileId) && id(value.familyId) && Array.isArray(value.memberUids)
      && value.memberUids.length === 3 && new Set(value.memberUids).size === 3
      && value.memberUids.every(id) && value.memberUids.includes(value.ownerProfileId) ? value : null;
  } catch { return null; }
}
/** A shared folder of uploaded copies is not a legal/medical representation grant. */
export async function copyFolderFor(context, transaction, actor, ownerProfileId) {
  const config = configuredCopyFolder();
  if (!config || config.ownerProfileId !== ownerProfileId || config.familyId !== actor.familyId || !config.memberUids.includes(context.uid)) return null;
  const refs = config.memberUids.map(uid => context.db.collection('members').doc(uid));
  const members = transaction ? await transaction.getAll(...refs) : await Promise.all(refs.map(ref => ref.get()));
  if (members.some(member => !member.exists || !activeHealthMember(member.data()) || member.data().familyId !== config.familyId)
    || members.filter(member => member.id !== ownerProfileId && member.data().role === 'parent').length !== 2) return null;
  const owner = members.find(member => member.id === ownerProfileId).data();
  return { ownerProfileId, ownerPersonKey: owner.personKey || owner.name, memberUids: config.memberUids, familyId: config.familyId };
}
