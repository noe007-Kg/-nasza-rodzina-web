import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { calendarConfiguration, calendarIdentifier, calendarSelection, expectCalendarFields, failCalendar } from './calendar-config.mjs';
import { calendarEncryptionConfigured, decryptCalendarSecrets, encryptCalendarSecrets } from './calendar-secrets.mjs';
import { assertFamilyV2WriteAllowed } from './family-v2-policy.mjs';
import { exchangeGoogleCode, googleAuthorizationUrl, googleCalendarClient, GOOGLE_CALENDAR_WRITE_SCOPE, normalizeGoogleHistoryEvent } from './calendar-google.mjs';
import { CALENDAR_LEASE_MS, acquireCalendarLease, assertCalendarActor, assertCalendarLease, assertCalendarNotRemoving, assertCalendarSelection, assertOwnedConnection, connectionRef,
  calendarEventFingerprint, googleEventDocumentId, persistCalendarCredentials, releaseCalendarLease, sourceCalendarDocuments, timestampMillis, updateCalendarLease, upsertGoogleEvents } from './calendar-storage.mjs';

const OAUTH_TTL_MS = 10 * 60000;
const digest = value => createHash('sha256').update(value).digest('hex');
const opaque = () => randomBytes(32).toString('base64url');
const opaquePattern = /^[A-Za-z0-9_-]{43}$/;
const stateRef = (context, id) => {
  if (typeof id !== 'string' || !opaquePattern.test(id)) failCalendar('CALENDAR_OAUTH_INVALID', 400, 'Nieprawidłowe potwierdzenie połączenia kalendarza.');
  return context.db.collection('_calendarOAuthStates').doc(digest(id));
};
export function parseCalendarOAuthCookie(header) {
  if (typeof header !== 'string' || header.length > 8192) return null;
  const values = header.split(';').map(value => value.trim()).filter(value => value.startsWith('__Host-calendar-oauth='));
  if (values.length !== 1) return null;
  const value = values[0].slice('__Host-calendar-oauth='.length), parts = value.split('.');
  return parts.length === 2 && parts.every(part => opaquePattern.test(part)) ? { stateId: parts[0], nonce: parts[1] } : null;
}
export function calendarOAuthCookie(value = '', clear = false) {
  return `__Host-calendar-oauth=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${clear ? 0 : 600}`;
}
function validState(data, id, cookie, now, phase) {
  if (!data || !cookie || cookie.stateId !== id || !Number.isFinite(timestampMillis(data.expiresAt)) || timestampMillis(data.expiresAt) <= now
    || typeof data.nonceHash !== 'string' || !/^[a-f0-9]{64}$/.test(data.nonceHash)
    || !timingSafeEqual(Buffer.from(data.nonceHash, 'hex'), Buffer.from(digest(cookie.nonce), 'hex')) || data.phase !== phase) {
    failCalendar('CALENDAR_OAUTH_EXPIRED', 401, 'Potwierdzenie połączenia wygasło albo zostało już użyte. Zacznij ponownie.');
  }
}
function configured() { try { calendarConfiguration(); return calendarEncryptionConfigured(); } catch { return false; } }
const iso = value => Number.isFinite(timestampMillis(value)) ? new Date(timestampMillis(value)).toISOString() : null;
export const publicCalendarConnection = (id, data) => ({ id, provider: 'google', calendarId: data.calendarId || '', calendarName: data.calendarName || 'Google Calendar',
  ownerProfileId: data.ownerProfileId, person: data.person, visibility: data.visibility, mode: data.mode, status: data.status,
  selectionConfirmed: data.selectionConfirmed === true, lastSuccessfulSyncAt: iso(data.lastSuccessfulSyncAt), lastAttemptAt: iso(data.lastAttemptAt), lastErrorCode: data.lastErrorCode || null,
  writeAuthorized: data.writeAuthorized === true, twoWayEnabled: data.twoWayEnabled === true, historyComplete: data.historyComplete === true, historyRequired: data.historyImportVersion === 2 && data.historyComplete !== true,
  historyProgress: data.historyProgress || null });

export function assertCalendarV2WritesAllowed(context, env = process.env) {
  if (env.VERCEL_ENV === 'preview') failCalendar('CALENDAR_PREVIEW_READ_ONLY', 403, 'Wersja Preview nie zapisuje zmian integracji w produkcyjnych danych. Użyj oddzielnego projektu testowego.');
  assertFamilyV2WriteAllowed(context, env);
}

export async function startCalendarOAuth(context, body, { now = Date.now() } = {}) {
  expectCalendarFields(body, ['ownerProfileId', 'visibility', 'mode', 'connectionId', 'write']);
  if (body.write !== undefined && typeof body.write !== 'boolean') failCalendar('CALENDAR_INVALID_REQUEST', 400, 'Nieprawidłowa zgoda na zapis.');
  if (body.write) assertCalendarV2WritesAllowed(context);
  const selection = calendarSelection(body), config = calendarConfiguration();
  if (Object.hasOwn(body, 'connectionId')) connectionRef(context, body.connectionId);
  if (!calendarEncryptionConfigured()) failCalendar('CALENDAR_NOT_CONFIGURED', 503, 'Administrator musi skonfigurować osobny klucz kalendarzy.');
  const id = opaque(), nonce = opaque(), verifier = opaque(), ref = stateRef(context, id), rateRef = context.db.collection('_calendarOAuthRates').doc(digest(context.uid));
  const envelope = encryptCalendarSecrets({ verifier }, { uid: context.uid, id, purpose: 'oauth' });
  await context.db.runTransaction(async transaction => {
    const [actorSnapshot, rateSnapshot] = await Promise.all([transaction.get(context.db.collection('members').doc(context.uid)), transaction.get(rateRef)]);
    const actor = actorSnapshot.data(), rate = rateSnapshot.data(), person = await assertCalendarSelection(transaction, context, actor, selection);
    let connection;
    if (body.connectionId) {
      connection = (await transaction.get(connectionRef(context, body.connectionId))).data(); assertOwnedConnection(context, connection);
      assertCalendarNotRemoving(connection, now);
      if (connection.mode === 'import' && connection.status === 'imported') failCalendar('CALENDAR_IMPORT_COMPLETE', 409, 'Ten kalendarz został już zaimportowany jednorazowo.');
      if (connection.ownerProfileId !== selection.ownerProfileId || connection.mode !== selection.mode) failCalendar('CALENDAR_SOURCE_LOCKED', 409, 'Ponowne połączenie musi zachować przypisanie istniejącego źródła.');
    }
    if (Number.isFinite(timestampMillis(rate?.startedAt)) && now - timestampMillis(rate.startedAt) < 10000) failCalendar('CALENDAR_RATE_LIMITED', 429, 'Połączenie zostało rozpoczęte przed chwilą. Spróbuj za moment.');
    if (rate?.stateId) transaction.delete(stateRef(context, rate.stateId));
    transaction.set(ref, { ownerUid: context.uid, ...selection, person, writeRequested: body.write === true, ...(body.connectionId ? { connectionId: body.connectionId, expectedConnectionVersion: connection.version } : {}), phase: 'started', nonceHash: digest(nonce), envelope,
      expiresAt: Timestamp.fromMillis(now + OAUTH_TTL_MS), createdAt: Timestamp.fromMillis(now) });
    transaction.set(rateRef, { startedAt: Timestamp.fromMillis(now), stateId: id });
  });
  return { authorizationUrl: googleAuthorizationUrl(config, id, createHash('sha256').update(verifier).digest('base64url'), { write: body.write === true }), cookie: calendarOAuthCookie(`${id}.${nonce}`) };
}

/** Callback has no Firebase bearer: state, PKCE and the same browser nonce bind it to the initiating UID. */
export async function completeCalendarOAuth(services, query, cookie, { clock = Date.now, now = clock(), exchange = exchangeGoogleCode } = {}) {
  const config = calendarConfiguration();
  if (query.error) failCalendar('CALENDAR_OAUTH_CANCELLED', 400, 'Połączenie Google Calendar zostało anulowane.');
  if (typeof query.state !== 'string' || typeof query.code !== 'string' || query.code.length > 1024) failCalendar('CALENDAR_OAUTH_INVALID', 400, 'Google nie przekazał poprawnego potwierdzenia.');
  const ref = stateRef(services, query.state), attempt = randomUUID();
  const state = await services.db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref), data = snapshot.data(); validState(data, query.state, cookie, clock(), 'started');
    const context = { ...services, uid: data.ownerUid };
    const actorSnapshot = await transaction.get(context.db.collection('members').doc(context.uid));
    await assertCalendarSelection(transaction, context, actorSnapshot.data(), data);
    if (data.connectionId) {
      const existing = (await transaction.get(connectionRef(context, data.connectionId))).data(); assertOwnedConnection(context, existing);
      assertCalendarNotRemoving(existing, clock());
      if (!data.expectedConnectionVersion || existing.version !== data.expectedConnectionVersion) failCalendar('CALENDAR_SYNC_STALE', 409, 'Połączenie zmieniło się. Zacznij ponowne połączenie od nowa.');
    }
    validState(data, query.state, cookie, clock(), 'started');
    transaction.update(ref, { phase: 'exchanging', attempt }); return data;
  });
  const { verifier } = decryptCalendarSecrets(state.envelope, { uid: state.ownerUid, id: query.state, purpose: 'oauth' });
  const tokens = await exchange(config, query.code, verifier, { now, signal: AbortSignal.timeout(15000) });
  const envelope = encryptCalendarSecrets({ tokens }, { uid: state.ownerUid, id: query.state, purpose: 'oauth' });
  await services.db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref), data = snapshot.data(); validState(data, query.state, cookie, clock(), 'exchanging');
    if (data.attempt !== attempt) failCalendar('CALENDAR_OAUTH_INVALID', 409, 'To potwierdzenie zostało już użyte.');
    const context = { ...services, uid: data.ownerUid }, actor = (await transaction.get(context.db.collection('members').doc(data.ownerUid))).data();
    await assertCalendarSelection(transaction, context, actor, data);
    if (data.connectionId) {
      const existing = (await transaction.get(connectionRef(context, data.connectionId))).data(); assertOwnedConnection(context, existing);
      assertCalendarNotRemoving(existing, clock());
      if (!data.expectedConnectionVersion || existing.version !== data.expectedConnectionVersion) failCalendar('CALENDAR_SYNC_STALE', 409, 'Połączenie zmieniło się. Zacznij ponowne połączenie od nowa.');
    }
    validState(data, query.state, cookie, clock(), 'exchanging');
    transaction.update(ref, { envelope, phase: 'authorized', authorizedAt: Timestamp.fromMillis(clock()) });
  });
  return { location: `${config.origin}/?calendarOAuth=${encodeURIComponent(query.state)}` };
}

export async function finalizeCalendarOAuth(context, body, cookie, { clock = Date.now, now = clock() } = {}) {
  expectCalendarFields(body, ['completionId']); calendarConfiguration();
  const ref = stateRef(context, body.completionId), newId = randomUUID();
  const id = await context.db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref), state = snapshot.data(); validState(state, body.completionId, cookie, clock(), 'authorized');
    if (state.ownerUid !== context.uid) failCalendar('CALENDAR_OAUTH_FORBIDDEN', 403, 'Dokończ połączenie na tym samym koncie Naszej Rodziny.');
    const actorSnapshot = await transaction.get(context.db.collection('members').doc(context.uid));
    const person = await assertCalendarSelection(transaction, context, actorSnapshot.data(), state);
    const id = state.connectionId || newId, connection = connectionRef(context, id), oldSnapshot = await transaction.get(connection), old = oldSnapshot.data();
    const existing = await transaction.get(context.db.collection('_calendarConnections').where('ownerUid', '==', context.uid).limit(31));
    // Retained history counts toward the bounded status response. Reconnecting
    // an existing source does not add a record or discard its imported events.
    if (!old && existing.docs.length >= 30) failCalendar('CALENDAR_SOURCE_HISTORY_LIMIT', 409, 'Osiągnięto limit 30 zapisanych źródeł kalendarza. Połącz ponownie istniejące źródło.');
    if (!old && existing.docs.filter(row => ['connected', 'needs-reconnect'].includes(row.data().status)).length >= 10) failCalendar('CALENDAR_CONNECTION_LIMIT', 409, 'Masz już dziesięć aktywnych źródeł. Rozłącz nieużywane źródło.');
    if (state.connectionId && (!old || !state.expectedConnectionVersion || old.version !== state.expectedConnectionVersion)) failCalendar('CALENDAR_SYNC_STALE', 409, 'Połączenie zmieniło się. Zacznij ponowne połączenie od nowa.');
    if (old) { assertOwnedConnection(context, old); assertCalendarNotRemoving(old, clock()); if (old.ownerProfileId !== state.ownerProfileId || old.mode !== state.mode) failCalendar('CALENDAR_SOURCE_LOCKED', 409, 'Przypisanie źródła zmieniło się. Zacznij ponownie.'); }
    const { tokens } = decryptCalendarSecrets(state.envelope, { uid: context.uid, id: body.completionId, purpose: 'oauth' });
    if (state.writeRequested) {
      assertCalendarV2WritesAllowed(context);
      if (!tokens.scopes?.includes(GOOGLE_CALENDAR_WRITE_SCOPE)) failCalendar('CALENDAR_WRITE_PERMISSION_REQUIRED', 403, 'Google nie udzielił zgody na zapis wydarzeń. Dotychczasowe połączenie pozostaje bez zmian.');
    }
    validState(state, body.completionId, cookie, clock(), 'authorized');
    transaction.set(connection, { ...(old || {}), ownerUid: context.uid, provider: 'google', ownerProfileId: state.ownerProfileId, person, visibility: state.visibility, mode: state.mode,
      calendarId: old?.calendarId || 'primary', calendarName: old?.calendarName || 'Google Calendar', selectionConfirmed: false,
      status: 'connected', version: randomUUID(), leaseId: null, leaseExpiresAt: null, lastErrorCode: null,
      removingEvents: false, removalExpiresAt: null,
      envelope: encryptCalendarSecrets({ tokens, syncToken: null }, { uid: context.uid, id, purpose: 'connection' }),
      writeAuthorized: state.writeRequested === true && tokens.scopes?.includes(GOOGLE_CALENDAR_WRITE_SCOPE) === true, twoWayEnabled: false, historyImportVersion: old?.historyImportVersion || 2,
      recurringIds: old?.recurringIds || [], createdAt: old?.createdAt || Timestamp.fromMillis(now), updatedAt: Timestamp.fromMillis(now) });
    transaction.delete(ref); return id;
  });
  return { connectionId: id };
}

export async function calendarStatus(context, body) {
  expectCalendarFields(body, []);
  const actorSnapshot = await context.db.collection('members').doc(context.uid).get(); assertCalendarActor(context, actorSnapshot.data());
  const snapshot = await context.db.collection('_calendarConnections').where('ownerUid', '==', context.uid).limit(31).get();
  if (snapshot.docs.length > 30) failCalendar('CALENDAR_CONNECTION_LIMIT', 409, 'Lista źródeł wymaga uporządkowania.');
  return { configured: configured(), connections: snapshot.docs.map(row => publicCalendarConnection(row.id, row.data())) };
}

async function withClient(context, body, operation, { clock = Date.now, clientFactory = googleCalendarClient, syncing = false } = {}) {
  const config = calendarConfiguration(), started = clock();
  const acquired = await acquireCalendarLease(context, body.connectionId, { now: started, syncing });
  const { data, lease, ref } = acquired;
  let secrets, client;
  try {
    secrets = decryptCalendarSecrets(data.envelope, { uid: context.uid, id: data.id, purpose: 'connection' });
    client = clientFactory(config, secrets.tokens, { now: started, signal: AbortSignal.timeout(45000) });
    const result = await operation(client, data, secrets, lease, ref, clock);
    return result;
  } catch (error) {
    // A later failed page must not lose credentials rotated by an earlier successful refresh.
    // This preserves the OLD cursor and never turns a failed read into a successful sync.
    if (client && secrets && !['CALENDAR_RECONNECT_REQUIRED', 'CALENDAR_SYNC_STALE'].includes(error?.code)) {
      await persistCalendarCredentials(context, ref, lease, data, client.tokens(), secrets.syncToken, clock(), clock, secrets).catch(() => {});
    }
    await releaseCalendarLease(context, ref, lease, { now: clock(), errorCode: typeof error?.code === 'string' && error.code.startsWith('CALENDAR_') ? error.code : 'CALENDAR_PROVIDER_UNAVAILABLE' }).catch(() => {});
    throw error;
  } finally { await releaseCalendarLease(context, ref, lease, { now: clock() }).catch(() => {}); }
}
export async function listGoogleCalendars(context, body, options) {
  expectCalendarFields(body, ['connectionId']);
  return withClient(context, body, async (client, data, secrets, lease, ref, clock) => {
    const calendars = await client.calendars(); await persistCalendarCredentials(context, ref, lease, data, client.tokens(), secrets.syncToken, clock(), clock, secrets); return { calendars };
  }, options);
}
export async function configureGoogleCalendar(context, body, options) {
  expectCalendarFields(body, ['connectionId', 'calendarId', 'ownerProfileId', 'visibility', 'mode']);
  const selection = calendarSelection(body);
  if (!calendarIdentifier(body.calendarId)) failCalendar('CALENDAR_INVALID_REQUEST', 400, 'Wybierz istniejący kalendarz Google.');
  return withClient(context, body, async (client, data, secrets, lease, ref, clock) => {
    const calendars = await client.calendars(), calendar = calendars.find(row => row.id === body.calendarId || body.calendarId === 'primary' && row.primary);
    if (!calendar) failCalendar('CALENDAR_SOURCE_NOT_FOUND', 403, 'Google nie udostępnia wybranego kalendarza.');
    const envelope = encryptCalendarSecrets({ ...secrets, tokens: client.tokens(), syncToken: data.calendarId === calendar.id ? secrets.syncToken : null }, { uid: context.uid, id: data.id, purpose: 'connection' });
    await context.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref), actorSnapshot = await transaction.get(context.db.collection('members').doc(context.uid)), current = snapshot.data();
      assertOwnedConnection(context, current); const person = await assertCalendarSelection(transaction, context, actorSnapshot.data(), selection); assertCalendarLease(current, lease, clock());
      const others = await transaction.get(context.db.collection('_calendarConnections').where('ownerUid', '==', context.uid).limit(31));
      if (others.docs.some(row => row.id !== data.id && row.data().calendarId === calendar.id && (row.data().hasEvents === true || ['connected', 'needs-reconnect'].includes(row.data().status)))) {
        failCalendar('CALENDAR_SOURCE_ALREADY_EXISTS', 409, 'Ten kalendarz jest już powiązany z istniejącym źródłem. Połącz ponownie dotychczasowe źródło.');
      }
      if (current.hasEvents && (current.calendarId !== calendar.id || current.ownerProfileId !== selection.ownerProfileId || current.mode !== selection.mode)) {
        failCalendar('CALENDAR_SOURCE_LOCKED', 409, 'Zaimportowane źródło zachowuje kalendarz i właściciela. Rozłącz je, aby utworzyć inne źródło.');
      }
      assertCalendarLease(current, lease, clock());
      transaction.update(ref, { ...selection, person, calendarId: calendar.id, calendarName: calendar.name, timeZone: calendar.timeZone, envelope,
        selectionConfirmed: true, googleCalendarCanWrite: calendar.canWrite === true, lastErrorCode: null, ...(current.calendarId === calendar.id ? {} : { recurringIds: [], historyComplete: false, historyProgress: null }), updatedAt: Timestamp.fromMillis(clock()) });
    });
    return { connectionId: data.id };
  }, options);
}
export async function syncGoogleCalendar(context, body, options) {
  expectCalendarFields(body, ['connectionId']);
  const current = (await connectionRef(context, body.connectionId).get()).data();
  if (current?.historyImportVersion === 2) return syncGoogleHistory(context, body, options);
  return withClient(context, body, async (client, data, secrets, lease, ref, clock) => {
    const changes = await client.changes(data.calendarId, { syncToken: secrets.syncToken, recurringIds: data.recurringIds || [], timeZone: data.timeZone });
    // Preserve a refreshed token before importing; the old cursor remains until every upsert succeeds.
    await persistCalendarCredentials(context, ref, lease, data, client.tokens(), secrets.syncToken, clock(), clock);
    const records = changes.events.slice();
    if (changes.cancelledSeries.length || changes.authoritativeSeries?.length || changes.fullSnapshotComplete || changes.recurringIds?.length) {
      const cancelled = new Set(changes.cancelledSeries), authoritative = new Set(changes.authoritativeSeries || []), returned = new Set(records.map(row => row.externalEventId));
      const activeStandalone = new Set(changes.authoritativeStandaloneIds || []), currentSeries = new Set(changes.recurringIds || []);
      const existing = await sourceCalendarDocuments(context, data.id);
      for (const row of existing) {
        const event = row.data(), inWindow = Number.isFinite(changes.windowStart) && Number.isFinite(changes.windowEnd)
          && timestampMillis(event.endDate) > changes.windowStart && timestampMillis(event.date) < changes.windowEnd;
        const wasStandalone = !event.externalSeriesId;
        const missingStandalone = wasStandalone && changes.fullSnapshotComplete === true && !activeStandalone.has(event.externalEventId);
        const standaloneBecameSeries = wasStandalone && currentSeries.has(event.externalEventId);
        const missingSeriesFromFullSnapshot = !wasStandalone && changes.fullSnapshotComplete === true && inWindow && !currentSeries.has(event.externalSeriesId);
        if (cancelled.has(event.externalSeriesId) || authoritative.has(event.externalSeriesId) && inWindow && !returned.has(event.externalEventId)
          || missingStandalone || standaloneBecameSeries || missingSeriesFromFullSnapshot) {
          records.push({ externalEventId: event.externalEventId, cancelled: true });
        }
      }
    }
    const result = await upsertGoogleEvents(context, data, lease, records, { now: clock(), clock });
    const now = clock(), envelope = data.mode === 'import' ? null : encryptCalendarSecrets({ tokens: client.tokens(), syncToken: changes.syncToken }, { uid: context.uid, id: data.id, purpose: 'connection' });
    await updateCalendarLease(context, ref, lease, { envelope, recurringIds: changes.recurringIds, timeZone: changes.timeZone, hasEvents: data.hasEvents || result.imported > 0,
      status: data.mode === 'import' ? 'imported' : 'connected', lastSuccessfulSyncAt: Timestamp.fromMillis(now), lastErrorCode: null, leaseId: null, leaseExpiresAt: null, updatedAt: Timestamp.fromMillis(now) }, now, clock);
    return { ...result, lastSuccessfulSyncAt: new Date(now).toISOString() };
  }, { ...options, syncing: true });
}

export async function changeGoogleEventVisibility(context, body, { clock = Date.now, now = clock() } = {}) {
  expectCalendarFields(body, ['connectionId', 'eventId', 'visibility']);
  if (!['private', 'family'].includes(body.visibility) || typeof body.eventId !== 'string' || !/^google-[a-f0-9]{64}$/.test(body.eventId)) failCalendar('CALENDAR_INVALID_REQUEST', 400, 'Wybierz poprawną widoczność wydarzenia.');
  const ref = connectionRef(context, body.connectionId), sharedRef = context.db.collection('calendarEvents').doc(body.eventId), privateRef = context.db.collection('privateCalendarEvents').doc(body.eventId);
  await context.db.runTransaction(async transaction => {
    const [connection, actor, shared, privateSnapshot] = await Promise.all([transaction.get(ref), transaction.get(context.db.collection('members').doc(context.uid)), transaction.get(sharedRef), transaction.get(privateRef)]);
    assertCalendarActor(context, actor.data()); assertOwnedConnection(context, connection.data());
    assertCalendarNotRemoving(connection.data(), clock());
    if (shared.exists && privateSnapshot.exists) failCalendar('CALENDAR_EVENT_CONFLICT', 409, 'Wydarzenie wymaga sprawdzenia ustawień prywatności.');
    const event = shared.exists ? shared.data() : privateSnapshot.data();
    if (!event || event.source !== 'google' || event.sourceConnectionId !== body.connectionId || event.sourceOwnerUid !== context.uid || event.ownerUid !== context.uid || event.createdBy !== context.uid) failCalendar('CALENDAR_EVENT_FORBIDDEN', 403, 'Nie możesz zmienić widoczności tego wydarzenia.');
    await assertCalendarSelection(transaction, context, actor.data(), connection.data());
    assertCalendarNotRemoving(connection.data(), clock());
    const isPrivate = body.visibility === 'private', target = isPrivate ? privateRef : sharedRef, oldRef = shared.exists ? sharedRef : privateRef;
    transaction.set(target, { ...event, private: isPrivate, visibilityOverride: body.visibility, updatedAt: Timestamp.fromMillis(now), updatedBy: context.uid });
    if (oldRef.path !== target.path) transaction.delete(oldRef);
  });
  return { eventId: body.eventId, visibility: body.visibility };
}

export async function disconnectGoogleCalendar(context, body, { clock = Date.now } = {}) {
  expectCalendarFields(body, ['connectionId', 'removeEvents']);
  if (typeof body.removeEvents !== 'boolean') failCalendar('CALENDAR_INVALID_REQUEST', 400, 'Wybierz, czy pozostawić wcześniej pobrane wydarzenia.');
  const ref = connectionRef(context, body.connectionId), version = randomUUID();
  await context.db.runTransaction(async transaction => {
    const [snapshot, actor] = await Promise.all([transaction.get(ref), transaction.get(context.db.collection('members').doc(context.uid))]);
    assertCalendarActor(context, actor.data()); assertOwnedConnection(context, snapshot.data());
    assertCalendarNotRemoving(snapshot.data(), clock());
    transaction.update(ref, { envelope: null, version, status: 'disconnected', selectionConfirmed: false, leaseId: null, leaseExpiresAt: null, lastErrorCode: null,
      removingEvents: body.removeEvents, removalExpiresAt: body.removeEvents ? Timestamp.fromMillis(clock() + CALENDAR_LEASE_MS) : null, updatedAt: Timestamp.fromMillis(clock()) });
  });
  let removed = 0;
  if (body.removeEvents) {
    try {
      const rows = await sourceCalendarDocuments(context, body.connectionId);
      for (let offset = 0; offset < rows.length; offset += 100) {
        const count = await context.db.runTransaction(async transaction => {
          const [snapshot, actor] = await Promise.all([transaction.get(ref), transaction.get(context.db.collection('members').doc(context.uid))]);
          assertCalendarActor(context, actor.data()); assertOwnedConnection(context, snapshot.data());
          const locked = snapshot.data();
          if (locked.version !== version || locked.status !== 'disconnected' || locked.removingEvents !== true
            || !Number.isFinite(timestampMillis(locked.removalExpiresAt)) || timestampMillis(locked.removalExpiresAt) <= clock()) failCalendar('CALENDAR_SYNC_STALE', 409, 'Połączenie zmieniło się podczas rozłączania.');
          const fresh = await Promise.all(rows.slice(offset, offset + 100).map(row => transaction.get(row.ref)));
          for (const row of fresh) if (row.exists) {
            const event = row.data();
            if (event.sourceConnectionId !== body.connectionId || event.sourceOwnerUid !== context.uid || event.ownerUid !== context.uid || event.createdBy !== context.uid || event.source !== 'google') failCalendar('CALENDAR_EVENT_CONFLICT', 409, 'Źródło kalendarza wymaga sprawdzenia właściciela.');
          }
          if (timestampMillis(locked.removalExpiresAt) <= clock()) failCalendar('CALENDAR_SYNC_STALE', 409, 'Usuwanie trwało zbyt długo. Spróbuj ponownie.');
          for (const row of fresh) if (row.exists) transaction.delete(row.ref);
          return fresh.filter(row => row.exists).length;
        }); removed += count;
      }
      await context.db.runTransaction(async transaction => {
        const [snapshot, actor] = await Promise.all([transaction.get(ref), transaction.get(context.db.collection('members').doc(context.uid))]);
        assertCalendarActor(context, actor.data()); assertOwnedConnection(context, snapshot.data());
        if (snapshot.data().version !== version || snapshot.data().status !== 'disconnected' || snapshot.data().removingEvents !== true
          || !Number.isFinite(timestampMillis(snapshot.data().removalExpiresAt)) || timestampMillis(snapshot.data().removalExpiresAt) <= clock()) failCalendar('CALENDAR_SYNC_STALE', 409, 'Połączenie zmieniło się podczas rozłączania.');
        transaction.update(ref, { hasEvents: false, removingEvents: false, removalExpiresAt: null });
      });
    } finally {
      // A failed cleanup preserves history and unlocks a retry; a newer connection is never modified.
      await context.db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref), current = snapshot.data();
        if (current?.ownerUid === context.uid && current.version === version && current.status === 'disconnected' && current.removingEvents === true) {
          transaction.update(ref, { removingEvents: false, removalExpiresAt: null });
        }
      }).catch(() => {});
    }
  }
  return { removed };
}

/** Bounded, resumable history. Cursors stay inside the existing AES-GCM envelope,
 * never in the browser. Closing the UI cannot duplicate already committed pages. */
export async function googleHistoryStep(context, body, options) {
  expectCalendarFields(body, ['connectionId', 'operation', 'restart']);
  assertCalendarV2WritesAllowed(context);
  if (!['preview', 'import'].includes(body.operation) || body.restart !== undefined && typeof body.restart !== 'boolean') failCalendar('CALENDAR_INVALID_REQUEST', 400, 'Wybierz sprawdzenie historii albo import.');
  return withClient(context, body, async (client, data, secrets, lease, ref, clock) => {
    let job = secrets.historyJob;
    const continuing = job?.phase === body.operation && job.complete !== true && !body.restart;
    if (!continuing) {
      if (body.operation === 'import' && (data.historyProgress?.phase !== 'preview' || data.historyProgress.complete !== true) && job?.phase !== 'import') failCalendar('CALENDAR_HISTORY_CONFIRM_REQUIRED', 409, 'Najpierw sprawdź liczbę wydarzeń, a następnie zatwierdź import.');
      job = { phase: body.operation, pageToken: null, syncToken: null, processed: 0, imported: 0, changed: 0, cancelled: 0, unchanged: 0, total: body.operation === 'import' ? data.historyProgress?.processed || null : null, complete: false };
    }
    return commitHistoryPage(context, client, data, secrets, lease, ref, clock, job);
  }, options);
}

async function commitHistoryPage(context, client, data, secrets, lease, ref, clock, job) {
  const page = await client.historyPage(data.calendarId, { pageToken: job.pageToken, syncToken: job.syncToken, timeZone: data.timeZone });
  const events = [];
  for (const event of page.events) {
    if (event.exportReference && /^[a-f0-9]{64}$/.test(event.exportReference)) {
      const exported = (await context.db.collection('_calendarExports').doc(event.exportReference).get()).data();
      if (exported?.ownerUid === context.uid && exported.sourceConnectionId === data.id && exported.externalEventId === event.externalEventId) continue;
    }
    events.push(event);
  }
  const totals = job.phase === 'preview' ? { imported: 0, changed: 0, cancelled: 0, unchanged: 0 } : await upsertGoogleEvents(context, data, lease, events, { clock, now: clock() });
  const complete = !page.nextPageToken;
  const next = { ...job, pageToken: page.nextPageToken, processed: job.processed + page.events.filter(event => !event.cancelled).length, complete,
    ...Object.fromEntries(['imported', 'changed', 'cancelled', 'unchanged'].map(key => [key, (job[key] || 0) + totals[key]])) };
  const progress = { phase: next.phase, processed: next.processed, total: next.total || null, complete };
  const syncToken = complete && job.phase !== 'preview' ? page.syncToken : secrets.syncToken;
  const envelope = complete && data.mode === 'import' && job.phase === 'import' ? null : encryptCalendarSecrets({ ...secrets, tokens: client.tokens(), syncToken: syncToken || null, historyJob: next }, { uid: context.uid, id: data.id, purpose: 'connection' });
  await updateCalendarLease(context, ref, lease, { envelope, historyProgress: progress, historyImportVersion: 2, timeZone: page.timeZone || data.timeZone || null,
    ...(job.phase !== 'preview' ? { hasEvents: data.hasEvents || totals.imported > 0 } : {}),
    ...(complete && job.phase !== 'preview' ? { historyComplete: true, lastSuccessfulSyncAt: Timestamp.fromMillis(clock()), status: data.mode === 'import' ? 'imported' : 'connected' } : {}),
    lastErrorCode: null, updatedAt: Timestamp.fromMillis(clock()) }, clock(), clock);
  return { ...totals, historyProgress: progress, complete, lastSuccessfulSyncAt: complete && job.phase !== 'preview' ? new Date(clock()).toISOString() : null };
}

export async function syncGoogleHistory(context, body, options) {
  assertCalendarV2WritesAllowed(context);
  const current = (await connectionRef(context, body.connectionId).get()).data();
  const continuation = current?.historyProgress?.complete === false && ['import', 'sync'].includes(current.historyProgress.phase);
  return withClient({ ...context, calendarHistoryContinuation: continuation }, body, async (client, data, secrets, lease, ref, clock) => {
    if (data.historyComplete !== true && secrets.historyJob?.phase !== 'import') failCalendar('CALENDAR_HISTORY_CONFIRM_REQUIRED', 409, 'Najpierw sprawdź i zatwierdź import historii.');
    const job = secrets.historyJob?.complete !== true && ['import', 'sync'].includes(secrets.historyJob?.phase) ? secrets.historyJob : {
      phase: 'sync', pageToken: null, syncToken: secrets.syncToken || null, processed: 0, imported: 0, changed: 0, cancelled: 0, unchanged: 0, total: null, complete: false,
    };
    let result;
    try { result = await commitHistoryPage(context, client, data, secrets, lease, ref, clock, job); }
    catch (error) {
      if (error?.code !== 'CALENDAR_CURSOR_EXPIRED' || !job.syncToken && !job.pageToken) throw error;
      // A stale cursor starts a bounded full-history reread under the same
      // lease. Existing records remain; only explicit cancellation is applied.
      result = await commitHistoryPage(context, client, data, secrets, lease, ref, clock, { ...job, pageToken: null, syncToken: null,
        processed: 0, imported: 0, changed: 0, cancelled: 0, unchanged: 0, complete: false });
    }
    if (result.complete && data.twoWayEnabled === true) await synchronizeGoogleExports(context, data, client, clock);
    return result;
  }, { ...options, syncing: true });
}

export async function changeGoogleVisibilityBatch(context, body, options) {
  expectCalendarFields(body, ['connectionId', 'eventIds', 'visibility']);
  assertCalendarV2WritesAllowed(context);
  if (!Array.isArray(body.eventIds) || body.eventIds.length < 1 || body.eventIds.length > 100 || new Set(body.eventIds).size !== body.eventIds.length) failCalendar('CALENDAR_INVALID_REQUEST', 400, 'Zaznacz od 1 do 100 własnych wydarzeń.');
  // Each move remains atomic across private/family collections; a failed item
  // does not expose any foreign record or change Google calendar sharing.
  for (const eventId of body.eventIds) await changeGoogleEventVisibility(context, { connectionId: body.connectionId, eventId, visibility: body.visibility }, options);
  return { changed: body.eventIds.length, visibility: body.visibility };
}

export async function configureGoogleTwoWay(context, body, options) {
  expectCalendarFields(body, ['connectionId', 'enabled']); assertCalendarV2WritesAllowed(context);
  if (typeof body.enabled !== 'boolean') failCalendar('CALENDAR_INVALID_REQUEST', 400, 'Potwierdź ustawienie synchronizacji.');
  return withClient(context, body, async (client, data, secrets, lease, ref, clock) => {
    if (body.enabled && (!data.writeAuthorized || !client.tokens().scopes?.includes(GOOGLE_CALENDAR_WRITE_SCOPE) || !data.historyComplete || data.googleCalendarCanWrite !== true || data.mode !== 'sync')) failCalendar('CALENDAR_WRITE_PERMISSION_REQUIRED', 403, 'Wymagany jest sprawdzony import historii, kalendarz z prawem zapisu i osobna zgoda Google na zapis.');
    await updateCalendarLease(context, ref, lease, { twoWayEnabled: body.enabled, updatedAt: Timestamp.fromMillis(clock()) }, clock(), clock);
    return { enabled: body.enabled };
  }, options);
}

const exportMapRef = (context, connectionId, eventId) => context.db.collection('_calendarExports').doc(digest(JSON.stringify([context.uid, connectionId, eventId])));
const calendarEventReferences = (context, eventId) => {
  if (typeof eventId !== 'string' || !eventId || eventId.length > 256 || /[\x00-\x1f/\\]/.test(eventId)) failCalendar('CALENDAR_INVALID_REQUEST', 400, 'Wybierz poprawne wydarzenie.');
  return ['privateCalendarEvents', 'calendarEvents'].map(name => context.db.collection(name).doc(eventId));
};
async function ownedLocalEvent(context, eventId) {
  const [privateRef, sharedRef] = calendarEventReferences(context, eventId);
  const [privateSnapshot, shared] = await Promise.all([privateRef.get(), sharedRef.get()]);
  if (privateSnapshot.exists && shared.exists) failCalendar('CALENDAR_EVENT_CONFLICT', 409, 'Wydarzenie ma niejednoznaczną widoczność.');
  const snapshot = privateSnapshot.exists ? privateSnapshot : shared;
  const event = snapshot.data();
  if (!event || event.ownerUid !== context.uid && event.createdBy !== context.uid || event.readOnly === true || event.source && event.source !== 'manual') failCalendar('CALENDAR_EVENT_FORBIDDEN', 403, 'Możesz eksportować wyłącznie własne, ręcznie dodane wydarzenia.');
  return { event, ref: privateSnapshot.exists ? privateRef : sharedRef };
}
function localEventGoogleBody(event, fallbackTimeZone) {
  const start = timestampMillis(event.date), end = timestampMillis(event.endDate);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) failCalendar('CALENDAR_INVALID_REQUEST', 400, 'Wydarzenie nie ma poprawnego terminu.');
  const timeZone = event.timeZone || fallbackTimeZone || 'Europe/Warsaw';
  const civil = millis => new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(millis));
  const body = { summary: String(event.title || '').slice(0, 500), description: String(event.description || '').slice(0, 10000), location: String(event.location || '').slice(0, 2000),
    start: event.allDay ? { date: event.sourceStartDate || civil(start) } : { dateTime: new Date(start).toISOString(), timeZone },
    end: event.allDay ? { date: event.sourceEndDateExclusive || new Date(Date.parse(`${civil(end)}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) } : { dateTime: new Date(end).toISOString(), timeZone } };
  if (Object.keys(event.recurrenceOverrides || {}).length) failCalendar('CALENDAR_EXPORT_SERIES_COMPLEX', 409, 'Seria z lokalnymi zmianami pojedynczych wystąpień wymaga osobnego uzgodnienia z Google. Nie wysłano uproszczonej kopii.');
  if (event.repeat && event.repeat !== 'none') {
    const units = { daily: 'DAILY', weekdays: 'WEEKLY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' }, custom = event.recurrence || {};
    const frequency = event.repeat === 'custom' ? { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' }[custom.unit] : units[event.repeat];
    if (!frequency) failCalendar('CALENDAR_INVALID_REQUEST', 400, 'Nieprawidłowa reguła powtarzania.');
    const parts = [`FREQ=${frequency}`, `INTERVAL=${event.repeat === 'custom' ? custom.interval || 1 : 1}`];
    const weekdays = event.repeat === 'weekdays' ? [1, 2, 3, 4, 5] : custom.weekdays;
    if (weekdays?.length) parts.push(`BYDAY=${weekdays.map(day => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][day]).join(',')}`);
    if (event.repeatCount) parts.push(`COUNT=${event.repeatCount}`);
    else if (Number.isFinite(timestampMillis(event.repeatUntil))) parts.push(`UNTIL=${new Date(timestampMillis(event.repeatUntil)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`);
    body.recurrence = [`RRULE:${parts.join(';')}`];
    if (event.recurrenceExceptions?.length) body.recurrence.push(`EXDATE:${event.recurrenceExceptions.map(value => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')).join(',')}`);
  }
  return body;
}
const assertGoogleWriting = (data, client) => {
  if (data.writeAuthorized !== true || data.historyComplete !== true || data.googleCalendarCanWrite !== true || !client.tokens().scopes?.includes(GOOGLE_CALENDAR_WRITE_SCOPE)) failCalendar('CALENDAR_WRITE_PERMISSION_REQUIRED', 403, 'Najpierw sprawdź import historii oraz udziel Google osobnej zgody na zapis w tym kalendarzu.');
};

/** Conscious export is separate from changing visibility in our family calendar. */
export async function exportLocalEventToGoogle(context, body, options) {
  expectCalendarFields(body, ['connectionId', 'eventId']); assertCalendarV2WritesAllowed(context);
  return withClient(context, body, async (client, data, secrets, lease, ref, clock) => {
    assertGoogleWriting(data, client);
    const local = await ownedLocalEvent(context, body.eventId), mappingRef = exportMapRef(context, data.id, body.eventId), mapping = (await mappingRef.get()).data();
    if (mapping) {
      if (mapping.ownerUid !== context.uid || mapping.sourceConnectionId !== data.id) failCalendar('CALENDAR_EVENT_FORBIDDEN', 403, 'Nieprawidłowe przypisanie eksportu.');
      if (mapping.ready === true) return { exported: false, alreadyExported: true, eventId: body.eventId };
    }
    const externalEventId = `nr${mappingRef.id}`, googleBody = { ...localEventGoogleBody(local.event, data.timeZone), extendedProperties: { private: { naszaRodzinaExport: mappingRef.id } } };
    await context.db.runTransaction(async transaction => {
      const [connection, actor, fresh, prior] = await Promise.all([transaction.get(ref), transaction.get(context.db.collection('members').doc(context.uid)), transaction.get(local.ref), transaction.get(mappingRef)]);
      assertCalendarActor(context, actor.data()); assertOwnedConnection(context, connection.data()); assertCalendarLease(connection.data(), lease, clock());
      if (!fresh.exists || calendarEventFingerprint(fresh.data()) !== calendarEventFingerprint(local.event)) failCalendar('CALENDAR_WRITE_CONFLICT', 409, 'Wydarzenie zmieniło się przed eksportem.');
      if (prior.exists && prior.data().ownerUid !== context.uid) failCalendar('CALENDAR_EVENT_FORBIDDEN', 403, 'Nieprawidłowe przypisanie eksportu.');
      if (!prior.exists) transaction.set(mappingRef, { ownerUid: context.uid, sourceConnectionId: data.id, localEventId: body.eventId, externalEventId, ready: false, localFingerprint: calendarEventFingerprint(local.event), conflict: false, updatedAt: Timestamp.fromMillis(clock()) });
    });
    let remote;
    try { remote = await client.writeEvent(data.calendarId, externalEventId, googleBody, { insert: true }); }
    catch (error) {
      if (error.code !== 'CALENDAR_WRITE_CONFLICT') throw error;
      remote = await client.event(data.calendarId, externalEventId);
      if (remote.extendedProperties?.private?.naszaRodzinaExport !== mappingRef.id) throw error;
    }
    if (!remote.etag || remote.id !== externalEventId) failCalendar('CALENDAR_PROVIDER_DATA', 502, 'Google nie potwierdził zapisu wydarzenia.');
    await context.db.runTransaction(async transaction => {
      const [connection, actor, fresh, prior] = await Promise.all([transaction.get(ref), transaction.get(context.db.collection('members').doc(context.uid)), transaction.get(local.ref), transaction.get(mappingRef)]);
      assertCalendarActor(context, actor.data()); assertOwnedConnection(context, connection.data()); assertCalendarLease(connection.data(), lease, clock());
      if (!fresh.exists || fresh.data().ownerUid !== context.uid && fresh.data().createdBy !== context.uid || calendarEventFingerprint(fresh.data()) !== calendarEventFingerprint(local.event)) failCalendar('CALENDAR_WRITE_CONFLICT', 409, 'Lokalne wydarzenie zmieniło się podczas eksportu. Nie nadpisano jego nowej wersji.');
      if (prior.exists && prior.data().ready === true) return;
      transaction.set(mappingRef, { ownerUid: context.uid, sourceConnectionId: data.id, localEventId: body.eventId, externalEventId, ready: true, localFingerprint: calendarEventFingerprint(local.event), providerEtag: remote.etag, conflict: false, updatedAt: Timestamp.fromMillis(clock()) });
    });
    await persistCalendarCredentials(context, ref, lease, data, client.tokens(), secrets.syncToken, clock(), clock, secrets);
    return { exported: true, eventId: body.eventId };
  }, options);
}

export async function updateImportedGoogleEvent(context, body, options) {
  expectCalendarFields(body, ['connectionId', 'eventId', 'patch']); assertCalendarV2WritesAllowed(context);
  expectCalendarFields(body.patch, ['title', 'description', 'location', 'date', 'endDate', 'allDay']);
  if (![body.patch.title, body.patch.description, body.patch.location].every(value => typeof value === 'string') || typeof body.patch.allDay !== 'boolean' || !Number.isFinite(Date.parse(body.patch.date)) || !Number.isFinite(Date.parse(body.patch.endDate))) failCalendar('CALENDAR_INVALID_REQUEST', 400, 'Sprawdź nazwę i termin wydarzenia.');
  return withClient(context, body, async (client, data, secrets, lease, ref, clock) => {
    assertGoogleWriting(data, client);
    if (!data.twoWayEnabled) failCalendar('CALENDAR_WRITE_DISABLED', 403, 'Najpierw świadomie włącz synchronizację dwukierunkową.');
    const [privateRef, sharedRef] = calendarEventReferences(context, body.eventId), [privateSnapshot, shared] = await Promise.all([privateRef.get(), sharedRef.get()]);
    if (privateSnapshot.exists && shared.exists) failCalendar('CALENDAR_EVENT_CONFLICT', 409, 'Wydarzenie ma niejednoznaczną widoczność.');
    const event = privateSnapshot.exists ? privateSnapshot.data() : shared.data();
    if (!event || event.source !== 'google' || event.sourceConnectionId !== data.id || event.sourceOwnerUid !== context.uid || event.ownerUid !== context.uid || !event.providerEtag) failCalendar('CALENDAR_EVENT_FORBIDDEN', 403, 'Możesz zmienić tylko własne wydarzenie z potwierdzoną wersją Google.');
    const remote = await client.event(data.calendarId, event.externalEventId);
    if (remote.etag !== event.providerEtag) failCalendar('CALENDAR_WRITE_CONFLICT', 409, 'Wydarzenie zmieniło się w Google. Najpierw zsynchronizuj i sprawdź aktualną wersję.');
    const nextLocal = { ...event, ...body.patch, date: Date.parse(body.patch.date), endDate: Date.parse(body.patch.endDate), repeat: 'none', recurrenceOverrides: {}, sourceStartDate: null, sourceEndDateExclusive: null };
    const payload = localEventGoogleBody(nextLocal, data.timeZone);
    const saved = await client.writeEvent(data.calendarId, event.externalEventId, payload, { etag: event.providerEtag });
    const incoming = normalizeGoogleHistoryEvent(saved, data.timeZone);
    await upsertGoogleEvents(context, data, lease, [incoming], { clock, now: clock() });
    await persistCalendarCredentials(context, ref, lease, data, client.tokens(), secrets.syncToken, clock(), clock, secrets);
    return { updated: true, eventId: body.eventId };
  }, options);
}

async function synchronizeGoogleExports(context, data, client, clock) {
  assertGoogleWriting(data, client);
  const mappings = (await context.db.collection('_calendarExports').where('sourceConnectionId', '==', data.id).limit(101).get()).docs;
  if (mappings.length > 100) failCalendar('CALENDAR_PROVIDER_LIMIT', 409, 'Automatyczny eksport obsługuje do 100 powiązanych wydarzeń w jednym źródle. Pozostałe wydarzenia wymagają osobnego źródła.');
  for (const row of mappings) {
    const mapping = row.data();
    if (mapping.ownerUid !== context.uid) failCalendar('CALENDAR_EVENT_FORBIDDEN', 403, 'Nieprawidłowe przypisanie eksportu.');
    if (mapping.ready !== true) continue;
    let local;
    try { local = await ownedLocalEvent(context, mapping.localEventId); } catch { await context.db.runTransaction(async transaction => { const current = await transaction.get(row.ref); if (current.exists && current.data().ownerUid === context.uid) transaction.update(row.ref, { conflict: true }); }); continue; }
    const remote = await client.event(data.calendarId, mapping.externalEventId);
    const localChanged = calendarEventFingerprint(local.event) !== mapping.localFingerprint, remoteChanged = remote.etag !== mapping.providerEtag;
    if (!localChanged && !remoteChanged) continue;
    if (localChanged && remoteChanged || remote.status === 'cancelled') {
      await context.db.runTransaction(async transaction => { const current = await transaction.get(row.ref); if (current.exists && current.data().ownerUid === context.uid) transaction.update(row.ref, { conflict: true }); }); continue;
    }
    if (localChanged) {
      const written = await client.writeEvent(data.calendarId, mapping.externalEventId, localEventGoogleBody(local.event, data.timeZone), { etag: mapping.providerEtag });
      await context.db.runTransaction(async transaction => { const current = await transaction.get(row.ref); if (current.exists && current.data().ownerUid === context.uid) transaction.update(row.ref, { providerEtag: written.etag, localFingerprint: calendarEventFingerprint(local.event), conflict: false, updatedAt: Timestamp.fromMillis(clock()) }); });
    } else {
      const incoming = normalizeGoogleHistoryEvent(remote, data.timeZone);
      // The manual calendar has its own recurrence editor. Do not silently
      // replace its series with a differently shaped provider rule or lose
      // local series exceptions. An explicit reconciliation is required.
      const expectedRules = localEventGoogleBody(local.event, data.timeZone).recurrence || [];
      if (JSON.stringify(incoming.sourceRecurrence || []) !== JSON.stringify(expectedRules)) {
        await context.db.runTransaction(async transaction => { const current = await transaction.get(row.ref); if (current.exists && current.data().ownerUid === context.uid) transaction.update(row.ref, { conflict: true }); });
        continue;
      }
      await context.db.runTransaction(async transaction => {
        const [fresh, current] = await Promise.all([transaction.get(local.ref), transaction.get(row.ref)]);
        if (!fresh.exists || !current.exists || current.data().ownerUid !== context.uid || calendarEventFingerprint(fresh.data()) !== mapping.localFingerprint) { if (current.exists && current.data().ownerUid === context.uid) transaction.update(row.ref, { conflict: true }); return; }
        const updated = { ...fresh.data(), title: incoming.title, description: incoming.description, location: incoming.location, date: Timestamp.fromMillis(incoming.start), endDate: Timestamp.fromMillis(incoming.end), allDay: incoming.allDay, timeZone: incoming.timeZone, sourceRecurrence: incoming.sourceRecurrence, updatedAt: Timestamp.fromMillis(clock()), updatedBy: context.uid };
        transaction.set(local.ref, updated);
        transaction.update(row.ref, { providerEtag: remote.etag, localFingerprint: calendarEventFingerprint(updated), conflict: false, updatedAt: Timestamp.fromMillis(clock()) });
      });
    }
  }
}
