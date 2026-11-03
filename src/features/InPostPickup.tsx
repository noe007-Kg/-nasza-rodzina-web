import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '../app-shared';
import { familyAction } from '../family-v2-client';
import { pickupImage } from './inpost-pickup-image';

export type Pickup = { code:string; phone:string; note:string; qr:string };
export const emptyPickup: Pickup = {code:'',phone:'',note:'',qr:''};
export function PickupViewer({ pickup, number, onClose }: { pickup:Pickup; number:string; onClose:()=>void }) {
  return createPortal(<Modal title="Odbiór paczki" subtitle={`Paczka •••• ${number.slice(-6)}`} onClose={onClose}>
    <div className="inpost-pickup-view">
      {pickup.code && <div className="inpost-pickup-code"><span>Kod odbioru</span><strong>{pickup.code}</strong></div>}
      {pickup.phone && <p>Telefon do odbioru: <strong>{pickup.phone}</strong></p>}
      {pickup.note && <p className="inpost-pickup-note">{pickup.note}</p>}
      {pickup.qr && <><img className="inpost-qr-full" src={pickup.qr} alt="Kod QR do odbioru paczki"/><p>Pokaż zapisany kod QR czytnikowi Paczkomatu.</p></>}
      {!pickup.qr && <p>Na ekranie Paczkomatu wybierz odbiór i podaj telefon odbiorcy oraz kod otrzymany od InPost.</p>}
    </div>
  </Modal>,document.body);
}
export function PickupEditor({ pickup, number, onClose }: { pickup:Pickup; number:string; onClose:()=>void }) {
  const [form,setForm]=useState(pickup),[busy,setBusy]=useState(false),[preparing,setPreparing]=useState(false),[error,setError]=useState('');
  const sequence=useRef(0);const id=useId();
  async function image(file:File) {
    const current=++sequence.current;setPreparing(true);setError('');
    try { const qr=await pickupImage(file);if(current===sequence.current)setForm(previous=>({...previous,qr})); }
    catch(e) { if(current===sequence.current)setError(e instanceof Error?e.message:'Nie udało się przygotować zdjęcia.'); }
    finally { if(current===sequence.current)setPreparing(false); }
  }
  async function save() {
    setBusy(true);setError('');
    try { await familyAction('parcels',{operation:'pickup',number,pickup:form});window.dispatchEvent(new Event('inpost-changed'));onClose(); }
    catch(e) { setError(e instanceof Error?e.message:'Nie udało się zapisać danych odbioru.'); }
    finally { setBusy(false); }
  }
  return createPortal(<Modal title="Kod odbioru, QR i notatka" subtitle={`Paczka •••• ${number.slice(-6)}`} onClose={()=>{if(!busy)onClose();}}>
    <form className="inpost-pickup-form" onSubmit={e=>{e.preventDefault();if(!preparing&&!busy)void save();}}>
      <p>Dane będą dostępne zalogowanym członkom Twojej rodziny. Przepisz kod lub dodaj zdjęcie otrzymane od InPost.</p>
      <label htmlFor={`${id}-code`}>Kod odbioru (6 cyfr)</label><input id={`${id}-code`} value={form.code} onChange={e=>setForm({...form,code:e.target.value.replace(/\D/g,'').slice(0,6)})} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="off" disabled={busy}/>
      <label htmlFor={`${id}-phone`}>Telefon do odbioru (opcjonalnie, 9 cyfr)</label><input id={`${id}-phone`} type="tel" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value.replace(/\D/g,'').slice(0,9)})} inputMode="tel" pattern="[0-9]{9}" maxLength={9} autoComplete="off" disabled={busy}/>
      <label htmlFor={`${id}-note`}>Notatka do paczki</label><textarea id={`${id}-note`} value={form.note} onChange={e=>setForm({...form,note:e.target.value})} maxLength={600} rows={3} placeholder="Np. buty dla Pawła, odbiera Dominika" disabled={busy}/>
      <label htmlFor={`${id}-qr`}>Zdjęcie kodu QR (opcjonalnie)</label><input id={`${id}-qr`} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy||preparing} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void image(file);}}/>
      {preparing && <p role="status">Przygotowuję zdjęcie…</p>}
      {form.qr && <div className="inpost-qr-editor"><img src={form.qr} alt="Podgląd dodanego kodu QR"/><button type="button" disabled={busy||preparing} onClick={()=>setForm({...form,qr:''})}>Usuń zdjęcie QR</button></div>}
      {error && <p role="alert">{error}</p>}
      <div className="inpost-pickup-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Anuluj</button><button type="submit" className="primary-button" disabled={busy||preparing}>{busy?'Zapisuję…':'Zapisz dane odbioru'}</button></div>
    </form>
  </Modal>,document.body);
}
