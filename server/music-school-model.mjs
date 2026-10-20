// Public school information + a parent's confirmed timetable, never a Fryderyk session.
export const MUSIC_SCHOOL_SCHEDULE = '0 8-18 * * *';
export const MUSIC_SCHOOL_TIME_ZONE = 'Europe/Warsaw';
export const MUSIC_SCHOOL_INDEX = 'https://www.gov.pl/web/psmkolobrzeg/nieobecnosci-nauczycieli';
export const MUSIC_SCHOOL_TEMPLATE = [
  { id: 'rhythm-mon', weekday: 1, title: 'Podstawy rytmiki', time: '16:40', endTime: '17:25', teacher: 'Agnieszka Sokolnicka', room: '10' },
  { id: 'hearing-mon', weekday: 1, title: 'Kształcenie słuchu', time: '17:30', endTime: '18:15', teacher: 'Agnieszka Sokolnicka', room: '10' },
  { id: 'piano-tue', weekday: 2, title: 'Fortepian główny', time: '15:00', endTime: '15:30', teacher: 'Anna Leszczyńska', room: '13' },
  { id: 'rhythm-wed', weekday: 3, title: 'Podstawy rytmiki', time: '15:50', endTime: '16:35', teacher: 'Agnieszka Sokolnicka', room: '10' },
  { id: 'piano-thu', weekday: 4, title: 'Fortepian główny', time: '13:15', endTime: '13:45', teacher: 'Anna Leszczyńska', room: '17' },
];
export function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function warsawParts(now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', { timeZone: MUSIC_SCHOOL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekday: new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`).getUTCDay() };
}
export function schoolInstant(date, time) {
  const target = Date.parse(`${date}T${time}:00Z`);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', { timeZone: MUSIC_SCHOOL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(guess).map(x => [x.type, x.value]));
    guess += target - Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
  }
  return new Date(guess).toISOString();
}
export function occurrences(plan) {
  const result = [];
  for (let ms = Date.parse(plan.validFrom); ms <= Date.parse(plan.validUntil); ms += 86400000) {
    const day = new Date(ms), date = day.toISOString().slice(0, 10);
    if (plan.excludedDates.includes(date)) continue;
    for (const lesson of plan.lessons.filter(x => x.weekday === day.getUTCDay())) {
      const key = `${date}_${lesson.id}`, override = plan.overrides?.[key] || {};
      const actualDate = override.date || date, time = override.time || lesson.time, endTime = override.endTime || lesson.endTime;
      const candidate = plan.cancellations?.[key];
      const evidence = candidate?.teacher === lesson.teacher && actualDate >= candidate.from && actualDate <= candidate.until ? candidate : null;
      const cancelled = typeof override.cancelled === 'boolean' ? override.cancelled : Boolean(evidence);
      result.push({ id: key, title: lesson.title, date: actualDate, time, endTime,
        startAt: schoolInstant(actualDate, time), endAt: schoolInstant(actualDate, endTime),
        teacher: lesson.teacher, room: lesson.room, cancelled,
        moved: actualDate !== date || time !== lesson.time || endTime !== lesson.endTime,
        evidence: evidence ? { url: evidence.url, from: evidence.from, until: evidence.until } : null,
        manual: Object.keys(override).length > 0, note: override.note || '' });
    }
  }
  return result;
}
export function hasLessonsOn(plan, date) {
  return occurrences(plan).some(x => x.date === date); // Also honours moved lessons and excluded dates.
}
