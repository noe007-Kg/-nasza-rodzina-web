const SLOT_MS = 10 * 60 * 1000;
const warsawHour = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw', hourCycle: 'h23', hour: '2-digit',
});

/** A UTC instant uniquely identifies a ten-minute Warsaw school-hours slot.
 * Use the scheduled time, not the worker's (possibly delayed) start time.
 */
export function schoolSyncSlotStart(instant) {
  if (!Number.isSafeInteger(instant) || Math.abs(instant) > 8640000000000000) return null;
  const hour = Number(warsawHour.format(new Date(instant)));
  if (hour < 8 || hour >= 15) return null;
  return Math.floor(instant / SLOT_MS) * SLOT_MS;
}

/** The durable marker rejects retries and out-of-order delivery. A manual or
 * legacy attempt in this slot already refreshed it and must not be repeated.
 * Callers supply lastAttempt, falling back to lastSuccess only when absent.
 */
export function schoolSyncSlotConsumed(slotStart, lastSlotStart, lastStart) {
  return (Number.isFinite(lastSlotStart) && slotStart <= lastSlotStart)
    || (Number.isFinite(lastStart) && lastStart >= slotStart);
}
