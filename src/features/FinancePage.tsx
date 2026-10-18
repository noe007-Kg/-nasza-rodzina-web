import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { isParent, Modal, type Member, type User } from '../app-shared';
import { useFamilyDirectory } from '../family-directory';
import { memberCanLogin } from '../family-members';
import { familyV2WritesAllowed } from '../family-v2-client';
import { Card, Icon, PrimaryButton, SecondaryButton, SectionHeader, StatusPill } from '../ui';
import { financeAction } from '../finance/finance-api';
import { FINANCE_CATEGORIES, FINANCE_RECURRENCES, financeAmountGrosze, financeAmountInput, financeBillStatus,
  financeCategoryTotals, financeDateValid, financeHouseholdConfigured, financeMonthLabel, financeToday, financeTotals, formatFinanceDate, formatFinanceMoney,
  safeFinancePaymentUrl, type FinanceBill, type FinanceBillFields, type FinanceRecurrence } from '../finance/model';
import { useFinanceBills } from '../finance/useFinanceBills';
import './finance.css';

type FinanceForm = Omit<FinanceBillFields, 'amountGrosze'> & { amount: string };
type BillFilter = 'all' | 'unpaid' | 'paid' | 'overdue';
const emptyForm = (): FinanceForm => ({ title: '', category: 'Inne', amount: '', dueDate: financeToday(), recipient: '', bankAccount: '',
  transferTitle: '', note: '', paymentUrl: '', recurrence: 'none', calendarEnabled: false, sharedWith: [] });
const fieldsFromBill = (bill: FinanceBill): FinanceBillFields => ({ title: bill.title, category: bill.category, amountGrosze: bill.amountGrosze,
  dueDate: bill.dueDate, recipient: bill.recipient, bankAccount: bill.bankAccount, transferTitle: bill.transferTitle, note: bill.note,
  paymentUrl: bill.paymentUrl, recurrence: bill.recurrence, calendarEnabled: bill.calendarEnabled, sharedWith: [...bill.sharedWith] });

function useWideFinancePanel() {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1200px)').matches);
  useEffect(() => { const query = window.matchMedia('(min-width: 1200px)'); const update = () => setWide(query.matches);
    update(); query.addEventListener('change', update); return () => query.removeEventListener('change', update); }, []);
  return wide;
}

export function FinancePage({ user, member }: { user: User; member: Member | null }) {
  const parent = isParent(member);
  const accessScope = JSON.stringify([user.uid, member?.role, member?.active, member?.archived, member?.canLogin,
    member?.disabled, member?.familyId]);
  const directory = useFamilyDirectory();
  const children = directory.filter(profile => financeHouseholdConfigured(member?.familyId) && profile.familyId === member.familyId
    && profile.role === 'child' && memberCanLogin(profile) && !profile.id.startsWith('legacy:'));
  const householdConfigured = financeHouseholdConfigured(member?.familyId);
  const source = useFinanceBills(user.uid, accessScope, householdConfigured);
  const bills = source.data?.bills || [];
  const writesEnabled = parent && source.data?.writesEnabled === true && familyV2WritesAllowed();
  const widePanel = useWideFinancePanel();
  const [month, setMonth] = useState(() => financeToday().slice(0, 7));
  const [filter, setFilter] = useState<BillFilter>('all');
  const [selection, setSelection] = useState<{ scope: string; id: string } | null>(null);
  const selected = selection?.scope === accessScope ? bills.find(bill => bill.id === selection.id) || null : null;
  const [formState, setFormState] = useState<{ scope: string; id: string; editing: boolean; fields: FinanceForm } | null>(null);
  const currentForm = formState?.scope === accessScope ? formState : null;
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [feedback, setFeedback] = useState<{ scope: string; text: string; error: boolean } | null>(null);
  const currentFeedback = feedback?.scope === accessScope ? feedback : null;
  const [today, setToday] = useState(financeToday);
  useEffect(() => { const timer = window.setInterval(() => setToday(financeToday()), 60000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { setSelection(null); setFormState(null); setFeedback(null); setMonth(financeToday().slice(0, 7)); setFilter('all'); }, [accessScope]);
  const months = useMemo(() => [...new Set([financeToday().slice(0, 7), ...bills.map(bill => bill.dueDate.slice(0, 7))])].sort().reverse(), [bills]);
  const monthlyBills = useMemo(() => bills.filter(bill => month === 'all' || bill.dueDate.startsWith(month)), [bills, month]);
  const totals = useMemo(() => financeTotals(monthlyBills), [monthlyBills]);
  const categoryTotals = useMemo(() => financeCategoryTotals(monthlyBills), [monthlyBills]);
  const overdue = monthlyBills.filter(bill => financeBillStatus(bill, today).key === 'overdue');
  const visible = monthlyBills.filter(bill => filter === 'all' || (filter === 'unpaid' ? bill.status === 'unpaid' : financeBillStatus(bill, today).key === filter))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title, 'pl'));
  const history = [...monthlyBills].sort((a, b) => b.dueDate.localeCompare(a.dueDate) || a.title.localeCompare(b.title, 'pl'));

  function message(text: string, error = false) { setFeedback({ scope: accessScope, text, error }); }
  function openNew() { setFeedback(null); setFormState({ scope: accessScope, id: crypto.randomUUID(), editing: false, fields: emptyForm() }); }
  function openEdit(bill: FinanceBill) { if (!parent || bill.status === 'paid') return; setFeedback(null);
    const { amountGrosze, ...fields } = fieldsFromBill(bill);
    setFormState({ scope: accessScope, id: bill.id, editing: true, fields: { ...fields, amount: financeAmountInput(amountGrosze) } }); }
  function changeForm(patch: Partial<FinanceForm>) { setFormState(previous => previous?.scope === accessScope ? { ...previous, fields: { ...previous.fields, ...patch } } : previous); }

  async function mutate(body: Record<string, unknown>, success: string) {
    if (!writesEnabled || busyRef.current) return false;
    busyRef.current = true; setBusy(true); setFeedback(null);
    try { await financeAction(body); await source.refresh(); message(success); return true; }
    catch (value) { message(value instanceof Error ? value.message : 'Nie udało się zapisać opłaty. Spróbuj ponownie.', true); return false; }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function saveForm(event: FormEvent) {
    event.preventDefault(); if (!currentForm || !writesEnabled || busyRef.current) return;
    const amountGrosze = financeAmountGrosze(currentForm.fields.amount);
    if (amountGrosze === null) { message('Wpisz dodatnią kwotę w PLN, z maksymalnie dwoma miejscami po przecinku.', true); return; }
    if (!financeDateValid(currentForm.fields.dueDate)) { message('Wpisz prawidłowy termin płatności.', true); return; }
    if (currentForm.fields.paymentUrl && !safeFinancePaymentUrl(currentForm.fields.paymentUrl)) { message('Link do płatności musi prowadzić do bezpiecznej strony HTTPS.', true); return; }
    const { amount: _amount, ...fields } = currentForm.fields;
    if (await mutate({ action: 'save', id: currentForm.id, ...fields, amountGrosze }, '✓ Opłata została zapisana.')) {
      setSelection({ scope: accessScope, id: currentForm.id }); setMonth(fields.dueDate.slice(0, 7)); setFilter('all'); setFormState(null);
    }
  }
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); message(`Skopiowano ${label}.`); }
    catch { message('Nie udało się skopiować. Możesz zaznaczyć i skopiować widoczną wartość.', true); }
  }
  async function changeCalendar(bill: FinanceBill, enabled: boolean) {
    await mutate({ action: 'save', id: bill.id, ...fieldsFromBill(bill), calendarEnabled: enabled }, enabled ? 'Termin jest widoczny wyłącznie w kalendarzach osób uprawnionych do tej opłaty.' : 'Usunięto termin z widoku kalendarza.');
  }

  const detail = selected && <div className="finance-detail-content" data-testid="finance-bill-detail">
    <div className="finance-detail-heading"><span className="finance-category-icon"><Icon name="document" size={27}/></span><div><h2>{selected.title}</h2><p>{selected.category}</p></div><strong>{formatFinanceMoney(selected.amountGrosze)}</strong></div>
    <div className="finance-detail-status"><span><Icon name="calendar" size={19}/> Termin płatności</span><strong>{formatFinanceDate(selected.dueDate)}</strong><FinanceStatus bill={selected} today={today}/></div>
    <dl className="finance-detail-fields">
      {selected.recipient && <div><dt><Icon name="users" size={19}/> Odbiorca</dt><dd>{selected.recipient}</dd></div>}
      {selected.bankAccount && <div><dt><Icon name="document" size={19}/> Numer rachunku</dt><dd><span className="finance-copy-value">{selected.bankAccount}</span><SecondaryButton onClick={() => void copy(selected.bankAccount, 'numer rachunku')}>Kopiuj numer</SecondaryButton></dd></div>}
      {selected.transferTitle && <div><dt><Icon name="document" size={19}/> Tytuł przelewu</dt><dd><span className="finance-copy-value">{selected.transferTitle}</span><SecondaryButton onClick={() => void copy(selected.transferTitle, 'tytuł przelewu')}>Kopiuj tytuł</SecondaryButton></dd></div>}
      {safeFinancePaymentUrl(selected.paymentUrl) && <div><dt><Icon name="link" size={19}/> Strona płatności</dt><dd><a className="finance-payment-link" href={safeFinancePaymentUrl(selected.paymentUrl)!} target="_blank" rel="noopener noreferrer">Otwórz link <Icon name="arrow-right" size={17}/></a><small>Otwiera zewnętrzną stronę. Aplikacja nie wykonuje przelewu.</small></dd></div>}
      {selected.note && <div><dt><Icon name="message" size={19}/> Notatka</dt><dd className="finance-note-text">{selected.note}</dd></div>}
      <div><dt><Icon name="refresh" size={19}/> Powtarzanie</dt><dd>{FINANCE_RECURRENCES[selected.recurrence]}{parent && selected.recurrence !== 'none' && <small>Każdy okres ma własną kwotę i status. Udostępnienie dziecku ustawiasz osobno dla każdego okresu.</small>}</dd></div>
      {selected.paidAt && <div><dt><Icon name="check" size={19}/> Oznaczono jako opłacone</dt><dd>{formatPaidAt(selected.paidAt)}</dd></div>}
    </dl>
    {parent && <div className="finance-detail-options">
      <label className="finance-calendar-choice"><Icon name="calendar" size={23}/><span><strong>Dodaj do kalendarza</strong><small>Tylko dla osób uprawnionych. Nie pojawi się w widoku „Cała rodzina”.</small></span><input type="checkbox" checked={selected.calendarEnabled} disabled={!writesEnabled || busy || selected.status === 'paid'} onChange={event => void changeCalendar(selected, event.target.checked)}/></label>
      <div className="finance-sharing-summary"><Icon name="shield" size={23}/><div><strong>Widoczność tej opłaty</strong><small>{selected.sharedWith.length === 0 ? 'Tylko uprawnieni rodzice.' : `Rodzice oraz: ${selected.sharedWith.map(uid => children.find(profile => profile.id === uid)?.name || 'udostępniona osoba').join(', ')}.`}</small><small>Udostępnienie zmienisz w edycji tej konkretnej opłaty.</small></div></div>
    </div>}
    {currentFeedback && !currentForm && <p className={`finance-feedback ${currentFeedback.error ? 'is-error' : ''}`} role={currentFeedback.error ? 'alert' : 'status'}>{currentFeedback.text}</p>}
    {parent && <div className="finance-detail-actions">
      {selected.status !== 'paid' && <><PrimaryButton icon="check" disabled={!writesEnabled || busy} onClick={() => void mutate({ action: 'markPaid', billId: selected.id }, '✓ Opłata oznaczona jako opłacona. Przypomnienia tego terminu zakończone.')}>Oznacz jako opłacone</PrimaryButton><SecondaryButton disabled={busy} onClick={() => openEdit(selected)}>Edytuj opłatę</SecondaryButton></>}
      {selected.recurrence !== 'none' && <SecondaryButton icon="refresh" disabled={!writesEnabled || busy} onClick={() => void mutate({ action: 'generatePeriods', billId: selected.id, count: 2 }, 'Przygotowano dwa kolejne okresy. Ich statusy są niezależne.')}>Utwórz dwa kolejne okresy</SecondaryButton>}
      {selected.status === 'paid' && <p className="finance-paid-note"><Icon name="check" size={18}/> Opłacony okres pozostaje w historii; nie zmienia statusu kolejnych okresów.</p>}
    </div>}
  </div>;

  return <div className="page-content family-ui finance-page" data-testid="finance-page">
    <SectionHeader title={parent ? 'Finanse' : 'Udostępnione opłaty'} icon="document" description={parent ? 'Opłaty, terminy i historia domowych rachunków.' : 'Widzisz wyłącznie opłaty udostępnione bezpośrednio Tobie.'}
      actions={parent ? <PrimaryButton icon="plus" onClick={openNew}>Dodaj opłatę</PrimaryButton> : undefined}/>
    {parent && !writesEnabled && !source.loading && <p className="finance-access-note" role="status">{source.data ? 'Wersja Preview: zapis nowych opłat i zmian statusu jest wyłączony. Możesz obejrzeć formularz.' : 'Finanse wymagają przygotowanego backendu i reguł dostępu. Istniejące dane pozostają bez zmian.'}</p>}
    {!householdConfigured && <p className="finance-access-note" role="alert">Finanse wymagają zweryfikowanego przypisania konta do gospodarstwa. Administrator musi uzupełnić konfigurację rodziny. Dane nie zostały zmienione.</p>}
    {source.error && <div className="finance-access-note" role="alert"><span>{source.error}</span><SecondaryButton icon="refresh" disabled={source.loading} onClick={() => void source.refresh().catch(() => {})}>Spróbuj ponownie</SecondaryButton></div>}
    {currentFeedback && !currentForm && !selected && <p className={`finance-feedback ${currentFeedback.error ? 'is-error' : ''}`} role={currentFeedback.error ? 'alert' : 'status'}>{currentFeedback.text}</p>}
    <div className="finance-period-toolbar"><label>Okres <select aria-label="Okres historii opłat" value={month} onChange={event => setMonth(event.target.value)}>{months.map(value => <option key={value} value={value}>{financeMonthLabel(value)}</option>)}<option value="all">Cała historia</option></select></label><small>Daty terminów: Europe/Warsaw</small></div>
    <section className="finance-summary" aria-label="Podsumowanie opłat wybranego okresu">
      <Card tone="rose"><span>Do zapłaty</span><strong>{formatFinanceMoney(totals.unpaidGrosze)}</strong><small>{monthlyBills.filter(bill => bill.status !== 'paid').length} opłat</small></Card>
      <Card tone="gold"><span>Po terminie</span><strong>{formatFinanceMoney(financeTotals(overdue).unpaidGrosze)}</strong><small>{overdue.length} opłat</small></Card>
      <Card tone="mint"><span>Opłacone</span><strong>{formatFinanceMoney(totals.paidGrosze)}</strong><small>{monthlyBills.filter(bill => bill.status === 'paid').length} opłat</small></Card>
    </section>
    <div className={`finance-layout ${selected && widePanel ? 'has-detail' : ''}`}>
      <Card as="section" className="finance-list-panel">
        <div className="finance-list-header"><h2>Lista opłat</h2><span>{financeMonthLabel(month)}</span></div>
        <div className="finance-tabs" role="group" aria-label="Filtr opłat">{(['all', 'unpaid', 'paid', 'overdue'] as const).map(value => <button type="button" key={value} aria-pressed={filter === value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{({ all: 'Wszystkie', unpaid: 'Do zapłaty', paid: 'Opłacone', overdue: 'Po terminie' })[value]}</button>)}</div>
        {source.loading && !source.data ? <p className="finance-empty" role="status">Wczytuję opłaty…</p> : visible.length === 0 ? <div className="finance-empty"><Icon name="document" size={34}/><strong>{bills.length ? 'Brak opłat w wybranym widoku.' : parent ? 'Nie dodano jeszcze opłat.' : 'Nie udostępniono Ci żadnej opłaty.'}</strong><p>{parent && !bills.length ? 'Dodaj pierwszy rachunek. Jego dane będą widoczne tylko dla uprawnionych rodziców.' : 'Możesz zmienić wybrany okres lub filtr.'}</p></div> :
          <ul className="finance-bill-list">{visible.map(bill => <li key={bill.id}><button type="button" className={`finance-bill-row ${selected?.id === bill.id ? 'is-selected' : ''}`} onClick={() => setSelection({ scope: accessScope, id: bill.id })} aria-label={`${bill.title}, ${formatFinanceMoney(bill.amountGrosze)}, ${formatFinanceDate(bill.dueDate)}`}>
            <span className="finance-category-icon"><Icon name="document" size={24}/></span><span className="finance-row-title"><strong>{bill.title}</strong><small>{bill.category}{bill.recurrence !== 'none' ? ` · ${FINANCE_RECURRENCES[bill.recurrence]}` : ''}</small></span><span className="finance-row-due">{formatFinanceDate(bill.dueDate, true)}</span><strong className="finance-row-amount">{formatFinanceMoney(bill.amountGrosze)}</strong><FinanceStatus bill={bill} today={today}/><Icon name="chevron-right" size={17}/>
          </button></li>)}</ul>}
      </Card>
      {selected && widePanel && <Card as="section" className="finance-detail-panel" aria-label="Szczegóły opłaty"><div className="finance-panel-top"><strong>Szczegóły opłaty</strong><button type="button" aria-label="Zamknij szczegóły opłaty" onClick={() => setSelection(null)}><Icon name="close" size={22}/></button></div>{detail}</Card>}
    </div>
    {history.length > 0 && <details className="finance-history"><summary>Historia opłat · {financeMonthLabel(month)}</summary><p>Zapłacone: <strong>{formatFinanceMoney(totals.paidGrosze)}</strong> · Niezapłacone: <strong>{formatFinanceMoney(totals.unpaidGrosze)}</strong></p><div className="finance-history-scroll"><table className="finance-category-totals"><caption>Podsumowanie według kategorii</caption><thead><tr><th>Kategoria</th><th>Zapłacone</th><th>Niezapłacone</th><th>Razem</th></tr></thead><tbody>{categoryTotals.map(category => <tr key={category.category}><td>{category.category}</td><td>{formatFinanceMoney(category.paidGrosze)}</td><td>{formatFinanceMoney(category.unpaidGrosze)}</td><td>{formatFinanceMoney(category.totalGrosze)}</td></tr>)}</tbody></table><table><caption>Historia terminów i płatności</caption><thead><tr><th>Opłata / kategoria</th><th>Termin</th><th>Kwota</th><th>Status</th><th>Data oznaczenia opłacenia</th></tr></thead><tbody>{history.map(bill => <tr key={bill.id}><td>{bill.title}<small>{bill.category}</small></td><td>{formatFinanceDate(bill.dueDate, true)}</td><td>{formatFinanceMoney(bill.amountGrosze)}</td><td>{financeBillStatus(bill, today).label}</td><td>{bill.paidAt ? formatPaidAt(bill.paidAt) : '—'}</td></tr>)}</tbody></table></div></details>}
    {selected && !widePanel && !currentForm && <Modal title="Szczegóły opłaty" onClose={() => setSelection(null)} wide>{detail}</Modal>}
    {currentForm && parent && <Modal title={currentForm.editing ? 'Edytuj opłatę' : 'Nowa opłata'} wide onClose={() => { if (!busy) setFormState(null); }}><form className="form-grid finance-form" onSubmit={event => void saveForm(event)}>
      <fieldset className="finance-form-fields field-wide" disabled={busy}>
        <label className="field field-wide"><span>Nazwa opłaty</span><input required maxLength={200} value={currentForm.fields.title} onChange={event => changeForm({ title: event.target.value })}/></label>
        <label className="field"><span>Kategoria</span><input list="finance-categories" required maxLength={80} value={currentForm.fields.category} onChange={event => changeForm({ category: event.target.value })}/><datalist id="finance-categories">{FINANCE_CATEGORIES.map(category => <option value={category} key={category}/>)}</datalist></label>
        <label className="field"><span>Kwota w PLN</span><input required inputMode="decimal" placeholder="0,00" maxLength={12} value={currentForm.fields.amount} onChange={event => changeForm({ amount: event.target.value })}/></label>
        <label className="field"><span>Termin płatności</span><input type="date" required value={currentForm.fields.dueDate} onChange={event => changeForm({ dueDate: event.target.value })}/></label>
        <label className="field"><span>Powtarzanie</span><select disabled={currentForm.editing} value={currentForm.fields.recurrence} onChange={event => changeForm({ recurrence: event.target.value as FinanceRecurrence })}>{Object.entries(FINANCE_RECURRENCES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{currentForm.editing && <small>Częstotliwość dotyczy całej serii. Inną częstotliwość ustaw w nowej opłacie.</small>}</label>
        <label className="field field-wide"><span>Odbiorca — opcjonalnie</span><input maxLength={300} value={currentForm.fields.recipient} onChange={event => changeForm({ recipient: event.target.value })}/></label>
        <label className="field field-wide"><span>Numer rachunku — opcjonalnie</span><input maxLength={80} value={currentForm.fields.bankAccount} onChange={event => changeForm({ bankAccount: event.target.value })}/></label>
        <label className="field field-wide"><span>Tytuł przelewu — opcjonalnie</span><input maxLength={300} value={currentForm.fields.transferTitle} onChange={event => changeForm({ transferTitle: event.target.value })}/></label>
        <label className="field field-wide"><span>Oficjalny link do płatności HTTPS — opcjonalnie</span><input type="url" placeholder="https://" maxLength={2000} value={currentForm.fields.paymentUrl} onChange={event => changeForm({ paymentUrl: event.target.value })}/></label>
        <label className="field field-wide"><span>Notatka — opcjonalnie</span><textarea rows={3} maxLength={4000} value={currentForm.fields.note} onChange={event => changeForm({ note: event.target.value })}/></label>
        <label className="checkbox-field field-wide"><input type="checkbox" checked={currentForm.fields.calendarEnabled} onChange={event => changeForm({ calendarEnabled: event.target.checked })}/><span>Dodaj termin do kalendarzy osób uprawnionych do tej opłaty</span></label>
        <div className="finance-form-sharing field-wide"><strong>Widoczność tej konkretnej opłaty</strong><p>Domyślnie: tylko uprawnieni rodzice. Udostępnienie opłaty nie daje dostępu do pozostałych finansów.</p>{children.map(profile => <label className="checkbox-field" key={profile.id}><input type="checkbox" checked={currentForm.fields.sharedWith.includes(profile.id)} onChange={event => changeForm({ sharedWith: event.target.checked ? [...currentForm.fields.sharedWith, profile.id] : currentForm.fields.sharedWith.filter(uid => uid !== profile.id) })}/><span>Udostępnij: {profile.name || profile.personKey}</span></label>)}{children.length === 0 && <small>Brak aktywnych kont dzieci, którym można udostępnić opłatę.</small>}</div>
      </fieldset>
      {currentFeedback && <p className="field-wide finance-feedback is-error" role="alert">{currentFeedback.text}</p>}
      {!writesEnabled && <p className="finance-access-note field-wide" role="status">Podgląd formularza — zapis jest wyłączony do przygotowania bezpiecznego backendu.</p>}
      <div className="form-actions field-wide"><SecondaryButton disabled={busy} onClick={() => setFormState(null)}>Anuluj</SecondaryButton><PrimaryButton type="submit" disabled={!writesEnabled || busy}>{busy ? 'Zapisuję…' : 'Zapisz opłatę'}</PrimaryButton></div>
    </form></Modal>}
  </div>;
}

function FinanceStatus({ bill, today }: { bill: FinanceBill; today: string }) {
  const status = financeBillStatus(bill, today); return <StatusPill tone={status.tone}>{status.label}</StatusPill>;
}
function formatPaidAt(value: string) { const date = new Date(value); return Number.isFinite(date.getTime())
  ? new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date) : '—'; }
