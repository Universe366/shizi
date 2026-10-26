import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Copy, Download, FileText, GitBranch, Globe, History, ImagePlus, Loader2, Mic, Pencil, Plus, RotateCcw, Send, Sparkles, Square, Trash2, Volume2, Wrench, X } from 'lucide-react';
import type {
  AiPlatform,
  AssistantProfile,
  ChatApprovalEvent,
  ChatCompareResult,
  ChatConversation,
  ChatMessage,
  ChatToolEvent,
  ChatToolRecord,
  McpToolOption,
  PageContextSummary,
  PageInfo,
  SkillItem,
  StoredChatMessage,
  SubtitleLine,
  TabInfo,
  WebReference
} from '../../../shared/types';
import { Markdown } from './Markdown';
import { pickTrack, isVideoKey, videoKeyOf } from '../lib/video';
import { getAsrResult } from '../lib/asrStore';
import { speakText } from '../lib/speech';

const SUGGESTIONS = [
  '这个视频的核心观点是什么？',
  '列出视频里提到的数字、结论或方法',
  '有哪些地方值得质疑或需要补充？',
  '用 5 条以内总结这个视频'
];

const PAGE_SUGGESTIONS = [
  '用 5 条要点总结这个页面',
  '这篇内容里有哪些关键数字或结论？',
  '把我选中的内容解释得更通俗',
  '这个页面有哪些值得质疑的地方？'
];

/** 参考链接只显示域名，避免长 URL 把气泡撑开。 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** 历史记录来自 localStorage，渲染前过滤掉损坏/非 http(s) 的来源。 */
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

function chatStorageKey(videoKey: string): string {
  return videoKey ? `bsub-chat:${videoKey}` : '';
}

function loadChat(videoKey: string): ChatMessage[] {
  const key = chatStorageKey(videoKey);
  if (!key) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (item) =>
          item &&
          (item.role === 'user' || item.role === 'assistant') &&
          typeof item.content === 'string'
      )
      .slice(-60);
  } catch {
    return [];
  }
}

function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `c_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

function ReasoningBlock({ text, defaultOpen }: { text: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="chat-reasoning"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>💭 思考过程</summary>
      <pre>{text}</pre>
    </details>
  );
}

function fromStoredMessage(row: StoredChatMessage): ChatMessage {
  return {
    role: row.role,
    content: row.content,
    ...(row.reasoning ? { reasoning: row.reasoning } : {}),
    ...(row.images.length ? { images: row.images } : {}),
    ...(row.sources.length ? { sources: row.sources } : {}),
    ...(row.webEngine ? { webEngine: row.webEngine } : {}),
    ...(row.webNotice ? { webNotice: row.webNotice } : {}),
    ...(row.tools.length ? { tools: row.tools } : {})
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取录音失败'));
    reader.readAsDataURL(blob);
  });
}

/** 聊天图片压到最长边 1568px 的 JPEG：既省 token，也避免 chat.db 被 base64 撑爆。 */
async function compressImage(file: File): Promise<string> {
  try {
    const bitmap = await createImageBitmap(file);
    const maxSide = 1568;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas unavailable');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    return blobToDataUrl(file).catch(() => '');
  }
}

export function ChatPanel({
  activeTab,
  onOpenSettings
}: {
  activeTab: TabInfo | null;
  onOpenSettings: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [profiles, setProfiles] = useState<AssistantProfile[]>([]);
  const [profileId, setProfileId] = useState(() => {
    try {
      return localStorage.getItem('chat-profile') || '';
    } catch {
      return '';
    }
  });
  const [skillId, setSkillId] = useState('');
  const [sendOnEnter, setSendOnEnter] = useState(true);
  const [expandReasoning, setExpandReasoning] = useState(false);
  const [pageContext, setPageContext] = useState<PageContextSummary | null>(null);
  const [includePage, setIncludePage] = useState(true);
  const [webSearch, setWebSearch] = useState(() => {
    try {
      return localStorage.getItem('chat-web') === '1';
    } catch {
      return false;
    }
  });
  const [searchEnabled, setSearchEnabled] = useState(true);
  const [savedNotice, setSavedNotice] = useState('');
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [editingConversationId, setEditingConversationId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [toolPanelOpen, setToolPanelOpen] = useState(false);
  const [toolOptions, setToolOptions] = useState<McpToolOption[]>([]);
  const [toolSelection, setToolSelection] = useState<string[] | null>(() => {
    try {
      const raw = localStorage.getItem('chat-tools');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : null;
    } catch {
      return null;
    }
  });
  const [toolEvents, setToolEvents] = useState<ChatToolEvent[]>([]);
  const [approvals, setApprovals] = useState<ChatApprovalEvent[]>([]);
  const [platforms, setPlatforms] = useState<AiPlatform[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareSelection, setCompareSelection] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('chat-compare') || '[]');
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  });
  const [comparing, setComparing] = useState(false);
  const [comparison, setComparison] = useState<{
    question: string;
    results: ChatCompareResult[];
  } | null>(null);
  const toolEventsRef = useRef<ChatToolEvent[]>([]);
  const autoReadChatRef = useRef(false);
  const conversationRef = useRef<number | null>(null);
  const [voiceState, setVoiceState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunks = useRef<Blob[]>([]);
  const autoSaveRef = useRef<{ title: string; url: string } | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef('');
  const contextRef = useRef<{ info: PageInfo; lines: SubtitleLine[] } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const videoKey = videoKeyOf(activeTab?.url);
  const isVideoPage = isVideoKey(videoKey);

  const refreshConversations = async (): Promise<void> => {
    const response = await window.bsub.chatHistoryList(60);
    if (response.ok) setConversations(response.data);
  };

  /** 第一条消息时创建会话；之后沿用同一个会话 id。 */
  const ensureConversation = async (title: string): Promise<number | null> => {
    if (conversationRef.current) return conversationRef.current;
    const created = await window.bsub.chatHistoryCreate({
      title: title.trim().slice(0, 40) || '新对话',
      videoKey,
      videoTitle: activeTab?.title || '',
      profileId: profileId || undefined
    });
    if (!created.ok) return null;
    conversationRef.current = created.data.id;
    setConversationId(created.data.id);
    void refreshConversations();
    return created.data.id;
  };

  const openConversation = async (conversation: ChatConversation): Promise<void> => {
    if (streaming) return;
    const rows = await window.bsub.chatHistoryMessages(conversation.id);
    if (!rows.ok) return;
    conversationRef.current = conversation.id;
    setConversationId(conversation.id);
    setMessages(rows.data.map(fromStoredMessage));
    if (conversation.profileId) {
      setProfileId(conversation.profileId);
      try {
        localStorage.setItem('chat-profile', conversation.profileId);
      } catch {
        // ignore
      }
    } else {
      setProfileId('');
      try {
        localStorage.setItem('chat-profile', '');
      } catch {
        // ignore
      }
    }
    setHistoryOpen(false);
  };

  const removeConversation = async (id: number): Promise<void> => {
    if (streaming) return;
    const response = await window.bsub.chatHistoryDelete(id);
    if (!response.ok) return;
    if (conversationRef.current === id) {
      conversationRef.current = null;
      setConversationId(null);
      setMessages([]);
    }
    void refreshConversations();
  };

  const saveConversationTitle = async (): Promise<void> => {
    if (editingConversationId == null) return;
    const title = editingTitle.trim();
    if (title) await window.bsub.chatHistoryRename(editingConversationId, title);
    setEditingConversationId(null);
    setEditingTitle('');
    void refreshConversations();
  };

  const exportConversation = async (id: number): Promise<void> => {
    const response = await window.bsub.chatHistoryExport(id);
    if (response.ok && !response.data.canceled) {
      setSavedNotice(`已导出：${response.data.path || ''}`);
    }
  };

  const openToolPanel = async (): Promise<void> => {
    setComposerOpen(true);
    setToolPanelOpen(true);
    const response = await window.bsub.mcpAllTools();
    if (response.ok) setToolOptions(response.data);
    else setError(response.error);
  };

  const toggleTool = (id: string): void => {
    const all = toolOptions.map((tool) => tool.id);
    const current = toolSelection === null ? all : toolSelection;
    const next = current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id];
    setToolSelection(next);
    try {
      localStorage.setItem('chat-tools', JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const selectAllTools = (): void => {
    setToolSelection(null);
    try {
      localStorage.removeItem('chat-tools');
    } catch {
      // ignore
    }
  };

  const selectNoTools = (): void => {
    setToolSelection([]);
    try {
      localStorage.setItem('chat-tools', '[]');
    } catch {
      // ignore
    }
  };

  const respondApproval = async (
    approval: ChatApprovalEvent,
    allow: boolean
  ): Promise<void> => {
    setApprovals((previous) =>
      previous.filter((item) => item.approvalId !== approval.approvalId)
    );
    await window.bsub.chatApprove(approval.approvalId, allow);
  };

  const toggleComparePlatform = (id: string): void => {
    const next = compareSelection.includes(id)
      ? compareSelection.filter((item) => item !== id)
      : compareSelection.length >= 3
        ? compareSelection
        : [...compareSelection, id];
    setCompareSelection(next);
    try {
      localStorage.setItem('chat-compare', JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const runCompare = async (): Promise<void> => {
    if (comparing) return;
    if (compareSelection.length < 2) {
      setError('至少选择 2 个平台做对比');
      return;
    }
    const typing = input.trim();
    const question =
      typing || [...messages].reverse().find((message) => message.role === 'user')?.content || '';
    if (!question) {
      setError('先输入问题，或先发一条消息再对比');
      return;
    }
    const outgoing = typing
      ? [...messages, { role: 'user' as const, content: question }]
      : messages;
    setComparing(true);
    setError(null);
    try {
      const context = await ensureContext();
      const response = await window.bsub.chatCompare({
        info: context.info,
        lines: context.lines,
        messages: outgoing.slice(-16).map((message) => ({
          role: message.role,
          content: message.content
        })),
        platformIds: compareSelection,
        includePage
      });
      if (!response.ok) throw new Error(response.error);
      setComparison({ question, results: response.data });
      setCompareOpen(false);
      if (typing) setInput('');
    } catch (error) {
      setError(`多模型对比失败：${(error as Error).message}`);
    } finally {
      setComparing(false);
    }
  };

  const adoptComparison = async (result: ChatCompareResult): Promise<void> => {
    const question = comparison?.question;
    if (!question) return;
    const last = messages[messages.length - 1];
    const hasUser = last?.role === 'user' && last.content === question;
    const base = hasUser ? messages : [...messages, { role: 'user' as const, content: question }];
    setMessages([
      ...base,
      { role: 'assistant', content: result.text }
    ]);
    const conversation = await ensureConversation(question);
    if (conversation) {
      if (!hasUser) {
        await window.bsub.chatHistoryAppend(conversation, { role: 'user', content: question });
      }
      await window.bsub.chatHistoryAppend(conversation, {
        role: 'assistant',
        content: result.text,
        model: result.model
      });
      void refreshConversations();
    }
    setComparison(null);
  };

  useEffect(() => {
    void (async () => {
      const response = await window.bsub.getSettings();
      if (!response.ok) return;
      const items = response.data.settings.skills.items.filter(
        (item) => item.enabled && item.body.trim()
      );
      setSkills(items);
      setSkillId((current) => (items.some((item) => item.id === current) ? current : ''));
      setProfiles(response.data.settings.ai.profiles || []);
      setPlatforms(response.data.settings.ai.platforms || []);
      setProfileId((current) =>
        (response.data.settings.ai.profiles || []).some((profile) => profile.id === current)
          ? current
          : ''
      );
      setSendOnEnter(response.data.settings.ai.sendOnEnter !== false);
      setExpandReasoning(response.data.settings.ai.expandReasoning === true);
      autoReadChatRef.current = response.data.settings.tts?.autoRead?.chat === true;
      const searchOn = response.data.settings.search.enabled !== false;
      setSearchEnabled(searchOn);
      if (!searchOn) {
        setWebSearch(false);
        try {
          localStorage.setItem('chat-web', '0');
        } catch {
          // ignore
        }
      }
    })();
    return window.bsub.onSettingsChanged((snapshot) => {
      const searchOn = snapshot.settings.search.enabled !== false;
      setSearchEnabled(searchOn);
      setProfiles(snapshot.settings.ai.profiles || []);
      setPlatforms(snapshot.settings.ai.platforms || []);
      setProfileId((current) =>
        (snapshot.settings.ai.profiles || []).some((profile) => profile.id === current)
          ? current
          : ''
      );
      autoReadChatRef.current = snapshot.settings.tts?.autoRead?.chat === true;
      setSkillId((current) =>
        snapshot.settings.skills.items.some((item) => item.id === current) ? current : ''
      );
      if (!searchOn) {
        setWebSearch(false);
        try {
          localStorage.setItem('chat-web', '0');
        } catch {
          // ignore
        }
      }
    });
  }, []);

  useEffect(() => {
    if (requestRef.current) {
      void window.bsub.cancelChat(requestRef.current);
      requestRef.current = '';
    }
    contextRef.current = null;
    conversationRef.current = null;
    setConversationId(null);
    setMessages([]);
    setInput('');
    setStreamText('');
    setStatus('');
    setError(null);
    setStreaming(false);
    setImages([]);
    setSavedNotice('');
    let alive = true;
    const load = async () => {
      const list = await window.bsub.chatHistoryList(60);
      if (alive && list.ok) setConversations(list.data);
      if (!videoKey) return;
      const latest = await window.bsub.chatHistoryLatest(videoKey);
      if (!alive) return;
      if (latest.ok && latest.data) {
        const rows = await window.bsub.chatHistoryMessages(latest.data.id);
        if (!alive) return;
        conversationRef.current = latest.data.id;
        setConversationId(latest.data.id);
        if (latest.data.profileId) {
          setProfileId(latest.data.profileId);
          try {
            localStorage.setItem('chat-profile', latest.data.profileId);
          } catch {
            // ignore
          }
        } else {
          setProfileId('');
          try {
            localStorage.setItem('chat-profile', '');
          } catch {
            // ignore
          }
        }
        if (rows.ok) setMessages(rows.data.map(fromStoredMessage));
        const legacyKey = chatStorageKey(videoKey);
        if (legacyKey) {
          try {
            localStorage.removeItem(legacyKey);
          } catch {
            // ignore
          }
        }
        return;
      }
      // 旧版本只把对话存在 localStorage：首次进视频时迁移进数据库。
      const legacy = loadChat(videoKey);
      if (!legacy.length) return;
      const created = await window.bsub.chatHistoryCreate({
        title: legacy.find((message) => message.role === 'user')?.content.slice(0, 40) || '历史对话',
        videoKey,
        videoTitle: activeTab?.title || '',
        profileId: profileId || undefined
      });
      if (!alive || !created.ok) return;
      conversationRef.current = created.data.id;
      setConversationId(created.data.id);
      for (const message of legacy) {
        await window.bsub.chatHistoryAppend(created.data.id, {
          role: message.role,
          content: message.content,
          reasoning: message.reasoning,
          images: message.images,
          sources: message.sources,
          webEngine: message.webEngine,
          webNotice: message.webNotice
        });
      }
      setMessages(legacy);
      const legacyKey = chatStorageKey(videoKey);
      if (legacyKey) {
        try {
          localStorage.removeItem(legacyKey);
        } catch {
          // ignore
        }
      }
      const refreshed = await window.bsub.chatHistoryList(60);
      if (alive && refreshed.ok) setConversations(refreshed.data);
    };
    void load();
    return () => {
      alive = false;
    };
  }, [activeTab?.id, videoKey]);

  useEffect(() => {
    let alive = true;
    if (!activeTab || !/^https?:/i.test(activeTab.url)) {
      setPageContext(null);
      return;
    }
    void window.bsub.getPageContext().then((response) => {
      if (alive) setPageContext(response.ok ? response.data : null);
    });
    return () => {
      alive = false;
    };
  }, [activeTab?.id, activeTab?.url]);

  useEffect(() => {
    const offDelta = window.bsub.onChatDelta((event) => {
      if (event.requestId === requestRef.current) {
        if (event.delta) setStreamText((previous) => previous + event.delta);
      }
    });
    const offDone = window.bsub.onChatDone((event) => {
      if (event.requestId !== requestRef.current) return;
      // 来源只保留标题/链接/短摘要，避免 localStorage 被长正文撑爆。
      const sources = (event.references || []).map((reference) => ({
        ...reference,
        snippet: reference.snippet.slice(0, 240)
      }));
      const tools: ChatToolRecord[] = toolEventsRef.current
        .filter((tool) => tool.phase === 'done')
        .map((tool) => ({
          name: tool.name,
          ok: tool.ok !== false,
          detail: tool.detail || '',
          at: Date.now()
        }));
      setMessages((previous) => [
        ...previous,
        {
          role: 'assistant',
          content: event.text,
          reasoning: event.reasoning,
          ...(sources.length ? { sources } : {}),
          ...(event.webEngine ? { webEngine: event.webEngine } : {}),
          ...(event.webError ? { webNotice: event.webError } : {}),
          ...(tools.length ? { tools } : {})
        }
      ]);
      setToolEvents([]);
      toolEventsRef.current = [];
      setApprovals([]);
      if (autoReadChatRef.current && event.text.trim()) {
        void speakText(event.text);
      }
      const conversation = conversationRef.current;
      if (conversation) {
        void window.bsub.chatHistoryAppend(conversation, {
          role: 'assistant',
          content: event.text,
          reasoning: event.reasoning,
          model: event.model,
          sources,
          webEngine: event.webEngine,
          webNotice: event.webError,
          tools
        });
        void refreshConversations();
      }
      setStreaming(false);
      setStreamText('');
      setStatus('');
      requestRef.current = '';

      const pending = autoSaveRef.current;
      autoSaveRef.current = null;
      if (pending && event.text.trim()) {
        void window.bsub
          .savePageSummary({
            title: pending.title,
            url: pending.url,
            content: event.text,
            model: event.model
          })
          .then((response) => {
            if (response.ok) {
              setSavedNotice(
                response.data.created
                  ? '已存入资料库，可在「库」里查看'
                  : '已更新资料库里的网页总结'
              );
            } else {
              setError(`存入资料库失败：${response.error}`);
            }
          });
      }
    });
    const offError = window.bsub.onChatError((event) => {
      if (event.requestId !== requestRef.current) return;
      // 用户主动点「停止」不是回答失败，不要弹红色错误卡片。
      if (event.error === '已取消') {
        setStreaming(false);
        setStreamText('');
        setStatus('');
        requestRef.current = '';
        return;
      }
      setError(event.error);
      setStreaming(false);
      setStreamText('');
      setStatus('');
      setApprovals([]);
      requestRef.current = '';
    });
    const offStatus = window.bsub.onChatStatus((event) => {
      if (event.requestId === requestRef.current) setStatus(event.status);
    });
    const offApproval = window.bsub.onChatApproval((event) => {
      if (event.requestId !== requestRef.current) return;
      setApprovals((previous) => [
        ...previous.filter((item) => item.approvalId !== event.approvalId),
        event
      ]);
    });
    const offTool = window.bsub.onChatTool((event) => {      if (event.requestId !== requestRef.current) return;
      setToolEvents((previous) => {
        const next = [...previous];
        if (event.phase === 'start') {
          next.push(event);
        } else {
          for (let index = next.length - 1; index >= 0; index -= 1) {
            if (next[index].name === event.name && next[index].phase === 'start') {
              next[index] = { ...next[index], ...event, phase: 'done' };
              toolEventsRef.current = next;
              return next;
            }
          }
          next.push(event);
        }
        const trimmed = next.slice(-8);
        toolEventsRef.current = trimmed;
        return trimmed;
      });
    });
    return () => {
      offDelta();
      offDone();
      offError();
      offStatus();
      offTool();
      offApproval();
    };
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, streamText, status]);

  const addImages = async (files: File[]) => {
    const selected = files.filter((file) => file.type.startsWith('image/'));
    if (!selected.length) return;
    let next = [...images];
    for (const file of selected) {
      if (next.length >= 2) {
        setError('最多附带 2 张图片');
        break;
      }
      if (file.size > 5 * 1024 * 1024) {
        setError('图片不能超过 5MB');
        continue;
      }
      const data = await compressImage(file);
      if (data) next = [...next, data];
    }
    setImages(next.slice(0, 2));
  };

  // 切换页面后必须重新取上下文，不能沿用上一个视频的字幕。
  useEffect(() => {
    contextRef.current = null;
  }, [activeTab?.id, activeTab?.url, pageContext?.url]);

  useEffect(() => {
    const apply = (payload: { question: string; answer: string } | null) => {
      if (!payload || (!payload.question && !payload.answer)) return;
      contextRef.current = null;
      setMessages([
        { role: 'user', content: payload.question },
        { role: 'assistant', content: payload.answer }
      ]);
      setStreamText('');
      setError(null);
      setStreaming(false);
    };
    try {
      const stored = localStorage.getItem('chat-handoff');
      if (stored) {
        apply(JSON.parse(stored));
        localStorage.removeItem('chat-handoff');
      }
    } catch {
      // ignore
    }
    return window.bsub.onChatHandoff?.((payload) => apply(payload));
  }, []);

  const ensureContext = async () => {
    if (contextRef.current) return contextRef.current;
    const infoResponse = await window.bsub.getPageInfo();
    const info: PageInfo = infoResponse.ok
      ? infoResponse.data
      : {
          kind: 'page',
          bvid: null,
          aid: null,
          cid: null,
          epId: null,
          seasonId: null,
          page: 1,
          partTitle: '',
          parts: [],
          title: activeTab?.title || pageContext?.title || '当前页面',
          owner: '',
          desc: '',
          duration: 0,
          url: activeTab?.url || '',
          signature: ''
        };

    const fallback = (lines: SubtitleLine[] = []) => {
      const cached = getAsrResult(videoKey);
      const context = cached ? { info: cached.info, lines: cached.lines } : { info, lines };
      contextRef.current = context;
      return context;
    };

    // 非视频页只带页面信息，正文由主进程在发送时读取。
    if (!info.bvid && !info.epId) return fallback([]);

    const subtitles = await window.bsub.getSubtitles().catch(() => null);
    if (!subtitles || !subtitles.ok) return fallback([]);
    const track = pickTrack(subtitles.data.tracks, info);

    if (!track) return fallback([]);

    const body = await window.bsub.getTrackBody(track.url);
    if (!body.ok) return fallback([]);
    const context = { info, lines: body.data.lines };
    contextRef.current = context;
    return context;
  };

  const send = async (preset?: string, forcePage = false, base?: ChatMessage[]) => {
    const content = String(preset ?? input).trim();
    if ((!content && !images.length) || streaming) return;

    setInput('');
    setError(null);
    setStreaming(true);
    setStreamText('');
    setToolEvents([]);
    toolEventsRef.current = [];
    setApprovals([]);
    setStatus(isVideoPage ? '读取字幕…' : '读取页面…');

    const nextMessages: ChatMessage[] = [
      ...(base ?? messages),
      { role: 'user', content, ...(images.length ? { images } : {}) }
    ];
    const attachedImages = images;
    setMessages(nextMessages);
    setImages([]);

    void (async () => {
      const conversation = await ensureConversation(content || '图片提问');
      if (!conversation) return;
      await window.bsub.chatHistoryAppend(conversation, {
        role: 'user',
        content,
        images: attachedImages
      });
      void refreshConversations();
    })();

    try {
      const context = await ensureContext();
      setStatus('正在回答…');
      const requestId = newRequestId();
      requestRef.current = requestId;
      const started = await window.bsub.chat({
        requestId,
        info: context.info,
        lines: context.lines,
        messages: nextMessages,
        skillIds: skillId ? [skillId] : [],
        profileId: profileId || undefined,
        // 选了助手档案就由档案决定工具，避免手动勾选悄悄覆盖档案配置。
        mcpToolIds: profileId ? undefined : toolSelection ?? undefined,
        includePage: forcePage ? true : includePage,
        web: webSearch
      });
      if (!started.ok) throw new Error(started.error);
    } catch (caught) {
      setError((caught as Error).message);
      setStreaming(false);
      setStatus('');
      setStreamText('');
    }
  };

  const stop = () => {
    setApprovals([]);
    if (requestRef.current) void window.bsub.cancelChat(requestRef.current);
  };

  /** 重新生成最后一条回答：截断数据库与界面，再把同一个问题发一次。 */
  const regenerate = async () => {
    if (streaming) return;
    let assistantIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'assistant') {
        assistantIndex = index;
        break;
      }
    }
    if (assistantIndex < 0) return;
    const base = messages.slice(0, assistantIndex);
    const lastUser = [...base].reverse().find((message) => message.role === 'user');
    if (!lastUser) return;
    const conversation = conversationRef.current;
    if (conversation) await window.bsub.chatHistoryTruncate(conversation, base.length);
    setMessages(base);
    await send(lastUser.content, false, base);
  };

  /** 从第 index 条消息处分叉：复制到新会话，原会话保留。 */
  const branchAt = async (index: number): Promise<void> => {
    if (streaming || !conversationRef.current) return;
    const response = await window.bsub.chatHistoryBranch(conversationRef.current, index + 1);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    if (!response.data) return;
    const created = response.data;
    conversationRef.current = created.id;
    setConversationId(created.id);
    setMessages((previous) => previous.slice(0, index + 1));
    if (created.profileId) {
      setProfileId(created.profileId);
      try {
        localStorage.setItem('chat-profile', created.profileId);
      } catch {
        // ignore
      }
    }
    setSavedNotice('已创建对话分支，可以继续追问');
    void refreshConversations();
  };

  /** 编辑某条用户消息：先把这条之后的内容从界面和数据库里删掉。 */
  const editMessage = async (index: number) => {
    if (streaming) return;
    const target = messages[index];
    if (!target || target.role !== 'user') return;
    const conversation = conversationRef.current;
    if (conversation) await window.bsub.chatHistoryTruncate(conversation, index);
    setMessages(messages.slice(0, index));
    setInput(target.content);
  };

  const summarizePage = () => {
    if (!activeTab || isVideoPage || streaming) return;
    autoSaveRef.current = { title: activeTab.title || pageContext?.title || activeTab.url, url: activeTab.url };
    setSavedNotice('');
    void send('用 5 条要点总结当前页面，先给结论，再列依据。', true);
  };

  const saveAnswer = async () => {
    if (!activeTab || isVideoPage) return;
    const last = [...messages].reverse().find((message) => message.role === 'assistant');
    if (!last?.content.trim()) return;
    const response = await window.bsub.savePageSummary({
      title: activeTab.title || pageContext?.title || activeTab.url,
      url: activeTab.url,
      content: last.content,
      model: 'AI'
    });
    if (response.ok) {
      setSavedNotice(response.data.created ? '已存入资料库，可在「库」里查看' : '已更新资料库里的网页总结');
    } else {
      setError(`存入资料库失败：${response.error}`);
    }
  };

  // Ctrl+Shift+S：把当前选中内容带进对话。
  useEffect(() => {
    const handler = () => {
      void send('解释我选中的这段内容');
    };
    window.addEventListener('bsub:ask-selection', handler);
    return () => window.removeEventListener('bsub:ask-selection', handler);
  }, [send]);

  // 网页里的划词工具条：解释 / 翻译 / 总结。
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string; text?: string }>).detail || {};
      const text = String(detail.text || '').trim();
      if (!text) return;
      const clipped = text.length > 1500 ? `${text.slice(0, 1500)}…` : text;
      const action = detail.action || 'explain';
      const label =
        action === 'translate'
          ? '翻译成中文（原文是中文就翻译成英文）'
          : action === 'summarize'
            ? '用要点总结'
            : '解释';
      void send(`请${label}下面这段选中的内容：\n"""\n${clipped}\n"""`, true);
    };
    window.addEventListener('bsub:selection-action', handler);
    return () => window.removeEventListener('bsub:selection-action', handler);
  }, [send]);

  // 阅读模式的「AI 总结」。
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string }>).detail || {};
      void send(detail.text || '用 5 条要点总结这个页面，先给结论，再列依据。', true);
    };
    window.addEventListener('bsub:reader-summary', handler);
    return () => window.removeEventListener('bsub:reader-summary', handler);
  }, [send]);

  const clear = () => {
    if (requestRef.current) void window.bsub.cancelChat(requestRef.current);
    requestRef.current = '';
    const key = chatStorageKey(videoKey);
    if (key) {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
    }
    conversationRef.current = null;
    setConversationId(null);
    setMessages([]);
    setImages([]);
    setStreamText('');
    setStatus('');
    setError(null);
    setStreaming(false);
  };

  /** 麦克风输入：录一段音，交给主进程走现有 ASR，再填进输入框。 */
  const toggleVoice = async () => {
    if (voiceState === 'recording') {
      recorderRef.current?.stop();
      return;
    }
    if (voiceState !== 'idle') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderChunks.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) recorderChunks.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setVoiceState('transcribing');
        try {
          const blob = new Blob(recorderChunks.current, {
            type: recorder.mimeType || 'audio/webm'
          });
          const dataUrl = await blobToDataUrl(blob);
          const response = await window.bsub.transcribeVoice(dataUrl);
          if (response.ok && response.data.text.trim()) {
            const text = response.data.text.trim();
            setInput((previous) => (previous.trim() ? `${previous.trim()} ${text}` : text));
          } else {
            setError(response.ok ? '没有识别到语音' : response.error);
          }
        } catch (voiceError) {
          setError(`语音识别失败：${(voiceError as Error).message}`);
        } finally {
          setVoiceState('idle');
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setVoiceState('recording');
      setError(null);
    } catch (voiceError) {
      setError(`无法使用麦克风：${(voiceError as Error).message}`);
    }
  };

  const showSettingsHint = Boolean(error) && /Key|模型|平台|设置|401|403|404/.test(error || '');

  return (
    <div className="panel chat-panel">
      <div className="panel-toolbar">
        <div className="panel-title">对话</div>
        <div className="toolbar-actions">
          {activeTab && !isVideoPage && (
            <button
              className="mini-btn"
              disabled={streaming}
              title="总结当前网页，并把结果存入本地库"
              onClick={summarizePage}
            >
              总结本页
            </button>
          )}
          {activeTab && !isVideoPage && messages.some((message) => message.role === 'assistant') && (
            <button
              className="mini-btn"
              disabled={streaming}
              title="把最近一条回答存为这个网页的总结"
              onClick={() => void saveAnswer()}
            >
              存入库
            </button>
          )}
          <button
            className="mini-btn"
            disabled={streaming}
            onClick={() => setHistoryOpen((value) => !value)}
            title="历史对话"
          >
            <History size={12} /> 历史
          </button>
          <button
            className="mini-btn"
            disabled={(!messages.length && !streaming) || streaming}
            onClick={clear}
            title="开始新对话（旧对话保留在历史里）"
          >
            <Plus size={12} /> 新对话
          </button>
          {streaming && (
            <button className="mini-btn" onClick={stop} title="停止回答">
              <Square size={11} /> 停止
            </button>
          )}
        </div>
      </div>

      {historyOpen && (
        <div className="chat-history-panel">
          <div className="chat-history-head">
            <span>历史对话（{conversations.length}）</span>
            <button className="mini-btn" onClick={() => void refreshConversations()}>
              刷新
            </button>
          </div>
          <input
            className="settings-input chat-history-search"
            placeholder="搜索标题 / 视频"
            value={historyQuery}
            spellCheck={false}
            onChange={(event) => setHistoryQuery(event.target.value)}
          />
          {!conversations.length && (
            <div className="settings-hint">还没有历史对话，发第一句话就会保存。</div>
          )}
          {conversations
            .filter((conversation) => {
              const query = historyQuery.trim().toLowerCase();
              if (!query) return true;
              return `${conversation.title} ${conversation.videoTitle}`
                .toLowerCase()
                .includes(query);
            })
            .map((conversation) => (
            <div
              key={conversation.id}
              className={`chat-history-row${conversationId === conversation.id ? ' is-active' : ''}`}
            >
              {editingConversationId === conversation.id ? (
                <input
                  className="settings-input chat-history-rename"
                  autoFocus
                  value={editingTitle}
                  onChange={(event) => setEditingTitle(event.target.value)}
                  onBlur={() => void saveConversationTitle()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void saveConversationTitle();
                    if (event.key === 'Escape') {
                      setEditingConversationId(null);
                      setEditingTitle('');
                    }
                  }}
                />
              ) : (
                <button
                  className="chat-history-main"
                  onClick={() => void openConversation(conversation)}
                >
                  <span className="chat-history-title">{conversation.title}</span>
                  <span className="chat-history-meta">
                    {[
                      conversation.videoTitle,
                      profiles.find((profile) => profile.id === conversation.profileId)?.name,
                      `${conversation.messageCount} 条`,
                      new Date(conversation.updatedAt).toLocaleString('zh-CN')
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              )}
              <button
                className="chat-action"
                title="重命名"
                onClick={() => {
                  setEditingConversationId(conversation.id);
                  setEditingTitle(conversation.title);
                }}
              >
                <Pencil size={11} />
              </button>
              <button
                className="chat-action"
                title="导出 Markdown"
                onClick={() => void exportConversation(conversation.id)}
              >
                <Download size={11} />
              </button>
              <button
                className="chat-action"
                title="删除对话"
                onClick={() => void removeConversation(conversation.id)}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {!activeTab && <div className="panel-empty">打开一个网页或视频后开始对话</div>}

      {activeTab && (
        <div className="chat-body" ref={scrollRef}>
          {!messages.length && !streaming && (
            <div className="chat-empty">
              <div className="chat-empty-title">{isVideoPage ? '基于本片字幕提问' : '就当前页面提问'}</div>
              <div className="chat-empty-desc">
                {isVideoPage
                  ? '会先读取当前视频字幕，再让设置里的 AI 平台回答。'
                  : '会读取当前网页正文和你选中的内容，再让设置里的 AI 平台回答。'}
              </div>
              <div className="chat-suggestions">
                {(isVideoPage ? SUGGESTIONS : PAGE_SUGGESTIONS).map((suggestion) => (
                  <button
                    key={suggestion}
                    className="chat-suggestion"
                    onClick={() => void send(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}-${message.content.slice(0, 16)}`}
              className={`chat-msg ${message.role}`}
            >
              {message.role === 'assistant' && <div className="chat-avatar">AI</div>}
              <div className="chat-bubble">
                {message.role === 'assistant' ? (
                  <>
                    {message.reasoning && (
                      <ReasoningBlock text={message.reasoning} defaultOpen={expandReasoning} />
                    )}
                    <Markdown content={message.content} />
                    {safeSources(message.sources).length > 0 && (
                      <div className="chat-sources">
                        <div className="chat-sources-title">
                          参考来源 · {safeSources(message.sources).length}
                          {typeof message.webEngine === 'string' && message.webEngine
                            ? ` · ${message.webEngine}`
                            : ''}
                        </div>
                        {safeSources(message.sources).map((reference, sourceIndex) => (
                          <button
                            key={`${sourceIndex}-${reference.url}`}
                            className="chat-source"
                            title={reference.url}
                            onClick={() => void window.bsub.openExternal(reference.url)}
                          >
                            <span className="chat-source-title">
                              {reference.title || reference.url}
                            </span>
                            <span className="chat-source-site">{hostOf(reference.url)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {typeof message.webNotice === 'string' && message.webNotice && (
                      <div className="chat-web-notice" title={message.webNotice}>
                        {message.webNotice}
                      </div>
                    )}
                    {message.tools?.length ? (
                      <details className="chat-tool-history">
                        <summary>工具调用 {message.tools.length} 次</summary>
                        <div className="chat-tool-cards">
                          {message.tools.map((tool, toolIndex) => (
                            <div
                              key={`${tool.name}-${toolIndex}`}
                              className={`chat-tool-card${tool.ok ? '' : ' is-error'}`}
                            >
                              <div className="chat-tool-head">
                                <span className="chat-tool-name">{tool.name}</span>
                                <span className="chat-tool-state">
                                  {tool.ok ? '完成' : '失败'}
                                </span>
                              </div>
                              {tool.detail && (
                                <div className="chat-tool-detail">{tool.detail}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}
                    <div className="chat-msg-actions">
                      <button
                        className="chat-action"
                        title="朗读回答"
                        onClick={() => void speakText(message.content)}
                      >
                        <Volume2 size={11} />
                      </button>
                      <button
                        className="chat-action"
                        title="复制回答"
                        onClick={() => void window.bsub.writeClipboard(message.content)}
                      >
                        <Copy size={11} />
                      </button>
                      <button
                        className="chat-action"
                        title="从此回答新建分支"
                        onClick={() => void branchAt(index)}
                      >
                        <GitBranch size={11} />
                      </button>
                      {index === messages.length - 1 && (
                        <button
                          className="chat-action"
                          title="重新生成"
                          onClick={() => void regenerate()}
                        >
                          <RotateCcw size={11} />
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    {message.images?.length ? (
                      <div className="chat-images">
                        {message.images.map((src, imageIndex) => (
                          <img
                            key={`${imageIndex}-${src.slice(-12)}`}
                            className="chat-image"
                            src={src}
                            alt=""
                          />
                        ))}
                      </div>
                    ) : null}
                    <div>{message.content}</div>
                    <div className="chat-msg-actions">
                      <button
                        className="chat-action"
                        title="从这条消息新建分支"
                        onClick={() => void branchAt(index)}
                      >
                        <GitBranch size={11} />
                      </button>
                      <button
                        className="chat-action"
                        title="编辑这条消息并重发"
                        onClick={() => void editMessage(index)}
                      >
                        <Pencil size={11} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}

          {toolEvents.length > 0 && (
            <div className="chat-tool-cards">
              <div className="chat-tool-cards-title">本轮工具调用</div>
              {toolEvents.map((tool, toolIndex) => (
                <div
                  key={`${tool.name}-${toolIndex}-${tool.phase}`}
                  className={`chat-tool-card${tool.ok === false ? ' is-error' : ''}`}
                >
                  <div className="chat-tool-head">
                    <span className="chat-tool-name">{tool.name}</span>
                    <span className="chat-tool-state">
                      {tool.phase === 'start' ? '调用中…' : tool.ok === false ? '失败' : '完成'}
                    </span>
                  </div>
                  {tool.detail && <div className="chat-tool-detail">{tool.detail}</div>}
                </div>
              ))}
            </div>
          )}

          {streaming && (
            <div className="chat-msg assistant">
              <div className="chat-avatar">AI</div>
              <div className="chat-bubble">
                {streamText ? (
                  <Markdown content={streamText} />
                ) : (
                  <span className="chat-thinking">
                    <Loader2 size={12} className="spin" /> {status || '正在思考…'}
                  </span>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="warn-card">
              <AlertTriangle size={15} />
              <div className="warn-body">
                <div className="warn-title">回答失败</div>
                <div className="warn-desc">{error}</div>
                {showSettingsHint && (
                  <button className="warn-btn" onClick={onOpenSettings}>
                    去设置
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {images.length > 0 && (
        <div className="chat-image-preview">
          {images.map((src, index) => (
            <div key={`${index}-${src.slice(-12)}`} className="chat-thumb">
              <img src={src} alt="" />
              <button
                className="chat-thumb-remove"
                title="移除图片"
                onClick={() => setImages(images.filter((_, item) => item !== index))}
              >
                <X size={9} />
              </button>
            </div>
          ))}
        </div>
      )}

      {savedNotice && <div className="status-line chat-saved">{savedNotice}</div>}

      {approvals.length > 0 && (
        <div className="chat-approval-list">
          {approvals.map((approval) => (
            <div key={approval.approvalId} className="chat-approval-card">
              <div className="chat-approval-title">
                工具「{approval.name}」请求执行，是否允许？
              </div>
              <pre className="chat-approval-args">{approval.detail || '{}'}</pre>
              <div className="chat-approval-actions">
                <button
                  className="mini-btn primary"
                  onClick={() => void respondApproval(approval, true)}
                >
                  允许
                </button>
                <button
                  className="mini-btn"
                  onClick={() => void respondApproval(approval, false)}
                >
                  拒绝
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {composerOpen && activeTab && (
        <div className="chat-menu">
          <div className="chat-menu-head">
            <div>
              <div className="chat-menu-title">更多工具</div>
              <div className="chat-menu-desc">按需打开；选项会自动记住</div>
            </div>
            <button
              className="icon-btn"
              title="收起"
              onClick={() => {
                setComposerOpen(false);
                setToolPanelOpen(false);
                setCompareOpen(false);
              }}
            >
              <X size={13} />
            </button>
          </div>
          <div className="chat-menu-grid">
            <button className="chat-menu-card" onClick={() => void openToolPanel()}>
              <Wrench size={15} />
              <span className="chat-menu-card-title">MCP 工具</span>
              <span className="chat-menu-card-desc">
                {toolSelection === null ? '全部可用工具' : `已选 ${toolSelection.length} 个`}
              </span>
            </button>
            <button
              className="chat-menu-card"
              onClick={() => {
                setCompareOpen(true);
                setToolPanelOpen(false);
              }}
            >
              <Sparkles size={15} />
              <span className="chat-menu-card-title">多模型对比</span>
              <span className="chat-menu-card-desc">两个以上平台并排回答</span>
            </button>
            <button className="chat-menu-card" onClick={() => imageInputRef.current?.click()}>
              <ImagePlus size={15} />
              <span className="chat-menu-card-title">添加图片</span>
              <span className="chat-menu-card-desc">也可直接粘贴或拖入</span>
            </button>
            <button className="chat-menu-card" onClick={clear}>
              <Plus size={15} />
              <span className="chat-menu-card-title">新对话</span>
              <span className="chat-menu-card-desc">旧对话保留在历史里</span>
            </button>
          </div>
          <div className="chat-menu-row">
            <span className="chat-menu-row-label">助手档案</span>
            <select
              className="settings-input chat-profile-select"
              title="助手档案：提示词 / 模型 / 技能 / 工具 / 联网"
              value={profileId}
              onChange={(event) => {
                const next = event.target.value;
                setProfileId(next);
                try {
                  localStorage.setItem('chat-profile', next);
                } catch {
                  // ignore
                }
                const target = profiles.find((profile) => profile.id === next);
                if (target?.web) {
                  setWebSearch(true);
                  try {
                    localStorage.setItem('chat-web', '1');
                  } catch {
                    // ignore
                  }
                }
                if (conversationRef.current) {
                  void window.bsub.chatHistoryProfile(conversationRef.current, next);
                }
              }}
            >
              <option value="">无助手档案</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.icon} {profile.name}
                </option>
              ))}
            </select>
          </div>
          <label className="chat-menu-row chat-menu-toggle">
            <span className="chat-menu-row-label">页面上下文</span>
            <span className="chat-menu-row-desc">
              {pageContext?.chars
                ? `约 ${pageContext.chars.toLocaleString('zh-CN')} 字`
                : '把当前网页正文一并带给 AI'}
            </span>
            <input
              type="checkbox"
              checked={includePage}
              onChange={(event) => setIncludePage(event.target.checked)}
            />
          </label>
          <label className="chat-menu-row chat-menu-toggle">
            <span className="chat-menu-row-label">联网检索</span>
            <span className="chat-menu-row-desc">
              {searchEnabled ? '本轮强制联网并列出参考' : '未启用，先去设置开启'}
            </span>
            <input
              type="checkbox"
              checked={webSearch}
              disabled={!searchEnabled}
              onChange={(event) => {
                const next = event.target.checked;
                setWebSearch(next);
                try {
                  localStorage.setItem('chat-web', next ? '1' : '0');
                } catch {
                  // ignore
                }
              }}
            />
          </label>
          {skills.length > 0 && (
            <div className="chat-menu-row">
              <span className="chat-menu-row-label">技能</span>
              <select
                className="settings-input chat-profile-select"
                title="选择本轮使用的技能"
                value={skillId}
                disabled={streaming}
                onChange={(event) => setSkillId(event.target.value)}
              >
                <option value="">不使用技能</option>
                {skills.map((skill) => (
                  <option key={skill.id} value={skill.id}>
                    {skill.icon || '✨'} {skill.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {toolPanelOpen && (
            <div className="chat-tool-panel">
              {profileId && (
                <div className="settings-hint">
                  当前使用助手档案，工具由档案的「MCP 工具」设置决定；想手动勾选请先切回「无助手档案」。
                </div>
              )}
              <div className="chat-tool-panel-head">
                <span>
                  本轮可用工具（{toolSelection === null ? '全部' : toolSelection.length}）
                </span>
                <button className="mini-btn" onClick={selectAllTools}>
                  全选
                </button>
                <button className="mini-btn" onClick={selectNoTools}>
                  不用 MCP
                </button>
              </div>
              {!toolOptions.length && (
                <div className="settings-hint">
                  没有可用工具：先在「设置 → 插件与集成 → MCP」添加并启用服务。
                </div>
              )}
              {toolOptions.map((tool) => {
                const checked = toolSelection === null || toolSelection.includes(tool.id);
                return (
                  <label key={tool.id} className="chat-tool-option" title={tool.description}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTool(tool.id)}
                    />
                    <span>
                      {tool.serverName} · {tool.name}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          {compareOpen && (
            <div className="chat-compare-panel">
              <div className="settings-hint">
                选 2–3 个平台，用同一个问题并排回答；对比模式不启用 MCP 工具与联网。
              </div>
              <div className="chat-compare-options">
                {platforms.map((platform) => {
                  const checked = compareSelection.includes(platform.id);
                  return (
                    <label key={platform.id} className="chat-tool-option" title={platform.model}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!checked && compareSelection.length >= 3}
                        onChange={() => toggleComparePlatform(platform.id)}
                      />
                      <span>
                        {platform.name} · {platform.model}
                      </span>
                    </label>
                  );
                })}
              </div>
              <button
                className="mini-btn primary"
                disabled={compareSelection.length < 2 || comparing}
                onClick={() => void runCompare()}
              >
                {comparing ? <Loader2 size={12} className="spin" /> : null}
                开始对比
              </button>
            </div>
          )}
        </div>
      )}

      <div
        className="chat-composer"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void addImages(Array.from(event.dataTransfer.files));
        }}
      >
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(event) => {
            void addImages(Array.from(event.target.files || []));
            event.target.value = '';
          }}
        />
        <textarea
          className="chat-input"
          rows={2}
          value={input}
          placeholder={
            activeTab
              ? `就当前页面提问…（${sendOnEnter ? 'Enter' : 'Ctrl+Enter'} 发送）`
              : '打开网页后可用'
          }
          disabled={!activeTab}
          onChange={(event) => setInput(event.target.value)}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files || []);
            if (files.some((file) => file.type.startsWith('image/'))) {
              event.preventDefault();
              void addImages(files);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === '/' && !input.trim()) {
              event.preventDefault();
              setComposerOpen(true);
              return;
            }
            const enterSends = sendOnEnter
              ? event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey
              : event.key === 'Enter' && (event.ctrlKey || event.metaKey);
            if (enterSends) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="chat-composer-bar">
          <div className="chat-bar-left">
            <button
              className={`icon-btn${composerOpen ? ' is-active' : ''}`}
              title="更多工具（输入 / 也可打开）"
              onClick={() => setComposerOpen((value) => !value)}
            >
              <Plus size={14} />
            </button>
            <button
              className={`chat-chip${includePage ? ' is-on' : ''}`}
              title={includePage ? '本次会带上当前网页正文' : '不带当前网页正文'}
              onClick={() => setIncludePage((value) => !value)}
            >
              <FileText size={12} /> 页面
            </button>
            <button
              className={`chat-chip${webSearch ? ' is-on' : ''}`}
              title={
                searchEnabled
                  ? webSearch
                    ? '本次会联网检索并列出参考'
                    : '本次不联网'
                  : '联网检索未启用，去设置开启'
              }
              disabled={!searchEnabled}
              onClick={() => {
                const next = !webSearch;
                setWebSearch(next);
                try {
                  localStorage.setItem('chat-web', next ? '1' : '0');
                } catch {
                  // ignore
                }
              }}
            >
              <Globe size={12} /> 联网
            </button>
            {profiles.find((profile) => profile.id === profileId) && (
              <button
                className="chat-chip is-on chat-chip-profile"
                title="当前助手档案，点击切换"
                onClick={() => setComposerOpen(true)}
              >
                {profiles.find((profile) => profile.id === profileId)?.icon}{' '}
                {profiles.find((profile) => profile.id === profileId)?.name}
              </button>
            )}
          </div>
          <div className="chat-bar-right">
            <span className="chat-token-hint" title="输入与页面正文的粗略估算">
              ≈{' '}
              {Math.ceil(
                ((input.length || 0) + (includePage ? pageContext?.chars || 0 : 0)) / 1.6
              ).toLocaleString('zh-CN')}
            </span>
            <button
              className={`icon-btn${voiceState === 'recording' ? ' is-recording' : ''}`}
              title={
                voiceState === 'recording'
                  ? '停止录音并识别'
                  : voiceState === 'transcribing'
                    ? '正在识别…'
                    : '语音输入'
              }
              disabled={!activeTab || streaming || voiceState === 'transcribing'}
              onClick={() => void toggleVoice()}
            >
              {voiceState === 'transcribing' ? (
                <Loader2 size={14} className="spin" />
              ) : voiceState === 'recording' ? (
                <Square size={14} />
              ) : (
                <Mic size={14} />
              )}
            </button>
            <button
              className="chat-send"
              disabled={!activeTab || (!input.trim() && !images.length) || streaming}
              onClick={() => void send()}
              title="发送"
            >
              <Send size={12} /> 发送
            </button>
          </div>
        </div>
      </div>

      {comparison && (
        <div className="compare-overlay" onClick={() => setComparison(null)}>
          <div className="compare-modal" onClick={(event) => event.stopPropagation()}>
            <div className="compare-head">
              <span>多模型对比 · {comparison.question.slice(0, 50)}</span>
              <button className="icon-btn" onClick={() => setComparison(null)}>
                <X size={14} />
              </button>
            </div>
            <div className="compare-grid">
              {comparison.results.map((result) => (
                <div key={result.platformId} className="compare-col">
                  <div className="compare-title">
                    {result.platformName}
                    <span>{result.model}</span>
                  </div>
                  {result.error ? (
                    <div className="compare-error">{result.error}</div>
                  ) : (
                    <div className="compare-body">
                      <Markdown content={result.text} />
                    </div>
                  )}
                  <div className="compare-actions">
                    <button
                      className="mini-btn"
                      disabled={!result.text}
                      onClick={() => void window.bsub.writeClipboard(result.text)}
                    >
                      复制
                    </button>
                    <button
                      className="mini-btn primary"
                      disabled={!result.text}
                      onClick={() => void adoptComparison(result)}
                    >
                      采用
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
