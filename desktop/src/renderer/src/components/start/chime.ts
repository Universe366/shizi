/** 番茄钟阶段结束的轻提示音；音频不可用时静默。 */
export function playChime(): void {
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return;
  try {
    const context = new window.AudioContext();
    const now = context.currentTime;
    [880, 1174.66].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + index * 0.18;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.16, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.36);
    });
    window.setTimeout(() => void context.close(), 900);
  } catch {
    // 忽略音频错误
  }
}
