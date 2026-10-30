import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { askConfirm } from './ui/confirm';
import type { DiagnosticsInfo } from '../../../shared/types';
import { AssistantSection } from './settings/AssistantSection';
import { BridgeSection } from './settings/BridgeSection';
import { DataBackupSection } from './settings/DataBackupSection';
import { CorrectionSection } from './settings/CorrectionSection';
import { AiSection } from './settings/AiSection';
import { AsrSection } from './settings/AsrSection';
import { DiagnosticsSection } from './settings/DiagnosticsSection';
import { PromptSection } from './settings/PromptSection';
import { SearchSection } from './settings/SearchSection';
import { AddressSearchGroup } from './settings/AddressSearchGroup';
import { AppearanceGroup } from './settings/AppearanceGroup';
import { EfficiencyGroup } from './settings/EfficiencyGroup';
import { PetSection } from './settings/PetSection';
import { ShortcutsSection } from './settings/ShortcutsSection';
import { GeneralGroup } from './settings/GeneralGroup';
import { DownloadSection } from './settings/DownloadSection';
import { RadialSection } from './settings/RadialSection';
import { LocalModelsSection } from './settings/LocalModelsSection';
import { ContextSection } from './settings/ContextSection';
import { ChatPromptsSection } from './settings/ChatPromptsSection';
import { OcrSection } from './settings/OcrSection';
import { ImageGenSection } from './settings/ImageGenSection';
import { QuickAskSection } from './settings/QuickAskSection';
import { ReadingGroup } from './settings/ReadingGroup';
import { SubtitleGroup } from './settings/SubtitleGroup';
import { SessionsGroup } from './settings/SessionsGroup';
import { McpSection } from './settings/McpSection';
import { ExportDefaultsSection } from './settings/ExportDefaultsSection';
import { SitePermissionsSection } from './settings/SitePermissionsSection';
import { SkillsSection } from './settings/SkillsSection';
import { TaskModelSection } from './settings/TaskModelSection';
import { TtsSection } from './settings/TtsSection';
import { VoiceInputSection } from './settings/VoiceInputSection';
import { UsageSection } from './settings/UsageSection';
import { UpdateSection } from './settings/UpdateSection';
import { Loader2, Save, Search } from 'lucide-react';
import { settingsGroup } from './settings/registry';
import type {
  AiPlatform,
  AsrPlatform,
  AppSettings,
  BridgeStatus,
  CorrectionRule,
  CorrectionRuleGroup,
  GlossaryTerm,
  McpServer,
  McpTool,
  McpResource,
  McpPrompt,
  SkillItem,
  PromptTemplate,
  SearchPlatform,
  UpdateStatus,
  WebReference
} from '../../../shared/types';

function updateText(status: UpdateStatus | null): string {
  if (!status) return '尚未检查';
  switch (status.state) {
    case 'disabled':
      return status.error || '当前版本不支持自动更新';
    case 'idle':
      return '尚未检查';
    case 'checking':
      return '正在检查更新…';
    case 'available':
      return `发现新版本 ${status.version || ''}`;
    case 'not-available':
      return `已是最新版本（v${status.currentVersion}）`;
    case 'downloading':
      return `正在下载 ${status.progress || 0}%`;
    case 'downloaded':
      return `新版本 ${status.version || ''} 已下载，重启后安装`;
    case 'error':
      return `检查失败：${status.error || '未知错误'}`;
    default:
      return '';
  }
}

export function SettingsPanel({
  group = 'all',
  onDirtyChange
}: {
  group?: string;
  onDirtyChange?: (dirty: boolean) => void;
} = {}) {
  const show = (key: string) =>
    !group || group === 'all' || group === key || Boolean(settingsQuery.trim());

  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [dataDir, setDataDir] = useState('');
  const [migrating, setMigrating] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsInfo | null>(null);
  const [version, setVersion] = useState('');
  const [message, setMessage] = useState('');
  const [installingExtension, setInstallingExtension] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [searchTesting, setSearchTesting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('B站 视频 总结');
  const [searchResults, setSearchResults] = useState<WebReference[] | null>(null);
  const [correctionTest, setCorrectionTest] = useState('这是一段测试字幕，AI 和 GPU 可能会被写错。');
  const [correctionPreview, setCorrectionPreview] = useState('');
  const [correctionTesting, setCorrectionTesting] = useState(false);
  const [mcpTools, setMcpTools] = useState<Record<string, McpTool[]>>({});
  const [mcpResources, setMcpResources] = useState<Record<string, McpResource[]>>({});
  const [mcpPrompts, setMcpPrompts] = useState<Record<string, McpPrompt[]>>({});
  const [mcpTesting, setMcpTesting] = useState('');
  const [mcpArgs, setMcpArgs] = useState('{}');
  const [mcpResult, setMcpResult] = useState('');
  const [settingsQuery, setSettingsQuery] = useState('');
  const [visibleSections, setVisibleSections] = useState(0);
  const [editingAiId, setEditingAiId] = useState('');
  const [editingAsrId, setEditingAsrId] = useState('');
  const [editingSearchId, setEditingSearchId] = useState('');
  const [modelCache, setModelCache] = useState<Record<string, string[]>>({});
  const [platformBusy, setPlatformBusy] = useState('');
  const [dirty, setDirty] = useState(false);
  const [sitePermissions, setSitePermissions] = useState<
    Array<{ origin: string; permission: string; decision: 'allow' | 'deny' }>
  >([]);

  useEffect(() => {
    void window.bsub.listSitePermissions().then((response) => {
      if (response.ok) setSitePermissions(response.data);
    });
  }, []);
  const savedJsonRef = useRef('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [platformStatus, setPlatformStatus] = useState<{
    key: string;
    text: string;
    ok: boolean;
  } | null>(null);
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [updateState, setUpdateState] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    void window.bsub.getBridgeStatus().then((response) => {
      if (response.ok) setBridge(response.data);
    });
    void window.bsub.getUpdateStatus().then((response) => {
      if (response.ok) setUpdateState(response.data);
    });
    return window.bsub.onUpdateStatus((status) => setUpdateState(status));
  }, []);

  useEffect(() => {
    void window.bsub.getDiagnostics().then((response) => {
      if (response.ok) setDiagnostics(response.data);
    });
  }, []);

  useEffect(() => {
    let alive = true;
    window.bsub
      .getSettings()
      .then((response) => {
        if (!alive) return;
        if (response.ok) {
          setDraft(response.data.settings);
          savedJsonRef.current = JSON.stringify(response.data.settings);
          setDataDir(response.data.dataDir);
          setVersion(response.data.version);
          void window.bsub.mcpRestoreSubscriptions(response.data.settings.mcp.servers);
        } else {
          setError(response.error);
        }
      })
      .catch((caught) => {
        if (alive) setError((caught as Error).message);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const dispose = window.bsub.onMcpResourceUpdated?.((update) => {
      setMcpResult(
        `资源更新：${update.uri}\n\n${update.content.slice(0, 3000)}`
      );
      setMessage(`MCP 资源有新内容：${update.uri}`);
    });
    return () => dispose?.();
  }, []);

  // 同步过滤，不排到 requestAnimationFrame：窗口被遮挡时 rAF 会被节流，
  // 搜索框看起来会「没反应」。过滤只读 textContent，直接跑开销很小。
  useLayoutEffect(() => {
    const query = settingsQuery.trim().toLowerCase();
    const sections = Array.from(document.querySelectorAll<HTMLElement>('.settings-section'));
    let count = 0;
    for (const section of sections) {
      const match = !query || (section.textContent || '').toLowerCase().includes(query);
      section.style.display = match ? '' : 'none';
      if (match) {
        count += 1;
        if (query) (section as HTMLDetailsElement).open = true;
      }
    }
    setVisibleSections(count);
  }, [settingsQuery, group, draft === null]);

  const active = draft
    ? draft.ai.platforms.find((platform) => platform.id === editingAiId) ||
      draft.ai.platforms.find((platform) => platform.id === draft.ai.activeId) ||
      draft.ai.platforms[0]
    : null;
  const activeTemplate = draft
    ? draft.prompt.templates.find((template) => template.id === draft.prompt.activeId) ||
      draft.prompt.templates[0] ||
      null
    : null;
  const activeAsr = draft
    ? draft.asr.platforms.find((platform) => platform.id === editingAsrId) ||
      draft.asr.platforms.find((platform) => platform.id === draft.asr.activeId) ||
      draft.asr.platforms[0] ||
      null
    : null;
  const activeSearch = draft
    ? draft.search.platforms.find((platform) => platform.id === editingSearchId) ||
      draft.search.platforms.find((platform) => platform.id === draft.search.activeId) ||
      draft.search.platforms[0] ||
      null
    : null;

  const updateGeneral = (patch: Partial<AppSettings['general']>) => {
    if (!draft) return;
    setDraft({ ...draft, general: { ...draft.general, ...patch } });
  };

  const updateAi = (patch: Partial<AppSettings['ai']>) => {
    if (!draft) return;
    setDraft({ ...draft, ai: { ...draft.ai, ...patch } });
  };

  const updateMcp = (patch: Partial<AppSettings['mcp']>) => {
    if (!draft) return;
    setDraft({ ...draft, mcp: { ...draft.mcp, ...patch } });
  };

  const updateMcpServer = (id: string, patch: Partial<McpServer>) => {
    if (!draft) return;
    updateMcp({
      servers: draft.mcp.servers.map((server) =>
        server.id === id ? { ...server, ...patch } : server
      )
    });
  };

  const addMcpServer = () => {
    if (!draft) return;
    updateMcp({
      servers: [
        ...draft.mcp.servers,
        {
          id: uid('mcp'),
          name: 'MCP 服务',
          url: '',
          token: '',
          headers: {},
          enabled: true,
          transport: 'http',
          command: '',
          args: [],
          cwd: '',
          env: {},
          toolNames: []
        }
      ]
    });
  };

  const removeMcpServer = (id: string) => {
    if (!draft) return;
    updateMcp({ servers: draft.mcp.servers.filter((server) => server.id !== id) });
    setMcpTools((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
  };

  const testAllMcp = async () => {
    for (const server of draft?.mcp.servers || []) {
      if (server.enabled) await testMcp(server);
    }
  };

  const oauthMcp = async (server: McpServer) => {
    setMcpTesting(server.id);
    setMcpResult('等待浏览器完成 OAuth 授权…');
    try {
      const response = await window.bsub.mcpOAuth(server);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      updateMcpServer(server.id, { oauth: response.data });
      setMessage('OAuth 授权成功');
    } finally {
      setMcpTesting('');
    }
  };

  const watchMcpResource = async (server: McpServer, uri: string, watched: boolean) => {
    const response = watched
      ? await window.bsub.mcpWatchResource(server, uri)
      : await window.bsub.mcpUnwatchResource(server, uri);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    const subscriptions = watched
      ? [...new Set([...(server.subscriptions || []), uri])]
      : (server.subscriptions || []).filter((item) => item !== uri);
    updateMcpServer(server.id, { subscriptions });
    setMessage(watched ? `已订阅资源：${uri}` : `已取消订阅：${uri}`);
  };

  const testMcp = async (server: McpServer) => {
    setMcpTesting(server.id);
    setMcpResult('');
    try {
      const response = await window.bsub.testMcp(server);
      if (response.ok) {
        setMcpTools((previous) => ({ ...previous, [server.id]: response.data }));
        setMessage(`MCP 连接成功，${response.data.length} 个工具`);
      } else {
        setError(response.error);
      }
      const [resources, prompts] = await Promise.all([
        window.bsub.mcpResources(server),
        window.bsub.mcpPrompts(server)
      ]);
      if (resources.ok) {
        setMcpResources((previous) => ({ ...previous, [server.id]: resources.data }));
      }
      if (prompts.ok) {
        setMcpPrompts((previous) => ({ ...previous, [server.id]: prompts.data }));
      }
    } finally {
      setMcpTesting('');
    }
  };

  const testMcpRef = useRef(testMcp);
  testMcpRef.current = testMcp;
  useEffect(() => {
    return window.bsub.onMcpServerChanged?.((event) => {
      const server = draft?.mcp.servers.find((item) => item.id === event.serverId);
      if (server?.enabled) void testMcpRef.current(server);
    });
  }, [draft?.mcp.servers]);

  const readMcpResource = async (server: McpServer, uri: string) => {
    setMcpResult(`读取资源 ${uri}…`);
    const response = await window.bsub.mcpReadResource(server, uri);
    setMcpResult(response.ok ? response.data : `读取失败：${response.error}`);
  };

  const getMcpPrompt = async (
    server: McpServer,
    name: string,
    args: Record<string, string>
  ) => {
    setMcpResult(`读取提示词 ${name}…`);
    const response = await window.bsub.mcpPrompt(server, name, args);
    setMcpResult(response.ok ? response.data : `读取失败：${response.error}`);
  };

  const callMcp = async (server: McpServer, tool: McpTool) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(mcpArgs || '{}');
    } catch {
      setError('MCP 参数不是合法 JSON');
      return;
    }
    setMcpResult(`调用 ${tool.name}…`);
    const response = await window.bsub.callMcp(server, tool.name, args);
    setMcpResult(response.ok ? response.data : `调用失败：${response.error}`);
  };

  const updateSkills = (patch: Partial<AppSettings['skills']>) => {
    if (!draft) return;
    setDraft({ ...draft, skills: { ...draft.skills, ...patch } });
  };

  const updateSkill = (id: string, patch: Partial<SkillItem>) => {
    if (!draft) return;
    updateSkills({
      items: draft.skills.items.map((item) => (item.id === id ? { ...item, ...patch } : item))
    });
  };

  const addSkill = () => {
    if (!draft) return;
    updateSkills({
      items: [
        ...draft.skills.items,
        {
          id: uid('skill'),
          name: '新技能',
          description: '',
          icon: '✨',
          body: '',
          enabled: true,
          source: 'manual'
        }
      ]
    });
  };

  const removeSkill = (id: string) => {
    if (!draft) return;
    updateSkills({ items: draft.skills.items.filter((item) => item.id !== id) });
  };

  const importSkill = async () => {
    if (!draft) return;
    const response = await window.bsub.importSkill();
    if (!response.ok) {
      setError(response.error);
      return;
    }
    if (response.data) {
      updateSkills({ items: [...draft.skills.items, response.data] });
      setMessage(`已导入技能：${response.data.name}`);
    }
  };

  const importSkillUrl = async (url: string) => {
    if (!draft) return;
    const response = await window.bsub.importSkillUrl(url);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    updateSkills({ items: [...draft.skills.items, response.data] });
    setMessage(`已导入技能：${response.data.name}`);
  };

  const refreshSkillUrl = async (id: string, url: string) => {
    const response = await window.bsub.importSkillUrl(url);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    updateSkill(id, {
      name: response.data.name,
      description: response.data.description,
      body: response.data.body,
      icon: response.data.icon,
      sourceUrl: url
    });
    setMessage(`已更新技能：${response.data.name}`);
  };

  const refreshAllSkills = async () => {
    for (const skill of draft?.skills.items || []) {
      if (skill.sourceUrl) await refreshSkillUrl(skill.id, skill.sourceUrl);
    }
  };

  const installSkillTemplate = (template: {
    id: string;
    name: string;
    description: string;
    icon: string;
    body: string;
    category?: string;
  }) => {
    if (!draft) return;
    if (draft.skills.items.some((item) => item.name === template.name)) {
      setMessage(`技能「${template.name}」已经在列表里`);
      return;
    }
    updateSkills({
      items: [
        ...draft.skills.items,
        {
          id: `skill-${Date.now()}-${template.id}`,
          name: template.name,
          description: template.description,
          icon: template.icon,
          body: template.body,
          enabled: true,
          category: template.category,
          source: 'manual'
        }
      ]
    });
    setMessage(`已安装技能：${template.name}`);
  };

  const importSkillRepo = async (url: string) => {
    if (!draft) return;
    const response = await window.bsub.importSkillRepo(url);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    const existing = new Set(draft.skills.items.map((item) => item.sourceUrl || item.name));
    const fresh = response.data.filter((item) => !existing.has(item.sourceUrl || item.name));
    updateSkills({ items: [...draft.skills.items, ...fresh] });
    setMessage(`从仓库导入 ${fresh.length} 个技能`);
  };

  const importSkillsJson = (items: AppSettings['skills']['items']) => {
    if (!draft) return;
    const fresh = items.filter(
      (item) => !draft.skills.items.some((existing) => existing.name === item.name)
    );
    updateSkills({ items: [...draft.skills.items, ...fresh] });
    setMessage(`导入 ${fresh.length} 个技能`);
  };

  const loadSkillIndex = async (url: string) => {
    const response = await window.bsub.fetchSkillIndex(url);
    if (!response.ok) throw new Error(response.error);
    return response.data;
  };

  const installIndexedSkill = async (entry: {
    url: string;
    name: string;
    description: string;
    icon?: string;
    category?: string;
  }) => {
    const response = await window.bsub.importSkillUrl(entry.url);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    if (!draft) return;
    const item = {
      ...response.data,
      name: response.data.name || entry.name,
      description: response.data.description || entry.description,
      icon: response.data.icon || entry.icon || '✨',
      category: entry.category
    };
    if (draft.skills.items.some((skill) => skill.name === item.name)) {
      setMessage(`技能「${item.name}」已经在列表里`);
      return;
    }
    updateSkills({ items: [...draft.skills.items, item] });
    setMessage(`已安装远程技能：${item.name}`);
  };

  const importSkillFolder = async () => {
    if (!draft) return;
    const response = await window.bsub.importSkillFolder();
    if (!response.ok) {
      setError(response.error);
      return;
    }
    if (!response.data.length) {
      setMessage('文件夹里没有找到 SKILL.md');
      return;
    }
    updateSkills({ items: [...draft.skills.items, ...response.data] });
    setMessage(`已导入 ${response.data.length} 个技能`);
  };

  const updateSearch = (patch: Partial<AppSettings['search']>) => {
    if (!draft) return;
    setDraft({ ...draft, search: { ...draft.search, ...patch } });
  };

  const updateSearchPlatform = (patch: Partial<SearchPlatform>) => {
    if (!draft || !activeSearch) return;
    setDraft({
      ...draft,
      search: {
        ...draft.search,
        platforms: draft.search.platforms.map((platform) =>
          platform.id === activeSearch.id ? { ...platform, ...patch } : platform
        )
      }
    });
  };

  const addSearchPlatform = () => {
    if (!draft) return;
    const id = `search-${Date.now().toString(36)}`;
    const platform: SearchPlatform = {
      id,
      name: '自定义搜索',
      kind: 'custom',
      baseUrl: '',
      apiKey: '',
      homepage: '',
      keyUrl: '',
      reuseAiKey: ''
    };
    setEditingSearchId(id);
    setDraft({
      ...draft,
      search: {
        ...draft.search,
        activeId: id,
        platforms: [...draft.search.platforms, platform]
      }
    });
  };

  const removeSearchPlatform = () => {
    if (!draft || !activeSearch || draft.search.platforms.length <= 1) return;
    const platforms = draft.search.platforms.filter(
      (platform) => platform.id !== activeSearch.id
    );
    setEditingSearchId(platforms[0].id);
    setDraft({
      ...draft,
      search: { ...draft.search, activeId: platforms[0].id, platforms }
    });
  };

  const testConnection = async (kind: 'ai' | 'asr' | 'search') => {
    const platform =
      kind === 'ai' ? active : kind === 'asr' ? activeAsr : activeSearch;
    if (!platform) return;
    setPlatformBusy(`${kind}:test`);
    setError('');
    setPlatformStatus({ key: `${kind}:test`, text: '测试中…', ok: true });
    try {
      const response = await window.bsub.testPlatform(kind, platform);
      if (response.ok) {
        const text = `连接正常（${response.data.ms}ms）${response.data.sample ? ` · ${response.data.sample}` : ''}`;
        setPlatformStatus({ key: `${kind}:test`, text, ok: true });
        setMessage(text);
      } else {
        setPlatformStatus({ key: `${kind}:test`, text: response.error, ok: false });
        setError(response.error);
      }
    } catch (caught) {
      const text = (caught as Error)?.message || String(caught);
      setPlatformStatus({ key: `${kind}:test`, text, ok: false });
      setError(text);
    } finally {
      setPlatformBusy('');
    }
  };

  const probeModels = async (kind: 'ai' | 'asr') => {
    const platform = kind === 'ai' ? active : activeAsr;
    if (!platform) return;
    setPlatformBusy(`${kind}:probe`);
    setError('');
    setPlatformStatus({ key: `${kind}:probe`, text: '探测中…', ok: true });
    try {
      const response = await window.bsub.probePlatformModels(kind, platform);
      if (response.ok) {
        setModelCache((previous) => ({
          ...previous,
          [platform.id]: response.data.models
        }));
        const text = `探测到 ${response.data.models.length} 个模型`;
        setPlatformStatus({ key: `${kind}:probe`, text, ok: true });
        setMessage(text);
      } else {
        setPlatformStatus({ key: `${kind}:probe`, text: response.error, ok: false });
        setError(response.error);
      }
    } catch (caught) {
      const text = (caught as Error)?.message || String(caught);
      setPlatformStatus({ key: `${kind}:probe`, text, ok: false });
      setError(text);
    } finally {
      setPlatformBusy('');
    }
  };

  const platformStatusNode = (kind: 'ai' | 'asr' | 'search') => {
    if (!platformStatus || !platformStatus.key.startsWith(`${kind}:`)) return null;
    return (
      <div className={`platform-status${platformStatus.ok ? ' ok' : ' err'}`}>
        {platformStatus.text}
      </div>
    );
  };

  const uid = (prefix: string) =>
    `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const updateAsr = (patch: Partial<AppSettings['asr']>) => {
    if (!draft) return;
    setDraft({ ...draft, asr: { ...draft.asr, ...patch } });
  };

  const updateAsrPlatform = (patch: Partial<AsrPlatform>) => {
    if (!draft || !activeAsr) return;
    setDraft({
      ...draft,
      asr: {
        ...draft.asr,
        platforms: draft.asr.platforms.map((platform) =>
          platform.id === activeAsr.id ? { ...platform, ...patch } : platform
        )
      }
    });
  };

  const addAsrPlatform = () => {
    if (!draft) return;
    const id = uid('asr');
    setEditingAsrId(id);
    setDraft({
      ...draft,
      asr: {
        ...draft.asr,
        activeId: id,
        platforms: [
          ...draft.asr.platforms,
          { id, name: '自定义语音识别', baseUrl: '', apiKey: '', model: '' }
        ]
      }
    });
  };

  const removeAsrPlatform = () => {
    if (!draft || !activeAsr || draft.asr.platforms.length <= 1) return;
    const platforms = draft.asr.platforms.filter((platform) => platform.id !== activeAsr.id);
    setEditingAsrId(platforms[0].id);
    setDraft({ ...draft, asr: { ...draft.asr, activeId: platforms[0].id, platforms } });
  };

  const updateCorrection = (patch: Partial<AppSettings['correction']>) => {
    if (!draft) return;
    setDraft({ ...draft, correction: { ...draft.correction, ...patch } });
  };

  const updateGroup = (id: string, patch: Partial<CorrectionRuleGroup>) => {
    if (!draft) return;
    updateCorrection({
      groups: draft.correction.groups.map((group) =>
        group.id === id ? { ...group, ...patch } : group
      )
    });
  };

  const exportRuleGroup = async (group: CorrectionRuleGroup) => {
    const response = await window.bsub.exportRuleGroup(group);
    if (response.ok) {
      setMessage(response.data.canceled ? '已取消' : `已导出规则组：${response.data.path || ''}`);
    } else {
      setError(response.error);
    }
  };

  const importRuleGroups = async () => {
    if (!draft) return;
    const response = await window.bsub.importRuleGroups();
    if (!response.ok) {
      setError(response.error);
      return;
    }
    if (!response.data.length) {
      setMessage('未选择规则组文件');
      return;
    }
    updateCorrection({
      groups: [...draft.correction.groups, ...response.data]
    });
    setMessage(`已导入 ${response.data.length} 个规则组`);
  };

  const addGroup = () => {
    if (!draft) return;
    const group: CorrectionRuleGroup = {
      id: uid('group'),
      name: '新规则组',
      enabled: true,
      rules: []
    };
    updateCorrection({ groups: [...draft.correction.groups, group] });
  };

  const removeGroup = (id: string) => {
    if (!draft) return;
    updateCorrection({ groups: draft.correction.groups.filter((group) => group.id !== id) });
  };

  const updateRule = (groupId: string, ruleId: string, patch: Partial<CorrectionRule>) => {
    if (!draft) return;
    updateCorrection({
      groups: draft.correction.groups.map((group) =>
        group.id === groupId
          ? {
              ...group,
              rules: group.rules.map((rule) =>
                rule.id === ruleId ? { ...rule, ...patch } : rule
              )
            }
          : group
      )
    });
  };

  const addRule = (groupId: string) => {
    if (!draft) return;
    const group = draft.correction.groups.find((item) => item.id === groupId);
    if (!group) return;
    const rule: CorrectionRule = {
      id: uid('rule'),
      pattern: '',
      replacement: '',
      regex: false,
      caseSensitive: false
    };
    updateGroup(groupId, { rules: [...group.rules, rule] });
  };

  const removeRule = (groupId: string, ruleId: string) => {
    if (!draft) return;
    const group = draft.correction.groups.find((item) => item.id === groupId);
    if (!group) return;
    updateGroup(groupId, { rules: group.rules.filter((rule) => rule.id !== ruleId) });
  };

  const updateGlossary = (patch: Partial<AppSettings['correction']['glossary']>) => {
    if (!draft) return;
    updateCorrection({ glossary: { ...draft.correction.glossary, ...patch } });
  };

  const addTerm = () => {
    if (!draft) return;
    const term: GlossaryTerm = { id: uid('term'), from: '', to: '', note: '' };
    updateGlossary({ terms: [...draft.correction.glossary.terms, term] });
  };

  const updateTerm = (id: string, patch: Partial<GlossaryTerm>) => {
    if (!draft) return;
    updateGlossary({
      terms: draft.correction.glossary.terms.map((term) =>
        term.id === id ? { ...term, ...patch } : term
      )
    });
  };

  const removeTerm = (id: string) => {
    if (!draft) return;
    updateGlossary({
      terms: draft.correction.glossary.terms.filter((term) => term.id !== id)
    });
  };

  const updatePlatform = (patch: Partial<AiPlatform>) => {
    if (!draft || !active) return;
    setDraft({
      ...draft,
      ai: {
        ...draft.ai,
        platforms: draft.ai.platforms.map((platform) =>
          platform.id === active.id ? { ...platform, ...patch } : platform
        )
      }
    });
  };

  const addPlatform = () => {
    if (!draft) return;
    const id = `custom-${Date.now().toString(36)}`;
    const platform: AiPlatform = {
      id,
      name: '自定义平台',
      baseUrl: '',
      apiKey: '',
      model: ''
    };
    setEditingAiId(id);
    setDraft({
      ...draft,
      ai: { ...draft.ai, activeId: id, platforms: [...draft.ai.platforms, platform] }
    });
  };

  const removePlatform = () => {
    if (!draft || !active || draft.ai.platforms.length <= 1) return;
    const platforms = draft.ai.platforms.filter((platform) => platform.id !== active.id);
    setEditingAiId(platforms[0].id);
    setDraft({
      ...draft,
      ai: { ...draft.ai, activeId: platforms[0].id, platforms }
    });
  };

  const updateTemplate = (patch: Partial<PromptTemplate>) => {
    if (!draft || !activeTemplate) return;
    setDraft({
      ...draft,
      prompt: {
        ...draft.prompt,
        templates: draft.prompt.templates.map((template) =>
          template.id === activeTemplate.id ? { ...template, ...patch } : template
        )
      }
    });
  };

  const addTemplate = () => {
    if (!draft) return;
    const id = `tpl-${Date.now().toString(36)}`;
    const template: PromptTemplate = { id, name: '新模板', text: '' };
    setDraft({
      ...draft,
      prompt: {
        ...draft.prompt,
        activeId: id,
        templates: [...draft.prompt.templates, template]
      }
    });
  };

  const removeTemplate = () => {
    if (!draft || !activeTemplate || draft.prompt.templates.length <= 1) return;
    const templates = draft.prompt.templates.filter((template) => template.id !== activeTemplate.id);
    setDraft({
      ...draft,
      prompt: { ...draft.prompt, activeId: templates[0].id, templates }
    });
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const response = await window.bsub.saveSettings(draft);
      if (response.ok) {
        setDraft(response.data.settings);
        savedJsonRef.current = JSON.stringify(response.data.settings);
        setDirty(false);
        setDataDir(response.data.dataDir);
        setMessage('已保存');
        const status = await window.bsub.getBridgeStatus();
        if (status.ok) setBridge(status.data);
      } else {
        setError(response.error);
      }
    } finally {
      setSaving(false);
      window.setTimeout(() => setMessage(''), 3000);
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        if (dirty && !saving) void save();
      } else if (key === 'f') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, saving]);

  const skipCurrentUpdate = async () => {
    if (!updateState?.version) return;
    const response = await window.bsub.skipUpdate(updateState.version);
    if (response.ok) {
      setUpdateState(response.data);
      setMessage(`已跳过 v${updateState.version}，下次自动检查不再提示`);
    } else {
      setError(response.error);
    }
  };

  const installExtension = async () => {
    setInstallingExtension(true);
    setError('');
    try {
      const response = await window.bsub.installExtension();
      if (response.ok) {
        setMessage(
          `插件目录：${response.data.path}${response.data.browser ? ` · ${response.data.browser}` : ''}`
        );
      } else {
        setError(response.error);
      }
    } finally {
      setInstallingExtension(false);
    }
  };

  const refreshDiagnostics = async () => {
    const response = await window.bsub.getDiagnostics();
    if (response.ok) {
      setDiagnostics(response.data);
      setMessage('诊断信息已刷新');
    } else {
      setError(response.error);
    }
  };

  const copyDiagnostics = async () => {
    const data = diagnostics;
    if (!data) return;
    const text = [
      `版本: ${data.version}`,
      `Electron: ${data.electron}`,
      `Chrome: ${data.chrome}`,
      `Node: ${data.node}`,
      `系统: ${data.platform} ${data.arch}`,
      `数据目录: ${data.dataDir}`,
      `设置: ${data.settingsPath}`,
      `数据库: ${data.dbPath}`,
      `库: ${data.library.videos} 视频 / ${data.library.segments} 段`,
      `日志: ${data.logs.map((log) => `${log.name}=${log.size}B`).join(', ')}`
    ].join('\n');
    await window.bsub.writeClipboard(text);
    setMessage('诊断信息已复制');
  };

  const testSearch = async () => {
    setSearchTesting(true);
    setMessage('');
    setError('');
    setSearchResults(null);
    try {
      const response = await window.bsub.testSearch(searchQuery, {
        platform: activeSearch || undefined,
        search: draft?.search
      });
      if (response.ok) {
        setSearchResults(response.data);
        setMessage(
          response.data.length
            ? `检索到 ${response.data.length} 条参考资料`
            : '没有检索到结果'
        );
      } else {
        setError(response.error);
      }
    } finally {
      setSearchTesting(false);
    }
  };

  const previewCorrection = async () => {
    if (!draft) return;
    setCorrectionTesting(true);
    setError('');
    try {
      const response = await window.bsub.previewCorrection(correctionTest, draft);
      if (response.ok) setCorrectionPreview(response.data);
      else setError(response.error);
    } finally {
      setCorrectionTesting(false);
    }
  };

  const exportSettings = async () => {
    setMessage('');
    setError('');
    const response = await window.bsub.exportSettings();
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setMessage(response.data.canceled ? '已取消' : `已导出到 ${response.data.path}`);
  };

  const backupAll = async () => {
    const response = await window.bsub.backupData();
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setMessage(response.data.canceled ? '已取消' : `数据已备份到：${response.data.path || ''}`);
  };

  const changeDataLocation = async () => {
    if (migrating) return;
    setMigrating(true);
    setError('');
    try {
      const response = await window.bsub.changeDataDir();
      if (!response.ok) {
        setError(response.error);
        return;
      }
      if (response.data.canceled) {
        setMessage('已取消');
        return;
      }
      setMessage(`数据已迁移到：${response.data.target || ''}，正在重启…`);
    } catch (err) {
      setError((err as Error).message || '迁移失败');
    } finally {
      setMigrating(false);
    }
  };

  const restoreAll = async () => {
    if (
      !(await askConfirm({
        title: '恢复备份？',
        description:
          '会覆盖当前设置与字幕库，并自动重启程序。当前数据会先留一份 pre-restore 备份。',
        confirmText: '恢复并重启'
      }))
    ) {
      return;
    }
    const response = await window.bsub.restoreData();
    if (!response.ok) {
      setError(response.error);
      return;
    }
    if (response.data.canceled) {
      setMessage('已取消');
      return;
    }
    setMessage('备份已恢复，程序正在重启…');
  };

  const exportDiag = async () => {
    setMessage('');
    setError('');
    const response = await window.bsub.exportDiagnostics();
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setMessage(
      response.data.canceled ? '已取消' : `诊断包已导出到：${response.data.path || ''}`
    );
  };

  const compactDatabase = async () => {
    if (
      !(await askConfirm({
        title: '压缩数据库？',
        description:
          '会重建 library.db 并回收磁盘空间；库里条目很多时可能需要几十秒，期间不要关闭程序。',
        confirmText: '开始压缩',
        danger: false
      }))
    ) {
      return;
    }
    setMessage('');
    setError('');
    const response = await window.bsub.vacuumLibrary();
    if (!response.ok) {
      setError(response.error);
      return;
    }
    const { before, after } = response.data;
    const saved = Math.max(0, before - after);
    setMessage(
      `数据库已压缩：${(before / 1024 / 1024).toFixed(1)} MB → ${(after / 1024 / 1024).toFixed(
        1
      )} MB（回收 ${(saved / 1024 / 1024).toFixed(1)} MB）`
    );
  };

  const clearPermissions = async () => {
    if (
      !(await askConfirm({
        title: '清除所有已记住的站点权限？',
        description: '下次访问这些站点时会重新询问。'
      }))
    ) {
      return;
    }
    const response = await window.bsub.clearSitePermissions();
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setSitePermissions([]);
    setMessage(`已清除 ${response.data.removed} 条站点权限记录`);
  };

  const refreshSitePermissions = async () => {
    const response = await window.bsub.listSitePermissions();
    if (response.ok) setSitePermissions(response.data);
  };

  const revokePermission = async (origin: string, permission: string) => {
    const response = await window.bsub.revokeSitePermission(origin, permission);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    await refreshSitePermissions();
  };

  const clearBrowsingData = async () => {
    if (
      !(await askConfirm({
        title: '清除浏览数据？',
        description: '将清除所有网站的 Cookie、缓存、站点数据和登录状态，所有网站都需要重新登录。',
        confirmText: '清除'
      }))
    ) {
      return;
    }
    const response = await window.bsub.clearBrowsingData();
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setMessage('浏览数据已清除，建议刷新已打开的页面');
  };

  const importSettings = async () => {
    if (
      !(await askConfirm({
        title: '导入设置？',
        description: '会覆盖当前设置（含 API Key 和插件桥 Token）。',
        confirmText: '导入'
      }))
    ) {
      return;
    }
    setMessage('');
    setError('');
    const response = await window.bsub.importSettings();
    if (!response.ok) {
      setError(response.error);
      return;
    }
    if (response.data.canceled || !response.data.snapshot) {
      setMessage('已取消');
      return;
    }
    setDraft(response.data.snapshot.settings);
    setDataDir(response.data.snapshot.dataDir);
    setVersion(response.data.snapshot.version);
    setMessage('设置已导入');
    const status = await window.bsub.getBridgeStatus();
    if (status.ok) setBridge(status.data);
  };


  useEffect(() => {
    if (!draft) return;
    const current = JSON.stringify(draft);
    if (!savedJsonRef.current) savedJsonRef.current = current;
    const next = current !== savedJsonRef.current;
    setDirty(next);
    onDirtyChange?.(next);
  }, [draft, onDirtyChange]);

  if (!draft || !active || !activeTemplate || !activeAsr) {
    return (
      <div className="panel">
        <div className="panel-title">设置</div>
        <div className="status-line">
          <Loader2 size={13} className="spin" />
          读取设置…
        </div>
      </div>
    );
  }

  return (
    <div className="panel settings-panel">
      <div className="settings-sticky">
        <div className="panel-toolbar">
          <span className={`settings-toolbar-hint${dirty ? ' is-dirty' : ''}`}>
            {dirty ? '有未保存的修改' : '所有修改已保存'}
          </span>
          <div className="toolbar-actions">
            <button
              className="mini-btn primary"
              disabled={saving || !dirty}
              title="保存设置（Ctrl+S）"
              onClick={() => void save()}
            >
              {saving ? <Loader2 size={12} className="spin" /> : <Save size={12} />} 保存
            </button>
          </div>
        </div>

        <div className="settings-search-row">
          <Search size={14} />
          <input
            ref={searchRef}
            className="settings-search-input"
            placeholder="搜索设置（Ctrl+F）"
            value={settingsQuery}
            spellCheck={false}
            onChange={(event) => setSettingsQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setSettingsQuery('');
              if (event.key === 'Enter') {
                const first = Array.from(
                  document.querySelectorAll<HTMLElement>('.settings-section')
                ).find((section) => section.style.display !== 'none');
                first?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }}
          />
          {settingsQuery && (
            <button className="mini-btn" onClick={() => setSettingsQuery('')}>
              清除
            </button>
          )}
        </div>

        {settingsQuery && (
          <div className="settings-hint">匹配 {visibleSections} 个设置分组</div>
        )}
      </div>

      {!settingsQuery &&
        (() => {
          const guide = settingsGroup(group);
          if (!guide) return null;
          return (
            <div className="settings-guide">
              <div className="settings-guide-title">{guide.label} · 上手提示</div>
              <ul>
                {guide.tips.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
            </div>
          );
        })()}

      {show('general') && (
        <>
          <GeneralGroup value={draft.general} onChange={(patch) => updateGeneral(patch)} />
          <DownloadSection
            value={draft.general.download}
            onChange={(next) => updateGeneral({ download: next })}
          />
          <SessionsGroup value={draft.general} onChange={(patch) => updateGeneral(patch)} />
          <ShortcutsSection value={draft.general} onChange={(patch) => updateGeneral(patch)} />
        </>
      )}
      {show('appearance') && (
        <>
          <AppearanceGroup value={draft.general} onChange={(patch) => updateGeneral(patch)} />
          <AddressSearchGroup value={draft.general} onChange={(patch) => updateGeneral(patch)} />
          <ReadingGroup value={draft.general} onChange={(patch) => updateGeneral(patch)} />
        </>
      )}
      {show('voice') && (
        <>
          <AsrSection
            draft={draft}
            activeAsr={activeAsr}
            updateAsr={(patch) => updateAsr(patch)}
            updateAsrPlatform={(patch) => updateAsrPlatform(patch)}
            addAsrPlatform={addAsrPlatform}
            removeAsrPlatform={removeAsrPlatform}
            testConnection={(kind) => void testConnection(kind)}
            probeModels={(kind) => void probeModels(kind)}
            platformBusy={platformBusy}
            modelCache={modelCache}
            showKey={showKey}
            setShowKey={setShowKey}
            setEditingAsrId={setEditingAsrId}
            platformStatus={platformStatusNode}
          />
          <LocalModelsSection
            activeAsr={activeAsr}
            updateAsrPlatform={(patch) => updateAsrPlatform(patch)}
          />
          <TtsSection
            value={draft.tts}
            onChange={(patch) => setDraft({ ...draft, tts: { ...draft.tts, ...patch } })}
          />
          <VoiceInputSection
            value={draft.general.dictation}
            onChange={(patch) =>
              updateGeneral({ dictation: { ...draft.general.dictation, ...patch } })
            }
          />
          <OcrSection
            value={draft.ocr}
            onChange={(patch) => setDraft({ ...draft, ocr: { ...draft.ocr, ...patch } })}
          />
        </>
      )}

      {show('subtitles') && (
        <>
          <SubtitleGroup value={draft.general} onChange={(patch) => updateGeneral(patch)} />
          <CorrectionSection
            value={draft.correction}
            testText={correctionTest}
            preview={correctionPreview}
            testing={correctionTesting}
            onToggle={(enabled) => updateCorrection({ enabled })}
            onAddGroup={addGroup}
            onImportGroups={() => void importRuleGroups()}
            onUpdateGroup={(id, patch) => updateGroup(id, patch)}
            onExportGroup={(group) => void exportRuleGroup(group)}
            onRemoveGroup={removeGroup}
            onAddRule={addRule}
            onUpdateRule={(groupId, ruleId, patch) => updateRule(groupId, ruleId, patch)}
            onRemoveRule={(groupId, ruleId) => removeRule(groupId, ruleId)}
            onToggleGlossary={(enabled) => updateGlossary({ enabled })}
            onAddTerm={addTerm}
            onUpdateTerm={(id, patch) => updateTerm(id, patch)}
            onRemoveTerm={removeTerm}
            onTestText={setCorrectionTest}
            onPreview={() => void previewCorrection()}
          />
          <ExportDefaultsSection
            value={draft.export}
            onChange={(next) => setDraft({ ...draft, export: next })}
          />
        </>
      )}
      {show('desktop') && (
        <>
          <EfficiencyGroup value={draft.general} onChange={(patch) => updateGeneral(patch)} />
          <QuickAskSection
            value={draft.general.quickAsk}
            onChange={(patch) =>
              updateGeneral({ quickAsk: { ...draft.general.quickAsk, ...patch } })
            }
          />
          <PetSection value={draft.general} onChange={(patch) => updateGeneral(patch)} />
          <RadialSection
            value={draft.general.radial}
            onChange={(next) => updateGeneral({ radial: next })}
          />
        </>
      )}


      {show('ai') && (
      <AiSection
        draft={draft}
        active={active}
        updateAi={(patch) => updateAi(patch)}
        updatePlatform={(patch) => updatePlatform(patch)}
        addPlatform={addPlatform}
        removePlatform={removePlatform}
        testConnection={(kind) => void testConnection(kind)}
        probeModels={(kind) => void probeModels(kind)}
        platformBusy={platformBusy}
        modelCache={modelCache}
        showKey={showKey}
        setShowKey={setShowKey}
        setEditingAiId={setEditingAiId}
        platformStatus={platformStatusNode}
      />
      )}

      {show('ai') && (
        <TaskModelSection value={draft.ai} updateAi={(patch) => updateAi(patch)} />
      )}

      {show('ai') && (
        <ImageGenSection
          value={draft.image}
          onChange={(patch) => setDraft({ ...draft, image: { ...draft.image, ...patch } })}
        />
      )}

      {show('ai') && (
        <ContextSection value={draft.ai} onChange={(patch) => updateAi(patch)} />
      )}

      {show('ai') && (
        <ChatPromptsSection value={draft.ai} onChange={(patch) => updateAi(patch)} />
      )}

      {show('ai') && (
        <AssistantSection
          value={draft.ai}
          platforms={draft.ai.platforms}
          skills={draft.skills.items}
          updateAi={(patch) => updateAi(patch)}
        />
      )}

      {show('ai') && (
      <PromptSection
        value={draft.prompt}
        onPatch={(patch) => setDraft({ ...draft, prompt: { ...draft.prompt, ...patch } })}
        onAddTemplate={addTemplate}
        onRemoveTemplate={removeTemplate}
        onUpdateTemplate={(patch) => updateTemplate(patch)}
      />
      )}

      {show('data') && (
        <UsageSection
          value={draft.usage}
          onChange={(patch) => setDraft({ ...draft, usage: { ...draft.usage, ...patch } })}
        />
      )}


      {show('search') && (
      <SearchSection
        draft={draft}
        activeSearch={activeSearch}
        updateSearch={(patch) => updateSearch(patch)}
        updateSearchPlatform={(patch) => updateSearchPlatform(patch)}
        addSearchPlatform={addSearchPlatform}
        removeSearchPlatform={removeSearchPlatform}
        setEditingSearchId={setEditingSearchId}
        showKey={showKey}
        setShowKey={setShowKey}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchTesting={searchTesting}
        searchResults={searchResults}
        onTestSearch={() => void testSearch()}
      />
      )}


      {show('search') && (
      <BridgeSection
        value={draft.bridge}
        status={bridge}
        installing={installingExtension}
        onChange={(next) => setDraft({ ...draft, bridge: next })}
        onInstall={installExtension}
      />
      )}


      {show('data') && (
      <UpdateSection
        version={version}
        status={updateState}
        statusText={updateText(updateState)}
        value={draft.update}
        onChange={(next) => setDraft({ ...draft, update: next })}
        onCheck={() => void window.bsub.checkForUpdates()}
        onDownload={() => void window.bsub.downloadUpdate()}
        onSkip={() => void skipCurrentUpdate()}
        onInstall={() => void window.bsub.installUpdate()}
        onOpenReleases={() => void window.bsub.openReleasesPage()}
      />
      )}


      {show('search') && (
      <McpSection
        value={draft.mcp}
        testing={mcpTesting}
        tools={mcpTools}
        resources={mcpResources}
        prompts={mcpPrompts}
        args={mcpArgs}
        result={mcpResult}
        onChange={(next) => updateMcp(next)}
        onArgs={setMcpArgs}
        onAddServer={addMcpServer}
        onUpdateServer={(id, patch) => updateMcpServer(id, patch)}
        onRemoveServer={removeMcpServer}
        onTest={(server) => void testMcp(server)}
        onCall={(server, tool) => void callMcp(server, tool)}
        onReadResource={(server, uri) => void readMcpResource(server, uri)}
        onGetPrompt={(server, name, args) => void getMcpPrompt(server, name, args)}
        onTestAll={() => void testAllMcp()}
        onOAuth={(server) => void oauthMcp(server)}
        onWatchResource={(server, uri, watched) =>
          void watchMcpResource(server, uri, watched)
        }
      />
      )}


      {show('search') && (
      <SkillsSection
        value={draft.skills}
        onToggle={(enabled) => updateSkills({ enabled })}
        onImport={() => void importSkill()}
        onImportUrl={(url) => void importSkillUrl(url)}
        onImportRepo={(url) => void importSkillRepo(url)}
        onImportJson={(items) => importSkillsJson(items)}
        onLoadIndex={(url) => loadSkillIndex(url)}
        onInstallIndex={(entry) => void installIndexedSkill(entry)}
        onIndexUrlChange={(url) => updateSkills({ indexUrl: url })}
        onImportFolder={() => void importSkillFolder()}
        onCreate={addSkill}
        onUpdate={(id, patch) => updateSkill(id, patch)}
        onRemove={removeSkill}
        onRefresh={(id, url) => void refreshSkillUrl(id, url)}
        onRefreshAll={() => void refreshAllSkills()}
        onInstall={(template) => installSkillTemplate(template)}
      />
      )}


      {show('data') && (
      <DiagnosticsSection
        diagnostics={diagnostics}
        fallbackVersion={version}
        fallbackDataDir={dataDir}
        onRefresh={() => void refreshDiagnostics()}
        onCopy={() => void copyDiagnostics()}
        onExport={() => void exportDiag()}
      />
      )}


      {show('data') && (
      <SitePermissionsSection
        items={sitePermissions}
        onRevoke={(origin, permission) => void revokePermission(origin, permission)}
        onRefresh={() => void refreshSitePermissions()}
        onClear={() => void clearPermissions()}
      />
      )}


      {show('data') && (
      <DataBackupSection
        dataDir={dataDir}
        migrating={migrating}
        onChangeLocation={() => void changeDataLocation()}
        onExportSettings={() => void exportSettings()}
        onImportSettings={() => void importSettings()}
        onBackup={() => void backupAll()}
        onRestore={() => void restoreAll()}
        onCompact={() => void compactDatabase()}
        onClearBrowsingData={() => void clearBrowsingData()}
      />
      )}


      {(message || error) && (
        <div
          className={`settings-toast ${error ? 'err' : 'ok'}`}
          onClick={() => {
            setMessage('');
            setError('');
          }}
          title="点击关闭"
        >
          {error || message}
        </div>
      )}

      <div className="panel-foot">
        <span>API Key 用系统 DPAPI 加密后保存在本机</span>
        <span>v{version}</span>
      </div>
    </div>
  );
}
