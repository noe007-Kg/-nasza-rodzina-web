import type { CalendarEventData } from '../app-shared';
import { memberPersonKey, type FamilyMemberProfile } from '../family-members';
export type MusicLesson = { id: string; weekday: number; title: string; teacher: string; room: string; time: string; endTime: string };
export type MusicOccurrence = { id: string; title: string; date: string; time: string; endTime: string; startAt: string; endAt: string;
  teacher: string; room: string; cancelled: boolean; moved: boolean; manual: boolean; note: string;
  evidence: { url: string; from: string; until: string } | null };
export type MusicPlan = { id: string; ownerProfileId: string; person: string; revision: number; validFrom: string; validUntil: string;
  lessons: MusicLesson[]; excludedDates: string[]; check: { status: string; successAt?: number | null; attemptAt?: number } | null; occurrences: MusicOccurrence[] };
export type MusicState = { plans: MusicPlan[]; template: MusicLesson[]; writesEnabled: boolean };
export function musicCalendarEvents(plans: MusicPlan[], profiles: readonly FamilyMemberProfile[] = []): CalendarEventData[] {
  return plans.flatMap(plan => plan.occurrences.map(x => ({
    id: `music:${plan.id}:${x.id}`, title: `${x.cancelled ? 'ODWOŁANE — ' : x.moved ? 'ZMIANA TERMINU — ' : ''}${x.title}`,
    person: memberPersonKey(profiles.find(profile => profile.id === plan.ownerProfileId)) || plan.person, date: new Date(x.startAt), endDate: new Date(x.endAt), allDay: false,
    description: [x.cancelled ? 'Zajęcia odwołane.' : 'Zaplanowane — brak informacji o odwołaniu; nie jest to potwierdzenie odbycia zajęć.',
      `Szkoła muzyczna · nauczyciel: ${x.teacher} · sala ${x.room}`,
      'Plan potwierdzony przez rodzica; dziennik Fryderyk niepołączony.',
      x.evidence ? `Komunikat szkoły: ${x.evidence.url} (${x.evidence.from}–${x.evidence.until})` : '',
      x.manual ? `Zmiana rodzica: ${x.note || 'ręczne ustawienie'}` : '',
      plan.check?.successAt ? `Ostatnie sprawdzenie: ${new Date(plan.check.successAt).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}` : 'Komunikaty nie zostały jeszcze zweryfikowane.',
      plan.check?.status === 'unavailable' || plan.check?.status === 'review' ? 'Nie udało się w pełni potwierdzić aktualności komunikatów.' : '',
    ].filter(Boolean).join('\n'),
    createdBy: plan.ownerProfileId, ownerUid: plan.ownerProfileId, ownerProfileId: plan.ownerProfileId,
    private: false, repeat: 'none', repeatUntil: null, source: 'fryderyk', sourceRecordId: x.id, sourceConnectionId: plan.id,
    readOnly: true, cancelled: x.cancelled, eventKind: 'lesson', timingConfidence: 'confirmed', timeZone: 'Europe/Warsaw',
  })));
}
