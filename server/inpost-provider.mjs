import { EduServerError } from './edu-auth.mjs';

export const POLL_MS = 15 * 60_000;
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
// ShipX tracking is public; OAuth credentials are only needed for Global API.
export function providerConfigured() { return true; }
const shipxLabels = {
  created: 'Przygotowana przez nadawcę', confirmed: 'Przygotowana przez nadawcę',
  dispatched_by_sender: 'Nadana', collected_from_sender: 'Odebrana od nadawcy',
  taken_by_courier: 'Odebrana przez kuriera', adopted_at_source_branch: 'W oddziale nadawczym',
  sent_from_source_branch: 'W drodze', adopted_at_sorting_center: 'W sortowni',
  sent_from_sorting_center: 'W drodze', adopted_at_target_branch: 'W oddziale docelowym',
  out_for_delivery: 'W doręczeniu', ready_to_pickup: 'Czeka w paczkomacie lub punkcie odbioru',
  pickup_reminder_sent: 'Przypomnienie o odbiorze', pickup_time_expired: 'Upłynął termin odbioru',
  avizo: 'Oczekuje na odbiór', delivered: 'Odebrana', returned_to_sender: 'Zwrócona do nadawcy',
  canceled: 'Anulowana', claimed: 'Reklamacja przesyłki', other: 'Nowy status przesyłki — sprawdź szczegóły',
};
export function projectShipxParcel(parcel) {
  if (!parcel || typeof parcel.status !== 'string' || !parcel.status) return null;
  const events = (Array.isArray(parcel.tracking_details) ? parcel.tracking_details : [])
    .filter(e => e && typeof e.status === 'string' && Number.isFinite(Date.parse(e.datetime)))
    .sort((a,b) => Date.parse(b.datetime) - Date.parse(a.datetime));
  const timestamp = events.find(e => e.status === parcel.status)?.datetime || parcel.updated_at;
  if (!Number.isFinite(Date.parse(timestamp))) return null;
  const point = parcel.custom_attributes?.target_machine_detail;
  return { statusCode:parcel.status, status:shipxLabels[parcel.status] || 'Nowy status przesyłki — sprawdź szczegóły',
    active:!['delivered','returned_to_sender','canceled'].includes(parcel.status),
    updatedAt:new Date(timestamp).toISOString(),
    locker:typeof point?.name === 'string' ? point.name.slice(0,100) : typeof parcel.custom_attributes?.target_machine_id === 'string' ? parcel.custom_attributes.target_machine_id.slice(0,100) : '' };
}
function retryDelay(response) {
  const value = response.headers.get('retry-after');
  const ms = /^\d+$/.test(value || '') ? Number(value)*1000 : Date.parse(value)-Date.now();
  return Math.min(24*60*60_000, Math.max(POLL_MS, Number.isFinite(ms) ? ms : POLL_MS));
}
async function fetchShipxTracking(numbers, fetcher) {
  const updates = {}; let unavailable = '', retryMs = 0;
  const issueRank = { '':0, 'not-found':1, provider:2, 'rate-limit':3 };
  const recordIssue = issue => { if (issueRank[issue] > issueRank[unavailable]) unavailable = issue; };
  // At most 20 requests, five at a time, keeping a family refresh below 40s.
  for (let start=0; start<numbers.length; start+=5) {
    await Promise.all(numbers.slice(start,start+5).map(async number => {
      try {
        const response = await fetcher(`https://api-shipx-pl.easypack24.net/v1/tracking/${number}`, {
          redirect:'error', signal:AbortSignal.timeout(8_000), headers:{ Accept:'application/json' },
        });
        if (!response.ok) {
          const issue = response.status === 404 ? 'not-found' : response.status === 429 ? 'rate-limit' : 'provider';
          recordIssue(issue);
          retryMs = Math.max(retryMs,retryDelay(response)); return;
        }
        const data = await response.json();
        const update = data?.tracking_number === number ? projectShipxParcel(data) : null;
        if (update) updates[number] = update; else recordIssue('provider');
      } catch { recordIssue('provider'); }
    }));
    if (unavailable === 'rate-limit') break;
  }
  return { updates, ...(unavailable ? { unavailable, retryMs } : {}) };
}
/** Bounded server-side tracking; no credentials or raw recipient data leave this module. */
export async function fetchTracking(numbers, { env = process.env, fetcher = fetch } = {}) {
  numbers = [...new Set(numbers.map(trackingNumber))];
  if (numbers.length > 20) throw new EduServerError('PARCEL_LIMIT',400,'Możesz śledzić maksymalnie 20 aktywnych paczek.');
  if (!env.INPOST_CLIENT_ID || !env.INPOST_CLIENT_SECRET) return fetchShipxTracking(numbers,fetcher);
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
