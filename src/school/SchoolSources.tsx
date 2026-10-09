import { useState } from 'react';
import { Card, Icon, SecondaryButton, StatusPill } from '../ui';
import './school-sources.css';

export type SchoolSourceView = 'sp4' | 'fryderyk';

/** Provider choices do not assign a school to a profile or create a connection. */
export function SchoolSourceSelector({ value, onChange }: { value: SchoolSourceView; onChange: (source: SchoolSourceView) => void }) {
  return <div className="school-source-selector" role="group" aria-label="Źródło szkolne" data-testid="school-source-selector">
    <button type="button" aria-pressed={value === 'sp4'} onClick={() => onChange('sp4')}><Icon name="school"/><span><strong>SP4 — eduVULCAN</strong><small>Szkoła podstawowa</small></span></button>
    <button type="button" aria-pressed={value === 'fryderyk'} onClick={() => onChange('fryderyk')}><span className="school-music-symbol" aria-hidden="true">🎵</span><span><strong>Fryderyk</strong><small>Szkoła muzyczna · niepołączono</small></span></button>
  </div>;
}

const sections = [
  { id: 'plan', title: 'Plan zajęć', text: 'Plan zajęć pojawi się po uruchomieniu i połączeniu integracji.' },
  { id: 'announcements', title: 'Ogłoszenia', text: 'Ogłoszenia nie zostały jeszcze pobrane z Fryderyka.' },
  { id: 'messages', title: 'Wiadomości', text: 'Skrzynka Fryderyka nie jest jeszcze połączona.' },
  { id: 'absence', title: 'Nieobecności', text: 'Informacje o nieobecnościach nie zostały jeszcze pobrane.' },
] as const;

/** Preparation only: no provider requests, credentials, timers or fake records. */
export function FryderykPreparation({ student, parent, onBack }: { student: string; parent: boolean; onBack: () => void }) {
  const [selected, setSelected] = useState<string>('plan');
  const available = sections.filter(section => parent || section.id !== 'messages');
  const section = available.find(item => item.id === selected) || available[0];
  return <section className="fryderyk-preparation" data-testid="fryderyk-preparation" aria-label={`Fryderyk: ${student}`}>
    <Card as="section" tone="violet" className="fryderyk-intro">
      <div><span className="school-eyebrow">Szkoła muzyczna · {student}</span><h2>Fryderyk</h2><p>Państwowa Szkoła Muzyczna I stopnia w Kołobrzegu</p></div>
      <StatusPill tone="neutral">Fryderyk — niepołączono</StatusPill>
      <p className="fryderyk-connection-note">Czekamy na potwierdzony sposób połączenia z dostawcą dziennika. Dane pojawią się po uruchomieniu integracji.</p>
      <small>Ostatnia synchronizacja: jeszcze nie wykonano</small>
    </Card>
    <div className="fryderyk-section-buttons" role="group" aria-label="Sekcje Fryderyka">{available.map(item => <SecondaryButton key={item.id} aria-pressed={section.id === item.id} onClick={() => setSelected(item.id)}>{item.title}</SecondaryButton>)}</div>
    <Card as="section" tone="neutral" className="fryderyk-empty" aria-live="polite"><Icon name={section.id === 'plan' ? 'calendar' : section.id === 'messages' ? 'message' : 'book'}/><h3>{section.title}</h3><p>{section.text}</p><p>Informacje SP4 są dostępne w osobnym widoku.</p></Card>
    <div className="fryderyk-actions"><SecondaryButton icon="chevron-left" onClick={onBack}>Wróć do SP4</SecondaryButton><a className="family-button family-secondary-button" href="https://psmkolobrzeg.fryderyk.edu.pl" target="_blank" rel="noopener noreferrer">Otwórz portal Fryderyk <Icon name="arrow-right"/></a></div>
  </section>;
}

export function SchoolConnectionsPreparation({ onOpenSchool }: { onOpenSchool: () => void }) {
  return <article className="settings-section school-connections-preparation family-ui" data-testid="school-connections-preparation"><header><span aria-hidden="true"><Icon name="link"/></span><div><strong>Połączenia szkolne</strong><small>Fryderyk · szkoła muzyczna</small></div></header><StatusPill tone="neutral">Fryderyk — niepołączono</StatusPill><p>Połączenie nie jest jeszcze dostępne. Nie wpisuj tutaj danych aktywacyjnych aplikacji mobilnej.</p><SecondaryButton onClick={onOpenSchool}>Otwórz moduł Szkoła</SecondaryButton></article>;
}
