let current: HTMLAudioElement | null = null;
let currentUrl = '';

/** 停止当前朗读（本地音频或 Web Speech）。 */
export function stopSpeech(): void {
  if (current) {
    try {
      current.pause();
      current.src = '';
    } catch {
      // ignore
    }
    current = null;
  }
  if (currentUrl) {
    currentUrl = '';
  }
  try {
    window.speechSynthesis?.cancel();
  } catch {
    // ignore
  }
}

/** 是否正在朗读（粗略判断，用于按钮态）。 */
export function isSpeechPlaying(): boolean {
  if (current && !current.paused && !current.ended) return true;
  try {
    return window.speechSynthesis?.speaking === true;
  } catch {
    return false;
  }
}

/** 朗读一段文字：优先主进程 TTS（edge/sapi/openai），失败回退浏览器语音。 */
export async function speakText(text: string): Promise<'cloud' | 'web' | 'none'> {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000);
  if (!clean) return 'none';
  stopSpeech();

  try {
    const response = await window.bsub.ttsSpeak({ text: clean });
    if (response.ok && response.data.dataUrl) {
      const audio = new Audio(response.data.dataUrl);
      current = audio;
      currentUrl = response.data.dataUrl;
      audio.onended = () => {
        if (current === audio) {
          current = null;
          currentUrl = '';
        }
      };
      await audio.play();
      return 'cloud';
    }
  } catch {
    // 回退浏览器语音
  }

  try {
    if (!('speechSynthesis' in window)) return 'none';
    const utterance = new SpeechSynthesisUtterance(clean.slice(0, 600));
    utterance.lang = 'zh-CN';
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
    return 'web';
  } catch {
    return 'none';
  }
}
