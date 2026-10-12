// The explicit CommonJS entry has the same default export in Node and Vite's
// CommonJS transform. rrule's package-level ESM entry does not export default.
import rrule from 'rrule/dist/es5/rrule.js';

const stamp = date => `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}T${String(date.getUTCHours()).padStart(2, '0')}${String(date.getUTCMinutes()).padStart(2, '0')}${String(date.getUTCSeconds()).padStart(2, '0')}`;
const parseRuleDate = value => {
  if (!/^\d{8}T\d{6}$/.test(value)) throw new RangeError('Nieprawidłowy termin serii.');
  const result = new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)), Number(value.slice(9, 11)), Number(value.slice(11, 13)), Number(value.slice(13, 15))));
  if (stamp(result) !== value) throw new RangeError('Nieprawidłowy termin serii.');
  return result;
};

/** Floating UTC fields represent the provider's wall clock, independent of the
 * device/server timezone. Warsaw DST must not shift a 09:00 recurring class. */
export function googleWallDate(date, zone) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]));
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second), date.getUTCMilliseconds()));
}
export function googleRealDate(wall, zone) {
  const target = wall.getTime(); let guess = target;
  for (let attempt = 0; attempt < 5; attempt++) {
    const delta = target - googleWallDate(new Date(guess), zone).getTime();
    if (!delta) return new Date(guess);
    guess += delta;
  }
  return null; // A skipped local time is not a real occurrence.
}
function floatingRule(line, zone) {
  if (line.startsWith('RRULE:')) return line.replace(/UNTIL=(\d{8}T\d{6})Z(?=;|$)/, (_match, value) => `UNTIL=${stamp(googleWallDate(parseRuleDate(value), zone))}`);
  const separator = line.indexOf(':'), head = line.slice(0, separator), values = line.slice(separator + 1).split(',');
  const sourceZone = /(?:^|;)TZID=([^;]+)/.exec(head)?.[1] || zone;
  const next = values.map(value => {
    if (/^\d{8}$/.test(value)) return value;
    const utc = value.endsWith('Z'), floating = parseRuleDate(utc ? value.slice(0, -1) : value);
    if (!utc && sourceZone === zone) return stamp(floating);
    const real = utc ? floating : googleRealDate(floating, sourceZone);
    if (!real) throw new RangeError('Nieprawidłowy termin wyjątku serii.');
    return stamp(googleWallDate(real, zone));
  });
  return `${head.replace(/;TZID=[^;]+/, '')}:${next.join(',')}`;
}
export function googleRecurrenceRule(date, lines, zone) {
  return rrule.rrulestr(`DTSTART:${stamp(googleWallDate(date, zone))}\n${lines.map(line => floatingRule(line, zone)).join('\n')}`, { forceset: true });
}
