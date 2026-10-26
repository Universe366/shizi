import { useEffect, useRef, useState } from 'react';
import { Markdown } from './components/Markdown';
import { speakText, stopSpeech } from './lib/speech';
import { parseReminder, formatReminder } from '../../shared/reminder';
import type {
  ChatMessage,
  PageInfo,
  PetClickAction,
  PetDoubleClickAction,
  PetTheme,
  PetTodo,
  WebReference
} from '../../shared/types';

function fallbackInfo(): PageInfo {
  return {
    kind: 'page',
    bvid: null,
    aid: null,
    cid: null,
    epId: null,
    seasonId: null,
    page: 1,
    partTitle: '',
    parts: [],
    title: '桌面',
    owner: '',
    desc: '',
    duration: 0,
    url: '',
    signature: 'pet'
  } as PageInfo;
}

type Emotion = 'idle' | 'thinking' | 'speaking' | 'happy' | 'sleeping';
type PetLayout = 'compact' | 'bubble' | 'widget' | 'menu';

/**
 * 桌宠只做「即时」的事：看屏幕、问选中、查资料。
 * 视频总结 / 入库属于主窗口，不在这里重复。
 */
const SELECTION_ACTIONS = [
  {
    id: 'explain',
    label: '解释选中',
    prompt: '解释我选中的这段内容，用通俗的话说清楚，必要时举一个例子。'
  },
  {
    id: 'translate',
    label: '翻译选中',
    prompt: '把我选中的这段内容翻译成中文（若已是中文则译成英文），保留专有名词。'
  }
];

const SHOT_PROMPT = '这张截图里是什么？用 3 条说清楚重点；如果有文字、数字或报错，原样摘出来。';
const OCR_PROMPT =
  '只输出这张图里识别到的文字本身，不要任何标题、说明、前后缀、引号或代码块；保留原有换行，看不清的字用「□」占位。';

const SELF_TALK = [
  '看视频遇到不懂的，右键「看屏幕」就行。',
  '选中网页文字，点「解释选中」就能问。',
  '要查资料就把「联网」打开。',
  '看久了记得起来活动一下。',
  '我在这儿，需要就叫我。'
];

const CLICK_PHRASES = ['摸摸头～', '我在呢！', '有要查的吗？', '别戳啦，会变瘦的'];

/** 与主进程 petGeometry.petLayoutForState 保持一致：气泡 > 菜单 > 挂件 > 紧凑。 */
function layoutForState(open: boolean, widgetOpen: boolean, menuOpen: boolean): PetLayout {
  if (menuOpen) return 'menu';
  if (open) return 'bubble';
  if (widgetOpen) return 'widget';
  return 'compact';
}

let audioContext: AudioContext | null = null;

/** 复用同一个 AudioContext：快速连点不会因为上下文数量上限而吞音。 */
function beep(volume = 60): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    if (!audioContext || audioContext.state === 'closed') audioContext = new AudioCtx();
    if (audioContext.state === 'suspended') void audioContext.resume().catch(() => undefined);
    const ctx = audioContext;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 660;
    const level = Math.max(0.0001, (volume / 100) * 0.12);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(level, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.18);
    oscillator.onended = () => {
      try {
        oscillator.disconnect();
        gain.disconnect();
      } catch {
        // ignore
      }
    };
  } catch {
    // 音频不可用时静默
  }
}

/** OCR 结果清理：去掉代码块围栏和“以下是提取的文字：”这类引导句。 */
function cleanOcrText(raw: string): string {
  let text = String(raw || '').trim();
  const fenced = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(text);
  if (fenced) text = fenced[1].trim();
  const lines = text.split('\n');
  if (lines.length > 1 && /^(以下|下面).{0,14}(文字|内容)/.test(lines[0].trim())) {
    text = lines.slice(1).join('\n').trim();
  }
  return text;
}

/** 模型不支持图片时，把底层报错翻译成可照做的提示。 */
function visionHint(raw: string): string {
  const looksLikeImageError =
    /image|vision|multimodal|content type|不支持.{0,6}图片|无效的.{0,4}内容/i.test(raw);
  if (!looksLikeImageError) return raw;
  return '当前 AI 模型可能不支持图片。去「设置 → AI」换一个支持视觉的模型（如 GPT-4o / Claude / Gemini / Qwen-VL）后再试一次。';
}

/** 历史来源来自 localStorage，渲染前过滤掉损坏/非 http(s) 的链接。 */
function safeSources(value: unknown): WebReference[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is WebReference => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as WebReference;
      return typeof candidate.url === 'string' && /^https?:\/\//i.test(candidate.url);
    })
    .map((item) => ({
      title:
        typeof item.title === 'string' && item.title.trim() ? item.title.trim() : item.url,
      url: item.url,
      snippet: typeof item.snippet === 'string' ? item.snippet : ''
    }));
}

/** 桌宠窗口：情绪、拖动、气泡对话、截图识图、问选中、联网检索。 */
export function PetWindow() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(() => {
    try {
      return localStorage.getItem('pet-draft') || '';
    } catch {
      return '';
    }
  });
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [emotion, setEmotion] = useState<Emotion>('idle');
  const [speak, setSpeak] = useState(() => localStorage.getItem('pet-speak') === '1');
  const [webOn, setWebOn] = useState(() => localStorage.getItem('pet-web') === '1');
  const [hint, setHint] = useState('');
  const [history, setHistory] = useState<
    Array<{
      role: 'user' | 'assistant';
      text: string;
      sources?: WebReference[];
      webEngine?: string;
      webNotice?: string;
    }>
  >(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('pet-history') || '[]');
      return Array.isArray(raw)
        ? raw
            .filter(
              (
                item
              ): item is {
                role: 'user' | 'assistant';
                text: string;
                sources?: WebReference[];
                webEngine?: string;
                webNotice?: string;
              } =>
                Boolean(item) &&
                (item.role === 'user' || item.role === 'assistant') &&
                typeof item.text === 'string' &&
                (!item.sources || Array.isArray(item.sources))
            )
            .slice(-30)
        : [];
    } catch {
      return [];
    }
  });
  const [recording, setRecording] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const mediaChunks = useRef<Blob[]>([]);
  const mediaStream = useRef<MediaStream | null>(null);
  const [playing, setPlaying] = useState(false);
  const [widgetOpen, setWidgetOpen] = useState(() => localStorage.getItem('pet-widget') === '1');
  const [now, setNow] = useState(() => new Date());
  const [todos, setTodos] = useState<PetTodo[]>([]);
  const [copied, setCopied] = useState(false);
  const [shot, setShot] = useState<string | null>(null);
  const [shotBusy, setShotBusy] = useState(false);
  const shotBusyRef = useRef(false);
  const [selection, setSelection] = useState<{ text: string; title: string } | null>(null);
  const requestRef = useRef('');
  const withImageRef = useRef(false);
  const happyTimer = useRef<number | null>(null);
  const lastActive = useRef(Date.now());
  const lastTalkAt = useRef(0);
  const voiceCanceled = useRef(false);
  const voiceStarting = useRef(false);
  const openChatRef = useRef<() => void>(() => undefined);
  const startVoiceRef = useRef<() => void>(() => undefined);
  const dragStarted = useRef(false);
  const [petSize, setPetSize] = useState(96);
  const [petOpacity, setPetOpacity] = useState(1);
  const [soundOn, setSoundOn] = useState(true);
  const [idleTalkOn, setIdleTalkOn] = useState(true);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [theme, setTheme] = useState<PetTheme>('sakura');
  const [motion, setMotion] = useState(true);
  const [petName, setPetName] = useState('即时助手');
  const [clickAction, setClickAction] = useState<PetClickAction>('chat');
  const [dblAction, setDblAction] = useState<PetDoubleClickAction>('main');
  const [idleTalkMinutes, setIdleTalkMinutes] = useState(3);
  const [sleepMinutes, setSleepMinutes] = useState(5);
  const [volume, setVolume] = useState(60);
  const [speechRate, setSpeechRate] = useState(1);
  const [pressing, setPressing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const bubbleBody = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hintTimer = useRef<number | null>(null);
  const todoTimer = useRef<number | null>(null);
  const lastAsk = useRef<{ text: string; selection?: string; image?: string } | null>(null);
  const ocrRef = useRef(false);
  const sentMessages = useRef<string[]>([]);
  const recallIndex = useRef(-1);
  const pressPoint = useRef<{ x: number; y: number } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [bubbleW, setBubbleW] = useState(440);
  const [bubbleH, setBubbleH] = useState(480);
  const [resizing, setResizing] = useState<{ w: number; h: number } | null>(null);
  const [below, setBelow] = useState(false);
  const [buttons, setButtons] = useState<string[]>([
    'web',
    'read',
    'widget',
    'screenshot',
    'explain',
    'translate',
    'copy',
    'newChat'
  ]);
  const tapTimer = useRef<number | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const shotHandler = useRef<(result: { action: 'image' | 'chat' | 'ocr'; dataUrl: string; width: number; height: number }) => void>(() => {});

  useEffect(() => {
    const apply = (general: Record<string, unknown>) => {
      setPetSize(Math.min(180, Math.max(64, Number(general.petSize) || 96)));
      setPetOpacity(Math.min(1, Math.max(0.4, Number(general.petOpacity ?? 1) || 1)));
      setSoundOn(general.petSound !== false);
      setIdleTalkOn(general.petIdleTalk !== false);
      setAlwaysOnTop(general.petAlwaysOnTop !== false);
      setTheme((general.petTheme as PetTheme) || 'sakura');
      setMotion(general.petMotion !== false);
      setPetName(String(general.petName || '即时助手').slice(0, 12));
      setClickAction((general.petClickAction as PetClickAction) || 'chat');
      setDblAction((general.petDoubleClickAction as PetDoubleClickAction) || 'main');
      setIdleTalkMinutes(Number(general.petIdleTalkMinutes ?? 3));
      setSleepMinutes(Number(general.petSleepMinutes ?? 5));
      setVolume(Number(general.petSoundVolume ?? 60));
      setSpeechRate(Number(general.petSpeechRate ?? 1));
      setBubbleW(Number(general.petBubbleWidth) || 440);
      setBubbleH(Number(general.petBubbleHeight) || 480);
      if (Array.isArray(general.petButtons)) setButtons(general.petButtons.map(String));
      if (Array.isArray(general.petTodos)) {
        const incoming = JSON.stringify(general.petTodos);
        setTodos((current) =>
          JSON.stringify(current) === incoming ? current : (general.petTodos as PetTodo[])
        );
      }
      setHydrated(true);
    };
    void window.bsub.getSettings().then((response) => {
      if (!response.ok) {
        setHydrated(true);
        return;
      }
      apply(response.data.settings.general as unknown as Record<string, unknown>);
    });
    // 设置页保存后实时生效，不用重开桌宠
    return window.bsub.onSettingsChanged((snapshot) => {
      apply(snapshot.settings.general as unknown as Record<string, unknown>);
    });
  }, []);

  // 上方空间不足时主进程会把面板翻到下面，这里跟着换 CSS 顺序。
  useEffect(() => {
    void window.bsub.petFlipped().then(setBelow);
    return window.bsub.onPetFlipped(setBelow);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('pet-history', JSON.stringify(history.slice(-30)));
    } catch {
      // ignore
    }
  }, [history]);

  // 打开气泡就把焦点放进输入框：点一下就能直接打字。
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [open]);

  // 点到别处（窗口失焦）就收起气泡/菜单，不要一直浮在上面。
  useEffect(() => {
    const close = () => {
      setHistoryOpen(false);
      // 截图覆盖窗会暂时抢走焦点，这时候别把气泡收掉（截完还要用）。
      if (shotBusyRef.current) return;
      setMenuOpen(false);
      setOpen(false);
      setWidgetOpen(false);
    };
    window.addEventListener('blur', close);
    return () => window.removeEventListener('blur', close);
  }, []);

  // 窗口跟着内容伸缩：关闭气泡后只占桌宠大小，不再用透明区域挡住桌面。
  useEffect(() => {
    void window.bsub.setPetLayout(layoutForState(open, widgetOpen, menuOpen));
  }, [open, widgetOpen, menuOpen]);

  useEffect(() => {
    localStorage.setItem('pet-widget', widgetOpen ? '1' : '0');
  }, [widgetOpen]);

  // 草稿跨重启保留
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (input.trim()) localStorage.setItem('pet-draft', input);
        else localStorage.removeItem('pet-draft');
      } catch {
        // ignore
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [input]);

  // 待办写进设置文件（清缓存/换数据目录不丢）
  useEffect(() => {
    if (!hydrated) return;
    if (todoTimer.current) window.clearTimeout(todoTimer.current);
    todoTimer.current = window.setTimeout(() => {
      void (async () => {
        const snapshot = await window.bsub.getSettings();
        if (!snapshot.ok) return;
        const next = snapshot.data.settings;
        next.general.petTodos = todos;
        await window.bsub.saveSettings(next);
      })();
    }, 400);
    return () => {
      if (todoTimer.current) window.clearTimeout(todoTimer.current);
      if (tapTimer.current) window.clearTimeout(tapTimer.current);
      if (mediaRecorder.current?.state === 'recording') mediaRecorder.current.stop();
      mediaStream.current?.getTracks().forEach((track) => track.stop());
    };
  }, [todos, hydrated]);

  useEffect(() => {
    localStorage.setItem('pet-web', webOn ? '1' : '0');
  }, [webOn]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // 媒体播放联动
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const response = await window.bsub.isMediaPlaying();
      if (alive) setPlaying(response.ok && response.data);
    };
    void poll();
    const timer = window.setInterval(poll, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  // Esc：先关菜单，再关气泡
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (menuOpen) {
        setMenuOpen(false);
        return;
      }
      if (!open) return;
      setHistoryOpen(false);
      setOpen(false);
      // 焦点别留在不可见的桌宠窗口里，还回上一个窗口。
      void window.bsub.petBlur();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen, open]);

  // 回答更新后滚到底部
  useEffect(() => {
    const node = bubbleBody.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [history, answer, error]);

  // 说话/回答事件
  useEffect(() => {
    const offDelta = window.bsub.onChatDelta((event) => {
      if (event.requestId !== requestRef.current) return;
      setEmotion('speaking');
      setAnswer((previous) => previous + event.delta);
    });
    const offDone = window.bsub.onChatDone((event) => {
      if (event.requestId !== requestRef.current) return;
      setBusy(false);
      const finalText = ocrRef.current ? cleanOcrText(event.text) : event.text;
      ocrRef.current = false;
      setAnswer(finalText);
      const sources = (event.references || []).slice(0, 3).map((reference) => ({
        ...reference,
        snippet: reference.snippet.slice(0, 160)
      }));
      setHistory((items) => [
        ...items,
        {
          role: 'assistant',
          text: finalText,
          ...(sources.length ? { sources } : {}),
          ...(event.webEngine ? { webEngine: event.webEngine } : {}),
          ...(event.webError ? { webNotice: event.webError } : {})
        }
      ]);
      setEmotion('happy');
      if (speak && finalText) {
        void speakText(finalText);
      }
      if (happyTimer.current) window.clearTimeout(happyTimer.current);
      happyTimer.current = window.setTimeout(() => setEmotion('idle'), 2500);
    });
    const offError = window.bsub.onChatError((event) => {
      if (event.requestId !== requestRef.current) return;
      setBusy(false);
      setEmotion('idle');
      setError(withImageRef.current ? visionHint(event.error) : event.error);
    });
    return () => {
      offDelta();
      offDone();
      offError();
    };
  }, [speak, speechRate]);

  // 全局快捷键（Ctrl+Alt+S）截完的结果
  useEffect(() => window.bsub.onPetShot((result) => shotHandler.current(result)), []);
  shotHandler.current = (result) => {
    void handleShotResult(result);
  };

  // 关掉桌宠时别让请求继续烧 token
  useEffect(
    () => () => {
      if (requestRef.current) void window.bsub.cancelChat(requestRef.current);
      if (hintTimer.current) window.clearTimeout(hintTimer.current);
      if (todoTimer.current) window.clearTimeout(todoTimer.current);
      if (tapTimer.current) window.clearTimeout(tapTimer.current);
      if (mediaRecorder.current?.state === 'recording') mediaRecorder.current.stop();
      mediaStream.current?.getTracks().forEach((track) => track.stop());
    },
    []
  );

  // 右键菜单打开后可以用 ↑/↓/Home/End 选，Enter 触发
  useEffect(() => {
    if (!menuOpen) return;
    const timer = window.setTimeout(() => {
      const first = menuRef.current?.querySelector('button');
      first?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [menuOpen]);

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll('button') || []) as HTMLElement[];
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(current + 1) % items.length].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(current - 1 + items.length) % items.length].focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0].focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1].focus();
    }
  };

  // 空闲：睡觉 + 自言自语
  useEffect(() => {
    const timer = window.setInterval(() => {
      // 气泡/菜单/挂件开着时不睡觉、不说话，避免打断正在看的内容。
      if (busy || open || menuOpen || widgetOpen) return;
      const idleMs = Date.now() - lastActive.current;
      if (sleepMinutes > 0 && idleMs > sleepMinutes * 60_000) {
        setEmotion('sleeping');
        return;
      }
      if (
        idleTalkOn &&
        idleTalkMinutes > 0 &&
        idleMs > idleTalkMinutes * 60_000 &&
        Date.now() - lastTalkAt.current > idleTalkMinutes * 60_000
      ) {
        // 记录这次说话的时间：之前每 45 秒会重复一次，太吵。
        lastTalkAt.current = Date.now();
        flash(SELF_TALK[Math.floor(Math.random() * SELF_TALK.length)], 5000);
      }
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [busy, idleTalkOn, idleTalkMinutes, sleepMinutes, open, menuOpen, widgetOpen]);

  const wake = () => {
    lastActive.current = Date.now();
    if (emotion === 'sleeping') setEmotion('idle');
  };

  const has = (id: string) => buttons.includes(id);

  const flash = (text: string, ms = 2600) => {
    if (hintTimer.current) window.clearTimeout(hintTimer.current);
    setHint(text);
    hintTimer.current = window.setTimeout(() => {
      setHint('');
      hintTimer.current = null;
    }, ms);
  };

  const toggleSpeak = () => {
    const next = !speak;
    setSpeak(next);
    localStorage.setItem('pet-speak', next ? '1' : '0');
    if (!next) stopSpeech();
  };

  /** 打开气泡并把它带到前台状态：关掉菜单/挂件/历史，焦点给输入框。 */
  const openChatPanel = () => {
    setMenuOpen(false);
    setWidgetOpen(false);
    setHistoryOpen(false);
    setOpen(true);
    window.setTimeout(() => inputRef.current?.focus(), 60);
  };

  // 全局快捷取词：主进程把任意应用的选中文字送进来。
  useEffect(() => {
    return window.bsub.onPetSelection?.((payload) => {
      openChatPanel();
      if (!payload?.text) {
        flash(payload?.error || '没有取到选中文字');
        return;
      }
      setSelection({ text: payload.text, title: '快速取词' });
      flash(`已取到 ${payload.text.length} 字`);
    });
  }, []);

  const toggleOpen = () => {
    wake();
    setEmotion('happy');
    if (happyTimer.current) window.clearTimeout(happyTimer.current);
    happyTimer.current = window.setTimeout(() => setEmotion('idle'), 1200);
    if (!open) {
      setWidgetOpen(false);
      setMenuOpen(false);
      setHistoryOpen(false);
    } else {
      setHistoryOpen(false);
    }
    if (!open && Math.random() < 0.4) {
      flash(CLICK_PHRASES[Math.floor(Math.random() * CLICK_PHRASES.length)]);
    }
    setOpen((value) => !value);
  };

  /**
   * 即时问答：默认不抽整页正文（那是主窗口的总结流程），
   * 只有明确附带的截图 / 选中文字才作为上下文。
   */
  const ask = async (
    text: string,
    context?: { selection?: string; image?: string | null; cleanup?: 'ocr' }
  ) => {
    const value = text.trim();
    if (!value || busy) return;
    wake();
    setBusy(true);
    setError('');
    setAnswer('');
    setEmotion('thinking');
    setInput('');
    const attachment = context?.image === null ? null : context?.image || shot;
    withImageRef.current = Boolean(attachment);
    ocrRef.current = context?.cleanup === 'ocr';

    const quoted = (context?.selection || selection?.text || '').trim().slice(0, 2000);
    const content = quoted
      ? `${value}\n\n我选中的内容：\n"""\n${quoted}\n"""`
      : value;

    // 记下这次请求：出错可原样重试，也用于 ↑ 翻历史
    lastAsk.current = { text: value, selection: quoted || undefined, image: attachment || undefined };
    sentMessages.current = [...sentMessages.current.slice(-19), value];
    recallIndex.current = -1;
    try {
      localStorage.removeItem('pet-draft');
    } catch {
      // ignore
    }

    // 多轮上下文：把最近几条对话一起发过去，追问「再详细点」才有意义。
    const contextMessages: ChatMessage[] = history
      .slice(-6)
      .map((item) => ({ role: item.role, content: item.text.slice(0, 2000) }));
    setHistory((items) => [
      ...items,
      { role: 'user', text: quoted ? `${value}（含选中内容）` : value }
    ]);
    setSelection(null);
    const requestId = `pet-${Date.now()}`;
    requestRef.current = requestId;
    try {
      // 桌宠对话与主窗口的当前页面解耦：不再读取活动标签页信息。
      const info = fallbackInfo();
      const message: ChatMessage = {
        role: 'user',
        content,
        ...(attachment ? { images: [attachment] } : {})
      };
      let surfaceContext = '';
      try {
        const foreground = await window.bsub.foregroundWindow?.();
        if (foreground?.ok && (foreground.data.title || foreground.data.process)) {
          surfaceContext = `前台窗口：${foreground.data.process || '未知程序'} - ${
            foreground.data.title || ''
          }`;
        }
      } catch {
        // ignore
      }
      const started = await window.bsub.chat({
        requestId,
        info,
        lines: [],
        messages: [...contextMessages, message],
        context: surfaceContext || undefined,
        // 桌宠只处理即时问题：不把整页正文塞给模型。
        includePage: false,
        web: webOn,
        surface: 'pet'
      });
      if (!started.ok) throw new Error(started.error);
    } catch (caught) {
      setBusy(false);
      setEmotion('idle');
      const message = (caught as Error).message || '请求失败';
      setError(withImageRef.current ? visionHint(message) : message);
    }
  };

  /** 本地系统 OCR 优先；失败/没识别到文字时回退到 AI 视觉。 */
  const extractText = async (dataUrl: string) => {
    try {
      const local = await window.bsub.ocrRecognize({ dataUrl });
      if (local.ok && local.data.text.trim()) {
        const text = local.data.text.trim();
        setAnswer(text);
        setHistory((items) => [...items, { role: 'assistant', text }]);
        flash(`已提取 ${text.length} 字（本地 OCR ${local.data.ms}ms）`);
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // 剪贴板不可用不影响展示
        }
        return;
      }
      flash('本地 OCR 没识别到文字，改用 AI 识别…');
    } catch {
      // 忽略，走 AI 兜底
    }
    await ask(OCR_PROMPT, { image: dataUrl, cleanup: 'ocr' });
  };

  /** 统一处理「框选结果」：本地按钮和全局快捷键共用。 */
  const handleShotResult = async (result: {
    action: 'image' | 'chat' | 'ocr';
    dataUrl: string;
    width: number;
    height: number;
  }) => {
    openChatPanel();
    if (result.action === 'image') {
      setShot(result.dataUrl);
      flash('截图已就绪，接着问就行');
      inputRef.current?.focus();
      return;
    }
    setShot(result.dataUrl);
    if (result.action === 'ocr') {
      await extractText(result.dataUrl);
      return;
    }
    await ask(SHOT_PROMPT, { image: result.dataUrl });
  };

  /** 框选截图：动作条里选「识别图片 / 对话 / 提取文字」。 */
  const takeRegionShot = async () => {
    if (shotBusy || busy) {
      flash('等当前回答结束再截图');
      return;
    }
    wake();
    setShotBusy(true);
    shotBusyRef.current = true;
    try {
      const result = await window.bsub.captureRegion();
      if (!result) {
        flash('已取消截图');
        return;
      }
      await handleShotResult(result);
    } catch {
      flash('截图失败，请重试');
    } finally {
      setShotBusy(false);
      shotBusyRef.current = false;
    }
  };

  /** 整页截图：不框选，直接截当前标签页。 */
  const takePageShot = async () => {
    if (shotBusy || busy) return;
    wake();
    setShotBusy(true);
    try {
      const response = await window.bsub.capturePage();
      if (!response.ok) {
        flash(response.error || '截图失败');
        return;
      }
      const dataUrl = response.data.dataUrl;
      await handleShotResult({ action: 'chat', dataUrl, width: 0, height: 0 });
    } finally {
      setShotBusy(false);
    }
  };

  const askSelection = async (prompt: string) => {
    if (busy) return;
    wake();
    const response = await window.bsub.readSelection();
    if (!response.ok) {
      flash(response.error || '读取选中内容失败');
      return;
    }
    const text = response.data.selection.trim();
    if (!text) {
      flash('先在网页里选中一段文字');
      return;
    }
    setSelection({ text, title: response.data.title });
    openChatPanel();
    await ask(prompt, { selection: text });
  };

  /** 直接改气泡尺寸（右键菜单里的三档），写到设置里立即生效。 */
  const applyBubblePreset = async (width: number, height: number) => {
    setBubbleW(width);
    setBubbleH(height);
    const snapshot = await window.bsub.getSettings();
    if (!snapshot.ok) return;
    const next = snapshot.data.settings;
    next.general.petBubbleWidth = width;
    next.general.petBubbleHeight = height;
    await window.bsub.saveSettings(next);
    flash(`气泡 ${width}×${height}`);
  };

  /** 拖角自由调整：上/下按翻转方向增长，宽度向右增长；拖动时显示尺寸。 */
  const startResize = (
    event: React.MouseEvent,
    axes: { width?: boolean; height?: boolean } = { width: true, height: true }
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const start = { sx: event.screenX, sy: event.screenY, w: bubbleW, h: bubbleH };
    let last = { w: bubbleW, h: bubbleH };
    const move = (moveEvent: MouseEvent) => {
      const dx = moveEvent.screenX - start.sx;
      const dy = moveEvent.screenY - start.sy;
      const width = axes.width ? Math.min(760, Math.max(320, start.w + dx)) : start.w;
      const height = axes.height
        ? Math.min(820, Math.max(260, start.h + (below ? dy : -dy)))
        : start.h;
      last = { w: width, h: height };
      setBubbleW(width);
      setBubbleH(height);
      setResizing(last);
      void window.bsub.resizeBubble(width, height, false);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setResizing(null);
      void window.bsub.resizeBubble(last.w, last.h, true);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  /** 在紧凑 / 舒适 / 大窗之间循环，按钮点起来可预期，不用拖角猜方向。 */
  const cycleBubbleSize = () => {
    const presets: Array<[number, number]> = [
      [360, 340],
      [440, 480],
      [620, 680]
    ];
    const index = presets.findIndex(([width]) => width === bubbleW);
    const next = presets[(index + 1) % presets.length];
    void applyBubblePreset(next[0], next[1]);
  };

  /** 新对话：清掉上下文与回答，附件保留（想继续问图就不用重截）。 */
  const resetChat = () => {
    if (requestRef.current) void window.bsub.cancelChat(requestRef.current);
    requestRef.current = '';
    setHistory([]);
    setAnswer('');
    setError('');
    setBusy(false);
    setEmotion('idle');
    sentMessages.current = [];
    recallIndex.current = -1;
    lastAsk.current = null;
    flash('已开始新对话');
  };

  const retry = () => {
    const last = lastAsk.current;
    if (!last || busy) return;
    void ask(last.text, { selection: last.selection, image: last.image ?? null });
  };

  /** ↑/↓ 翻最近发过的问题。 */
  const recall = (direction: 1 | -1) => {
    const list = sentMessages.current;
    if (!list.length) return;
    if (direction < 0) {
      const next = recallIndex.current < 0 ? list.length - 1 : Math.max(0, recallIndex.current - 1);
      recallIndex.current = next;
      setInput(list[next]);
      return;
    }
    if (recallIndex.current < 0) return;
    const next = recallIndex.current + 1;
    if (next >= list.length) {
      recallIndex.current = -1;
      setInput('');
    } else {
      recallIndex.current = next;
      setInput(list[next]);
    }
  };

  const stop = () => {
    if (!requestRef.current) return;
    void window.bsub.cancelChat(requestRef.current);
    setBusy(false);
    setEmotion('idle');
    flash('已停止');
  };

  const togglePlay = async () => {
    const result = await window.bsub.toggleMedia();
    if (result.ok) {
      setPlaying(result.data.playing);
      flash(result.data.playing ? '继续播放' : '已暂停');
    }
  };

  const copyAnswer = async () => {
    const text = answer || [...history].reverse().find((item) => item.role === 'assistant')?.text;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      flash('复制失败');
    }
  };

  const stopVoice = () => {
    if (mediaRecorder.current?.state === 'recording') mediaRecorder.current.stop();
  };

  const startVoice = async () => {
    if (recording) {
      stopVoice();
      return;
    }
    if (busy || voiceStarting.current) return;
    voiceStarting.current = true;
    try {
      voiceCanceled.current = false;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // 等权限/设备期间气泡被关掉：直接释放麦克风，不要偷偷开始录。
      if (voiceCanceled.current) {
        stream.getTracks().forEach((track) => track.stop());
        voiceCanceled.current = false;
        return;
      }
      mediaStream.current = stream;
      mediaChunks.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorder.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) mediaChunks.current.push(event.data);
      };
      recorder.onstop = () => {
        setRecording(false);
        stream.getTracks().forEach((track) => track.stop());
        mediaStream.current = null;
        // 关闭气泡/窗口导致的停止不转写，避免在后台偷偷发请求。
        if (voiceCanceled.current) {
          voiceCanceled.current = false;
          mediaChunks.current = [];
          return;
        }
        const blob = new Blob(mediaChunks.current, { type: 'audio/webm' });
        mediaChunks.current = [];
        if (!blob.size) {
          flash('没有录到声音');
          return;
        }
        const reader = new FileReader();
        reader.onload = async () => {
          flash('识别中…', 6000);
          const result = await window.bsub.transcribeVoice?.(String(reader.result || ''));
          if (result?.ok) {
            void ask(result.data.text);
          } else {
            flash(result?.error || '语音识别失败，请检查 ASR 设置');
          }
        };
        reader.readAsDataURL(blob);
      };
      recorder.start();
      setRecording(true);
      openChatPanel();
    } catch {
      // getUserMedia 成功、MediaRecorder 构造失败时也要把麦克风关掉。
      mediaStream.current?.getTracks().forEach((track) => track.stop());
      mediaStream.current = null;
      mediaRecorder.current = null;
      flash('无法使用麦克风');
    } finally {
      voiceStarting.current = false;
    }
  };

  // 全局快捷键（Ctrl+Shift+D / Ctrl+Shift+Space）：主进程只负责开窗+发事件，这里接住。
  openChatRef.current = openChatPanel;
  startVoiceRef.current = () => {
    void startVoice();
  };

  useEffect(() => window.bsub.onPetChat?.(() => openChatRef.current()), []);
  useEffect(() => window.bsub.onPetVoice?.(() => startVoiceRef.current()), []);

  // 气泡被关掉时停止录音：不要把麦克风留在后台。
  useEffect(() => {
    if (open) return;
    if (!recording && !voiceStarting.current) return;
    voiceCanceled.current = true;
    if (recording) {
      mediaChunks.current = [];
      stopVoice();
    }
  }, [open, recording]);

  const pasteClipboard = async () => {
    try {
      const text = await window.bsub.readClipboard?.();
      if (!text || !text.trim()) {
        flash('剪贴板里没有文字');
        return;
      }
      setInput((value) => (value ? `${value}
${text.slice(0, 4000)}` : text.slice(0, 4000)));
      openChatPanel();
    } catch {
      flash('读取剪贴板失败');
    }
  };

  const handoffToMain = async () => {
    const text = answer || [...history].reverse().find((item) => item.role === 'assistant')?.text;
    const question = lastAsk.current?.text || [...sentMessages.current].reverse()[0] || '';
    if (!text) {
      flash('还没有可交接的回答');
      return;
    }
    await window.bsub.handoffChat?.({ question, answer: text });
    await window.bsub.focusMain?.();
    flash('已交给主窗口');
  };

  const saveAnswerAsTodo = async () => {
    const text = answer || [...history].reverse().find((item) => item.role === 'assistant')?.text;
    if (!text) {
      flash('还没有可保存的回答');
      return;
    }
    setTodos((items) => [
      ...items,
      { id: Date.now(), text: `回答：${text.replace(/\s+/g, ' ').slice(0, 80)}`, done: false }
    ]);
    flash('已存为待办');
  };

  const saveAsNote = async () => {
    const text = answer || [...history].reverse().find((item) => item.role === 'assistant')?.text;
    if (!text) {
      flash('还没有可保存的回答');
      return;
    }
    const page = await window.bsub.getPageInfo();
    if (!page.ok) {
      flash('读取当前页面失败');
      return;
    }
    const library = await window.bsub.listLibrary();
    const videos = library.ok ? library.data.videos : [];
    const strip = (value: string) => {
      try {
        const url = new URL(value);
        return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
      } catch {
        return value;
      }
    };
    const match = videos.find((video) => strip(video.url) === strip(page.data.url));
    if (!match) {
      flash('当前页面还没入库，先入库再存笔记');
      return;
    }
    const saved = await window.bsub.saveNote(match.id, text);
    flash(saved.ok ? '已存为笔记' : saved.error || '保存笔记失败');
  };

  const dropFile = async (event: React.DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    // Electron 32+ 的 File 没有 path 字段，必须走 webUtils（preload 暴露）。
    let filePath = '';
    try {
      filePath = window.bsub.petFilePath?.(file) || '';
    } catch {
      filePath = '';
    }
    if (!filePath) {
      filePath = (file as File & { path?: string })?.path || '';
    }
    if (!filePath) {
      flash('请从资源管理器拖入文件');
      return;
    }
    const result = await window.bsub.readPetFile?.(filePath);
    if (!result?.ok) {
      flash(result?.error || '读取文件失败');
      return;
    }
    openChatPanel();
    if (result.data.kind === 'image' && result.data.dataUrl) {
      setShot(result.data.dataUrl);
      flash(`已添加图片：${result.data.name}`);
    } else if (result.data.text) {
      setInput(
        (value) => `${value ? `${value}
` : ''}[文件：${result.data.name}]
${result.data.text}`
      );
      flash(`已读取：${result.data.name}`);
    }
  };

  const toggleAlwaysOnTop = async () => {
    const next = await window.bsub.setPetAlwaysOnTop(!alwaysOnTop);
    setAlwaysOnTop(next !== false);
    flash(next !== false ? '已置顶' : '已取消置顶');
  };

  const startDrag = (event: React.MouseEvent, fromBubble = false) => {
    // 只响应左键；输入框/按钮不要触发拖动（本体自己是按钮，要放行）。
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('input,textarea,.mini-btn,.pet-close,.pet-resize,.pet-menu')) return;
    if (!fromBubble && target.closest('.pet-bubble,.pet-widget,.pet-menu')) return;
    dragStarted.current = false;
    pressPoint.current = { x: event.screenX, y: event.screenY };
    setPressing(true);
    // 位移交给主进程跟随光标：指针移出窗口也不会掉。
    void window.bsub.beginPetDrag();
    const origin = { x: event.screenX, y: event.screenY };
    const move = (moveEvent: MouseEvent) => {
      if (Math.abs(moveEvent.screenX - origin.x) + Math.abs(moveEvent.screenY - origin.y) > 3) {
        if (!dragStarted.current) setDragging(true);
        dragStarted.current = true;
      }
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setPressing(false);
      setDragging(false);
      void window.bsub.endPetDrag();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div
      className={`pet-root pet-theme-${theme} emotion-${emotion}${open ? ' is-open' : ''}${
        playing ? ' is-playing' : ''
      }${motion ? '' : ' no-motion'}${pressing ? ' is-pressing' : ''}${
        dragging ? ' is-dragging' : ''
      }${below ? ' is-below' : ''}${!open && !widgetOpen && !menuOpen ? ' is-compact' : ''}`}
      style={{
        ['--pet-size' as string]: `${petSize}px`,
        ['--pet-bubble-w' as string]: `${bubbleW}px`,
        ['--pet-opacity' as string]: String(petOpacity)
      }}
      onContextMenu={(event) => {
        const target = event.target as HTMLElement | null;
        // 输入框里右键应该留给系统/快捷键粘贴，不要用桌宠菜单把气泡顶掉。
        if (target?.closest('input,textarea,[contenteditable="true"],[contenteditable=""]')) return;
        event.preventDefault();
        wake();
        setMenuOpen((value) => !value);
      }}
      onMouseEnter={wake}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => void dropFile(event)}
    >
      {menuOpen && (
        <div className="pet-menu" ref={menuRef} onKeyDown={onMenuKeyDown} onMouseLeave={() => setMenuOpen(false)}>
          <button
            onClick={() => {
              setMenuOpen(false);
              setHistoryQuery('');
              setHistoryOpen(true);
              setOpen(true);
            }}
          >
            <span className="pet-menu-icon">◷</span>
            <span className="pet-menu-label">历史记录</span>
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              void takeRegionShot();
            }}
          >
            <span className="pet-menu-icon">▢</span><span className="pet-menu-label">截图（框选）</span>
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              void takePageShot();
            }}
          >
            <span className="pet-menu-icon">▤</span><span className="pet-menu-label">整页截图</span>
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              void askSelection(SELECTION_ACTIONS[0].prompt);
            }}
          >
            <span className="pet-menu-icon">◉</span><span className="pet-menu-label">问选中的内容</span>
          </button>
          <span className="pet-menu-sep" />
          <button
            onClick={() => {
              setMenuOpen(false);
              void window.bsub.focusMain();
            }}
          >
            <span className="pet-menu-icon">◧</span><span className="pet-menu-label">打开主窗口</span>
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              void togglePlay();
            }}
          >
            <span className="pet-menu-icon">{playing ? 'Ⅱ' : '▶'}</span>
            <span className="pet-menu-label">{playing ? '暂停播放' : '继续播放'}</span>
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              void toggleAlwaysOnTop();
            }}
          >
            <span className="pet-menu-icon">⇧</span>
            <span className="pet-menu-label">{alwaysOnTop ? '取消置顶' : '窗口置顶'}</span>
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              void window.bsub.resetPetPosition();
            }}
          >
            <span className="pet-menu-icon">↺</span><span className="pet-menu-label">重置位置</span>
          </button>
          <span className="pet-menu-sep" />
          <button
            onClick={() => {
              setMenuOpen(false);
              void applyBubblePreset(360, 340);
            }}
          >
            <span className="pet-menu-icon">▭</span>
            <span className="pet-menu-label">气泡：紧凑</span>
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              void applyBubblePreset(440, 480);
            }}
          >
            <span className="pet-menu-icon">▭</span>
            <span className="pet-menu-label">气泡：舒适</span>
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              void applyBubblePreset(620, 680);
            }}
          >
            <span className="pet-menu-icon">▭</span>
            <span className="pet-menu-label">气泡：大窗</span>
          </button>
          <span className="pet-menu-sep" />
          <button
            className="is-danger"
            onClick={() => {
              setMenuOpen(false);
              void window.bsub.setPetEnabled(false);
            }}
          >
            <span className="pet-menu-icon">×</span><span className="pet-menu-label">隐藏桌宠</span>
          </button>
        </div>
      )}
      <div className="pet-grip" title="拖动移动桌宠" onMouseDown={startDrag} />

      {hint && <div className="pet-hint">{hint}</div>}

      {widgetOpen && !menuOpen && (
        <div className="pet-widget">
          <div className="pet-widget-clock">
            {now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div className="pet-widget-date">
            {now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}
          </div>
          <input
            className="pet-widget-input"
            placeholder="加一条待办，如 20分钟后 喝水"
            onKeyDown={(event) => {
              // 中文输入法按 Enter 只是确认候选词，不能当成提交。
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
              const raw = event.currentTarget.value.trim();
              if (!raw) return;
              const { text, dueAt } = parseReminder(raw);
              setTodos((items) => [...items, { id: Date.now(), text, done: false, dueAt }]);
              event.currentTarget.value = '';
            }}
          />
          <div className="pet-widget-list">
            {todos.map((todo) => (
              <label key={todo.id} className="pet-widget-item">
                <input
                  type="checkbox"
                  checked={todo.done}
                  onChange={() =>
                    setTodos((items) =>
                      items.map((item) =>
                        item.id === todo.id ? { ...item, done: !item.done } : item
                      )
                    )
                  }
                />
                <span className={todo.done ? 'is-done' : ''}>{todo.text}</span>
                {todo.dueAt && <span className="pet-todo-due">{formatReminder(todo.dueAt)}</span>}
                <button
                  className="pet-widget-remove"
                  title="删除这条待办"
                  onClick={() => setTodos((items) => items.filter((item) => item.id !== todo.id))}
                >
                  ×
                </button>
              </label>
            ))}
            {!todos.length && <div className="pet-widget-empty">今天还没有待办</div>}
          </div>
        </div>
      )}

      {open && !menuOpen && (
        <div className="pet-bubble">
          <div className="pet-bubble-head" onMouseDown={(event) => startDrag(event, true)}>
            <span className="pet-bubble-title">
              <span className={`pet-dot${busy ? ' is-busy' : ''}`} />
              {petName}
            </span>
            <div className="pet-bubble-tools">
              {has('web') && (
                <button
                  className={`mini-btn${webOn ? ' is-active' : ''}`}
                  title={webOn ? '关闭联网（本轮）' : '打开联网检索'}
                  onClick={() => setWebOn((value) => !value)}
                >
                  联网
                </button>
              )}
              {has('read') && (
                <button
                  className={`mini-btn${speak ? ' is-active' : ''}`}
                  title={speak ? '关闭朗读' : '朗读回答'}
                  onClick={toggleSpeak}
                >
                  朗读
                </button>
              )}
              {has('widget') && (
                <button
                  className={`mini-btn${widgetOpen ? ' is-active' : ''}`}
                  title="桌面小挂件（时钟 / 待办）"
                  onClick={() => {
                    setOpen(false);
                    setWidgetOpen((value) => !value);
                  }}
                >
                  挂件
                </button>
              )}
              <button
                className="pet-size"
                title={`气泡大小：${bubbleW}×${bubbleH}（点击切换紧凑 / 舒适 / 大窗）`}
                aria-label="切换气泡大小"
                onClick={() => cycleBubbleSize()}
              >
                ⤢
              </button>
              <button
                className="pet-close"
                title="关闭对话（Esc）"
                aria-label="关闭对话"
                onClick={() => {
                  setOpen(false);
                  setHistoryOpen(false);
                  void window.bsub.petBlur();
                }}
              >
                ×
              </button>
            </div>
          </div>

          {historyOpen && (
            <div className="pet-history-panel">
              <div className="pet-history-head">
                <span>历史记录</span>
                <button
                  className="pet-close"
                  title="关闭历史"
                  onClick={() => setHistoryOpen(false)}
                >
                  ×
                </button>
              </div>
              <input
                className="settings-input"
                placeholder="搜索历史…"
                value={historyQuery}
                onChange={(event) => setHistoryQuery(event.target.value)}
              />
              <div className="pet-history-list">
                {history
                  .filter((item) =>
                    item.text.toLowerCase().includes(historyQuery.trim().toLowerCase())
                  )
                  .slice(-40)
                  .reverse()
                  .map((item, index) => (
                    <button
                      key={`${item.role}-${index}`}
                      className={`pet-history-item is-${item.role}`}
                      title={item.text}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(item.text);
                          flash('已复制');
                        } catch {
                          flash('复制失败');
                        }
                      }}
                    >
                      <span className="pet-history-role">
                        {item.role === 'user' ? '我' : '答'}
                      </span>
                      <span className="pet-history-text">{item.text}</span>
                    </button>
                  ))}
                {!history.length && <div className="pet-history-empty">还没有历史</div>}
              </div>
            </div>
          )}

          <div className="pet-bubble-body" ref={bubbleBody}>
            {history.slice(-6).map((item, index) => (
              <div key={index} className={`pet-line is-${item.role}`}>
                {item.role === 'assistant' ? (
                  <>
                    <Markdown content={item.text} />
                    {safeSources(item.sources).length ? (
                      <div className="pet-sources">
                        {typeof item.webEngine === 'string' && item.webEngine && (
                          <div className="pet-sources-label">{item.webEngine}</div>
                        )}
                        {safeSources(item.sources).map((reference, sourceIndex) => (
                          <button
                            key={`${sourceIndex}-${reference.url}`}
                            className="pet-source"
                            title={reference.url}
                            onClick={() => void window.bsub.openExternal(reference.url)}
                          >
                            {reference.title || reference.url}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {typeof item.webNotice === 'string' && item.webNotice && (
                      <div className="pet-web-notice">{item.webNotice}</div>
                    )}
                  </>
                ) : (
                  item.text
                )}
              </div>
            ))}
            {busy && (
              <div className="pet-line is-assistant pet-stream">
                {answer || '思考中…'}
                <button className="mini-btn pet-stop" title="停止生成" onClick={stop}>
                  停止
                </button>
              </div>
            )}
            {error && (
              <div className="pet-line is-error">
                {error}
                <button className="mini-btn" style={{ marginLeft: 6 }} onClick={retry}>
                  重试
                </button>
                <button
                  className="mini-btn"
                  style={{ marginLeft: 4 }}
                  onClick={() => void window.bsub.openSettings()}
                >
                  打开设置
                </button>
              </div>
            )}
            {!history.length && !busy && !error && (
              <div className="pet-empty">
                <span>
                  <b>截图</b> 框选屏幕，识别图片 / 提取文字
                </span>
                <span>
                  <b>选中即问</b> 选中网页文字，一键解释或翻译
                </span>
                <span>
                  <b>联网</b> 打开后回答会带参考链接
                </span>
              </div>
            )}
          </div>

          {(shot || selection) && (
            <div className="pet-attach">
              {shot && (
                <div className="pet-shot">
                  <img src={shot} alt="当前页面截图" />
                  <span className="pet-shot-label">截图</span>
                  <button title="移除截图" onClick={() => setShot(null)}>
                    ×
                  </button>
                </div>
              )}
              {selection && (
                <div className="pet-selection" title={selection.text}>
                  <span>
                    选中：{selection.text.slice(0, 26)}
                    {selection.text.length > 26 ? '…' : ''}
                  </span>
                  <div className="pet-selection-actions">
                    <button
                      title="复制选中文字"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(selection.text);
                          flash('已复制选段');
                        } catch {
                          flash('复制失败');
                        }
                      }}
                    >
                      复制
                    </button>
                    <button
                      title="解释选中"
                      onClick={() => void askSelection(SELECTION_ACTIONS[0].prompt)}
                    >
                      解释
                    </button>
                    <button
                      title="翻译选中"
                      onClick={() => void askSelection(SELECTION_ACTIONS[1].prompt)}
                    >
                      翻译
                    </button>
                  </div>
                  <button title="移除选中内容" onClick={() => setSelection(null)}>
                    ×
                  </button>
                </div>
              )}
            </div>
          )}

          {shot && !busy && (
            <div className="pet-followups">
              <button className="mini-btn" onClick={() => void ask('这张图里是什么？', { image: shot })}>
                这是什么
              </button>
              <button className="mini-btn" onClick={() => void extractText(shot)}>
                提取文字
              </button>
              <button
                className="mini-btn"
                onClick={() => void ask('把这张图里的文字翻译成中文，保留原文结构。', { image: shot })}
              >
                翻译文字
              </button>
            </div>
          )}

          <div className="pet-quick">
            {has('screenshot') && (
              <button
                className="mini-btn primary"
                title="框选屏幕区域，再选识别图片 / 对话 / 提取文字"
                disabled={busy || shotBusy}
                onClick={() => void takeRegionShot()}
              >
                {shotBusy ? '截图中…' : '截图'}
              </button>
            )}
            {has('explain') && (
              <button
                className="mini-btn"
                disabled={busy}
                onClick={() => void askSelection(SELECTION_ACTIONS[0].prompt)}
              >
                解释选中
              </button>
            )}
            {has('translate') && (
              <button
                className="mini-btn"
                disabled={busy}
                onClick={() => void askSelection(SELECTION_ACTIONS[1].prompt)}
              >
                翻译选中
              </button>
            )}
            {has('voice') && (
              <button
                className={`mini-btn${recording ? ' is-active' : ''}`}
                title={recording ? '停止录音并识别' : '语音提问（也可以按 Ctrl+Shift+Space）'}
                disabled={busy && !recording}
                onClick={() => void startVoice()}
              >
                {recording ? '停止录音' : '语音'}
              </button>
            )}
            {has('clipboard') && (
              <button
                className="mini-btn"
                title="把剪贴板里的文字放进输入框"
                onClick={() => void pasteClipboard()}
              >
                粘贴板
              </button>
            )}
            {has('handoff') && (
              <button
                className="mini-btn"
                title="把当前问答交给主窗口继续"
                disabled={!answer && !history.some((item) => item.role === 'assistant')}
                onClick={() => void handoffToMain()}
              >
                主窗口
              </button>
            )}
            {has('note') && (
              <button
                className="mini-btn"
                title="把回答存进当前页面在字幕库里的笔记"
                disabled={!answer && !history.some((item) => item.role === 'assistant')}
                onClick={() => void saveAsNote()}
              >
                存笔记
              </button>
            )}
            {has('save') && (
              <button
                className="mini-btn"
                title="把回答存成一条待办"
                disabled={!answer && !history.some((item) => item.role === 'assistant')}
                onClick={() => void saveAnswerAsTodo()}
              >
                存待办
              </button>
            )}
            {has('copy') && (
              <button
                className="mini-btn"
                title="把回答复制到剪贴板"
                disabled={!answer && !history.some((item) => item.role === 'assistant')}
                onClick={() => void copyAnswer()}
              >
                {copied ? '已复制' : '复制'}
              </button>
            )}
          </div>

          {has('newChat') && history.length > 0 && (
            <div className="pet-reset-row">
              <button className="pet-reset" onClick={resetChat} title="清空上下文，重新开始">
                新对话
              </button>
            </div>
          )}

          <span
            className="pet-resize-edge is-right"
            title="拖动调整宽度"
            onMouseDown={(event) => startResize(event, { width: true })}
          />
          <span
            className={`pet-resize-edge ${below ? 'is-bottom' : 'is-top'}`}
            title="拖动调整高度"
            onMouseDown={(event) => startResize(event, { height: true })}
          />
          <span
            className="pet-resize"
            title="切换预设尺寸（也可以拖边缘自由调整）"
            onMouseDown={(event) => startResize(event)}
          />
          {resizing && (
            <span className="pet-size-badge">
              {resizing.w} × {resizing.h}
            </span>
          )}

          <div className="pet-bubble-input">
            <input
              ref={inputRef}
              value={input}
              placeholder={webOn ? '问点什么（本轮会联网）' : '问点什么，Enter 发送'}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) void ask(input);
                if (event.key === 'Escape') setOpen(false);
                if (event.key === 'ArrowUp' && event.currentTarget.selectionStart === 0) {
                  event.preventDefault();
                  recall(-1);
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  recall(1);
                }
              }}
            />
            <button
              className="mini-btn primary"
              disabled={busy || !input.trim()}
              onClick={() => void ask(input)}
            >
              发送
            </button>
          </div>
        </div>
      )}

      <button
        className={`pet-body${busy ? ' is-busy' : ''}`}
        title="点击聊天，拖动移动，双击打开主窗口"
        onMouseDown={startDrag}
        onClick={(event) => {
          const press = pressPoint.current;
          pressPoint.current = null;
          // 松开时的位置和按下时差超过 3px，说明刚才是在拖动，不能当点击。
          const moved =
            press &&
            (Math.abs(event.screenX - press.x) > 3 || Math.abs(event.screenY - press.y) > 3);
          if (moved || dragStarted.current) {
            dragStarted.current = false;
            return;
          }
          if (menuOpen) {
            setMenuOpen(false);
            return;
          }
          // 双击的第二次 click 不再触发单击动作，交给 onDoubleClick。
          if (event.detail > 1) return;
          if (clickAction === 'none') return;
          if (tapTimer.current) window.clearTimeout(tapTimer.current);
      if (mediaRecorder.current?.state === 'recording') mediaRecorder.current.stop();
      mediaStream.current?.getTracks().forEach((track) => track.stop());
          // 150ms 内没有第二次点击才执行单击动作，避免双击时气泡闪现。
          tapTimer.current = window.setTimeout(() => {
            tapTimer.current = null;
            if (soundOn) beep(volume);
            if (clickAction === 'screenshot') void takeRegionShot();
            else toggleOpen();
          }, 150);
        }}
        onDoubleClick={() => {
          if (tapTimer.current) {
            window.clearTimeout(tapTimer.current);
            tapTimer.current = null;
          }
          if (dblAction === 'main') void window.bsub.focusMain();
          else if (dblAction === 'screenshot') void takeRegionShot();
        }}
      >
        <span className="pet-glow" />
        <span className="pet-eye left" />
        <span className="pet-eye right" />
        <span className="pet-cheek left" />
        <span className="pet-cheek right" />
        <span className="pet-mouth" />
        {busy && <span className="pet-status" title="正在处理" />}
        {playing && <span className="pet-music">♪</span>}
        {emotion === 'sleeping' && <span className="pet-zzz">z z</span>}
      </button>
    </div>
  );
}
