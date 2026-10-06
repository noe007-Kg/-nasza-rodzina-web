import { createHash } from 'node:crypto';

const SCHOOL_SOURCES = new Set(['schoolItems', 'schoolParentMessages', 'schoolStudentMessages']);
const SOURCES = new Set(['calendarEvents', 'privateCalendarEvents', 'tasks', 'shoppingItems', 'familyMessages', 'healthRecords', ...SCHOOL_SOURCES]);
const connectionIdValid = value => value === 'family' || typeof value === 'string' && /^student_[a-f0-9]{64}$/.test(value);
const documentIdValid = value => typeof value === 'string' && !!value && !value.includes('/') && !['.', '..'].includes(value) && Buffer.byteLength(value) <= 1500;
const boundedText = (value, maximum) => typeof value === 'string' && !!value && value.length <= maximum;

/** Functions supplies the same canonical helpers as the Vercel server. Keeping
 * these dependencies explicit avoids a second event/baseline implementation or
 * an import outside the deployable Functions source directory.
 */
export async function processNotificationWrite(context, { collection, id, before = null, after = null }, { derive, enqueue, baselineRef, bootstrap }) {
  if (!SOURCES.has(collection) || !documentIdValid(id)) throw new Error('Invalid notification trigger source.');
  const school = SCHOOL_SOURCES.has(collection);
  const current = after || before;
  if (school && current?.source === 'eduvulcan' && current.sourceConnectionId !== undefined) {
    if (!connectionIdValid(current.sourceConnectionId) || !boundedText(current.sourceProfileId, 500)
      || !boundedText(current.person, 300) || !boundedText(current.sourceSyncId, 500)) {
      return { created: 0, reason: 'invalid-managed-school-source' };
    }
    const baseline = await baselineRef(context.db, current.sourceConnectionId, current.sourceProfileId, current.person).get();
    // The protected import transaction atomically creates this baseline and its
    // semantic-diff journal. Raw imported rows must never bypass that baseline,
    // including the first partial history or newly entering timetable dates.
    if (baseline.exists) return { created: 0, reason: 'managed-school-journal' };
  }
  // A legacy import may not yet have a canonical baseline. Retain its existing
  // first-import protection; metadata-only writes still establish history.
  if (school && await bootstrap(context.db, before, after)) return { created: 0, reason: 'school-history-baseline' };
  const event = derive(collection, id, before, after);
  if (!event) return { created: 0, reason: 'no-semantic-change' };
  const result = await enqueue(context, [event], { revalidateSource: !school });
  return { ...result, reason: 'event' };
}

/** One durable journal write per changed import, rather than one independent
 * producer per imported grade/message. syncAction may drain the same journal;
 * canonical inbox transactions make both paths idempotent and preserve stars.
 */
export async function processSchoolNotificationBatch(context, { connectionHash, batch }, { flush }) {
  if (!batch || batch.status !== 'pending' || !connectionIdValid(batch.connectionId)
    || typeof connectionHash !== 'string'
    || createHash('sha256').update(JSON.stringify(batch.connectionId)).digest('hex') !== connectionHash) {
    return { created: 0, reason: 'invalid-school-journal' };
  }
  const result = await flush({ ...context, connection: { id: batch.connectionId } });
  return { ...result, reason: 'school-journal' };
}
