import { FieldValue } from 'firebase-admin/firestore';
import { eventDocumentId } from './notification-events.mjs';

const millis = value => typeof value?.toMillis === 'function' ? value.toMillis() : value instanceof Date ? value.getTime() : typeof value === 'number' ? value : 0;
const scope = value => value?.sourceConnectionScope || 'family';
const sameProfile = (value, current) => value.source === 'eduvulcan' && value.sourceProfileId === current.sourceProfileId && scope(value) === scope(current) && (scope(current) !== 'student' || value.sourceOwnerUid === current.sourceOwnerUid);

/** The first full import is history, but deploying notifications onto an already
 * synchronized family must not suppress its first genuinely new grade/message. */
export async function schoolSyncBootstrap(db, before, after) {
  const current = after || before;
  if (current?.source !== 'eduvulcan' || !current.sourceSyncId || !current.sourceProfileId) return false;
  const sourceScope = scope(current);
  const key = `${sourceScope}${sourceScope === 'student' ? ':' + current.sourceOwnerUid : ''}:${current.sourceProfileId}`;
  const baselineRef = db.collection('_notificationBaselines').doc(eventDocumentId({ id: key }));
  const previousBaseline = await baselineRef.get();
  if (previousBaseline.exists) return !!after && previousBaseline.data().initialSyncId === current.sourceSyncId;

  // Any update to an existing synchronized document establishes prior history,
  // including metadata-only writes that do not themselves produce an alert.
  let hasHistory = before?.source === 'eduvulcan';
  if (!hasHistory) {
    const createdAt = millis(current.createdAt);
    const snapshots = await Promise.all(['schoolItems', 'schoolParentMessages', 'schoolStudentMessages'].map(collectionName => db.collection(collectionName).where('sourceProfileId', '==', current.sourceProfileId).limit(1500).get()));
    hasHistory = snapshots.some(snapshot => snapshot.docs.some(row => {
      const value = row.data();
      return sameProfile(value, current) && (millis(value.createdAt) > 0 && createdAt > 0 && millis(value.createdAt) < createdAt || value.sourceSyncId && value.sourceSyncId !== current.sourceSyncId);
    }));
  }
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(baselineRef);
    if (snapshot.exists) return !!after && snapshot.data().initialSyncId === current.sourceSyncId;
    transaction.set(baselineRef, { initialSyncId: hasHistory ? '' : current.sourceSyncId, historyExists: !!hasHistory, createdAt: FieldValue.serverTimestamp() });
    return !!after && !hasHistory;
  });
}
