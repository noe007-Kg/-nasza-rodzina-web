import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { calendarConfiguration, calendarIdentifier, calendarSelection, expectCalendarFields, failCalendar } from './calendar-config.mjs';
import { calendarEncryptionConfigured, decryptCalendarSecrets, encryptCalendarSecrets } from './calendar-secrets.mjs';
import { exchangeGoogleCode, googleAuthorizationUrl, googleCalendarClient } from './calendar-google.mjs';
import { CALENDAR_LEASE_MS, acquireCalendarLease, assertCalendarActor, assertCalendarLease, assertCalendarNotRemoving, assertCalendarSelection, assertOwnedConnection, connectionRef,
  persistCalendarCredentials, releaseCalendarLease, sourceCalendarDocuments, timestampMillis, updateCalendarLease, upsertGoogleEvents } from './calendar-storage.mjs';

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
  selectionConfirmed: data.selectionConfirmed === true, lastSuccessfulSyncAt: iso(data.lastSuccessfulSyncAt), lastAttemptAt: iso(data.lastAttemptAt), lastErrorCode: data.lastErrorCode || null });

export async function startCalendarOAuth(context, body, { now = Date.now() } = {}) {
  expectCalendarFields(body, ['ownerProfileId', 'visibility', 'mode', 'connectionId']);
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
    transaction.set(ref, { ownerUid: context.uid, ...selection, person, ...(body.connectionId ? { connectionId: body.connectionId, expectedConnectionVersion: connection.version } : {}), phase: 'started', nonceHash: digest(nonce), envelope,
      expiresAt: Timestamp.fromMillis(now + OAUTH_TTL_MS), createdAt: Timestamp.fromMillis(now) });
    transaction.set(rateRef, { startedAt: Timestamp.fromMillis(now), stateId: id });
  });
  return { authorizationUrl: googleAuthorizationUrl(config, id, createHash('sha256').update(verifier).digest('base64url')), cookie: calendarOAuthCookie(`${id}.${nonce}`) };
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
    validState(state, body.completionId, cookie, clock(), 'authorized');
    transaction.set(connection, { ...(old || {}), ownerUid: context.uid, provider: 'google', ownerProfileId: state.ownerProfileId, person, visibility: state.visibility, mode: state.mode,
      calendarId: old?.calendarId || 'primary', calendarName: old?.calendarName || 'Google Calendar', selectionConfirmed: false,
      status: 'connected', version: randomUUID(), leaseId: null, leaseExpiresAt: null, lastErrorCode: null,
      removingEvents: false, removalExpiresAt: null,
      envelope: encryptCalendarSecrets({ tokens, syncToken: null }, { uid: context.uid, id, purpose: 'connection' }),
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
      await persistCalendarCredentials(context, ref, lease, data, client.tokens(), secrets.syncToken, clock(), clock).catch(() => {});
    }
    await releaseCalendarLease(context, ref, lease, { now: clock(), errorCode: typeof error?.code === 'string' && error.code.startsWith('CALENDAR_') ? error.code : 'CALENDAR_PROVIDER_UNAVAILABLE' }).catch(() => {});
    throw error;
  } finally { await releaseCalendarLease(context, ref, lease, { now: clock() }).catch(() => {}); }
}
export async function listGoogleCalendars(context, body, options) {
  expectCalendarFields(body, ['connectionId']);
  return withClient(context, body, async (client, data, secrets, lease, ref, clock) => {
    const calendars = await client.calendars(); await persistCalendarCredentials(context, ref, lease, data, client.tokens(), secrets.syncToken, clock(), clock); return { calendars };
  }, options);
}
export async function configureGoogleCalendar(context, body, options) {
  expectCalendarFields(body, ['connectionId', 'calendarId', 'ownerProfileId', 'visibility', 'mode']);
  const selection = calendarSelection(body);
  if (!calendarIdentifier(body.calendarId)) failCalendar('CALENDAR_INVALID_REQUEST', 400, 'Wybierz istniejący kalendarz Google.');
  return withClient(context, body, async (client, data, secrets, lease, ref, clock) => {
    const calendars = await client.calendars(), calendar = calendars.find(row => row.id === body.calendarId || body.calendarId === 'primary' && row.primary);
    if (!calendar) failCalendar('CALENDAR_SOURCE_NOT_FOUND', 403, 'Google nie udostępnia wybranego kalendarza.');
    const envelope = encryptCalendarSecrets({ tokens: client.tokens(), syncToken: data.calendarId === calendar.id ? secrets.syncToken : null }, { uid: context.uid, id: data.id, purpose: 'connection' });
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
        selectionConfirmed: true, lastErrorCode: null, ...(current.calendarId === calendar.id ? {} : { recurringIds: [] }), updatedAt: Timestamp.fromMillis(clock()) });
    });
    return { connectionId: data.id };
  }, options);
}
export async function syncGoogleCalendar(context, body, options) {
  expectCalendarFields(body, ['connectionId']);
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
