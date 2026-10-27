import type { SearchEngineId } from './searchEngines';

export type DownloadQuality = 'best' | '2160' | '1080' | '720' | '480';

export type WheelActionId =
  | 'summary'
  | 'chat'
  | 'newChat'
  | 'library'
  | 'settings'
  | 'start'
  | 'find'
  | 'reader'
  | 'reload'
  | 'none';

export interface RadialSettings {
  enabled: boolean;
  hotkey: string;
  /** 固定 8 个扇区，顺序从正上方开始顺时针 */
  sectors: WheelActionId[];
}

export interface DownloadSettings {
  quality: DownloadQuality;
  audioOnly: boolean;
  audioFormat: 'm4a' | 'mp3';
  cover: boolean;
  subtitles: boolean;
  metadata: boolean;
  /** 文件名模板：标题 / 标题+ID / UP+标题 */
  template: 'title' | 'title-id' | 'uploader-title';
  /** 合集、分P、播放列表下载时按列表名建子文件夹 */
  folderPerList: boolean;
}

export interface OnlineDownloadOptions {
  quality?: DownloadQuality;
  audioOnly?: boolean;
  audioFormat?: 'm4a' | 'mp3';
  cover?: boolean;
  subtitles?: boolean;
  metadata?: boolean;
  template?: DownloadSettings['template'];
  folderPerList?: boolean;
  /** 只下载列表里的这些序号（从 1 开始）；为空表示单个视频 */
  playlistItems?: number[];
  /** 列表标题：用于子文件夹与提示 */
  listTitle?: string;
}

/** 解析结果：单个视频或列表（分P / 合集 / 番剧）。 */
export interface DownloadProbeEntry {
  index: number;
  id: string;
  title: string;
  duration: number;
  url: string;
  thumbnail?: string;
}

export interface DownloadProbeResult {
  kind: 'single' | 'playlist';
  id: string;
  title: string;
  uploader: string;
  duration: number;
  thumbnail: string;
  webpageUrl: string;
  entries: DownloadProbeEntry[];
}

export interface DownloadProgressEvent {
  requestId: string;
  percent: number;
  speed: string;
  eta: string;
  message: string;
}

export interface TabInfo {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  active: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  favicon?: string;
  suspended: boolean;
  zoom: number;
  /** 该标签当前的播放倍速 */
  playbackRate?: number;
  /** 固定后排在普通标签之前 */
  pinned?: boolean;
  /** 正在出声 */
  audible?: boolean;
  /** 已静音 */
  muted?: boolean;
  /** 所属标签组 */
  groupId?: string;
}

export interface TabGroup {
  id: string;
  name: string;
  color: 'blue' | 'green' | 'red' | 'yellow' | 'purple' | 'gray';
  collapsed: boolean;
}

export interface FindResult {
  tabId: string;
  activeMatchOrdinal: number;
  matches: number;
  finalUpdate: boolean;
}

export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Section =
  | 'subtitles'
  | 'summary'
  | 'chat'
  | 'library';

export interface VideoPart {
  index: number;
  cid: number;
  title: string;
  duration: number;
}

export interface VideoPoint {
  title: string;
  start: number;
  end: number;
}

export interface PageInfo {
  ok?: boolean;
  kind: string;
  bvid: string | null;
  aid: number | null;
  cid: number | null;
  epId: number | null;
  seasonId: number | null;
  page: number;
  partTitle: string;
  parts: VideoPart[];
  title: string;
  owner: string;
  desc: string;
  duration: number;
  url: string;
  signature: string;
  cover?: string;
  stat?: { view: number; danmaku: number };
  pubdate?: number;
  /** B 站官方分段/章节（view_points）；有值时总结按它组织，不再让 AI 另造章节。 */
  viewPoints?: VideoPoint[];
}

export interface SubtitleTrack {
  lan: string;
  lanDoc: string;
  url: string;
  isAi: boolean;
  aiStatus: number | null;
  source: string;
}

export interface SubtitleDiagnostics {
  groups?: string[];
  sniffed?: unknown[];
  foreignTracks?: Array<{
    from?: string;
    cid?: string;
    lan?: string;
    source?: string;
    url?: string;
  }>;
  sniffCount?: number;
  staleSniffCount?: number;
  signatureChanged?: boolean;
  identityMismatch?: boolean;
  identityUnstable?: boolean;
  reason?: string;
  /** 官方 player/v2 返回的轨数（交叉核对） */
  apiTrackCount?: number;
  /** 因与官方接口不一致被丢弃的轨数 */
  apiFiltered?: number;
}

export interface SubtitleBundle {
  needLogin: boolean;
  tracks: SubtitleTrack[];
  sources: string[];
  errors: Array<{ source?: string; code?: number | string; message?: string }>;
  identity?: string;
  diagnostics?: SubtitleDiagnostics;
}

export interface SubtitleTrackCheck {
  url: string;
  lanDoc: string;
  source: string;
  isAi: boolean;
  lines: number;
  lastEnd: number;
  coverage: number;
  ok: boolean;
  reason: string;
}

export interface SubtitleLine {
  start: number;
  end: number;
  text: string;
}

export interface TrackBody {
  lines: SubtitleLine[];
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export interface LibraryVideo {
  id: number;
  bvid: string | null;
  cid: number | null;
  title: string;
  owner: string;
  duration: number;
  cover: string | null;
  url: string;
  /** video / youtube / page / podcast / local */
  kind: string;
  /** bilibili / youtube / web / podcast / local */
  source: string;
  createdAt: number;
  updatedAt: number;
  /** 最后一次保存总结的时间；null 表示尚未总结 */
  summaryUpdatedAt: number | null;
  summaryModel?: string;
  tags: string[];
  collections: string[];
  trackCount: number;
  lineCount: number;
  /** 当前条目全部字幕轨的字符数（用于批量成本预估） */
  chars: number;
}

export interface LibraryTag {
  name: string;
  count: number;
}

export interface LibraryCollection {
  id: number;
  name: string;
  count: number;
}

export interface CollectionSummary {
  collectionId: number;
  content: string;
  model: string;
  itemCount: number;
  updatedAt: number;
}

export interface NoteVersionMeta {
  id: number;
  createdAt: number;
  chars: number;
}

export interface NoteVersion extends NoteVersionMeta {
  videoId: number;
  content: string;
}

export interface CollectionSummaryVersionMeta {
  id: number;
  model: string;
  itemCount: number;
  createdAt: number;
  chars: number;
}

export interface CollectionSummaryVersion extends CollectionSummaryVersionMeta {
  collectionId: number;
  content: string;
}

export interface ExportRecord {
  id: number;
  path: string;
  kind: string;
  title: string;
  createdAt: number;
}

export interface CollectionResolveItem {
  url: string;
  title: string;
  bvid: string;
  cid: number | null;
  page: number | null;
}

export interface CollectionResolveResult {
  kind: 'season' | 'pages' | 'single';
  title: string;
  total: number;
  items: CollectionResolveItem[];
  sourceUrl: string;
}

export interface LibraryStats {
  videos: number;
  tracks: number;
  segments: number;
  bytes: number;
}

export interface DiagnosticsLog {
  name: string;
  size: number;
  modified: number;
}

export interface DiagnosticsInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
  dataDir: string;
  settingsPath: string;
  dbPath: string;
  logs: DiagnosticsLog[];
  library: LibraryStats;
}

export interface LibraryList {
  videos: LibraryVideo[];
  stats: LibraryStats;
  /** 库内视频总数（videos 可能因分页上限被截断） */
  total: number;
}

export interface LibraryNote {
  videoId: number;
  content: string;
  updatedAt: number;
}

export interface LibraryDetail {
  video: LibraryVideo;
  /** 没有入库字幕时（只存过总结）为 null */
  bundle: LibraryBundle | null;
  summary: StoredSummary | null;
  note: LibraryNote | null;
}

export type LibrarySort = 'updated' | 'created' | 'title' | 'duration';

export interface TrashItem {
  id: number;
  videoId: number;
  title: string;
  owner: string;
  trackCount: number;
  lineCount: number;
  hasSummary: boolean;
  hasNote: boolean;
  deletedAt: number;
}

export interface HistoryEntry {
  id: number;
  url: string;
  title: string;
  favicon: string | null;
  visitedAt: number;
}

export interface Bookmark {
  id: number;
  url: string;
  title: string;
  favicon: string | null;
  createdAt: number;
}

export type DownloadState = 'progressing' | 'completed' | 'cancelled' | 'interrupted' | 'paused';

export interface DownloadRecord {
  id: number;
  url: string;
  filename: string;
  path: string;
  state: DownloadState;
  total: number;
  received: number;
  startedAt: number;
  finishedAt: number | null;
}

export interface PodcastEpisode {
  id: string;
  title: string;
  audioUrl: string;
  pageUrl: string;
  duration: number;
  pubDate: number | null;
}

export interface PodcastFeed {
  title: string;
  description: string;
  episodes: PodcastEpisode[];
}

export type JobType =
  | 'summary'
  | 'asr'
  | 'translate'
  | 'optimize'
  | 'batch-summary'
  | 'url-batch'
  | 'collection-summary'
  | 'synthesize'
  | 'batch-synthesize'
  | 'online-download'
  | 'dub'
  | 'local-transcribe';

export type JobStatus = 'running' | 'paused' | 'done' | 'failed' | 'cancelled';

export type JobItemStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface JobItem {
  targetId: string;
  title: string;
  status: JobItemStatus;
  progress: number;
  message: string;
  error: string | null;
  updatedAt: number;
}

export interface JobRecord {
  id: string;
  type: JobType;
  title: string;
  status: JobStatus;
  progress: number;
  message: string;
  error: string | null;
  /** 任务参数（例如链接批量是否顺带总结），供“重试失败项”使用 */
  metaJson: string | null;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  items: JobItem[];
}

export interface LibraryHistoryItem {
  id: number;
  videoId: number;
  bvid: string | null;
  cid: number | null;
  title: string;
  owner: string;
  url: string;
  model: string;
  content: string;
  updatedAt: number;
}

export interface LibraryTranscriptionItem {
  videoId: number;
  bvid: string | null;
  title: string;
  owner: string;
  url: string;
  trackCount: number;
  lineCount: number;
  updatedAt: number;
  lanDoc: string;
}

export interface LibraryBundle {
  info: PageInfo;
  track: SubtitleTrack;
  lines: SubtitleLine[];
}

export interface Chapter {
  start: number;
  end: number;
  title: string;
}

export interface QualityIssue {
  code: string;
  severity: 'info' | 'warn' | 'error';
  message: string;
  lineIndex?: number;
  start?: number;
  end?: number;
}

export interface QualityStats {
  lines: number;
  duration: number;
  coverage: number;
  charsPerSecond: number;
}

export interface QualityReport {
  issues: QualityIssue[];
  stats: QualityStats;
}

export interface BatchProgressEvent {
  requestId: string;
  percent: number;
  message: string;
}

export interface BatchDoneEvent {
  requestId: string;
  succeeded: number;
  failed: Array<{ videoId: number; title: string; error: string }>;
  /** 用户主动停止：已完成的条目仍然有效 */
  cancelled?: boolean;
}

export interface BatchErrorEvent {
  requestId: string;
  error: string;
}

export interface UrlBatchProgressEvent {
  requestId: string;
  index: number;
  total: number;
  url: string;
  title: string;
  stage: string;
  percent: number;
}

export interface UrlBatchDoneEvent {
  requestId: string;
  succeeded: number;
  failed: Array<{ url: string; title?: string; error: string }>;
  cancelled?: boolean;
}

export interface UrlBatchErrorEvent {
  requestId: string;
  error: string;
}

export interface LibraryIngestPayload {
  info: PageInfo;
  track: SubtitleTrack;
  lines: SubtitleLine[];
}

export interface LibraryIngestResult {
  videoId: number;
  trackId: number;
  lineCount: number;
  created: boolean;
}

export interface LibrarySearchMatch {
  videoId: number;
  bvid: string | null;
  title: string;
  owner: string;
  cover: string | null;
  url: string;
  start: number;
  end: number;
  text: string;
  lanDoc: string;
}

export interface LibrarySearchResult {
  query: string;
  /** 字幕正文命中的总条数 */
  total: number;
  matches: LibrarySearchMatch[];
  /** 标题 / UP 名命中的视频（字幕正文之外的第二类结果） */
  videos: LibraryVideo[];
  mode: 'fts' | 'like';
}

export interface SummarySearchHit {
  videoId: number;
  title: string;
  owner: string;
  url: string;
  bvid: string | null;
  cid: number | null;
  updatedAt: number;
  snippet: string;
}

export interface CollectionSearchHit {
  collectionId: number;
  name: string;
  snippet: string;
  updatedAt: number;
}

export interface GlobalSearchResult {
  query: string;
  items: LibraryVideo[];
  lines: LibrarySearchMatch[];
  summaries: SummarySearchHit[];
  collections: CollectionSearchHit[];
  total: number;
}

export interface AiPlatform {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  models?: string[];
  homepage?: string;
  keyUrl?: string;
  kind?: string;
  /** 额外 API Key：主 Key 触发限流/额度时按顺序轮换（可选） */
  extraKeys?: string[];
  /** Azure OpenAI 的 api-version（kind=azure 时使用） */
  apiVersion?: string;
}

/** 可以单独指定模型的 AI 任务；没配置就跟随「当前平台」。 */
export type AiTask =
  | 'chat'
  | 'summary'
  | 'translate'
  | 'proofread'
  | 'chapters'
  | 'verify'
  | 'quick';

export interface AiTaskModel {
  /** 平台 id；空字符串表示沿用当前平台，只覆盖模型名 */
  platformId: string;
  model: string;
}

/** 助手档案：提示词 + 模型 + 技能 + 工具 + 联网，一次性套用到对话。 */
export interface AssistantProfile {
  id: string;
  name: string;
  icon: string;
  description: string;
  prompt: string;
  /** 空 = 跟随任务槽位/当前平台 */
  platformId: string;
  /** 空 = 用平台的默认模型 */
  model: string;
  skillIds: string[];
  toolMode: 'all' | 'none' | 'custom';
  toolIds: string[];
  web: boolean;
  temperature: number | null;
  maxTokens: number | null;
}

/** 一次 AI 请求的 token 用量（由服务端返回，缺失时不记录）。 */
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  /** 命中缓存的输入 token（Anthropic cache_read_input_tokens 等） */
  cacheReadTokens?: number;
}

export interface UsageEvent {
  id: number;
  createdAt: number;
  task: AiTask;
  platformId: string;
  platformName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface UsageAggregate {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface UsageSummary {
  totals: UsageAggregate;
  byModel: Array<UsageAggregate & { model: string }>;
  byTask: Array<UsageAggregate & { task: AiTask }>;
  byDay: Array<UsageAggregate & { day: string }>;
}

export interface ModelPrice {
  /** 每 100 万输入 token 的价格（人民币） */
  input: number;
  /** 每 100 万输出 token 的价格（人民币） */
  output: number;
}

export interface ChatConversation {
  id: number;
  title: string;
  videoKey: string;
  videoTitle: string;
  profileId: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface ChatAttachment {
  name: string;
  chars: number;
  text: string;
}

export interface StoredChatMessage {
  id: number;
  conversationId: number;
  role: 'user' | 'assistant';
  content: string;
  reasoning: string;
  model: string;
  images: string[];
  sources: WebReference[];
  webEngine: string;
  webNotice: string;
  tools: ChatToolRecord[];
  attachments: ChatAttachment[];
  createdAt: number;
}

export type TtsEngine = 'edge' | 'sapi' | 'openai';

export interface TtsSettings {
  enabled: boolean;
  engine: TtsEngine;
  /** edge: zh-CN-XiaoxiaoNeural；sapi: 系统音色名；openai: alloy 等 */
  voice: string;
  /** 0.5–2.0 */
  rate: number;
  /** 0–100 */
  volume: number;
  /** 自动朗读哪些内容 */
  autoRead: {
    chat: boolean;
    summary: boolean;
    note: boolean;
  };
  /** OpenAI 兼容 /audio/speech */
  openai: {
    baseUrl: string;
    apiKey: string;
    model: string;
    voice: string;
  };
}

export interface McpServer {
  id: string;
  name: string;
  url: string;
  token: string;
  headers: Record<string, string>;
  enabled: boolean;
  transport: 'http' | 'sse' | 'stdio';
  /** stdio：可执行文件（例如 npx / uvx / node / python） */
  command?: string;
  /** stdio：参数列表 */
  args?: string[];
  /** stdio：工作目录 */
  cwd?: string;
  /** stdio：额外环境变量 */
  env?: Record<string, string>;
  /** 只允许这些工具；空数组 = 全部允许 */
  toolNames?: string[];
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema?: unknown;
}

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface McpPrompt {
  name: string;
  description: string;
  arguments: Array<{ name: string; description: string; required: boolean }>;
}

export interface SkillItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  body: string;
  enabled: boolean;
  source: 'builtin' | 'manual' | 'file';
}

export interface AsrPlatform {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  models?: string[];
  homepage?: string;
  keyUrl?: string;
  transport?: AsrTransport;
  paramStyle?: 'auto' | 'minimal' | 'full';
  audioFormat?: AsrFormat;
  keyField?: string;
  /** 默认走 HTTP 平台；local-whisper 表示调用本机 whisper.cpp */
  kind?: 'http' | 'local-whisper';
  /** 本地 whisper.cpp 可执行文件（whisper-cli.exe） */
  localExe?: string;
  /** 本地 ggml 模型文件 */
  localModel?: string;
}

export interface SearchPlatform {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  apiKey: string;
  homepage?: string;
  keyUrl?: string;
  reuseAiKey?: string;
}

export interface SearchSettings {
  enabled: boolean;
  activeId: string;
  platforms: SearchPlatform[];
  maxResults: number;
  includeContent: boolean;
  timeRange: SearchTimeRange;
  verify: boolean;
  verifySummary: boolean;
  verifyItemCount: number;
  keylessFallback: boolean;
  /** 无 Key 兜底引擎顺序：exa / anysearch / searxng */
  keylessOrder: string[];
  cacheMinutes: number;
  autoSearchOnChat: boolean;
  /** 自动联网时用一次小 AI 调用判断要不要检索（默认只用规则） */
  autoSearchAi: boolean;
  alwaysSearchOnChat: boolean;
  useVideoMeta: boolean;
  useComments: boolean;
  /** 总结前让 AI 从字幕里挑「实体 + 具体说法」生成检索词 */
  aiQueryGeneration: boolean;
  /** 用户补充的核实查询，每行一条 */
  extraVerifyQueries: string;
  /** 抓取网页正文替换摘要（慢一些，但证据更完整） */
  fetchPages: boolean;
  /** 每条结果保留的字符数（截断，避免撑爆 token） */
  snippetChars: number;
  /** 域名黑名单：每行一个，支持 * 通配与 /正则/ */
  blacklist: string[];
}

export type AsrTransport = 'auto' | 'multipart' | 'base64-json' | 'chat-audio';
export type AsrFormat = 'auto' | 'm4a' | 'wav';

export interface AsrSettings {
  activeId: string;
  platforms: AsrPlatform[];
  language: string;
  chunkSeconds: number;
  transport: AsrTransport;
  audioFormat: AsrFormat;
  concurrency: number;
  timeoutSeconds: number;
  maxFileMb: number;
  overlapSeconds: number;
  /** 本地 whisper.cpp 线程数 */
  localThreads: number;
  autoOptimizeAfter: boolean;
  autoApplyAfter: boolean;
}

export interface PromptTemplate {
  id: string;
  name: string;
  text: string;
}

export type SearchTimeRange = 'any' | 'year' | 'month' | 'week';

export interface WebReference {
  title: string;
  url: string;
  snippet: string;
}

export type VerifyVerdict = 'support' | 'refute' | 'irrelevant';

export interface VerifiedReference extends WebReference {
  verdict?: VerifyVerdict;
  /** 可注册域，用于「多来源一致 / 冲突」统计 */
  site?: string;
  consistency?: 'multi' | 'single' | 'conflict';
}

export interface VerificationItem {
  label?: string;
  query: string;
  line: string;
  context?: string;
  references: VerifiedReference[];
}

export interface VerificationSummary {
  items: VerificationItem[];
  references: VerifiedReference[];
  supplements: string[];
  attempted: number;
  failed: number;
  judged: boolean;
  dropped: number;
  error?: string;
  /** 非致命提示（例如语义判定返回格式异常，证据已保留） */
  note?: string;
}

export interface CorrectionRule {
  id: string;
  pattern: string;
  replacement: string;
  regex: boolean;
  caseSensitive: boolean;
}

export interface CorrectionRuleGroup {
  id: string;
  name: string;
  enabled: boolean;
  rules: CorrectionRule[];
}

export interface GlossaryTerm {
  id: string;
  from: string;
  to: string;
  note: string;
}

export type ThemeMode = 'system' | 'light' | 'dark';
export interface StartShortcut {
  id: string;
  label: string;
  url: string;
  /** 分组名，例如 常用 / 学习 / 工具 */
  group?: string;
}

export interface PetTodo {
  id: number;
  text: string;
  done: boolean;
  /** 提醒时间（毫秒时间戳） */
  dueAt?: number;
  /** 是否已经提醒过 */
  notified?: boolean;
}

export type PetTheme = 'sakura' | 'mint' | 'sunset' | 'midnight' | 'graphite';
export type PetClickAction = 'chat' | 'screenshot' | 'none';
export type PetDoubleClickAction = 'main' | 'screenshot' | 'none';
export type PetStartCorner =
  | 'remember'
  | 'bottom-right'
  | 'bottom-left'
  | 'top-right'
  | 'top-left';

export interface AppSettings {
  general: {
    theme: ThemeMode;
    closeToTray: boolean;
    suspendMinutes: number;
    cacheSubtitles: boolean;
    /** 字幕正文缓存天数（0 = 不缓存） */
    subtitleCacheDays: number;
    fontScale: number;
    sidebarWidth: number;
    sidebarPosition: 'left' | 'right';
    /** 标签栏放左侧（纵向） */
    verticalTabs: boolean;
    verticalTabsWidth: number;
    verticalTabsCollapsed: boolean;
    sidebarCollapsed: boolean;
    autoFollow: boolean;
    /** 默认播放倍速（没有站点规则时使用） */
    mediaRate: number;
    /** 按站点记住倍速 */
    mediaRememberSite: boolean;
    /** 已记住的站点倍速：hostname -> rate */
    mediaSiteRates: Record<string, number>;
    /** 变速不变调（preservesPitch） */
    mediaPreservePitch: boolean;
    /** 单键调速 A / S / D（默认关闭，避免和 B 站 D 键冲突） */
    mediaSingleKey: boolean;
    /** 网页内显示悬浮倍速角标 */
    mediaWidget: boolean;
    /** 首次使用向导是否已完成 */
    wizardDone: boolean;
    /** 退出时记住标签页，下次启动恢复 */
    restoreSession: boolean;
    /** 网页内选中文字时显示解释/翻译/总结工具条 */
    selectionToolbar: boolean;
    /** 桌面宠物悬浮窗 */
    petEnabled: boolean;
    /** 主窗口右下角的 AI 悬浮球 */
    assistantEnabled: boolean;
    /** 宠物窗口位置（0 表示自动放在右下角） */
    petX: number;
    /** 桌宠大小（px） */
    petSize: number;
    /** 桌宠不透明度 0.4–1 */
    petOpacity: number;
    /** 点击音效 */
    petSound: boolean;
    /** 空闲自言自语 */
    petIdleTalk: boolean;
    /** 窗口置顶 */
    petAlwaysOnTop: boolean;
    /** 桌宠配色主题 */
    petTheme: PetTheme;
    /** 呼吸/眨眼/浮动等动效 */
    petMotion: boolean;
    /** 拖拽松手吸附屏幕边缘 */
    petSnap: boolean;
    /** 单击本体 */
    petClickAction: PetClickAction;
    /** 双击本体 */
    petDoubleClickAction: PetDoubleClickAction;
    /** 空闲自言自语间隔（分钟，0 = 关闭） */
    petIdleTalkMinutes: number;
    /** 无操作后睡觉（分钟，0 = 不睡） */
    petSleepMinutes: number;
    /** 点击音效音量 0–100 */
    petSoundVolume: number;
    /** 朗读语速 0.6–2 */
    petSpeechRate: number;
    /** 启动时的位置 */
    petStartCorner: PetStartCorner;
    /** 全局截图快捷键 Ctrl+Alt+S */
    petShortcut: boolean;
    /** 气泡里显示的名字 */
    petName: string;
    /** 对话气泡宽度（px） */
    petBubbleWidth: number;
    /** 对话气泡高度（px） */
    petBubbleHeight: number;
    /** 拖动松手后带惯性（甩出去会滑一段） */
    petThrow: boolean;
    /** 气泡里显示哪些按钮（见 PET_BUTTONS） */
    petButtons: string[];
    /** 贴边停靠：none / 左 / 右 */
    petDock: 'none' | 'left' | 'right';
    /** 停靠后自动藏到屏幕边缘，悬停探出 */
    petPeek: boolean;
    /** 全屏时自动隐藏桌宠 */
    petHideFullscreen: boolean;
    /** 截图压缩档位 */
    petShotQuality: 'clear' | 'small';
    /** 语音提问快捷键 */
    petVoiceShortcut: boolean;
    /** 打开对话快捷键 */
    petChatShortcut: boolean;
    /** 应用内快捷键覆盖：动作 id → 存储格式（例如 Ctrl+Shift+Digit3） */
    shortcuts: Record<string, string>;
    /** 翻译：批间带前后文 */
    translateContext: boolean;
    /** 翻译：译完后让 AI 对照原文反思一次 */
    translateReflect: boolean;
    /** 翻译并发批数（1-3） */
    translateConcurrency: number;
    /** 翻译：LLM 不可用/失败时用免费 MyMemory 翻译兜底 */
    translateFreeFallback: boolean;
    /** 成片默认样式 */
    subtitleStyle: SubtitleStyle;
    /** 成片样式预设（最多 12 个） */
    subtitlePresets: Array<{ name: string; style: SubtitleStyle }>;
    /** 字幕面板工具栏显示的按钮 id */
    subtitleToolbar: string[];
    /** 桌宠待办（挂件里的小清单，存设置里避免清缓存丢失） */
    petTodos: PetTodo[];
    petY: number;
    /** 地址栏/起始页搜索用哪个引擎（默认必应，浏览器式） */
    searchEngine: SearchEngineId;
    /** 老配置的搜索引擎默认值迁移标记 */
    searchEngineMigrated: boolean;
    /** 起始页自定义快捷方式 */
    startShortcuts: StartShortcut[];
    /** 起始页壁纸主题 */
    startWallpaper: 'aurora' | 'midnight' | 'paper' | 'mint' | 'peach' | 'bing';
    /** 自定义壁纸（压缩后的 dataURL） */
    startWallpaperImage: string;
    /** 起始页小组件顺序 */
    startWidgets: string[];
    /** 起始页天气小组件 */
    startWeather: boolean;
    /** 天气城市 */
    startCity: string;
    /** 起始页热搜小组件 */
    startHotSearch: boolean;
    /** 云同步文件夹（OneDrive/坚果云等本地同步目录） */
    syncFolder: string;
    /** 开机自启动 */
    autoStart: boolean;
    /** searchEngine=custom 时的 URL 模板，必须包含 {q} */
    searchEngineCustom: string;
    /** 应用级代理：影响内置浏览器与 AI/搜索请求 */
    proxy: {
      mode: 'system' | 'custom' | 'none';
      /** custom 时的代理规则，例如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080 */
      url: string;
      /** 绕过代理的地址，逗号分隔 */
      bypass: string;
    };
    /** 全局语音听写：热键说话，识别后粘贴到前台应用 */
    dictation: {
      enabled: boolean;
      accelerator: string;
      /** 识别后自动模拟 Ctrl+V */
      autoPaste: boolean;
    };
    /** 全局快捷取词：任意应用选中文字后热键唤起桌宠 */
    quickAsk: {
      enabled: boolean;
      accelerator: string;
    };
    /** 主题强调色（#rrggbb），colorScheme=custom 时生效 */
    accentColor: string;
    /** 预设配色 id（见 shared/colorSchemes.ts）；custom 使用 accentColor */
    colorScheme: string;
    /** 界面密度 */
    density: 'comfortable' | 'compact';
    /** 自定义 CSS（追加到界面） */
    customCss: string;
    /** 界面圆角（px） */
    uiRadius: number;
    /** 毛玻璃面板 */
    uiGlass: boolean;
    /** 界面动效 */
    uiMotion: boolean;
    /** 在线视频下载默认选项 */
    download: DownloadSettings;
    /** 鼠标轮盘 */
    radial: RadialSettings;
  };
  ai: {
    activeId: string;
    platforms: AiPlatform[];
    temperature: number;
    maxTokens: number;
    stream: boolean;
    preProofread: boolean;
    sendOnEnter: boolean;
    expandReasoning: boolean;
    presetVersion: number;
    /** 允许模型调用本地只读工具（搜库/读条目） */
    appTools: boolean;
    /** 按任务覆盖模型；缺省跟随当前平台 */
    taskModels: Partial<Record<AiTask, AiTaskModel>>;
    /** 助手档案 */
    profiles: AssistantProfile[];
    /** 按「平台/模型」覆盖自动识别的能力（图片/音频） */
    capabilities: Record<string, { vision?: boolean; audio?: boolean }>;
  };
  usage: {
    /** 记录 token 用量（关闭后不再写库） */
    enabled: boolean;
    /** 用户覆盖的模型价格（每 100 万 token，人民币） */
    prices: Record<string, ModelPrice>;
  };
  tts: TtsSettings;
  ocr: {
    /** system = Windows 自带 OCR；paddle = 自建 PaddleOCR HTTP 服务 */
    engine: 'system' | 'paddle';
    /** Windows OCR 语言标签（auto 用系统默认） */
    lang: string;
    /** PaddleOCR 服务地址（POST { image: base64 } → { text } 或 Paddle 常见结构） */
    paddleUrl: string;
  };
  knowledge: {
    enabled: boolean;
    /** 空 = 使用当前 AI 平台（必须支持 OpenAI 兼容 /embeddings） */
    platformId: string;
    model: string;
  };
  asr: AsrSettings;
  prompt: {
    activeId: string;
    templates: PromptTemplate[];
    chat: string;
    translate: string;
    optimize: string;
    chapters: string;
  };
  mcp: {
    enabled: boolean;
    servers: McpServer[];
    callTimeoutMs: number;
    maxToolRounds: number;
    /** 危险工具审批：off=不询问，write=写入类工具询问，all=全部询问 */
    approvalMode: McpApprovalMode;
  };
  skills: {
    enabled: boolean;
    builtinVersion: number;
    items: SkillItem[];
  };
  search: SearchSettings;
  correction: {
    enabled: boolean;
    groups: CorrectionRuleGroup[];
    glossary: {
      enabled: boolean;
      terms: GlossaryTerm[];
    };
  };
  export: {
    format: ExportFormat;
    includeTimestamps: boolean;
    filenamePattern: string;
    template: ExportTemplate;
    assFontSize: number;
    estimateTimestamps: boolean;
  };
  bridge: {
    enabled: boolean;
    port: number;
    token: string;
  };
  update: {
    autoCheck: boolean;
    autoDownload: boolean;
    feedUrl: string;
    skippedVersion: string;
  };
  dataDir: string;
}

export type UpdateState =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateStatus {
  state: UpdateState;
  currentVersion: string;
  version?: string;
  progress?: number;
  error?: string;
  notes?: string;
  manual?: boolean;
  checkedAt?: number;
}

export interface BridgeStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  token: string;
  error?: string;
}

export interface SettingsSnapshot {
  settings: AppSettings;
  dataDir: string;
  version: string;
}

export type ExportFormat = 'md' | 'srt' | 'vtt' | 'ass' | 'txt' | 'json';
export type ExportTemplate = 'plain' | 'timestamped' | 'notes' | 'meeting';

export interface ExportPayload {
  format: ExportFormat;
  info: PageInfo;
  track: SubtitleTrack | null;
  lines: SubtitleLine[];
  summary?: string;
  savePath?: string;
  includeTimestamps?: boolean;
  filenamePattern?: string;
  translatedLines?: SubtitleLine[];
  translationLanguage?: string;
  template?: ExportTemplate;
  assFontSize?: number;
  estimateTimestamps?: boolean;
}

export interface SaveTextPayload {
  content: string;
  filename?: string;
  /** 指定路径时跳过保存对话框（测试/自动化用） */
  savePath?: string;
}

export type SaveTextResult = { path: string } | { canceled: true };

export interface AiDeltaEvent {
  requestId: string;
  delta: string;
}

export interface AiStatusEvent {
  requestId: string;
  status: string;
}

export interface AiReasoningEvent {
  requestId: string;
  delta: string;
}

export interface ChatToolRecord {
  name: string;
  ok: boolean;
  detail: string;
  /** 毫秒时间戳 */
  at: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
  reasoning?: string;
  /** 助手消息引用的联网资料（持久化时只保留标题/链接/短摘要） */
  sources?: WebReference[];
  /** 本次来源实际使用的检索引擎（用于来源列表标题） */
  webEngine?: string;
  /** 联网失败/未启用的提示，回答本身仍然有效 */
  webNotice?: string;
  /** 这一轮调用过的工具（持久化到对话库） */
  tools?: ChatToolRecord[];
  /** 用户上传的文本附件（只保存截断后的文本） */
  attachments?: ChatAttachment[];
}

export interface ChatRequest {
  requestId: string;
  info: PageInfo;
  lines: SubtitleLine[];
  messages: ChatMessage[];
  skillIds?: string[];
  /** 助手档案 id：套用提示词/模型/技能/工具/联网 */
  profileId?: string;
  /** 本次对话允许使用的 MCP 工具（`serverId__toolName`）；不传 = 全部，空数组 = 不用 MCP */
  mcpToolIds?: string[];
  /** 是否把当前网页正文/选中内容带给模型（默认 true） */
  includePage?: boolean;
  /** 本次对话强制联网检索（覆盖设置里的自动检索策略） */
  web?: boolean;
  /** 桌宠等场景附带的上下文（前台窗口、来源说明） */
  context?: string;
  /** 调用来源：main = 主窗口对话；pet = 桌面即时助手（用独立系统提示词） */
  surface?: 'main' | 'pet';
}

export interface ChatToolEvent {
  requestId: string;
  phase: 'start' | 'done';
  /** 展示名（已去掉 serverId 前缀） */
  name: string;
  /** 启动时是参数摘要，完成时是结果摘要 */
  detail?: string;
  ok?: boolean;
}

/** 主窗口里可勾选的 MCP 工具（已按服务器展开）。 */
export type McpApprovalMode = 'off' | 'write' | 'all';

export interface McpToolOption {
  id: string;
  serverId: string;
  serverName: string;
  name: string;
  description: string;
}

export interface ChatApprovalEvent {
  requestId: string;
  approvalId: string;
  name: string;
  detail: string;
}

export interface ChatCompareResult {
  platformId: string;
  platformName: string;
  model: string;
  text: string;
  error: string;
}

export interface ConvertTargetResult {
  source: string;
  output: string;
}

export interface KbStatus {
  chunks: number;
  videos: number;
  model: string;
  ready: boolean;
}

export type KbLearningStatus = 'new' | 'learning' | 'review' | 'mastered';

export interface KbDocument {
  videoId: number;
  title: string;
  owner: string;
  chunks: number;
  subtitle: number;
  summary: number;
  note: number;
  indexed: number;
  updatedAt: number;
  /** 视频标签（来自资料库） */
  tags: string[];
  /** 学习状态 */
  status: KbLearningStatus;
}

export interface KbChunk {
  kind: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface KbQaEntry {
  id: number;
  question: string;
  answer: string;
  mode: 'ask' | 'search';
  scopeLabel: string;
  hits: KbHit[];
  createdAt: number;
}

export interface KbCard {
  id: number;
  videoId: number | null;
  front: string;
  back: string;
  dueAt: number;
  intervalDays: number;
  streak: number;
  createdAt: number;
  updatedAt: number;
}

export interface KbHit {
  videoId: number;
  title: string;
  kind: string;
  startMs: number;
  endMs: number;
  text: string;
  score: number;
}

export interface KbProgress {
  phase: 'collect' | 'embed' | 'done' | 'error';
  done: number;
  total: number;
  message: string;
}

export interface PageContextSummary {
  title: string;
  url: string;
  chars: number;
  selectionChars: number;
}

export interface PageDocument {
  title: string;
  url: string;
  text: string;
}

export interface ChatDeltaEvent {
  requestId: string;
  delta: string;
  reasoning?: string;
}

export interface ChatStatusEvent {
  requestId: string;
  status: string;
}

export interface ChatDoneEvent {
  requestId: string;
  text: string;
  model: string;
  reasoning?: string;
  /** 本次联网检索实际采用的参考资料 */
  references?: WebReference[];
  /** 参考资料实际使用的检索引擎 */
  webEngine?: string;
  /** 联网失败/未启用时的提示（回答仍会继续） */
  webError?: string;
}

export interface ChatErrorEvent {
  requestId: string;
  error: string;
}

export type AsrStage = 'prepare' | 'download' | 'convert' | 'transcribe' | 'merge';

export interface AsrProgressEvent {
  requestId: string;
  stage: AsrStage;
  percent: number;
  message: string;
}

/** 本地 whisper.cpp 模型/可执行文件下载进度 */
export interface AsrDownloadProgress {
  key: string;
  percent: number;
  received: number;
  total: number;
  message: string;
}

export interface AsrLocalStatus {
  dir: string;
  models: Partial<
    Record<'tiny' | 'base' | 'small' | 'medium' | 'large-v3-turbo', string>
  >;
  binaries: Partial<Record<'cpu' | 'vulkan' | 'cuda118' | 'cuda124', string>>;
  binary: string | null;
  note: string;
}

export interface AsrDoneEvent {
  requestId: string;
  lines: SubtitleLine[];
  model: string;
  duration: number;
}

export interface AsrErrorEvent {
  requestId: string;
  error: string;
}

export interface SubtitleStyle {
  fontName: string;
  fontSize: number;
  primaryColor: string;
  outlineColor: string;
  outline: number;
  shadow: number;
  marginV: number;
  bilingual: boolean;
  alignment: number;
}

export interface SynthesizeRequest {
  requestId: string;
  videoPath: string;
  title: string;
  lines: SubtitleLine[];
  translatedLines?: SubtitleLine[];
  mode: 'hard' | 'soft';
  style: SubtitleStyle;
  /** 软字幕轨道语言标签（mkv），默认 chi */
  softLanguage?: string;
}

export interface SynthesizeProgressEvent {
  requestId: string;
  percent: number;
  message: string;
}

export interface SynthesizeDoneEvent {
  requestId: string;
  path: string;
  canceled?: boolean;
}

export interface TranslateRequest {
  requestId: string;
  lines: SubtitleLine[];
  target: string;
  options?: {
    useContext?: boolean;
    reflect?: boolean;
    concurrency?: number;
    freeFallback?: boolean;
  };
}

export interface TranslateProgressEvent {
  requestId: string;
  percent: number;
  message: string;
}

export interface TranslateDoneEvent {
  requestId: string;
  lines: SubtitleLine[];
  language: string;
}

export interface TranslateErrorEvent {
  requestId: string;
  error: string;
}

export interface OptimizeSuggestion {
  index: number;
  original: string;
  suggestion: string;
  verdict?: 'support' | 'refute' | 'unknown';
  evidence?: string;
  sources?: number;
  supportCount?: number;
  refuteCount?: number;
  consistency?: 'multi' | 'single' | 'conflict';
}

export interface OptimizeProgressEvent {
  requestId: string;
  percent: number;
  message: string;
}

export interface OptimizeDoneEvent {
  requestId: string;
  suggestions: OptimizeSuggestion[];
}

export interface OptimizeErrorEvent {
  requestId: string;
  error: string;
}

export interface SummarizeRequest {
  requestId?: string;
  info: PageInfo;
  lines: SubtitleLine[];
  /** 跳过「先校对字幕」直接生成（快速总结） */
  skipProofread?: boolean;
  /** 跳过联网核对/参考资料（快速总结） */
  skipVerify?: boolean;
}

export interface AiDoneEvent {
  requestId: string;
  text: string;
  model: string;
  verification?: VerificationSummary;
}

export interface AiErrorEvent {
  requestId: string;
  error: string;
}

export interface SummaryRef {
  bvid: string | null;
  cid: number | null;
  epId: number | null;
}

export interface StoredSummary {
  content: string;
  model: string;
  updatedAt: number;
  /** 保存总结时的联网核对结果（旧数据没有该字段） */
  verification?: VerificationSummary | null;
}

export interface SummaryVersionMeta {
  id: number;
  model: string;
  createdAt: number;
  chars: number;
}

export interface SummaryVersion extends SummaryVersionMeta {
  videoId: number;
  content: string;
}


