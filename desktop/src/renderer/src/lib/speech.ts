let current: HTMLAudioElement | null = null;
let currentUtterance: SpeechSynthesisUtterance | null = null;
let sequence = 0;
let mode: 'cloud' | 'web' | 'none' = 'none';
let webPaused = false;

export interface SpeechState {
  playing: boolean;
  paused: boolean;
  mode: 'cloud' | 'web' | 'none';
}

function state(): SpeechState {
  const playing =
    mode === 'cloud'
      ? Boolean(current && !current.paused && !current.ended)
      : mode === 'web'
        ? !webPaused
        : false;
  const paused =
    mode === 'cloud'
      ? Boolean(current && current.paused && !current.ended)
      : mode === 'web'
        ? webPaused
        : false;
  return { playing, paused, mode };
}

function emit(): void {
  try {
    window.dispatchEvent(new CustomEvent('bsub:speech-state', { detail: state() }));
  } catch {
    // 非浏览器环境忽略
  }
}

export function speechState(): SpeechState {
  return state();
}

export function onSpeechState(listener: (state: SpeechState) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<SpeechState>).detail;
    listener(detail || speechState());
  };
  window.addEventListener('bsub:speech-state', handler);
  return () => window.removeEventListener('bsub:speech-state', handler);
}

/** 停止当前朗读（本地音频或 Web Speech）。 */
export function stopSpeech(): void {
  sequence += 1;
  mode = 'none';
  if (current) {
    try {
      current.pause();
      current.src = '';
    } catch {
      // ignore
    }
    current = null;
  }
  currentUtterance = null;
  webPaused = false;
  try {
    window.speechSynthesis?.cancel();
  } catch {
    // ignore
  }
  emit();
}

export function pauseSpeech(): void {
  if (mode === 'cloud' && current && !current.paused) {
    current.pause();
    emit();
    return;
  }
  if (mode === 'web') {
    try {
      window.speechSynthesis?.pause();
      webPaused = true;
      emit();
    } catch {
      // ignore
    }
  }
}

export function resumeSpeech(): void {
  if (mode === 'cloud' && current && current.paused) {
    void current.play().then(emit).catch(() => stopSpeech());
    return;
  }
  if (mode === 'web') {
    try {
      window.speechSynthesis?.resume();
      webPaused = false;
      emit();
    } catch {
      // ignore
    }
  }
}

export function toggleSpeech(): void {
  const next = state();
  if (next.paused) resumeSpeech();
  else if (next.playing) pauseSpeech();
}

/** 是否正在朗读（粗略判断，用于按钮态）。 */
export function isSpeechPlaying(): boolean {
  return state().playing || state().paused;
}

/** 朗读一段文字：优先主进程 TTS（edge/sapi/openai），失败回退浏览器语音。 */
export async function speakText(text: string): Promise<'cloud' | 'web' | 'none'> {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000);
  if (!clean) return 'none';
  stopSpeech();
  const token = sequence;

  try {
    const response = await window.bsub.ttsSpeak({ text: clean });
    if (token !== sequence) return 'none';
    if (response.ok && response.data.dataUrl) {
      const audio = new Audio(response.data.dataUrl);
      current = audio;
      mode = 'cloud';
      audio.onended = () => {
        if (current === audio) {
          current = null;
          mode = 'none';
          emit();
        }
      };
      audio.onerror = () => {
        if (current === audio) stopSpeech();
      };
      audio.onplay = emit;
      audio.onpause = emit;
      await audio.play();
      emit();
      return 'cloud';
    }
  } catch {
    // 回退浏览器语音
  }

  if (token !== sequence) return 'none';
  try {
    if (!('speechSynthesis' in window)) return 'none';
    const utterance = new SpeechSynthesisUtterance(clean.slice(0, 600));
    utterance.lang = 'zh-CN';
    utterance.rate = 1;
    currentUtterance = utterance;
    mode = 'web';
    utterance.onend = () => {
      if (currentUtterance === utterance) {
        currentUtterance = null;
        webPaused = false;
        mode = 'none';
        emit();
      }
    };
    utterance.onerror = () => {
      if (currentUtterance === utterance) {
        currentUtterance = null;
        webPaused = false;
        mode = 'none';
        emit();
      }
    };
    window.speechSynthesis.speak(utterance);
    emit();
    return 'web';
  } catch {
    return 'none';
  }
}
