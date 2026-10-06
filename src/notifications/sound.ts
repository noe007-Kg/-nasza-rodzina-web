let context: AudioContext | null = null;
/** Browsers require a user gesture. Never force audio past OS/browser mute controls. */
export async function unlockNotificationSound(): Promise<void> {
  try {
    const Constructor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) return;
    context ||= new Constructor();
    if (context.state === 'suspended') await context.resume();
  } catch { /* Sound is optional and must never block delivery. */ }
}
export function playNotificationBell(enabled: boolean): boolean {
  if (!enabled || document.visibilityState !== 'visible' || !context || context.state !== 'running') return false;
  try {
    const start = context.currentTime;
    for (const [frequency, delay, volume] of [[880, 0, 0.10], [1320, 0, 0.028], [1174.66, 0.16, 0.065]]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start + delay);
      gain.gain.linearRampToValueAtTime(volume, start + delay + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.82);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(start + delay); oscillator.stop(start + delay + 0.84);
    }
    return true;
  } catch { return false; }
}
