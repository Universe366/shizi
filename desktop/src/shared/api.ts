import type {
  AiDeltaEvent,
  AiDoneEvent,
  AiErrorEvent,
  AiStatusEvent,
  AiReasoningEvent,
  AiPlatform,
  AsrPlatform,
  SearchPlatform,
  AppSettings,
  TabGroup,
  DiagnosticsInfo,
  CorrectionRuleGroup,
  BridgeStatus,
  ChatDeltaEvent,
  ChatDoneEvent,
  ChatErrorEvent,
  ChatStatusEvent,
  ChatRequest,
  AsrDoneEvent,
  AsrErrorEvent,
  AsrProgressEvent,
  AsrDownloadProgress,
  AsrLocalStatus,
  TranslateRequest,
  TranslateProgressEvent,
  TranslateDoneEvent,
  TranslateErrorEvent,
  OptimizeProgressEvent,
  OptimizeDoneEvent,
  OptimizeErrorEvent,
  BatchProgressEvent,
  BatchDoneEvent,
  UrlBatchProgressEvent,
  UrlBatchDoneEvent,
  UrlBatchErrorEvent,
  BatchErrorEvent,
  Chapter,
  QualityReport,
  McpServer,
  McpTool,
  SkillItem,
  LibraryHistoryItem,
  LibraryTranscriptionItem,
  FindResult,
  LayoutRect,
  Result,
  PageInfo,
  SettingsSnapshot,
  StoredSummary,
  SubtitleBundle,
  SubtitleLine,
  SummarizeRequest,
  SummaryRef,
  TrackBody,
  TabInfo,
  WebReference,
  UpdateStatus,
  ExportPayload,
  SynthesizeRequest,
  SynthesizeDoneEvent,
  SubtitleStyle,
  SaveTextPayload,
  SaveTextResult,
  LibraryIngestPayload,
  LibraryIngestResult,
  LibraryList,
  LibrarySearchResult,
  LibraryDetail,
  LibrarySort,
  LibraryTag,
  LibraryCollection,
  LibraryNote,
  NoteVersion,
  NoteVersionMeta,
  CollectionSummary,
  CollectionSummaryVersion,
  CollectionSummaryVersionMeta,
  CollectionResolveResult,
  ExportRecord,
  JobRecord,
  SummaryVersion,
  SummaryVersionMeta,
  GlobalSearchResult,
  TrashItem,
  HistoryEntry,
  Bookmark,
  DownloadRecord,
  PageContextSummary,
  UsageEvent,
  UsageSummary,
  TtsSettings,
  ChatConversation,
  StoredChatMessage,
  McpResource,
  McpPrompt,
  PodcastFeed,
  PageDocument
} from './types';

export interface BsubApi {
  listTabs(): Promise<TabInfo[]>;
  newTab(url?: string): Promise<string>;
  /** 打开链接：同一视频已打开时复用标签；start 为秒级播放位置。 */
  openUrl(url: string, start?: number): Promise<{ id: string; reused: boolean; ready: boolean }>;
  moveTab(id: string, index: number): void;
  petPosition(): Promise<{ x: number; y: number } | null>;
  resetPetPosition(): Promise<void>;
  movePet(x: number, y: number): Promise<void>;
  /** 拖拽松手：吸附屏幕边缘并保存位置。 */
  dropPet(x: number, y: number): Promise<{ x: number; y: number } | null>;
  /** 桌宠窗口随气泡/挂件/菜单伸缩，避免透明区域挡住桌面点击。 */
  setPetLayout(mode: 'compact' | 'bubble' | 'widget' | 'menu'): Promise<void>;
  setPetAlwaysOnTop(enabled: boolean): Promise<boolean>;
  /** 收起气泡后把焦点还给上一个窗口。 */
  petBlur(): Promise<void>;
  /** 主进程跟随光标拖拽（指针移出窗口也不会掉）。 */
  beginPetDrag(): Promise<void>;
  endPetDrag(): Promise<{ x: number; y: number; moved: boolean } | null>;
  /** 全局截图快捷键的注册状态。 */
  petShortcutStatus(): Promise<{ accelerator: string; registered: boolean; error: string }>;
  petShortcutsStatus(): Promise<
    Array<{ id: 'shot' | 'voice' | 'chat'; accelerator: string; registered: boolean; error: string }>
  >;
  onPetVoice(cb: () => void): () => void;
  onPetChat(cb: () => void): () => void;
  /** 拖角调整气泡大小；persist=true 时落盘。 */
  resizeBubble(
    width: number,
    height: number,
    persist: boolean
  ): Promise<{ width: number; height: number }>;
  /** 面板是否翻到了桌宠下方。 */
  petFlipped(): Promise<boolean>;
  onPetFlipped(cb: (below: boolean) => void): () => void;
  /** 桌宠本体矩形（跨布局稳定，用于位置断言/调试）。 */
  petBodyRect(): Promise<{ x: number; y: number; width: number; height: number } | null>;
  /** 全局快捷键框选后的结果（已裁剪压缩）。 */
  onPetShot(
    cb: (result: {
      action: 'image' | 'chat' | 'ocr';
      dataUrl: string;
      width: number;
      height: number;
    }) => void
  ): () => void;
  /** 全局快捷取词结果（任意应用选中文字）。 */
  onPetSelection(cb: (payload: { text: string; error?: string }) => void): () => void;
  openSettings(): Promise<void>;
  onOpenSettings(cb: () => void): () => void;
  /** 焦点在网页里时，主进程转发的可自定义快捷键动作 id */
  onShortcut?(cb: (action: string) => void): () => void;
  isMediaPlaying(): Promise<{ ok: true; data: boolean }>;
  /** 播放/暂停当前标签页的媒体。 */
  toggleMedia(): Promise<{ ok: true; data: { playing: boolean } }>;
  setPetEnabled(enabled: boolean): Promise<void>;
  focusMain(): Promise<void>;
  setPlaybackRate(rate: number): Promise<{ ok: true; data: number }>;
  /** 打开/收起当前页面里的倍速面板 */
  toggleMediaPanel(): Promise<void>;
  setActiveViewVisible(visible: boolean): Promise<void>;
  pinTab(id: string, pinned: boolean): Promise<void>;
  closeTab(id: string, nextId?: string): Promise<void>;
  activateTab(id: string): Promise<void>;
  navigate(url: string): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  stop(): Promise<void>;
  setLayout(rect: LayoutRect): void;
  exitFullscreen(): void;
  refreshView(): void;
  onTabs(cb: (tabs: TabInfo[]) => void): () => void;
  reopenClosedTab(): Promise<string | null>;

  listBrowseHistory(query?: string, limit?: number): Promise<Result<HistoryEntry[]>>;
  clearBrowseHistory(): Promise<Result<{ removed: number }>>;
  listBookmarks(): Promise<Result<Bookmark[]>>;
  isBookmarked(url: string): Promise<Result<{ bookmarked: boolean }>>;
  toggleBookmark(payload: {
    url: string;
    title?: string;
    favicon?: string | null;
  }): Promise<Result<{ bookmarked: boolean }>>;
  removeBookmark(url: string): Promise<Result<{ removed: boolean }>>;
  listDownloads(): Promise<Result<DownloadRecord[]>>;
  deleteDownload(id: number): Promise<Result<{ removed: boolean }>>;
  clearDownloads(): Promise<Result<{ removed: number }>>;
  openDownload(id: number): Promise<Result<boolean>>;
  revealDownload(id: number): Promise<Result<boolean>>;
  controlDownload(id: number, action: 'pause' | 'resume' | 'cancel'): Promise<Result<{ state: string }>>;
  clearBrowsingData(): Promise<Result<{ cleared: boolean }>>;
  onDownloadsChanged(cb: () => void): () => void;

  getPageInfo(tabId?: string): Promise<Result<PageInfo>>;
  getPageContext(): Promise<Result<PageContextSummary>>;
  getPageDocument(): Promise<Result<PageDocument>>;
  resolveCollection(input: string): Promise<Result<CollectionResolveResult>>;
  getSubtitles(expectSignature?: string, tabId?: string): Promise<Result<SubtitleBundle>>;
  /** 当前页面选中的文字（桌宠「问选中」，不抽整页正文）。 */
  readSelection(): Promise<Result<{ title: string; url: string; selection: string }>>;
  /** 截当前标签页，返回 data URL（桌宠「看屏幕」/识图）。 */
  capturePage(): Promise<Result<{ dataUrl: string }>>;
  /** 框选截图：全屏覆盖窗选中区域后，按「识别图片 / 对话 / 提取文字」返回裁剪图。 */
  captureRegion(): Promise<{
    action: 'image' | 'chat' | 'ocr';
    dataUrl: string;
    width: number;
    height: number;
  } | null>;
  /** 覆盖窗：取背景截图与尺寸。 */
  shotInit(): Promise<{ dataUrl: string; width: number; height: number } | null>;
  /** 覆盖窗：回传选中区域（null = 取消）与动作。 */
  shotDone(
    payload: {
      selection: { x: number; y: number; width: number; height: number } | null;
      action: 'image' | 'chat' | 'ocr';
      annotatedDataUrl?: string;
    } | null
  ): Promise<void>;
  triggerSubtitleMenu(): Promise<Result<boolean>>;
  getTrackBody(url: string): Promise<Result<TrackBody>>;
  getTime(): Promise<Result<{ currentTime: number; duration: number }>>;
  seek(time: number): Promise<void>;

  ingestLibrary(payload: LibraryIngestPayload): Promise<Result<LibraryIngestResult>>;
  listLibrary(sort?: LibrarySort): Promise<Result<LibraryList>>;
  getLibraryItem(id: number): Promise<Result<LibraryDetail>>;
  getNote(videoId: number): Promise<Result<LibraryNote | null>>;
  saveNote(videoId: number, content: string): Promise<Result<LibraryNote | null>>;
  getNoteVersions(videoId: number): Promise<Result<NoteVersionMeta[]>>;
  getNoteVersion(id: number): Promise<Result<NoteVersion | null>>;
  listTags(): Promise<Result<LibraryTag[]>>;
  setLibraryTags(videoId: number, tags: string[]): Promise<Result<{ tags: string[] }>>;
  renameTag(name: string, newName: string): Promise<Result<{ renamed: boolean }>>;
  deleteTag(name: string): Promise<Result<{ removed: boolean }>>;
  bulkTag(videoIds: number[], name: string): Promise<Result<{ linked: number }>>;
  bulkCollection(videoIds: number[], name: string): Promise<Result<{ linked: number }>>;
  bulkRemove(videoIds: number[]): Promise<Result<{ removed: number }>>;
  importLocalMedia(): Promise<
    Result<{ canceled: boolean; requestId?: string; filename?: string }>
  >;
  previewPodcast(url: string): Promise<Result<PodcastFeed>>;
  importPodcast(payload: {
    audioUrl: string;
    title: string;
    pageUrl?: string;
    duration?: number;
  }): Promise<Result<{ requestId: string }>>;
  listTrash(): Promise<Result<TrashItem[]>>;
  restoreTrash(id: number): Promise<Result<{ videoId: number }>>;
  deleteTrash(id: number): Promise<Result<{ removed: boolean }>>;
  clearTrash(): Promise<Result<{ removed: number }>>;
  vacuumLibrary(): Promise<Result<{ before: number; after: number }>>;
  listCollections(): Promise<Result<LibraryCollection[]>>;
  createCollection(name: string): Promise<Result<LibraryCollection>>;
  addToCollection(videoId: number, name: string): Promise<Result<{ collections: string[] }>>;
  removeFromCollection(
    videoId: number,
    name: string
  ): Promise<Result<{ collections: string[] }>>;
  renameCollection(id: number, name: string): Promise<Result<{ renamed: boolean }>>;
  deleteCollection(id: number): Promise<Result<{ removed: boolean }>>;
  getCollectionSummary(collectionId: number): Promise<Result<CollectionSummary | null>>;
  getCollectionSummaryVersions(
    collectionId: number
  ): Promise<Result<CollectionSummaryVersionMeta[]>>;
  getCollectionSummaryVersion(id: number): Promise<Result<CollectionSummaryVersion | null>>;
  restoreCollectionSummaryVersion(id: number): Promise<Result<CollectionSummary>>;
  summarizeCollection(collectionId: number): Promise<Result<{ requestId: string }>>;
  onCollectionSummaryDone(
    cb: (event: { collectionId: number; summary: CollectionSummary }) => void
  ): () => void;
  onCollectionSummaryError(
    cb: (event: { collectionId: number; error: string }) => void
  ): () => void;
  searchLibrary(query: string): Promise<Result<LibrarySearchResult>>;
  globalSearch(query: string): Promise<Result<GlobalSearchResult>>;
  onSearchRequest(cb: () => void): () => void;
  onAskSelectionRequest(cb: () => void): () => void;
  onSelectionAction(cb: (payload: { action: string; text: string }) => void): () => void;
  onTabSearchRequest(cb: () => void): () => void;
  onBookmarkRequest(cb: () => void): () => void;
  onReaderRequest(cb: () => void): () => void;
  onTasksRequest(cb: () => void): () => void;
  removeLibrary(id: number): Promise<Result<{ removed: boolean }>>;
  savePageSummary(payload: {
    title: string;
    url: string;
    content: string;
    model?: string;
  }): Promise<Result<{ videoId: number; created: boolean }>>;
  openLibrarySource(id: number): Promise<Result<boolean>>;
  onLibraryChanged(cb: () => void): () => void;

  getSettings(): Promise<Result<SettingsSnapshot>>;
  getDiagnostics(): Promise<Result<DiagnosticsInfo>>;
  exportDiagnostics(): Promise<Result<{ canceled: boolean; path?: string }>>;
  clearSitePermissions(): Promise<Result<{ removed: number }>>;
  listSitePermissions(): Promise<
    Result<Array<{ origin: string; permission: string; decision: 'allow' | 'deny' }>>
  >;
  revokeSitePermission(origin: string, permission: string): Promise<Result<{ removed: boolean }>>;
  saveSettings(next: AppSettings): Promise<Result<SettingsSnapshot>>;
  /** 用量统计：最近 N 天的汇总（按模型/任务/日期）。 */
  usageSummary(days?: number): Promise<Result<UsageSummary>>;
  /** 最近的请求明细。 */
  usageEvents(limit?: number): Promise<Result<UsageEvent[]>>;
  clearUsage(): Promise<Result<{ removed: number }>>;
  exportUsage(): Promise<Result<{ canceled: boolean; path?: string }>>;
  /** 本地 OCR（Windows 系统 OCR）。 */
  ocrRecognize(payload: {
    dataUrl?: string;
    path?: string;
    lang?: string;
  }): Promise<Result<{ text: string; ms: number }>>;
  ocrStatus(): Promise<Result<{ available: boolean }>>;
  /** 文字朗读：主进程合成音频，返回 dataURL。 */
  ttsSpeak(payload: { text: string; override?: TtsSettings }): Promise<
    Result<{ dataUrl: string; mime: string; engine: 'edge' | 'sapi' | 'openai'; ms: number }>
  >;
  ttsVoices(): Promise<Result<{ edge: Array<{ id: string; label: string }>; sapi: string[] }>>;
  /** 全局听写：主进程热键 → 渲染层录音 → dictationFinish 回传文字。 */
  onDictationStart(cb: () => void): () => void;
  onDictationStop(cb: () => void): () => void;
  dictationFinish(payload: { text: string; error?: string }): void;
  finishWizard(): Promise<Result<SettingsSnapshot>>;
  setWizardVisible(visible: boolean): Promise<Result<SettingsSnapshot>>;
  setSidebarWidth(width: number): Promise<Result<SettingsSnapshot>>;
  setBrowserVisible(visible: boolean): Promise<void>;
  beginSidebarDrag(): Promise<Result<string | null>>;
  endSidebarDrag(): Promise<void>;
  /** 垂直标签栏宽度/折叠状态（高频，不触发设置全量副作用） */
  setTabsLayout(patch: { width?: number; collapsed?: boolean }): Promise<Result<SettingsSnapshot>>;
  setSidebarLayout(patch: {
    width?: number;
    position?: 'left' | 'right';
    collapsed?: boolean;
  }): Promise<Result<SettingsSnapshot>>;
  handoffChat(payload: { question: string; answer: string }): Promise<void>;
  onChatHandoff(cb: (payload: { question: string; answer: string }) => void): () => void;
  readClipboard(): Promise<string>;
  foregroundWindow(): Promise<Result<{ title: string; process: string }>>;
  readPetFile(
    path: string
  ): Promise<Result<{ kind: 'image' | 'text'; name: string; dataUrl?: string; text?: string }>>;
  /** Electron 32+ 移除了 File.path，拖入文件要经 webUtils 取真实路径 */
  petFilePath(file: File): string;
  transcribeVoice(dataUrl: string): Promise<Result<{ text: string }>>;
  tabPreview(id: string): Promise<{ dataUrl: string; title: string; url: string } | null>;
  getTabGroups(): Promise<TabGroup[]>;
  onTabGroups(cb: (groups: TabGroup[]) => void): () => void;
  createTabGroup(name: string, color: TabGroup['color']): Promise<TabGroup>;
  assignTabGroup(tabId: string, groupId: string | null): Promise<void>;
  renameTabGroup(id: string, name: string): Promise<void>;
  setTabGroupColor(id: string, color: TabGroup['color']): Promise<void>;
  toggleTabGroupCollapsed(id: string): Promise<void>;
  closeTabGroup(id: string): Promise<void>;
  /** 用系统菜单渲染浮层（避免被网页视图盖住）。 */
  popupMenu(
    items: Array<{ id?: string; label?: string; type?: 'separator'; enabled?: boolean }>
  ): Promise<string | null>;
  setTabMuted(id: string, muted: boolean): Promise<void>;
  sleepTab(id: string): Promise<boolean>;
  wakeTab(id: string): Promise<boolean>;
  listClosedTabs(): Promise<Array<{ url: string; title: string }>>;
  reopenClosedAt(index: number): Promise<string | null>;
  /** 请求关闭主窗口（走应用内确认弹窗）。 */
  requestClose(): Promise<void>;
  /** 关闭窗口时主进程询问：最小化到托盘 / 退出 / 取消。 */
  onCloseRequest(cb: () => void): () => void;
  /** 自定义关闭框超时/被放弃时，主进程通知渲染层收起遮罩 */
  onCloseCancel(cb: () => void): () => void;
  /** 关闭框已显示：主进程据此取消「弹窗没出来」的兜底计时 */
  closeShown?(): void;
  closeDecision(choice: 'tray' | 'quit' | 'cancel', remember: boolean): void;
  /** 起始页天气（Open-Meteo） */
  startWeather(city: string): Promise<
    Result<{ city: string; temperature: number; description: string; high: number; low: number }>
  >;
  /** 起始页 B 站热搜 */
  startHotSearch(): Promise<Result<string[]>>;
  /** 云同步：选择文件夹 */
  chooseSyncFolder(): Promise<Result<string | null>>;
  syncStatus(folder: string): Promise<
    Result<{ exists: boolean; modifiedAt?: number; path: string }>
  >;
  syncPush(folder: string): Promise<Result<{ path: string }>>;
  syncPull(folder: string): Promise<
    Result<{ settings: AppSettings; path: string }>
  >;
  exportSettings(): Promise<Result<{ canceled: boolean; path?: string }>>;
  importSettings(): Promise<Result<{ canceled: boolean; snapshot?: SettingsSnapshot }>>;
  onSettingsChanged(cb: (snapshot: SettingsSnapshot) => void): () => void;
  testSearch(
    query: string,
    override?: { platform?: SearchPlatform; search?: AppSettings['search'] }
  ): Promise<Result<WebReference[]>>;
  previewCorrection(text: string, settings?: AppSettings): Promise<Result<string>>;
  exportRuleGroup(group: CorrectionRuleGroup): Promise<Result<{ canceled: boolean; path?: string }>>;
  importRuleGroups(): Promise<Result<CorrectionRuleGroup[]>>;
  probePlatformModels(
    kind: 'ai' | 'asr',
    platform: AiPlatform | AsrPlatform
  ): Promise<Result<{ models: string[]; url: string }>>;
  testPlatform(
    kind: 'ai' | 'asr' | 'search',
    platform: AiPlatform | AsrPlatform | SearchPlatform
  ): Promise<Result<{ ok: boolean; ms: number; sample: string }>>;
  openDataDir(): Promise<void>;
  /** 打开系统文件选择框（本地 ASR 选 exe/模型用） */
  pickFile?(options?: {
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<Result<string | null>>;
  openExternal(url: string): Promise<void>;
  backupData(): Promise<Result<{ canceled: boolean; path?: string }>>;
  restoreData(): Promise<Result<{ canceled: boolean; restored?: boolean }>>;
  changeDataDir(): Promise<
    Result<{ canceled: boolean; target?: string; failed?: number }>
  >;
  getBridgeStatus(): Promise<Result<BridgeStatus>>;
  installExtension(): Promise<Result<{ path: string; browser: string; opened: boolean }>>;
  writeClipboard(text: string): Promise<void>;

  getUpdateStatus(): Promise<Result<UpdateStatus>>;
  checkForUpdates(): Promise<Result<UpdateStatus>>;
  downloadUpdate(): Promise<Result<UpdateStatus>>;
  installUpdate(): Promise<void>;
  skipUpdate(version: string): Promise<Result<UpdateStatus>>;
  openReleasesPage(): Promise<void>;
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void;

  summarize(payload: SummarizeRequest): Promise<Result<{ requestId: string }>>;
  cancelSummary(requestId: string): Promise<void>;
  getSummary(ref: SummaryRef): Promise<Result<StoredSummary | null>>;
  getSummaryVersions(videoId: number): Promise<Result<SummaryVersionMeta[]>>;
  getSummaryVersion(id: number): Promise<Result<SummaryVersion | null>>;
  restoreSummaryVersion(id: number): Promise<Result<StoredSummary>>;
  onAiDelta(cb: (event: AiDeltaEvent) => void): () => void;
  onAiDone(cb: (event: AiDoneEvent) => void): () => void;
  onAiError(cb: (event: AiErrorEvent) => void): () => void;
  onAiStatus(cb: (event: AiStatusEvent) => void): () => void;
  onAiReasoning(cb: (event: AiReasoningEvent) => void): () => void;

  chat(payload: ChatRequest): Promise<Result<{ requestId: string }>>;
  cancelChat(requestId: string): Promise<void>;
  chatHistoryList(limit?: number): Promise<Result<ChatConversation[]>>;
  chatHistoryLatest(videoKey: string): Promise<Result<ChatConversation | null>>;
  chatHistoryCreate(input: {
    title?: string;
    videoKey?: string;
    videoTitle?: string;
  }): Promise<Result<ChatConversation>>;
  chatHistoryMessages(id: number): Promise<Result<StoredChatMessage[]>>;
  chatHistoryAppend(
    conversationId: number,
    message: {
      role: 'user' | 'assistant';
      content: string;
      reasoning?: string;
      model?: string;
      images?: string[];
      sources?: WebReference[];
      webEngine?: string;
      webNotice?: string;
    }
  ): Promise<Result<StoredChatMessage>>;
  chatHistoryRename(id: number, title: string): Promise<Result<boolean>>;
  chatHistoryTruncate(conversationId: number, keep: number): Promise<Result<boolean>>;
  chatHistoryDelete(id: number): Promise<Result<boolean>>;
  chatHistoryExport(id: number): Promise<Result<{ canceled: boolean; path?: string }>>;
  onChatDelta(cb: (event: ChatDeltaEvent) => void): () => void;
  onChatDone(cb: (event: ChatDoneEvent) => void): () => void;
  onChatError(cb: (event: ChatErrorEvent) => void): () => void;
  onChatStatus(cb: (event: ChatStatusEvent) => void): () => void;

  transcribe(requestId: string): Promise<Result<{ requestId: string }>>;
  cancelTranscribe(requestId: string): Promise<void>;
  onAsrProgress(cb: (event: AsrProgressEvent) => void): () => void;
  onAsrDone(cb: (event: AsrDoneEvent) => void): () => void;
  onAsrError(cb: (event: AsrErrorEvent) => void): () => void;
  /** 本地 whisper.cpp：已下载的模型/可执行文件 */
  localAsrStatus?(): Promise<Result<AsrLocalStatus>>;
  downloadAsrModel?(
    id: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3-turbo'
  ): Promise<Result<{ path: string }>>;
  downloadAsrBinary?(variant?: 'cpu' | 'vulkan' | 'cuda118' | 'cuda124'): Promise<
    Result<{ path: string }>
  >;
  /** 读取本机显卡名称（用于选择 CUDA / Vulkan 构建） */
  detectGpu?(): Promise<Result<{ names: string[] }>>;
  cancelAsrDownload?(key: string): void;
  deleteAsrModel?(id: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3-turbo'): Promise<
    Result<{ removed: boolean; status: AsrLocalStatus }>
  >;
  deleteAsrBinary?(variant: 'cpu' | 'vulkan' | 'cuda118' | 'cuda124'): Promise<
    Result<{ removed: boolean; status: AsrLocalStatus }>
  >;
  onAsrDownloadProgress?(cb: (event: AsrDownloadProgress) => void): () => void;
  /** 选择一个本地 .srt/.vtt 字幕文件（返回文件名与文本） */
  pickSubtitleFile?(): Promise<Result<{ name: string; text: string } | null>>;
  /** 智能断句：只合并/拆分，不改写字幕文字 */
  resegmentSubtitles?(payload: {
    requestId?: string;
    lines: SubtitleLine[];
    options: { maxChars: number; minDuration: number; useAi: boolean };
  }): Promise<Result<{ lines: SubtitleLine[]; mode: string; note: string }>>;

  translate(payload: TranslateRequest): Promise<Result<{ requestId: string }>>;
  cancelTranslate(requestId: string): Promise<void>;
  onTranslateProgress(cb: (event: TranslateProgressEvent) => void): () => void;
  onTranslateDone(cb: (event: TranslateDoneEvent) => void): () => void;
  onTranslateError(cb: (event: TranslateErrorEvent) => void): () => void;

  optimize(payload: { requestId: string; lines: SubtitleLine[] }): Promise<Result<{ requestId: string }>>;
  cancelOptimize(requestId: string): Promise<void>;
  onOptimizeProgress(cb: (event: OptimizeProgressEvent) => void): () => void;
  onOptimizeDone(cb: (event: OptimizeDoneEvent) => void): () => void;
  onOptimizeError(cb: (event: OptimizeErrorEvent) => void): () => void;

  batchSummarize(
    videoIds: number[],
    concurrency?: number
  ): Promise<Result<{ requestId: string }>>;
  cancelBatch(requestId: string): Promise<void>;
  pauseBatch(requestId: string): Promise<void>;
  resumeBatch(requestId: string): Promise<void>;
  removeBatchItem(requestId: string, videoId: number): Promise<void>;
  onBatchProgress(cb: (event: BatchProgressEvent) => void): () => void;
  onBatchDone(cb: (event: BatchDoneEvent) => void): () => void;
  onBatchError(cb: (event: BatchErrorEvent) => void): () => void;

  batchUrls(urls: string[], summarize: boolean): Promise<Result<{ requestId: string }>>;
  cancelUrlBatch(requestId: string): Promise<void>;
  onUrlBatchProgress(cb: (event: UrlBatchProgressEvent) => void): () => void;
  onUrlBatchDone(cb: (event: UrlBatchDoneEvent) => void): () => void;
  onUrlBatchError(cb: (event: UrlBatchErrorEvent) => void): () => void;

  getHistory(): Promise<Result<LibraryHistoryItem[]>>;
  getTranscriptions(): Promise<Result<LibraryTranscriptionItem[]>>;
  deleteHistory(id: number): Promise<Result<{ removed: boolean }>>;
  clearHistory(): Promise<Result<{ removed: number }>>;
  listExports(): Promise<Result<ExportRecord[]>>;
  clearExports(): Promise<Result<{ removed: number }>>;
  deleteExport(id: number): Promise<Result<{ removed: boolean }>>;
  openExport(filePath: string): Promise<Result<boolean>>;
  revealExport(filePath: string): Promise<Result<boolean>>;

  listJobs(): Promise<Result<JobRecord[]>>;
  getJob(id: string): Promise<Result<JobRecord | null>>;
  cancelJob(id: string): Promise<void>;
  retryJob(id: string): Promise<Result<{ requestId: string }>>;
  clearFinishedJobs(): Promise<Result<{ removed: number }>>;
  onJobsChanged(cb: (jobs: JobRecord[]) => void): () => void;

  checkQuality(info: PageInfo, lines: SubtitleLine[]): Promise<Result<QualityReport>>;
  generateChapters(info: PageInfo, lines: SubtitleLine[]): Promise<Result<Chapter[]>>;

  testMcp(server: McpServer): Promise<Result<McpTool[]>>;
  callMcp(server: McpServer, name: string, args: Record<string, unknown>): Promise<Result<string>>;
  mcpResources(server: McpServer): Promise<Result<McpResource[]>>;
  mcpReadResource(server: McpServer, uri: string): Promise<Result<string>>;
  mcpPrompts(server: McpServer): Promise<Result<McpPrompt[]>>;
  mcpPrompt(
    server: McpServer,
    name: string,
    args: Record<string, string>
  ): Promise<Result<string>>;
  importSkill(): Promise<Result<SkillItem | null>>;
  importSkillUrl(url: string): Promise<Result<SkillItem>>;
  importSkillFolder(): Promise<Result<SkillItem[]>>;

  exportBatch(payload: { ids: number[]; kind: 'subtitles' | 'summary' }): Promise<
    Result<{ canceled: true } | { dir: string; exported: number; skipped: string[] }>
  >;
  exportVideo(payload: ExportPayload): Promise<Result<{ path: string } | { canceled: true }>>;
  synthesizeVideo(payload: SynthesizeRequest): Promise<
    Result<{ requestId: string; path: string } | { canceled: true }>
  >;
  cancelSynthesize?(requestId: string): void;
  batchSynthesize?(payload: {
    ids: number[];
    mode?: 'hard' | 'soft';
    style?: SubtitleStyle;
  }): Promise<Result<{ requestId: string; dir: string; total: number } | { canceled: true }>>;
  downloadOnlineVideo?(url: string): Promise<Result<{ requestId: string }>>;
  cancelOnlineDownload?(requestId: string): void;
  onDownloadDone?(cb: (event: { requestId: string; path: string }) => void): () => void;
  onDownloadError?(cb: (event: { requestId: string; error: string }) => void): () => void;
  listTtsVoices?(): Promise<Result<{ voices: string[] }>>;
  dubVideo?(payload: {
    videoPath: string;
    title: string;
    lines: SubtitleLine[];
    voice?: string;
    mode: 'audio' | 'video';
  }): Promise<Result<{ requestId: string; path: string } | { canceled: true }>>;
  cancelDub?(requestId: string): void;
  onDubDone?(cb: (event: { requestId: string; path: string }) => void): () => void;
  onDubError?(cb: (event: { requestId: string; error: string }) => void): () => void;
  pickLocalMedia?(): Promise<
    Result<{ path: string; name: string; duration: number } | { canceled: true }>
  >;
  transcribeLocalVideo?(path: string, language?: string): Promise<Result<{ requestId: string }>>;
  cancelLocalTranscribe?(requestId: string): void;
  onLocalTransProgress?(
    cb: (event: { requestId: string; percent: number; message: string }) => void
  ): () => void;
  onLocalTransDone?(
    cb: (event: {
      requestId: string;
      lines: SubtitleLine[];
      name: string;
      duration: number;
      path: string;
    }) => void
  ): () => void;
  onLocalTransError?(cb: (event: { requestId: string; error: string }) => void): () => void;
  saveLocalTranscript?(payload: {
    path: string;
    name: string;
    duration: number;
    lines: SubtitleLine[];
  }): Promise<Result<{ videoId: number }>>;
  onSynthesizeDone?(cb: (event: SynthesizeDoneEvent) => void): () => void;
  onSynthesizeError?(cb: (event: { requestId: string; error: string }) => void): () => void;
  saveTextFile(payload: SaveTextPayload): Promise<Result<SaveTextResult>>;

  zoomIn(): Promise<void>;
  zoomOut(): Promise<void>;
  zoomReset(): Promise<void>;
  findInPage(query: string, options?: { forward?: boolean; findNext?: boolean }): Promise<void>;
  stopFind(): Promise<void>;
  onFindResult(cb: (result: FindResult) => void): () => void;
}
