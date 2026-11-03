import { EduServerError } from './edu-auth.mjs';

export const POLL_MS = 3 * 60 * 60_000;
export function trackingNumber(value) {
  if (typeof value !== 'string' || !/^[0-9]{24}$/.test(value.trim())) throw new EduServerError('PARCEL_NUMBER', 400, 'Podaj 24-cyfrowy numer przesyłki InPost Polska.');
  return value.trim();
}
const labels = { 'CRE.1001': 'Przygotowana przez nadawcę', 'FMD.1001': 'Nadana', 'FMD.1002': 'Odebrana przez kuriera', 'MMD.1001': 'W sortowni', 'MMD.1004': 'W drodze', 'LMD.1001': 'W doręczeniu', 'LMD.1004': 'Czeka w punkcie odbioru', 'LMD.1005': 'Czeka w paczkomacie', 'LMD.9001': 'Przypomnienie o odbiorze', 'LMD.9002': 'Upłynął termin odbioru', 'LMD.9013': 'Czeka w punkcie obsługi', 'RTS.1001': 'Wraca do nadawcy', 'RTS.1002': 'Zwrócona do nadawcy', 'EOL.1001': 'Dostarczona', 'EOL.1002': 'Odebrana', 'EOL.9004': 'Anulowana', 'INF.9001': 'Opóźnienie dostawy' };
export function projectParcel(parcel) {
  const events = (Array.isArray(parcel.events) ? parcel.events : []).filter(e => typeof e.eventCode === 'string' && Number.isFinite(Date.parse(e.eventTimestamp))).sort((a,b) => Date.parse(b.eventTimestamp)-Date.parse(a.eventTimestamp));
  if (!events.length) return null;
  const event = events[0], code = event.eventCode;
  const destination = parcel.destination;
  return { statusCode: code, status: labels[code] || (code.startsWith('EOL.') ? 'Obsługa przesyłki zakończona' : 'Nowy status przesyłki — sprawdź szczegóły'),
    active: !code.startsWith('EOL.') && code !== 'RTS.1002', updatedAt: new Date(event.eventTimestamp).toISOString(),
    locker: ['LOCKER_POINT','PUDO_POINT'].includes(destination?.type) && typeof destination.name === 'string' ? destination.name.slice(0,100) : '' };
}
export function providerConfigured(env) { return !!(env.INPOST_CLIENT_ID && env.INPOST_CLIENT_SECRET); }
/** One token and one bounded tracking request per family refresh; no client secrets or raw recipient data leave this module. */
export async function fetchTracking(numbers, { env = process.env, fetcher = fetch } = {}) {
  if (!providerConfigured(env)) return { unavailable: 'not-configured' };
  const host = env.INPOST_ENVIRONMENT === 'stage' ? 'https://stage-api.inpost-group.com' : 'https://api.inpost-group.com';
  const options = { redirect: 'error', signal: AbortSignal.timeout(12_000) };
  const auth = await fetcher(`${host}/oauth2/token`, { ...options, method:'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type:'client_credentials', scope:'api:tracking:read', client_id:env.INPOST_CLIENT_ID, client_secret:env.INPOST_CLIENT_SECRET }) });
  if (!auth.ok) return { unavailable: 'authorization', retryMs: 60 * 60_000 };
  const token = await auth.json();
  if (typeof token.access_token !== 'string') return { unavailable:'authorization', retryMs:60*60_000 };
  const updates = {};
  for (let start=0; start<numbers.length; start+=10) {
    const url = new URL(`${host}/tracking/v1/parcels`);
    numbers.slice(start,start+10).forEach(number => url.searchParams.append('trackingNumbers', number));
    const response = await fetcher(url, { ...options, signal:AbortSignal.timeout(12_000), headers:{ Authorization:`Bearer ${token.access_token}`, Accept:'application/json', 'x-inpost-event-version':'V1' } });
    if (!response.ok) {
      const retry = response.headers.get('retry-after');
      const seconds = /^\d+$/.test(retry || '') ? Number(retry) : (Date.parse(retry)-Date.now())/1000;
      return { unavailable: response.status === 429 ? 'rate-limit' : response.status === 403 ? 'authorization' : 'provider', retryMs:Math.min(24*60*60_000, Math.max(POLL_MS, Number.isFinite(seconds) ? seconds*1000 : POLL_MS)) };
    }
    const data = await response.json();
    if (!Array.isArray(data.parcels)) return { unavailable:'provider' };
    for (const parcel of data.parcels) if (numbers.includes(parcel.trackingNumber)) { const update = projectParcel(parcel); if (update) updates[parcel.trackingNumber] = update; }
  }
  return { updates };
}
