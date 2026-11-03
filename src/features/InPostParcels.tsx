import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { familyAction } from '../family-v2-client';
import './inpost.css';

export type Parcel = { number: string; status: string; updatedAt: string | null; locker: string; detailsUrl: string };
type ParcelState = { parcels: Parcel[]; configured: boolean; issue: string; checkedAt: string | null };
const issueText = (issue: string) => issue === 'not-found' ? 'InPost nie udostępnił jeszcze danych jednej z paczek. Sprawdź numer; starsze niż 45 dni przesyłki mogą być niedostępne. Ponowimy odczyt automatycznie.' : 'Statusy mogą być nieaktualne. Ponowimy odczyt automatycznie; szczegóły sprawdzisz w InPost.';
const date = (value: string) => new Date(value).toLocaleString('pl-PL', { timeZone:'Europe/Warsaw', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
function useParcels(uid: string) {
  const [state, setState] = useState<{ uid:string; data:ParcelState | null; error:string }>({ uid, data:null, error:'' });
  useEffect(() => {
    let alive = true, pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try { const data = await familyAction<ParcelState>('parcels', { operation:'state' }); if (alive) setState({ uid, data, error:'' }); }
      catch (e) { if (alive) setState(previous => ({ uid, data:previous.uid === uid ? previous.data : null, error:e instanceof Error ? e.message : 'Nie udało się odczytać paczek.' })); }
      finally { pending = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 300_000);
    window.addEventListener('inpost-changed', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { alive = false; clearInterval(timer); window.removeEventListener('inpost-changed', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [uid]);
  return state.uid === uid ? state : { uid, data:null, error:'' };
}
export function ParcelRows({ parcels }: { parcels:readonly Parcel[] }) {
  return <ul className="inpost-list">{parcels.map(parcel => <li key={parcel.number}><div><strong>•••• {parcel.number.slice(-6)}</strong><span className="inpost-status">{parcel.status}</span></div>{parcel.locker && <small>Punkt odbioru: {parcel.locker}</small>}<small>{parcel.updatedAt ? <>Status z <time dateTime={parcel.updatedAt}>{date(parcel.updatedAt)}</time></> : 'Status niepotwierdzony przez InPost'}</small><a href={parcel.detailsUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`Szczegóły paczki kończącej się na ${parcel.number.slice(-6)}`}>Szczegóły w InPost ↗</a></li>)}</ul>;
}
export function InPostTile({ user }: { user:User }) {
  const { data, error } = useParcels(user.uid);
  if (!data?.parcels.length) return null;
  return <section className="inpost-tile" aria-labelledby="inpost-heading" data-testid="inpost-tile"><header><span aria-hidden="true">📦</span><div><h2 id="inpost-heading">Paczki InPost</h2><p>Aktywne przesyłki w rodzinie: {data.parcels.length}</p></div></header><ParcelRows parcels={data.parcels}/>{(!data.configured || data.issue || error) && <p role="status" className="inpost-notice">{error || (!data.configured ? 'Automatyczne statusy czekają na połączenie API InPost. Szczegóły sprawdzisz pod linkiem.' : issueText(data.issue))}</p>}{data.checkedAt && <small>Ostatnia próba odczytu: {date(data.checkedAt)}</small>}</section>;
}
export function InPostSettings({ user, canManage }: { user:User; canManage:boolean }) {
  const { data, error } = useParcels(user.uid);
  const [number, setNumber] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function change(operation:'add'|'archive', value:string) {
    setBusy(true); setMessage('');
    try { await familyAction('parcels', { operation, number:value }); setNumber(''); setMessage(operation === 'add' ? 'Zapisano paczkę dla rodziny.' : 'Zakończono śledzenie paczki.'); window.dispatchEvent(new Event('inpost-changed')); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Nie udało się zapisać paczki.'); }
    finally { setBusy(false); }
  }
  return <article className="settings-section inpost-settings"><header><span aria-hidden="true">📦</span><div><strong>Paczki InPost</strong><small>Wspólne przesyłki rodziny</small></div></header><p>Statusy aktywnych paczek sprawdzamy co około 15 minut. Przy pustej liście nie odpytujemy InPost. Dodaj numer przesyłki otrzymany od nadawcy. Aktywne paczki pojawią się na stronie Start. Numer i status będą dostępne członkom Twojej rodziny.</p>{canManage && <form onSubmit={e => { e.preventDefault(); void change('add',number.trim()); }}><label htmlFor="inpost-number">Numer przesyłki InPost Polska</label><div><input id="inpost-number" value={number} onChange={e=>setNumber(e.target.value)} inputMode="numeric" pattern="[0-9]{24}" maxLength={24} minLength={24} autoComplete="off" required placeholder="24 cyfry"/><button className="primary-button" type="submit" disabled={busy || !data}>{busy ? 'Zapisuję…' : 'Dodaj paczkę'}</button></div></form>}{data && !data.configured && <p className="inpost-notice">Numery można zapisywać. Automatyczne aktualizacje wymagają skonfigurowania dostępu InPost przez administratora.</p>}{data?.issue && <p role="status">{issueText(data.issue)}</p>}{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}{data?.parcels.length ? <><ParcelRows parcels={data.parcels}/>{canManage && <div className="inpost-archive">{data.parcels.map(p=><button type="button" className="secondary-button" key={p.number} disabled={busy} onClick={()=>void change('archive',p.number)}>Zakończ śledzenie •••• {p.number.slice(-6)}</button>)}</div>}</> : data && <p>Nie śledzicie aktywnych paczek. Kafelek na Start jest ukryty.</p>}</article>;
}
