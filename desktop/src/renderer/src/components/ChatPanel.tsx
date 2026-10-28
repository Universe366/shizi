import { Fragment, useEffect, useRef, useState } from 'react';
import { EmptyState } from './ui/EmptyState';
import { ProviderBrandIcon } from './settings/ProviderBrandIcon';
import { AlertTriangle, AtSign, Captions, Copy, Download, Eraser, FileText, GitBranch, Globe, History, ImagePlus, List, Loader2, Mic, Pencil, Plus, Quote, RotateCcw, Search, Send, Sparkles, Square, Trash2, Volume2, Wrench, X } from 'lucide-react';
import {
  capabilityKey,
  effectiveContextWindow,
  effectiveModelCapabilities,
  formatContextWindow
} from '../../../shared/modelCapabilities';
import { describeMcpParameters } from '../../../shared/mcpSchema';
import { contextMessages, formatConversationReference } from '../../../shared/chatContext';
import { estimateMessagesTokens, estimateTextTokens } from '../../../shared/chatTokens';
import { formatTokens } from '../lib/usageStats';
import type {
  AiPlatform,
  AssistantProfile,
  ChatApprovalEvent,
  ChatAttachment,
  ChatCompareResult,
  ChatConversation,
  ChatMessage,
  ChatToolEvent,
  ChatToolRecord,
  McpElicitationAction,
  McpElicitationRequest,
  McpPromptOption,
  McpResourceOption,
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
    ...(row.tools.length ? { tools: row.tools } : {}),
    ...(row.attachments.length ? { attachments: row.attachments } : {}),
    ...(row.compare?.length ? { compare: row.compare } : {}),
    ...(row.usage ? { usage: row.usage } : {})
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
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [quote, setQuote] = useState<ChatMessage | null>(null);
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
  const [includeTranscript, setIncludeTranscript] = useState(() => {
    try {
      return localStorage.getItem('chat-transcript') !== '0';
    } catch {
      return true;
    }
  });
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
  const [toolPanelMode, setToolPanelMode] = useState<'tools' | 'prompts' | 'resources'>(
    'tools'
  );
  const [promptOptions, setPromptOptions] = useState<McpPromptOption[]>([]);
  const [resourceOptions, setResourceOptions] = useState<McpResourceOption[]>([]);
  const [mcpPanelBusy, setMcpPanelBusy] = useState(false);
  const [mcpPanelNotice, setMcpPanelNotice] = useState('');
  const [promptForm, setPromptForm] = useState<{
    option: McpPromptOption;
    args: Record<string, string>;
  } | null>(null);
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
  const [contextStart, setContextStart] = useState<number | null>(null);
  const [queue, setQueue] = useState<
    Array<{
      text: string;
      images: string[];
      attachments: ChatAttachment[];
      quote: ChatMessage | null;
    }>
  >([]);
  const [queuePaused, setQueuePaused] = useState(false);
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [messageSearchQuery, setMessageSearchQuery] = useState('');
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [elicitations, setElicitations] = useState<McpElicitationRequest[]>([]);
  const [elicitValues, setElicitValues] = useState<
    Record<string, Record<string, string | boolean>>
  >({});
  const [platforms, setPlatforms] = useState<AiPlatform[]>([]);
  const [activeAiId, setActiveAiId] = useState('');
  const [defaultModel, setDefaultModelState] = useState<{
    platformId: string;
    model: string;
  } | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState('');
  const [modelOverride, setModelOverride] = useState<{
    platformId: string;
    model: string;
  } | null>(null);
  const [capabilityOverrides, setCapabilityOverrides] = useState<
    Record<string, { vision?: boolean; audio?: boolean; contextWindow?: number }>
  >({});
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef('');
  const contextRef = useRef<{ info: PageInfo; lines: SubtitleLine[] } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const videoKey = videoKeyOf(activeTab?.url);
  const isVideoPage = isVideoKey(videoKey);
  const currentProfile = profiles.find((profile) => profile.id === profileId);
  const defaultPlatform = platforms.find(
    (platform) => platform.id === defaultModel?.platformId && platform.enabled !== false
  );
  const overridePlatform = platforms.find(
    (platform) => platform.id === modelOverride?.platformId && platform.enabled !== false
  );
  const currentPlatform =
    (currentProfile
      ? platforms.find((platform) => platform.id === currentProfile.platformId)
      : undefined) ||
    overridePlatform ||
    defaultPlatform ||
    platforms.find((platform) => platform.id === activeAiId);
  const currentModel =
    currentProfile?.model ||
    (overridePlatform ? modelOverride?.model || overridePlatform.model : '') ||
    (defaultPlatform ? defaultModel?.model || defaultPlatform.model : '') ||
    currentPlatform?.model ||
    '';
  const currentCapabilities = effectiveModelCapabilities(
    currentPlatform?.kind,
    currentModel,
    capabilityOverrides[capabilityKey(currentPlatform?.id || '', currentModel)]
  );
  const visionEnabled = currentCapabilities.vision;

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
      profileId: profileId || undefined,
      platformId: modelOverride?.platformId,
      model: modelOverride?.model
    });
    if (!created.ok) return null;
    conversationRef.current = created.data.id;
    setConversationId(created.data.id);
    void refreshConversations();
    return created.data.id;
  };

  /** 恢复会话级本地状态：清除上下文的位置与草稿。 */
  const applyLocalConversationState = (id: number | null, count: number): void => {
    if (!id) {
      setContextStart(null);
      setInput('');
      return;
    }
    let start: number | null = null;
    try {
      const raw = Number(localStorage.getItem(`chat-context-${id}`));
      if (Number.isFinite(raw) && raw > 0 && raw <= count) start = raw;
    } catch {
      // ignore
    }
    setContextStart(start);
    try {
      setInput(localStorage.getItem(`chat-draft-${id}`) || '');
    } catch {
      setInput('');
    }
  };

  const openConversation = async (conversation: ChatConversation): Promise<void> => {
    if (streaming) return;
    const rows = await window.bsub.chatHistoryMessages(conversation.id);
    if (!rows.ok) return;
    conversationRef.current = conversation.id;
    setConversationId(conversation.id);
    setModelOverride(
      conversation.platformId && conversation.model
        ? { platformId: conversation.platformId, model: conversation.model }
        : null
    );
    const restored = rows.data.map(fromStoredMessage);
    setMessages(restored);
    applyLocalConversationState(conversation.id, restored.length);
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
    try {
      localStorage.removeItem(`chat-context-${id}`);
      localStorage.removeItem(`chat-draft-${id}`);
    } catch {
      // ignore
    }
    if (conversationRef.current === id) {
      conversationRef.current = null;
      setConversationId(null);
      setMessages([]);
      setContextStart(null);
      setInput('');
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

  const appendComposer = (text: string): void => {
    const value = String(text || '').trim();
    if (!value) return;
    setInput((previous) => (previous.trim() ? `${previous.trim()}\n\n${value}` : value));
    setComposerOpen(false);
    setToolPanelOpen(false);
    setPromptForm(null);
  };

  const openToolPanel = async (
    mode: 'tools' | 'prompts' | 'resources' = 'tools'
  ): Promise<void> => {
    setComposerOpen(true);
    setToolPanelOpen(true);
    setToolPanelMode(mode);
    setPromptForm(null);
    setMcpPanelNotice('');
    setMcpPanelBusy(true);
    try {
      if (mode === 'tools') {
        const response = await window.bsub.mcpAllTools();
        if (response.ok) setToolOptions(response.data);
        else setMcpPanelNotice(response.error);
      } else if (mode === 'prompts') {
        const response = await window.bsub.mcpAllPrompts();
        if (response.ok) setPromptOptions(response.data);
        else setMcpPanelNotice(response.error);
      } else {
        const response = await window.bsub.mcpAllResources();
        if (response.ok) setResourceOptions(response.data);
        else setMcpPanelNotice(response.error);
      }
    } finally {
      setMcpPanelBusy(false);
    }
  };

  const runMcpPrompt = async (
    option: McpPromptOption,
    args: Record<string, string>
  ): Promise<void> => {
    setMcpPanelBusy(true);
    setMcpPanelNotice('');
    try {
      const response = await window.bsub.mcpRunPrompt(option.serverId, option.name, args);
      if (!response.ok) {
        setMcpPanelNotice(`提示词运行失败：${response.error}`);
        return;
      }
      appendComposer(response.data);
    } finally {
      setMcpPanelBusy(false);
    }
  };

  const pickMcpPrompt = (option: McpPromptOption): void => {
    if (option.arguments.length) {
      setPromptForm({ option, args: {} });
      return;
    }
    void runMcpPrompt(option, {});
  };

  const insertMcpResource = async (option: McpResourceOption): Promise<void> => {
    setMcpPanelBusy(true);
    setMcpPanelNotice('');
    try {
      const response = await window.bsub.mcpResourceText(option.serverId, option.uri);
      if (!response.ok) {
        setMcpPanelNotice(`读取资源失败：${response.error}`);
        return;
      }
      appendComposer(`【${option.serverName} · ${option.name}】\n${response.data}`);
    } finally {
      setMcpPanelBusy(false);
    }
  };

  const replyElicitation = async (
    request: McpElicitationRequest,
    action: McpElicitationAction
  ): Promise<void> => {
    const params = describeMcpParameters(request.requestedSchema);
    const values = elicitValues[request.requestId] || {};
    const content: Record<string, unknown> = {};
    for (const param of params) {
      const raw = values[param.name];
      if (raw === undefined || raw === '') continue;
      if (param.type.includes('number')) content[param.name] = Number(raw);
      else if (param.type === 'boolean') content[param.name] = Boolean(raw);
      else content[param.name] = raw;
    }
    await window.bsub.replyMcpElicitation?.(request.requestId, action, content);
    setElicitations((previous) =>
      previous.filter((item) => item.requestId !== request.requestId)
    );
    setElicitValues((previous) => {
      const next = { ...previous };
      delete next[request.requestId];
      return next;
    });
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

  const compareKey = (platformId: string, model: string) => `${platformId}::${model}`;

  const toggleCompareTarget = (key: string): void => {
    const next = compareSelection.includes(key)
      ? compareSelection.filter((item) => item !== key)
      : compareSelection.length >= 3
        ? compareSelection
        : [...compareSelection, key];
    setCompareSelection(next);
    try {
      localStorage.setItem('chat-compare', JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const compareTargets = compareSelection
    .map((key) => {
      const index = key.indexOf('::');
      if (index < 0) {
        const platform = platforms.find((item) => item.id === key);
        return platform ? { platformId: key, model: platform.model } : null;
      }
      return {
        platformId: key.slice(0, index),
        model: key.slice(index + 2)
      };
    })
    .filter((item): item is { platformId: string; model: string } => Boolean(item));

  const runCompare = async (): Promise<void> => {
    if (comparing) return;
    if (compareTargets.length < 2) {
      setError('至少选择 2 个模型做对比');
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
        targets: compareTargets,
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

  const saveComparisonAll = async (): Promise<void> => {
    const question = comparison?.question;
    const results = comparison?.results || [];
    if (!question || !results.length) return;
    const last = messages[messages.length - 1];
    const hasUser = last?.role === 'user' && last.content === question;
    const base = hasUser ? messages : [...messages, { role: 'user' as const, content: question }];
    setMessages([...base, { role: 'assistant', content: '', compare: results }]);
    const conversation = await ensureConversation(question);
    if (conversation) {
      if (!hasUser) {
        await window.bsub.chatHistoryAppend(conversation, { role: 'user', content: question });
      }
      await window.bsub.chatHistoryAppend(conversation, {
        role: 'assistant',
        content: '',
        compare: results
      });
      void refreshConversations();
    }
    setComparison(null);
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
      setActiveAiId(response.data.settings.ai.activeId || '');
      setDefaultModelState(response.data.settings.ai.defaultModel || null);
      setCapabilityOverrides(response.data.settings.ai.capabilities || {});
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
      setActiveAiId(snapshot.settings.ai.activeId || '');
      setDefaultModelState(snapshot.settings.ai.defaultModel || null);
      setCapabilityOverrides(snapshot.settings.ai.capabilities || {});
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
    setModelOverride(null);
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
        if (rows.ok) {
          const restored = rows.data.map(fromStoredMessage);
          setMessages(restored);
          applyLocalConversationState(latest.data.id, restored.length);
        }
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
    return window.bsub.onMcpElicitation?.((request) => {
      setElicitations((previous) => [
        ...previous.filter((item) => item.requestId !== request.requestId),
        request
      ]);
      setElicitValues((previous) => ({ ...previous, [request.requestId]: {} }));
    });
  }, []);

  useEffect(() => {
    return window.bsub.onMcpServerChanged?.(() => {
      if (!toolPanelOpen) return;
      void (async () => {
        if (toolPanelMode === 'prompts') {
          const response = await window.bsub.mcpAllPrompts();
          if (response.ok) setPromptOptions(response.data);
        } else if (toolPanelMode === 'resources') {
          const response = await window.bsub.mcpAllResources();
          if (response.ok) setResourceOptions(response.data);
        } else {
          const response = await window.bsub.mcpAllTools();
          if (response.ok) setToolOptions(response.data);
        }
      })();
    });
  }, [toolPanelOpen, toolPanelMode]);

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
          ...(tools.length ? { tools } : {}),
          ...(event.usage ? { usage: event.usage } : {})
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
          tools,
          usage: event.usage
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
    const offTool = window.bsub.onChatTool((event) => {
      if (event.requestId !== requestRef.current) return;
      setToolEvents((previous) => {
        const next = [...previous];
        if (event.phase === 'start') {
          next.push(event);
        } else if (event.phase === 'progress') {
          for (let index = next.length - 1; index >= 0; index -= 1) {
            if (next[index].name === event.name && next[index].phase === 'start') {
              next[index] = { ...next[index], detail: event.detail };
              return next;
            }
          }
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
    if (!visionEnabled) {
      setError('当前模型未开启图片能力：到「设置 → AI 与语音 → AI 平台 → 模型能力」勾选「图片」后再试。');
      return;
    }
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

  const addTextFiles = async (files: File[]) => {
    const allowed = /\.(txt|md|markdown|srt|vtt|json|csv|log|ya?ml|xml|html?)$/i;
    const selected = files.filter(
      (file) => file.type.startsWith('text/') || allowed.test(file.name)
    );
    if (!selected.length) {
      setError('只支持 txt / md / srt / vtt / json / csv / log 等文本文件');
      return;
    }
    let next = [...attachments];
    for (const file of selected) {
      if (next.length >= 3) {
        setError('最多附带 3 个文本附件');
        break;
      }
      if (file.size > 1024 * 1024) {
        setError('文本附件不能超过 1MB');
        continue;
      }
      const text = (await file.text()).slice(0, 30000);
      if (!text.trim()) continue;
      next = [
        ...next,
        { name: file.name.slice(0, 120), chars: text.length, text }
      ];
    }
    setAttachments(next.slice(0, 3));
  };

  const attachmentText = (items: ChatAttachment[] = []): string =>
    items
      .map((item) => `【附件：${item.name}】\n${item.text}`)
      .join('\n\n');

  /** 发给模型时把附件和引用展开进 content，界面上仍然用紧凑气泡。 */
  const expandForModel = (message: ChatMessage): ChatMessage => {
    const extra = [
      message.attachments?.length ? attachmentText(message.attachments) : '',
      message.content
    ]
      .filter(Boolean)
      .join('\n\n');
    return extra === message.content ? message : { ...message, content: extra };
  };
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

  const send = async (
    preset?: string,
    forcePage = false,
    base?: ChatMessage[],
    override?: {
      text?: string;
      images?: string[];
      attachments?: ChatAttachment[];
      quote?: ChatMessage | null;
    }
  ) => {
    const text = String(override?.text ?? preset ?? input).trim();
    const sendingImages = override?.images ?? images;
    const sendingAttachments = override?.attachments ?? attachments;
    const sendingQuote = override ? override.quote ?? null : quote;
    if (!text && !sendingImages.length && !sendingAttachments.length) return;
    if (streaming) {
      setQueue((previous) => [
        ...previous,
        { text, images: sendingImages, attachments: sendingAttachments, quote: sendingQuote }
      ]);
      setInput('');
      setImages([]);
      setAttachments([]);
      setQuote(null);
      return;
    }
    if (sendingImages.length && !visionEnabled) {
      setError('当前模型未开启图片能力，请先在设置里勾选「图片」，或移除图片发送。');
      return;
    }
    const quoted = sendingQuote
      ? `> 引用：${sendingQuote.content.slice(0, 400).replace(/\n/g, '\n> ')}\n\n`
      : '';
    const content = `${quoted}${text || '请阅读并分析这个附件。'}`.trim();
    const outgoingAttachments = sendingAttachments;

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
      {
        role: 'user',
        content,
        ...(sendingImages.length ? { images: sendingImages } : {}),
        ...(outgoingAttachments.length ? { attachments: outgoingAttachments } : {})
      }
    ];
    const attachedImages = sendingImages;
    setMessages(nextMessages);

    void (async () => {
      const conversation = await ensureConversation(text || '附件提问');
      if (!conversation) return;
      await window.bsub.chatHistoryAppend(conversation, {
        role: 'user',
        content,
        images: attachedImages,
        attachments: outgoingAttachments
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
        platformId: modelOverride?.platformId,
        model: modelOverride?.model,
        lines: context.lines,
        messages: (base ? nextMessages : contextMessages(nextMessages, contextStart)).map(
          expandForModel
        ),
        skillIds: skillId ? [skillId] : [],
        profileId: profileId || undefined,
        // 选了助手档案就由档案决定工具，避免手动勾选悄悄覆盖档案配置。
        mcpToolIds: profileId ? undefined : toolSelection ?? undefined,
        conversationId: conversationRef.current || undefined,
        includePage: forcePage ? true : includePage,
        includeTranscript,
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

  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (streaming || queuePaused || !queue.length) return;
    const next = queue[0];
    setQueue((previous) => previous.slice(1));
    void sendRef.current(undefined, false, undefined, next);
  }, [streaming, queue, queuePaused]);

  useEffect(() => {
    if (!conversationId) return;
    try {
      localStorage.setItem(`chat-draft-${conversationId}`, input);
    } catch {
      // ignore
    }
  }, [input, conversationId]);

  const clearContext = (): void => {
    if (!messages.length) return;
    const next = messages.length;
    setContextStart(next);
    if (conversationId) {
      try {
        localStorage.setItem(`chat-context-${conversationId}`, String(next));
      } catch {
        // ignore
      }
    }
    setComposerOpen(false);
    setSavedNotice('已清除上下文：之前的消息保留，但不再发送给模型');
  };

  const restoreContext = (): void => {
    setContextStart(null);
    if (conversationId) {
      try {
        localStorage.removeItem(`chat-context-${conversationId}`);
      } catch {
        // ignore
      }
    }
    setSavedNotice('已恢复上下文');
  };

  const jumpToMessage = (index: number): void => {
    setHighlightIndex(index);
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-chat-index="${index}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    window.setTimeout(() => {
      setHighlightIndex((current) => (current === index ? null : current));
    }, 2200);
  };

  const insertConversationReference = async (
    conversation: ChatConversation
  ): Promise<void> => {
    setMentionOpen(false);
    setMentionQuery('');
    const response = await window.bsub.chatHistoryMessages(conversation.id);
    const rows = response.ok ? response.data : [];
    const block = formatConversationReference(conversation.title, rows);
    setInput((previous) => (previous.trim() ? `${previous.trim()}\n\n${block}` : block));
    setComposerOpen(false);
  };

  const stop = () => {
    setApprovals([]);
    setQueuePaused(true);
    if (requestRef.current) void window.bsub.cancelChat(requestRef.current);
  };

  const useModel = (platformId: string, model: string) => {
    setModelOverride({ platformId, model });
    if (conversationRef.current) {
      void window.bsub.chatHistorySetModel?.(conversationRef.current, platformId, model);
    }
    setModelMenuOpen(false);
  };

  const clearModelOverride = () => {
    setModelOverride(null);
    if (conversationRef.current) {
      void window.bsub.chatHistorySetModel?.(conversationRef.current, '', '');
    }
  };

  const saveCurrentAsDefault = async () => {
    if (!overridePlatform || !modelOverride) return;
    const response = await window.bsub.setDefaultModel?.(
      modelOverride.platformId,
      modelOverride.model
    );
    if (!response?.ok) {
      setError(response?.error || '设为默认失败');
      return;
    }
    setDefaultModelState(response.data);
    setActiveAiId(response.data.platformId);
    setPlatforms((current) =>
      current.map((platform) =>
        platform.id === response.data.platformId
          ? { ...platform, model: response.data.model }
          : platform
      )
    );
    if (conversationRef.current) {
      void window.bsub.chatHistorySetModel?.(conversationRef.current, '', '');
    }
    setModelOverride(null);
    setModelMenuOpen(false);
  };

  // 网页右键/选中文字触发的操作：直接带入对话并生成。
  useEffect(() => {
    const handler = (event: Event) => {
      const prompt = String((event as CustomEvent).detail || '').trim();
      if (!prompt) return;
      setComposerOpen(false);
      void send(prompt);
    };
    window.addEventListener('bsub:chat-prefill', handler);
    return () => window.removeEventListener('bsub:chat-prefill', handler);
  }, [send]);

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
    if (conversation) {
      await window.bsub.chatHistoryTruncate(conversation, base.length);
      try {
        localStorage.removeItem(`chat-context-${conversation}`);
      } catch {
        // ignore
      }
    }
    setContextStart(null);
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
    setContextStart(null);
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
    if (conversation) {
      await window.bsub.chatHistoryTruncate(conversation, index);
      try {
        localStorage.removeItem(`chat-context-${conversation}`);
      } catch {
        // ignore
      }
    }
    setContextStart(null);
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
            : action === 'ask'
              ? '解释并回答其中的问题'
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
    const oldId = conversationRef.current;
    if (oldId) {
      try {
        localStorage.removeItem(`chat-context-${oldId}`);
        localStorage.removeItem(`chat-draft-${oldId}`);
      } catch {
        // ignore
      }
    }
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
    setModelOverride(null);
    setMessages([]);
    setImages([]);
    setContextStart(null);
    setQueue([]);
    setQueuePaused(false);
    setInput('');
    setStreamText('');
    setStatus('');
    setError(null);
    setStreaming(false);
  };

  useEffect(() => {
    const handler = () => clear();
    window.addEventListener('bsub:chat-new', handler);
    return () => window.removeEventListener('bsub:chat-new', handler);
  }, [clear]);

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

  const searchQuery = messageSearchQuery.trim().toLowerCase();
  const messageSearchResults = searchQuery
    ? messages
        .map((message, index) => ({ message, index }))
        .filter(({ message }) =>
          `${message.role === 'assistant' ? 'AI' : '用户'} ${message.content}`
            .toLowerCase()
            .includes(searchQuery)
        )
        .slice(0, 60)
    : [];
  const mentionQueryText = mentionQuery.trim().toLowerCase();
  const mentionResults = conversations
    .filter((conversation) => conversation.id !== conversationRef.current)
    .filter(
      (conversation) =>
        !mentionQueryText ||
        `${conversation.title} ${conversation.videoTitle || ''}`
          .toLowerCase()
          .includes(mentionQueryText)
    )
    .slice(0, 20);

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
            disabled={!messages.length}
            onClick={() => {
              setMessageSearchOpen((value) => !value);
              setMessageSearchQuery('');
              setHistoryOpen(false);
              setOutlineOpen(false);
            }}
            title="在当前对话内搜索"
          >
            <Search size={12} /> 搜索
          </button>
          <button
            className="mini-btn"
            disabled={!messages.some((message) => message.role === 'user')}
            onClick={() => {
              setOutlineOpen((value) => !value);
              setMessageSearchOpen(false);
              setHistoryOpen(false);
            }}
            title="按提问列出对话大纲"
          >
            <List size={12} /> 大纲
          </button>
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

      {messageSearchOpen && (
        <div className="chat-history-panel chat-search-panel">
          <div className="chat-history-head">
            <span>对话内搜索</span>
            <button
              className="mini-btn"
              onClick={() => {
                setMessageSearchOpen(false);
                setMessageSearchQuery('');
              }}
            >
              关闭
            </button>
          </div>
          <input
            autoFocus
            className="settings-input chat-history-search"
            placeholder="搜索当前对话…"
            value={messageSearchQuery}
            spellCheck={false}
            onChange={(event) => setMessageSearchQuery(event.target.value)}
          />
          {searchQuery && !messageSearchResults.length && (
            <div className="settings-hint">没有匹配的消息</div>
          )}
          {messageSearchResults.map(({ message, index }) => {
            const raw = message.content.replace(/\s+/g, ' ');
            const position = raw.toLowerCase().indexOf(searchQuery);
            const start = Math.max(0, position - 30);
            const snippet = `${start > 0 ? '…' : ''}${raw.slice(start, start + 120)}${
              raw.length > start + 120 ? '…' : ''
            }`;
            return (
              <button
                key={index}
                className="chat-search-result"
                onClick={() => jumpToMessage(index)}
              >
                <span className="chat-search-role">
                  {message.role === 'assistant' ? 'AI' : '用户'}
                </span>
                <span className="chat-search-snippet">{snippet}</span>
              </button>
            );
          })}
        </div>
      )}

      {outlineOpen && (
        <div className="chat-history-panel chat-outline-panel">
          <div className="chat-history-head">
            <span>对话大纲</span>
            <button className="mini-btn" onClick={() => setOutlineOpen(false)}>
              关闭
            </button>
          </div>
          {messages.map((message, index) =>
            message.role === 'user' ? (
              <button
                key={index}
                className="chat-search-result"
                onClick={() => jumpToMessage(index)}
              >
                <span className="chat-search-role">
                  {messages.slice(0, index + 1).filter((item) => item.role === 'user').length}
                </span>
                <span className="chat-search-snippet">
                  {message.content.replace(/\s+/g, ' ').slice(0, 120) || '附件提问'}
                </span>
              </button>
            ) : null
          )}
        </div>
      )}

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
                      conversation.model
                        ? `${
                            platforms.find((platform) => platform.id === conversation.platformId)
                              ?.name || conversation.platformId
                          } / ${conversation.model}`
                        : '',
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
            <EmptyState
              plain
              title={isVideoPage ? '基于本片字幕提问' : '就当前页面提问'}
              desc={
                isVideoPage
                  ? '会先读取当前视频字幕，再让设置里的 AI 平台回答。'
                  : '会读取当前网页正文和你选中的内容，再让设置里的 AI 平台回答。'
              }
            >
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
            </EmptyState>
          )}

          {messages.map((message, index) => (
            <Fragment key={`${message.role}-${index}-${message.content.slice(0, 16)}`}>
              {contextStart === index && (
                <div className="chat-context-divider">
                  上下文从这里开始，之前的消息不再发送
                </div>
              )}
              <div
                className={`chat-msg ${message.role}${
                  highlightIndex === index ? ' is-search-hit' : ''
                }`}
                data-chat-index={index}
              >
              {message.role === 'assistant' && <div className="chat-avatar">AI</div>}
              <div className="chat-bubble">
                {message.role === 'assistant' ? (
                  <>
                    {message.reasoning && (
                      <ReasoningBlock text={message.reasoning} defaultOpen={expandReasoning} />
                    )}
                    {message.compare?.length ? (
                      <div className="chat-compare-inline">
                        {message.compare.map((result) => (
                          <div
                            key={`${result.platformId}:${result.model}`}
                            className="chat-compare-inline-col"
                          >
                            <div className="chat-compare-inline-title">
                              {result.platformName}
                              <span>{result.model}</span>
                            </div>
                            {result.error ? (
                              <div className="compare-error">{result.error}</div>
                            ) : (
                              <Markdown content={result.text} />
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Markdown
                        content={message.content}
                        citations={safeSources(message.sources)}
                        citePrefix={`m${index}`}
                      />
                    )}
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
                            id={`cite-m${index}-${sourceIndex + 1}`}
                            className="chat-source"
                            title={reference.url}
                            onClick={() => void window.bsub.openExternal(reference.url)}
                          >
                            <span className="chat-source-title">
                              {reference.title || reference.url}
                            </span>
                            <span className="chat-source-site">
                              {reference.site || hostOf(reference.url)}
                              {reference.date ? ` · ${String(reference.date).slice(0, 10)}` : ''}
                            </span>
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
                    {message.usage && (
                      <div
                        className="chat-usage"
                        title={`输入 ${message.usage.inputTokens.toLocaleString('zh-CN')} · 输出 ${message.usage.outputTokens.toLocaleString('zh-CN')}${
                          message.usage.cacheReadTokens
                            ? ` · 缓存命中 ${message.usage.cacheReadTokens.toLocaleString('zh-CN')}`
                            : ''
                        }`}
                      >
                        输入 {formatTokens(message.usage.inputTokens)} · 输出{' '}
                        {formatTokens(message.usage.outputTokens)}
                      </div>
                    )}
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
                        title="引用这条回答"
                        onClick={() => setQuote(message)}
                      >
                        <Quote size={11} />
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
                    {message.attachments?.length ? (
                      <div className="chat-attachments">
                        {message.attachments.map((attachment) => (
                          <span
                            key={`${attachment.name}-${attachment.chars}`}
                            className="chat-attachment-chip"
                            title={attachment.name}
                          >
                            <FileText size={10} /> {attachment.name}
                            <span>{attachment.chars.toLocaleString('zh-CN')} 字</span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div>{message.content}</div>
                    <div className="chat-msg-actions">
                      <button
                        className="chat-action"
                        title="引用这条消息"
                        onClick={() => setQuote(message)}
                      >
                        <Quote size={11} />
                      </button>
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
            </Fragment>
          ))}

          {contextStart !== null && contextStart >= messages.length && (
            <div className="chat-context-divider">
              上下文已清除，从下一条消息开始
            </div>
          )}

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
                  {tool.images?.length ? (
                    <div className="chat-tool-images">
                      {tool.images.map((src, imageIndex) => (
                        <img
                          key={imageIndex}
                          src={src}
                          alt="工具返回的图片"
                          loading="lazy"
                        />
                      ))}
                    </div>
                  ) : null}
                  {tool.structured !== undefined && (
                    <details className="chat-tool-schema">
                      <summary>结构化结果</summary>
                      <pre className="chat-tool-structured">
                        {JSON.stringify(tool.structured, null, 2)}
                      </pre>
                    </details>
                  )}
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

      {elicitations.length > 0 && (
        <div className="chat-approval-list">
          {elicitations.map((request) => {
            const params = describeMcpParameters(request.requestedSchema);
            const values = elicitValues[request.requestId] || {};
            const missing = params.some(
              (param) =>
                param.required && (values[param.name] === undefined || values[param.name] === '')
            );
            return (
              <div key={request.requestId} className="chat-approval-card">
                <div className="chat-approval-title">
                  MCP「{request.serverName}」请求补充信息
                </div>
                <div className="chat-tool-detail">{request.message}</div>
                {params.length ? (
                  params.map((param) => (
                    <label key={param.name} className="chat-elicit-field">
                      <span>
                        {param.name}
                        {param.required ? ' *' : ''} <em>{param.type}</em>
                      </span>
                      {param.enumValues.length ? (
                        <select
                          className="settings-input"
                          value={String(values[param.name] ?? '')}
                          onChange={(event) =>
                            setElicitValues((previous) => ({
                              ...previous,
                              [request.requestId]: {
                                ...previous[request.requestId],
                                [param.name]: event.target.value
                              }
                            }))
                          }
                        >
                          <option value="">请选择</option>
                          {param.enumValues.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      ) : param.type === 'boolean' ? (
                        <input
                          type="checkbox"
                          checked={Boolean(values[param.name])}
                          onChange={(event) =>
                            setElicitValues((previous) => ({
                              ...previous,
                              [request.requestId]: {
                                ...previous[request.requestId],
                                [param.name]: event.target.checked
                              }
                            }))
                          }
                        />
                      ) : (
                        <input
                          className="settings-input"
                          type={param.type.includes('number') ? 'number' : 'text'}
                          value={String(values[param.name] ?? '')}
                          onChange={(event) =>
                            setElicitValues((previous) => ({
                              ...previous,
                              [request.requestId]: {
                                ...previous[request.requestId],
                                [param.name]: event.target.value
                              }
                            }))
                          }
                        />
                      )}
                      {param.description && <small>{param.description}</small>}
                    </label>
                  ))
                ) : (
                  <div className="settings-hint">这个请求没有额外字段，确认后提交即可。</div>
                )}
                <div className="chat-approval-actions">
                  <button
                    className="mini-btn primary"
                    disabled={missing}
                    onClick={() => void replyElicitation(request, 'accept')}
                  >
                    提交
                  </button>
                  <button
                    className="mini-btn"
                    onClick={() => void replyElicitation(request, 'decline')}
                  >
                    拒绝
                  </button>
                  <button
                    className="mini-btn"
                    onClick={() => void replyElicitation(request, 'cancel')}
                  >
                    取消
                  </button>
                </div>
              </div>
            );
          })}
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
            <button className="chat-menu-card" onClick={() => void openToolPanel('tools')}>
              <Wrench size={15} />
              <span className="chat-menu-card-title">MCP 工具</span>
              <span className="chat-menu-card-desc">
                {toolSelection === null ? '全部可用工具' : `已选 ${toolSelection.length} 个`}
              </span>
            </button>
            <button className="chat-menu-card" onClick={() => void openToolPanel('prompts')}>
              <Quote size={15} />
              <span className="chat-menu-card-title">MCP 提示词</span>
              <span className="chat-menu-card-desc">插入服务预设的提示词</span>
            </button>
            <button className="chat-menu-card" onClick={() => void openToolPanel('resources')}>
              <FileText size={15} />
              <span className="chat-menu-card-title">MCP 资源</span>
              <span className="chat-menu-card-desc">读取内容并放进输入框</span>
            </button>
            <button
              className="chat-menu-card"
              onClick={() => {
                setMentionOpen(true);
                setMentionQuery('');
                setComposerOpen(false);
              }}
            >
              <AtSign size={15} />
              <span className="chat-menu-card-title">引用历史对话</span>
              <span className="chat-menu-card-desc">输入 @ 也可打开</span>
            </button>
            <button
              className="chat-menu-card"
              disabled={!messages.length}
              onClick={clearContext}
            >
              <Eraser size={15} />
              <span className="chat-menu-card-title">清除上下文</span>
              <span className="chat-menu-card-desc">保留消息，只把之后的内容发给模型</span>
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
            <button
              className="chat-menu-card"
              disabled={!visionEnabled}
              title={visionEnabled ? '添加图片' : '当前模型未开启图片能力，可在设置里勾选'}
              onClick={() => imageInputRef.current?.click()}
            >
              <ImagePlus size={15} />
              <span className="chat-menu-card-title">添加图片</span>
              <span className="chat-menu-card-desc">
                {visionEnabled ? '也可直接粘贴或拖入' : '当前模型未开启图片能力'}
              </span>
            </button>
            <button className="chat-menu-card" onClick={() => fileInputRef.current?.click()}>
              <FileText size={15} />
              <span className="chat-menu-card-title">文本附件</span>
              <span className="chat-menu-card-desc">txt / md / srt，最多 3 个</span>
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
          <div className="chat-menu-quick">
            <span className="chat-menu-row-label">快捷</span>
            {[
              { label: '总结', prompt: '请用要点总结当前视频/页面的核心内容，先给结论再展开。' },
              { label: '待办', prompt: '从当前内容里提取可执行的待办事项，用 Markdown 任务列表输出。' },
              { label: '时间线', prompt: '按时间顺序整理当前内容的关键节点，标注大致时间点。' },
              { label: '提问清单', prompt: '基于当前内容，列出 5 个值得继续追问的问题并说明为什么。' }
            ].map((item) => (
              <button
                key={item.label}
                className="chat-chip"
                onClick={() => {
                  setComposerOpen(false);
                  void send(item.prompt);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          {toolPanelOpen && (
            <div className="chat-tool-panel">
              <div className="chat-tool-panel-head">
                <span>
                  {toolPanelMode === 'tools'
                    ? `本轮可用工具（${toolSelection === null ? '全部' : toolSelection.length}）`
                    : toolPanelMode === 'prompts'
                      ? 'MCP 提示词'
                      : 'MCP 资源'}
                </span>
                {toolPanelMode !== 'tools' && (
                  <button className="mini-btn" onClick={() => void openToolPanel('tools')}>
                    工具
                  </button>
                )}
                {toolPanelMode === 'tools' && (
                  <>
                    <button className="mini-btn" onClick={selectAllTools}>
                      全选
                    </button>
                    <button className="mini-btn" onClick={selectNoTools}>
                      不用 MCP
                    </button>
                  </>
                )}
              </div>
              {mcpPanelNotice && (
                <div className="settings-hint" style={{ color: 'var(--danger)' }}>
                  {mcpPanelNotice}
                </div>
              )}
              {mcpPanelBusy && <div className="settings-hint">读取中…</div>}
              {toolPanelMode === 'tools' && (
                <>
                  {profileId && (
                    <div className="settings-hint">
                      当前使用助手档案，工具由档案的「MCP 工具」设置决定；想手动勾选请先切回「无助手档案」。
                    </div>
                  )}
                  {!toolOptions.length && (
                    <div className="settings-hint">
                      没有可用工具：先在「设置 → 插件与集成 → MCP」添加并启用服务。
                    </div>
                  )}
                  {toolOptions.map((tool) => {
                    const checked = toolSelection === null || toolSelection.includes(tool.id);
                    const params = describeMcpParameters(tool.inputSchema);
                    return (
                      <div key={tool.id} className="chat-tool-item">
                        <label className="chat-tool-option" title={tool.description}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleTool(tool.id)}
                          />
                          <span>
                            {tool.serverName} · {tool.name}
                          </span>
                        </label>
                        {params.length > 0 && (
                          <details className="chat-tool-schema">
                            <summary>{params.length} 个参数</summary>
                            <div className="chat-tool-params">
                              {params.map((param) => (
                                <div key={param.name} className="chat-tool-param">
                                  <div className="chat-tool-param-head">
                                    <code>{param.name}</code>
                                    <span>
                                      {param.type}
                                      {param.required ? ' · 必填' : ''}
                                    </span>
                                  </div>
                                  {param.description && (
                                    <div className="chat-tool-param-desc">
                                      {param.description}
                                    </div>
                                  )}
                                  {param.enumValues.length > 0 && (
                                    <div className="chat-tool-param-desc">
                                      可选值：{param.enumValues.join(' / ')}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
              {toolPanelMode === 'prompts' &&
                (promptForm ? (
                  <div className="chat-mcp-form">
                    <div className="chat-tool-panel-head">
                      <span>
                        {promptForm.option.serverName} · {promptForm.option.name}
                      </span>
                      <button className="mini-btn" onClick={() => setPromptForm(null)}>
                        返回
                      </button>
                    </div>
                    {promptForm.option.description && (
                      <div className="settings-hint">{promptForm.option.description}</div>
                    )}
                    {promptForm.option.arguments.map((arg) => (
                      <label key={arg.name} className="chat-mcp-field">
                        <span>
                          {arg.name}
                          {arg.required ? ' *' : ''}
                        </span>
                        <input
                          className="settings-input"
                          value={promptForm.args[arg.name] || ''}
                          placeholder={arg.description || ''}
                          onChange={(event) =>
                            setPromptForm((current) =>
                              current
                                ? {
                                    ...current,
                                    args: { ...current.args, [arg.name]: event.target.value }
                                  }
                                : current
                            )
                          }
                        />
                      </label>
                    ))}
                    <button
                      className="mini-btn primary"
                      disabled={
                        mcpPanelBusy ||
                        promptForm.option.arguments.some(
                          (arg) => arg.required && !String(promptForm.args[arg.name] || '').trim()
                        )
                      }
                      onClick={() => void runMcpPrompt(promptForm.option, promptForm.args)}
                    >
                      运行并插入
                    </button>
                  </div>
                ) : (
                  <>
                    {!promptOptions.length && !mcpPanelBusy && (
                      <div className="settings-hint">
                        没有提示词：服务需要提供 prompts 能力并已启用。
                      </div>
                    )}
                    {promptOptions.map((option) => (
                      <button
                        key={option.id}
                        className="chat-mcp-item"
                        title={option.description}
                        onClick={() => pickMcpPrompt(option)}
                      >
                        <span>
                          {option.serverName} · {option.name}
                        </span>
                        {option.arguments.length > 0 && (
                          <span className="chat-mcp-meta">
                            {option.arguments.length} 个参数
                          </span>
                        )}
                      </button>
                    ))}
                  </>
                ))}
              {toolPanelMode === 'resources' && (
                <>
                  {!resourceOptions.length && !mcpPanelBusy && (
                    <div className="settings-hint">
                      没有资源：服务需要提供 resources 能力并已启用。
                    </div>
                  )}
                  {resourceOptions.map((option) => (
                    <button
                      key={option.id}
                      className="chat-mcp-item"
                      title={option.description || option.uri}
                      onClick={() => void insertMcpResource(option)}
                    >
                      <span>
                        {option.serverName} · {option.name}
                      </span>
                      <span className="chat-mcp-meta">{option.mimeType || 'resource'}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
          {compareOpen && (
            <div className="chat-compare-panel">
              <div className="settings-hint">
                选 2–3 个平台，用同一个问题并排回答；对比模式不启用 MCP 工具与联网。
              </div>
              <div className="chat-compare-options">
                {platforms
                  .filter((platform) => platform.enabled !== false)
                  .map((platform) => {
                    const models = (platform.models?.length
                      ? platform.models
                      : [platform.model]
                    ).filter(Boolean);
                    if (!models.length) return null;
                    return (
                      <div key={platform.id} className="chat-compare-group">
                        <div className="chat-compare-group-title">{platform.name}</div>
                        {models.map((model) => {
                          const key = compareKey(platform.id, model);
                          const legacy =
                            compareSelection.includes(platform.id) && model === platform.model;
                          const checked = compareSelection.includes(key) || legacy;
                          return (
                            <label key={key} className="chat-tool-option" title={model}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={!checked && compareSelection.length >= 3}
                                onChange={() => toggleCompareTarget(key)}
                              />
                              <span>{model}</span>
                            </label>
                          );
                        })}
                      </div>
                    );
                  })}
              </div>
              <button
                className="mini-btn primary"
                disabled={compareTargets.length < 2 || comparing}
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
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.markdown,.srt,.vtt,.json,.csv,.log,.yaml,.yml,.xml,.html"
          multiple
          style={{ display: 'none' }}
          onChange={(event) => {
            void addTextFiles(Array.from(event.target.files || []));
            event.target.value = '';
          }}
        />
        {(quote || attachments.length > 0) && (
          <div className="chat-attach-row">
            {quote && (
              <span className="chat-quote-chip" title={quote.content.slice(0, 500)}>
                <Quote size={10} />
                引用：{quote.content.replace(/\s+/g, ' ').slice(0, 48)}
                <button title="取消引用" onClick={() => setQuote(null)}>
                  <X size={9} />
                </button>
              </span>
            )}
            {attachments.map((attachment, index) => (
              <span key={`${attachment.name}-${index}`} className="chat-attachment-chip">
                <FileText size={10} /> {attachment.name}
                <span>{attachment.chars.toLocaleString('zh-CN')} 字</span>
                <button
                  title="移除附件"
                  onClick={() =>
                    setAttachments((items) => items.filter((_, item) => item !== index))
                  }
                >
                  <X size={9} />
                </button>
              </span>
            ))}
          </div>
        )}
        {mentionOpen && (
          <div className="chat-history-panel chat-mention-panel">
            <div className="chat-history-head">
              <span>引用历史对话</span>
              <button className="mini-btn" onClick={() => setMentionOpen(false)}>
                关闭
              </button>
            </div>
            <input
              autoFocus
              className="settings-input chat-history-search"
              placeholder="搜索历史对话标题 / 视频…"
              value={mentionQuery}
              spellCheck={false}
              onChange={(event) => setMentionQuery(event.target.value)}
            />
            {!mentionResults.length && (
              <div className="settings-hint">没有匹配的对话</div>
            )}
            {mentionResults.map((conversation) => (
              <button
                key={conversation.id}
                className="chat-search-result"
                onClick={() => void insertConversationReference(conversation)}
              >
                <span className="chat-search-role">对话</span>
                <span className="chat-search-snippet">
                  {conversation.title}
                  {conversation.videoTitle ? ` · ${conversation.videoTitle}` : ''}
                </span>
              </button>
            ))}
          </div>
        )}
        {queue.length > 0 && (
          <div className="chat-queue">
            <span className="chat-queue-label">排队 {queue.length}</span>
            {queue.map((item, index) => (
              <span
                key={`${index}-${item.text.slice(0, 8)}`}
                className="chat-queue-chip"
                title={item.text || '附件'}
              >
                {item.text.replace(/\s+/g, ' ').slice(0, 22) || '附件'}
                <button
                  title="编辑这条排队消息"
                  onClick={() => {
                    setInput(item.text);
                    setQueue((previous) => previous.filter((_, i) => i !== index));
                  }}
                >
                  <Pencil size={9} />
                </button>
                <button
                  title="移出队列"
                  onClick={() => setQueue((previous) => previous.filter((_, i) => i !== index))}
                >
                  <X size={9} />
                </button>
              </span>
            ))}
            <button className="mini-btn" onClick={() => setQueuePaused((value) => !value)}>
              {queuePaused ? '继续' : '暂停'}
            </button>
            <button className="mini-btn" onClick={() => setQueue([])}>
              清空
            </button>
          </div>
        )}
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
            if (event.key === '@' && (!input || /\s$/.test(input))) {
              event.preventDefault();
              setMentionOpen(true);
              setMentionQuery('');
              setComposerOpen(false);
              return;
            }
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
            <div className="chat-model-picker">
              <button
                type="button"
                className="chat-chip chat-model-chip"
                disabled={Boolean(currentProfile)}
                title={
                  currentProfile
                    ? '当前使用助手档案，模型由档案决定'
                    : '选择对话模型（可跨服务商）'
                }
                onClick={() => setModelMenuOpen((value) => !value)}
              >
                {currentPlatform?.name || '模型'} · {currentModel || '未选'}
                {modelOverride ? '（临时）' : ''}
              </button>
              {modelMenuOpen && (
                <div className="chat-model-menu">
                  <input
                    className="settings-input chat-model-search"
                    value={modelQuery}
                    placeholder="搜索模型…"
                    spellCheck={false}
                    onChange={(event) => setModelQuery(event.target.value)}
                  />
                  {platforms
                    .filter((platform) => platform.enabled !== false)
                    .map((platform) => {
                      const models = (platform.models?.length
                        ? platform.models
                        : [platform.model]
                      )
                        .filter(Boolean)
                        .filter((model) =>
                          modelQuery.trim()
                            ? model.toLowerCase().includes(modelQuery.trim().toLowerCase())
                            : true
                        );
                      return (
                        <div key={platform.id} className="chat-model-group">
                          <div className="chat-model-group-title">
                            <ProviderBrandIcon
                              name={platform.name}
                              kind={platform.kind}
                              size={12}
                              style={{ marginRight: 4, verticalAlign: '-2px' }}
                            />
                            {platform.name}
                          </div>
                          {models.map((model) => (
                            <button
                              key={model}
                              type="button"
                              className={`chat-model-option${
                                (modelOverride
                                  ? platform.id === modelOverride.platformId &&
                                    model === modelOverride.model
                                  : platform.id === defaultModel?.platformId &&
                                    model === defaultModel?.model)
                                  ? ' is-active'
                                  : ''
                              }`}
                              onClick={() => useModel(platform.id, model)}
                            >
                              {model}
                              {(() => {
                                const capability = effectiveModelCapabilities(
                                  platform.kind,
                                  model,
                                  capabilityOverrides[capabilityKey(platform.id, model)]
                                );
                                const context = formatContextWindow(
                                  effectiveContextWindow(
                                    model,
                                    capabilityOverrides[capabilityKey(platform.id, model)]
                                      ?.contextWindow
                                  )
                                );
                                return (
                                  <>
                                    {context && (
                                      <span className="chat-model-tag">{context}</span>
                                    )}
                                    {capability.vision && (
                                      <span className="chat-model-tag">图片</span>
                                    )}
                                    {capability.audio && (
                                      <span className="chat-model-tag">音频</span>
                                    )}
                                  </>
                                );
                              })()}
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  <div className="chat-model-footer">
                    {modelOverride && (
                      <button type="button" onClick={clearModelOverride}>
                        跟随默认
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={!overridePlatform || !modelOverride}
                      onClick={() => void saveCurrentAsDefault()}
                    >
                      设为全局默认
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button
              className={`chat-chip${includePage ? ' is-on' : ''}`}
              title={includePage ? '本次会带上当前网页正文' : '不带当前网页正文'}
              onClick={() => setIncludePage((value) => !value)}
            >
              <FileText size={12} /> 页面
            </button>
            <button
              className={`chat-chip${includeTranscript ? ' is-on' : ''}`}
              title={
                includeTranscript
                  ? '本次会带上当前视频字幕；关掉可只做联网问答'
                  : '本次不带字幕，只按问题/联网回答'
              }
              onClick={() => {
                const next = !includeTranscript;
                setIncludeTranscript(next);
                try {
                  localStorage.setItem('chat-transcript', next ? '1' : '0');
                } catch {
                  // ignore
                }
              }}
            >
              <Captions size={12} /> 字幕
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
            {contextStart !== null && (
              <button
                className="chat-chip is-on"
                title="之前的消息不再发送给模型，点击恢复"
                onClick={restoreContext}
              >
                <Eraser size={12} /> 上下文已清除 ↺
              </button>
            )}
          </div>
          <div className="chat-bar-right">
            <span
              className="chat-token-hint"
              title="输入 + 对话历史 + 页面正文的粗略估算"
            >
              ≈{' '}
              {(
                estimateMessagesTokens(messages) +
                estimateTextTokens(input) +
                (includePage ? Math.ceil((pageContext?.chars || 0) / 1.6) : 0)
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
              disabled={!activeTab || (!input.trim() && !images.length && !attachments.length)}
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
                <div key={`${result.platformId}:${result.model}`} className="compare-col">
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
            <div className="compare-footer">
              <button
                className="mini-btn primary"
                onClick={() => void saveComparisonAll()}
              >
                全部保存到对话
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
