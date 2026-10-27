import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { BsubApi } from '../shared/api';
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
  ExportPayload,
  SynthesizeRequest,
  SynthesizeDoneEvent,
  SynthesizeProgressEvent,
  SaveTextPayload,
  SaveTextResult,
  LayoutRect,
  PageInfo,
  Result,
  SettingsSnapshot,
  StoredSummary,
  WebReference,
  SubtitleBundle,
  SubtitleTrack,
  SubtitleLine,
  SummarizeRequest,
  SummaryRef,
  TabInfo,
  TabGroup,
  TrackBody,
  UpdateStatus,
  UsageEvent,
  UsageSummary,
  TtsSettings,
  ChatConversation,
  StoredChatMessage,
  McpResource,
  McpPrompt,
  McpToolOption,
  ChatToolEvent,
  ChatToolRecord,
  ChatApprovalEvent,
  ChatAttachment,
  ChatCompareResult,
  KbChunk,
  WebSearchDiagnostics,
  KbCard,
  KbDocument,
  KbQaEntry,
  KbLearningStatus,
  KbStatus,
  KbHit,
  KbProgress,
  ConvertTargetResult,
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
  DownloadProgressEvent,
  DownloadProbeResult,
  OnlineDownloadOptions,
  PageContextSummary,
  PodcastFeed,
  PageDocument,
  SiteMeta
} from '../shared/types';

const on = <T>(channel: string, cb: (payload: T) => void) => {
  const handler = (_event: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

const api: BsubApi = {
  listTabs: () => ipcRenderer.invoke('tabs:list') as Promise<TabInfo[]>,
  readClipboard: () => ipcRenderer.invoke('clipboard:read') as Promise<string>,
  foregroundWindow: () => ipcRenderer.invoke('window:foreground'),
  readPetFile: (path: string) => ipcRenderer.invoke('pet:read-file', path),
  filePath: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  petFilePath: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  transcribeVoice: (dataUrl: string) => ipcRenderer.invoke('voice:transcribe', { dataUrl }),
  tabPreview: (id: string) =>
    ipcRenderer.invoke('tab:preview', id) as Promise<{
      dataUrl: string;
      title: string;
      url: string;
    } | null>,
  getTabGroups: () => ipcRenderer.invoke('tabs:groups') as Promise<TabGroup[]>,
  onTabGroups: (cb: (groups: TabGroup[]) => void) => on<TabGroup[]>('tabs:groups', cb),
  createTabGroup: (name: string, color: TabGroup['color']) =>
    ipcRenderer.invoke('group:create', name, color) as Promise<TabGroup>,
  assignTabGroup: (tabId: string, groupId: string | null) =>
    ipcRenderer.invoke('group:assign', tabId, groupId) as Promise<void>,
  renameTabGroup: (id: string, name: string) =>
    ipcRenderer.invoke('group:rename', id, name) as Promise<void>,
  setTabGroupColor: (id: string, color: TabGroup['color']) =>
    ipcRenderer.invoke('group:color', id, color) as Promise<void>,
  toggleTabGroupCollapsed: (id: string) =>
    ipcRenderer.invoke('group:collapse', id) as Promise<void>,
  closeTabGroup: (id: string) => ipcRenderer.invoke('group:close', id) as Promise<void>,
  newTab: (url?: string) => ipcRenderer.invoke('tab:new', url) as Promise<string>,
  openUrl: (url: string, start?: number) =>    ipcRenderer.invoke('tab:open', url, start) as Promise<{
      id: string;
      reused: boolean;
      ready: boolean;
    }>,
  moveTab: (id: string, index: number) =>
    ipcRenderer.invoke('tab:move', id, index) as Promise<void>,
  focusMain: () => ipcRenderer.invoke('app:focus-main') as Promise<void>,
  petPosition: () =>
    ipcRenderer.invoke('pet:get-position') as Promise<{ x: number; y: number } | null>,
  resetPetPosition: () => ipcRenderer.invoke('pet:reset-position') as Promise<void>,
  movePet: (x: number, y: number) =>
    ipcRenderer.invoke('pet:move', x, y) as Promise<void>,
  dropPet: (x: number, y: number) =>
    ipcRenderer.invoke('pet:drop', x, y) as Promise<{ x: number; y: number } | null>,
  setPetLayout: (mode: 'compact' | 'bubble' | 'widget' | 'menu') =>
    ipcRenderer.invoke('pet:set-layout', mode) as Promise<void>,
  setPetAlwaysOnTop: (enabled: boolean) =>
    ipcRenderer.invoke('pet:set-always-on-top', enabled) as Promise<boolean>,
  petBlur: () => ipcRenderer.invoke('pet:blur') as Promise<void>,
  beginPetDrag: () => ipcRenderer.invoke('pet:begin-drag') as Promise<void>,
  endPetDrag: () =>
    ipcRenderer.invoke('pet:end-drag') as Promise<{ x: number; y: number; moved: boolean } | null>,
  petShortcutsStatus: () => ipcRenderer.invoke('pet:shortcuts-status'),
  onPetVoice: (cb: () => void) => on<void>('pet:voice', cb),
  onPetChat: (cb: () => void) => on<void>('pet:open-chat', cb),
  handoffChat: (payload: unknown) => ipcRenderer.invoke('chat:handoff', payload) as Promise<void>,
  onChatHandoff: (cb: (payload: { question: string; answer: string }) => void) =>
    on<{ question: string; answer: string }>('chat:handoff', cb),
  petShortcutStatus: () =>
    ipcRenderer.invoke('pet:shortcut-status') as Promise<{
      accelerator: string;
      registered: boolean;
      error: string;
    }>,
  petFlipped: () => ipcRenderer.invoke('pet:flipped') as Promise<boolean>,
  resizeBubble: (width: number, height: number, persist: boolean) =>
    ipcRenderer.invoke('pet:resize-bubble', { width, height, persist }) as Promise<{
      width: number;
      height: number;
    }>,
  onPetFlipped: (cb: (below: boolean) => void) => on<boolean>('pet:flipped', cb),
  petBodyRect: () =>
    ipcRenderer.invoke('pet:body-rect') as Promise<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>,
  onPetShot: (cb) => on<{ action: 'image' | 'chat' | 'ocr'; dataUrl: string; width: number; height: number }>('pet:shot', cb),
  onPetSelection: (cb) => on<{ text: string; error?: string }>('pet:selection', cb),
  openSettings: () => ipcRenderer.invoke('app:open-settings') as Promise<void>,
  onOpenSettings: (cb: () => void) => on<null>('ui:open-settings', () => cb()),
  onShortcut: (cb: (action: string) => void) => on<string>('app:shortcut', cb),
  isMediaPlaying: () =>
    ipcRenderer.invoke('media:playing') as Promise<{ ok: true; data: boolean }>,
  toggleMedia: () =>
    ipcRenderer.invoke('media:toggle') as Promise<{ ok: true; data: { playing: boolean } }>,
  setPetEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('pet:set-enabled', enabled) as Promise<void>,
  setPlaybackRate: (rate: number) =>
    ipcRenderer.invoke('media:set-rate', rate) as Promise<{ ok: true; data: number }>,
  toggleMediaPanel: () => ipcRenderer.invoke('media:toggle-panel') as Promise<void>,
  setActiveViewVisible: (visible: boolean) =>
    ipcRenderer.invoke('tab:set-visible', visible) as Promise<void>,
  pinTab: (id: string, pinned: boolean) =>
    ipcRenderer.invoke('tab:pin', id, pinned) as Promise<void>,
  closeTab: (id: string, nextId?: string) =>
    ipcRenderer.invoke('tab:close', id, nextId) as Promise<void>,
  activateTab: (id: string) => ipcRenderer.invoke('tab:activate', id) as Promise<void>,
  navigate: (url: string) => ipcRenderer.invoke('tab:navigate', url) as Promise<void>,
  back: () => ipcRenderer.invoke('tab:back') as Promise<void>,
  forward: () => ipcRenderer.invoke('tab:forward') as Promise<void>,
  reload: () => ipcRenderer.invoke('tab:reload') as Promise<void>,
  stop: () => ipcRenderer.invoke('tab:stop') as Promise<void>,
  zoomIn: () => ipcRenderer.invoke('tab:zoom-in') as Promise<void>,
  zoomOut: () => ipcRenderer.invoke('tab:zoom-out') as Promise<void>,
  zoomReset: () => ipcRenderer.invoke('tab:zoom-reset') as Promise<void>,
  findInPage: (query: string, options?: { forward?: boolean; findNext?: boolean }) =>
    ipcRenderer.invoke('tab:find', query, options) as Promise<void>,
  stopFind: () => ipcRenderer.invoke('tab:stop-find') as Promise<void>,
  onFindResult: (cb: (result: FindResult) => void) => on<FindResult>('find:result', cb),
  setLayout: (rect: LayoutRect) => ipcRenderer.send('layout:set', rect),
  exitFullscreen: () => ipcRenderer.send('tabs:exit-fullscreen'),
  refreshView: () => ipcRenderer.send('tabs:refresh-view'),
  onTabs: (cb: (tabs: TabInfo[]) => void) => on<TabInfo[]>('tabs:changed', cb),
  setTabMuted: (id: string, muted: boolean) =>
    ipcRenderer.invoke('tab:set-muted', id, muted) as Promise<void>,
  sleepTab: (id: string) => ipcRenderer.invoke('tab:sleep', id) as Promise<boolean>,
  wakeTab: (id: string) => ipcRenderer.invoke('tab:wake', id) as Promise<boolean>,
  listClosedTabs: () => ipcRenderer.invoke('tabs:closed') as Promise<Array<{ url: string; title: string }>>,
  reopenClosedAt: (index: number) =>
    ipcRenderer.invoke('tabs:reopen-at', index) as Promise<string | null>,
  reopenClosedTab: () => ipcRenderer.invoke('tab:reopen-closed') as Promise<string | null>,

  listBrowseHistory: (query?: string, limit?: number) =>
    ipcRenderer.invoke('browse-history:list', query, limit) as Promise<Result<HistoryEntry[]>>,
  clearBrowseHistory: () =>
    ipcRenderer.invoke('browse-history:clear') as Promise<Result<{ removed: number }>>,

  listBookmarks: () => ipcRenderer.invoke('bookmarks:list') as Promise<Result<Bookmark[]>>,
  isBookmarked: (url: string) =>
    ipcRenderer.invoke('bookmarks:check', url) as Promise<Result<{ bookmarked: boolean }>>,
  toggleBookmark: (payload: { url: string; title?: string; favicon?: string | null }) =>
    ipcRenderer.invoke('bookmarks:toggle', payload) as Promise<Result<{ bookmarked: boolean }>>,
  removeBookmark: (url: string) =>
    ipcRenderer.invoke('bookmarks:remove', url) as Promise<Result<{ removed: boolean }>>,

  listDownloads: () => ipcRenderer.invoke('downloads:list') as Promise<Result<DownloadRecord[]>>,
  deleteDownload: (id: number) =>
    ipcRenderer.invoke('downloads:delete', id) as Promise<Result<{ removed: boolean }>>,
  clearDownloads: () =>
    ipcRenderer.invoke('downloads:clear') as Promise<Result<{ removed: number }>>,
  openDownload: (id: number) =>
    ipcRenderer.invoke('downloads:open', id) as Promise<Result<boolean>>,
  revealDownload: (id: number) =>
    ipcRenderer.invoke('downloads:reveal', id) as Promise<Result<boolean>>,
  controlDownload: (id: number, action: 'pause' | 'resume' | 'cancel') =>
    ipcRenderer.invoke('downloads:control', { id, action }) as Promise<Result<{ state: string }>>,
  clearBrowsingData: () =>
    ipcRenderer.invoke('browser:clear-data') as Promise<Result<{ cleared: boolean }>>,
  onDownloadsChanged: (cb: () => void) => on<null>('downloads:changed', () => cb()),

  getPageInfo: (tabId?: string) =>
    ipcRenderer.invoke('page:info', tabId) as Promise<Result<PageInfo>>,
  getPageContext: () =>
    ipcRenderer.invoke('page:context') as Promise<Result<PageContextSummary>>,
  getPageDocument: () =>
    ipcRenderer.invoke('page:document') as Promise<Result<PageDocument>>,
  resolveCollection: (input: string) =>
    ipcRenderer.invoke('source:resolve-collection', input) as Promise<
      Result<CollectionResolveResult>
    >,
  getSubtitles: (expectSignature?: string, tabId?: string) =>
    ipcRenderer.invoke('page:subtitles', expectSignature, tabId) as Promise<Result<SubtitleBundle>>,
  savedSubtitles: (info: PageInfo) =>
    ipcRenderer.invoke('page:saved-subtitles', info) as Promise<Result<SubtitleTrack[]>>,
  readSelection: () =>
    ipcRenderer.invoke('page:selection') as Promise<
      Result<{ title: string; url: string; selection: string }>
    >,
  capturePage: () =>
    ipcRenderer.invoke('page:capture') as Promise<Result<{ dataUrl: string }>>,
  captureRegion: () =>
    ipcRenderer.invoke('shot:capture-region') as Promise<{
      action: 'image' | 'chat' | 'ocr';
      dataUrl: string;
      width: number;
      height: number;
    } | null>,
  shotInit: () =>
    ipcRenderer.invoke('shot:init') as Promise<{
      dataUrl: string;
      width: number;
      height: number;
    } | null>,
  shotDone: (payload) => ipcRenderer.invoke('shot:done', payload) as Promise<void>,
  triggerSubtitleMenu: () =>
    ipcRenderer.invoke('page:trigger-subtitle') as Promise<Result<boolean>>,
  getTrackBody: (url: string) => ipcRenderer.invoke('page:track-body', url) as Promise<Result<TrackBody>>,
  getTime: () =>
    ipcRenderer.invoke('page:time') as Promise<Result<{ currentTime: number; duration: number }>>,
  seek: (time: number) => ipcRenderer.invoke('page:seek', time) as Promise<void>,

  ingestLibrary: (payload: LibraryIngestPayload) =>
    ipcRenderer.invoke('library:ingest', payload) as Promise<Result<LibraryIngestResult>>,
  listLibrary: (sort?: LibrarySort) =>
    ipcRenderer.invoke('library:list', sort) as Promise<Result<LibraryList>>,
  getLibraryItem: (id: number) =>
    ipcRenderer.invoke('library:get', id) as Promise<Result<LibraryDetail>>,
  getNote: (videoId: number) =>
    ipcRenderer.invoke('library:note', videoId) as Promise<Result<LibraryNote | null>>,
  saveNote: (videoId: number, content: string) =>
    ipcRenderer.invoke('library:note-save', { videoId, content }) as Promise<
      Result<LibraryNote | null>
    >,
  getNoteVersions: (videoId: number) =>
    ipcRenderer.invoke('library:note-versions', videoId) as Promise<Result<NoteVersionMeta[]>>,
  getNoteVersion: (id: number) =>
    ipcRenderer.invoke('library:note-version', id) as Promise<Result<NoteVersion | null>>,
  listTags: () => ipcRenderer.invoke('library:tags') as Promise<Result<LibraryTag[]>>,
  setLibraryTags: (videoId: number, tags: string[]) =>
    ipcRenderer.invoke('library:set-tags', { videoId, tags }) as Promise<
      Result<{ tags: string[] }>
    >,
  renameTag: (name: string, newName: string) =>
    ipcRenderer.invoke('library:tag-rename', { name, newName }) as Promise<
      Result<{ renamed: boolean }>
    >,
  deleteTag: (name: string) =>
    ipcRenderer.invoke('library:tag-delete', name) as Promise<Result<{ removed: boolean }>>,
  bulkTag: (videoIds: number[], name: string) =>
    ipcRenderer.invoke('library:bulk-tag', { videoIds, name }) as Promise<
      Result<{ linked: number }>
    >,
  bulkCollection: (videoIds: number[], name: string) =>
    ipcRenderer.invoke('library:bulk-collection', { videoIds, name }) as Promise<
      Result<{ linked: number }>
    >,
  bulkRemove: (videoIds: number[]) =>
    ipcRenderer.invoke('library:bulk-remove', { videoIds }) as Promise<
      Result<{ removed: number }>
    >,
  importLocalMedia: () =>
    ipcRenderer.invoke('local:import') as Promise<
      Result<{ canceled: boolean; requestId?: string; filename?: string }>
    >,
  previewPodcast: (url: string) =>
    ipcRenderer.invoke('podcast:preview', url) as Promise<Result<PodcastFeed>>,
  importPodcast: (payload: {
    audioUrl: string;
    title: string;
    pageUrl?: string;
    duration?: number;
  }) => ipcRenderer.invoke('podcast:import', payload) as Promise<Result<{ requestId: string }>>,
  listTrash: () => ipcRenderer.invoke('trash:list') as Promise<Result<TrashItem[]>>,
  restoreTrash: (id: number) =>
    ipcRenderer.invoke('trash:restore', id) as Promise<Result<{ videoId: number }>>,
  deleteTrash: (id: number) =>
    ipcRenderer.invoke('trash:delete', id) as Promise<Result<{ removed: boolean }>>,
  clearTrash: () => ipcRenderer.invoke('trash:clear') as Promise<Result<{ removed: number }>>,
  vacuumLibrary: () =>
    ipcRenderer.invoke('library:vacuum') as Promise<Result<{ before: number; after: number }>>,
  listCollections: () =>
    ipcRenderer.invoke('library:collections') as Promise<Result<LibraryCollection[]>>,
  createCollection: (name: string) =>
    ipcRenderer.invoke('library:collection-create', name) as Promise<
      Result<LibraryCollection>
    >,
  addToCollection: (videoId: number, name: string) =>
    ipcRenderer.invoke('library:collection-add', { videoId, name }) as Promise<
      Result<{ collections: string[] }>
    >,
  removeFromCollection: (videoId: number, name: string) =>
    ipcRenderer.invoke('library:collection-remove', { videoId, name }) as Promise<
      Result<{ collections: string[] }>
    >,
  renameCollection: (id: number, name: string) =>
    ipcRenderer.invoke('library:collection-rename', { id, name }) as Promise<
      Result<{ renamed: boolean }>
    >,
  deleteCollection: (id: number) =>
    ipcRenderer.invoke('library:collection-delete', id) as Promise<
      Result<{ removed: boolean }>
    >,
  getCollectionSummary: (collectionId: number) =>
    ipcRenderer.invoke('collection:summary', collectionId) as Promise<
      Result<CollectionSummary | null>
    >,
  getCollectionSummaryVersions: (collectionId: number) =>
    ipcRenderer.invoke('collection:summary-versions', collectionId) as Promise<
      Result<CollectionSummaryVersionMeta[]>
    >,
  getCollectionSummaryVersion: (id: number) =>
    ipcRenderer.invoke('collection:summary-version', id) as Promise<
      Result<CollectionSummaryVersion | null>
    >,
  restoreCollectionSummaryVersion: (id: number) =>
    ipcRenderer.invoke('collection:summary-restore', id) as Promise<
      Result<CollectionSummary>
    >,
  summarizeCollection: (collectionId: number) =>
    ipcRenderer.invoke('collection:summarize', collectionId) as Promise<
      Result<{ requestId: string }>
    >,
  onCollectionSummaryDone: (
    cb: (event: { collectionId: number; summary: CollectionSummary }) => void
  ) => on<{ collectionId: number; summary: CollectionSummary }>('collection:summary-done', cb),
  onCollectionSummaryError: (cb: (event: { collectionId: number; error: string }) => void) =>
    on<{ collectionId: number; error: string }>('collection:summary-error', cb),
  searchLibrary: (query: string) =>
    ipcRenderer.invoke('library:search', query) as Promise<Result<LibrarySearchResult>>,
  globalSearch: (query: string) =>
    ipcRenderer.invoke('search:global', query) as Promise<Result<GlobalSearchResult>>,
  onSearchRequest: (cb: () => void) => on<null>('app:search', () => cb()),
  onAskSelectionRequest: (cb: () => void) => on<null>('app:ask-selection', () => cb()),
  onSelectionAction: (cb: (payload: { action: string; text: string }) => void) =>
    on<{ action: string; text: string }>('app:selection-action', cb),
  onTabSearchRequest: (cb: () => void) => on<null>('app:tab-search', () => cb()),
  onBookmarkRequest: (cb: () => void) => on<null>('app:bookmark', () => cb()),
  onReaderRequest: (cb: () => void) => on<null>('app:reader', () => cb()),
  onTasksRequest: (cb: () => void) => on<null>('app:tasks', () => cb()),
  removeLibrary: (id: number) =>
    ipcRenderer.invoke('library:remove', id) as Promise<Result<{ removed: boolean }>>,
  savePageSummary: (payload: { title: string; url: string; content: string; model?: string }) =>
    ipcRenderer.invoke('library:save-page-summary', payload) as Promise<
      Result<{ videoId: number; created: boolean }>
    >,
  openLibrarySource: (id: number, startMs = 0) =>
    ipcRenderer.invoke('library:open-source', { id, startMs }) as Promise<Result<boolean>>,
  onLibraryChanged: (cb: () => void) => on<null>('library:changed', () => cb()),

  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<Result<SettingsSnapshot>>,
  getDiagnostics: () => ipcRenderer.invoke('diagnostics:get') as Promise<Result<DiagnosticsInfo>>,
  exportDiagnostics: () =>
    ipcRenderer.invoke('diagnostics:export') as Promise<
      Result<{ canceled: boolean; path?: string }>
    >,
  clearSitePermissions: () =>
    ipcRenderer.invoke('permissions:clear') as Promise<Result<{ removed: number }>>,
  listSitePermissions: () =>
    ipcRenderer.invoke('permissions:list') as Promise<
      Result<Array<{ origin: string; permission: string; decision: 'allow' | 'deny' }>>
    >,
  revokeSitePermission: (origin: string, permission: string) =>
    ipcRenderer.invoke('permissions:revoke', { origin, permission }) as Promise<
      Result<{ removed: boolean }>
    >,
  beginSidebarDrag: () =>
    ipcRenderer.invoke('browser:begin-drag') as Promise<Result<string | null>>,
  endSidebarDrag: () => ipcRenderer.invoke('browser:end-drag') as Promise<void>,
  setBrowserVisible: (visible: boolean) =>
    ipcRenderer.invoke('browser:set-visible', visible) as Promise<void>,
  setTabsLayout: (patch: { width?: number; collapsed?: boolean }) =>
    ipcRenderer.invoke('settings:tabs-layout', patch) as Promise<Result<SettingsSnapshot>>,
  setSidebarLayout: (patch: {
    width?: number;
    position?: 'left' | 'right';
    collapsed?: boolean;
  }) =>
    ipcRenderer.invoke('settings:sidebar-layout', patch) as Promise<Result<SettingsSnapshot>>,
  setSidebarWidth: (width: number) =>
    ipcRenderer.invoke('settings:sidebar-width', width) as Promise<Result<SettingsSnapshot>>,
  saveSettings: (next: AppSettings) =>
    ipcRenderer.invoke('settings:set', next) as Promise<Result<SettingsSnapshot>>,
  usageSummary: (days?: number) =>
    ipcRenderer.invoke('usage:summary', days) as Promise<Result<UsageSummary>>,
  usageEvents: (limit?: number) =>
    ipcRenderer.invoke('usage:events', limit) as Promise<Result<UsageEvent[]>>,
  clearUsage: () => ipcRenderer.invoke('usage:clear') as Promise<Result<{ removed: number }>>,
  exportUsage: () =>
    ipcRenderer.invoke('usage:export') as Promise<Result<{ canceled: boolean; path?: string }>>,
  ocrRecognize: (payload: { dataUrl?: string; path?: string; lang?: string }) =>
    ipcRenderer.invoke('ocr:recognize', payload) as Promise<
      Result<{ text: string; ms: number; engine?: 'system' | 'paddle' }>
    >,
  ocrStatus: () =>
    ipcRenderer.invoke('ocr:status') as Promise<Result<{ available: boolean }>>,
  kbStatus: () => ipcRenderer.invoke('kb:status') as Promise<Result<KbStatus>>,
  kbIndex: () => ipcRenderer.invoke('kb:index') as Promise<Result<KbStatus>>,
  kbDocuments: () => ipcRenderer.invoke('kb:documents') as Promise<Result<KbDocument[]>>,
  kbChunks: (videoId: number) =>
    ipcRenderer.invoke('kb:chunks', videoId) as Promise<Result<KbChunk[]>>,
  kbStatusSet: (videoId: number, status: KbLearningStatus) =>
    ipcRenderer.invoke('kb:status-set', { videoId, status }) as Promise<Result<KbLearningStatus>>,
  kbCollectionVideos: (collectionId: number) =>
    ipcRenderer.invoke('kb:collection-videos', collectionId) as Promise<Result<number[]>>,
  kbExport: (format: 'markdown' | 'json') =>
    ipcRenderer.invoke('kb:export', format) as Promise<Result<string | null>>,
  webMetrics: () =>
    ipcRenderer.invoke('web:metrics') as Promise<Result<WebSearchDiagnostics>>,
  webMetricsClear: () => ipcRenderer.invoke('web:metrics-clear') as Promise<Result<number>>,
  webCacheClear: () => ipcRenderer.invoke('web:cache-clear') as Promise<Result<number>>,
  kbHistory: (payload?: { videoId?: number; limit?: number }) =>
    ipcRenderer.invoke('kb:history', payload) as Promise<Result<KbQaEntry[]>>,
  kbCards: (payload?: { dueOnly?: boolean; videoId?: number; limit?: number }) =>
    ipcRenderer.invoke('kb:cards', payload) as Promise<Result<KbCard[]>>,
  kbCardAdd: (payload: { videoId?: number; front: string; back: string }) =>
    ipcRenderer.invoke('kb:card-add', payload) as Promise<Result<KbCard>>,
  kbCardReview: (id: number, grade: 'again' | 'hard' | 'good') =>
    ipcRenderer.invoke('kb:card-review', { id, grade }) as Promise<Result<KbCard>>,
  kbCardDelete: (id: number) =>
    ipcRenderer.invoke('kb:card-delete', id) as Promise<Result<boolean>>,
  kbSearch: (question: string, scope?: { videoId?: number; collectionId?: number }) =>
    ipcRenderer.invoke('kb:search', { question, ...scope }) as Promise<Result<KbHit[]>>,
  kbAsk: (question: string, scope?: { videoId?: number; collectionId?: number }) =>
    ipcRenderer.invoke('kb:ask', { question, ...scope }) as Promise<
      Result<{ text: string; hits: KbHit[] }>
    >,
  onKbProgress: (cb: (progress: KbProgress) => void) => on<KbProgress>('kb:progress', cb),
  pickConvertFiles: () =>
    ipcRenderer.invoke('convert:pick') as Promise<Result<string[]>>,
  runConvert: (paths: string[], target: string) =>
    ipcRenderer.invoke('convert:run', { paths, target }) as Promise<Result<{ requestId: string }>>,
  cancelConvert: (requestId: string) => {
    void ipcRenderer.invoke('convert:cancel', requestId);
  },
  revealConverted: (file: string) => {
    void ipcRenderer.invoke('convert:reveal', file);
  },
  onConvertProgress: (
    cb: (event: {
      requestId: string;
      file: string;
      index: number;
      total: number;
      percent: number;
      message: string;
    }) => void
  ) => on('convert:progress', cb),
  onConvertDone: (cb: (event: { requestId: string; files: ConvertTargetResult[] }) => void) =>
    on('convert:done', cb),
  onConvertError: (cb: (event: { requestId: string; error: string }) => void) =>
    on('convert:error', cb),
  ttsSpeak: (payload: { text: string; override?: TtsSettings }) =>
    ipcRenderer.invoke('tts:speak', payload) as Promise<
      Result<{ dataUrl: string; mime: string; engine: 'edge' | 'sapi' | 'openai'; ms: number }>
    >,
  ttsVoices: () =>
    ipcRenderer.invoke('tts:voices') as Promise<
      Result<{ edge: Array<{ id: string; label: string }>; sapi: string[] }>
    >,
  onDictationStart: (cb: () => void) => on<void>('dictation:start', cb),
  onDictationStop: (cb: () => void) => on<void>('dictation:stop', cb),
  dictationFinish: (payload: { text: string; error?: string }) =>
    ipcRenderer.send('dictation:finish', payload),
  finishWizard: () =>
    ipcRenderer.invoke('settings:wizard', true) as Promise<Result<SettingsSnapshot>>,
  setWizardVisible: (visible: boolean) =>
    ipcRenderer.invoke('settings:wizard', !visible) as Promise<Result<SettingsSnapshot>>,
  popupMenu: (items: unknown) => ipcRenderer.invoke('ui:popup-menu', items),
  requestClose: () => ipcRenderer.invoke('app:close-window') as Promise<void>,
  onCloseRequest: (cb: () => void) => on<void>('app:close-request', cb),
  onCloseCancel: (cb: () => void) => on<void>('app:close-cancel', cb),
  closeShown: () => ipcRenderer.send('app:close-shown'),
  closeDecision: (choice: 'tray' | 'quit' | 'cancel', remember: boolean) =>
    ipcRenderer.send('app:close-decision', { choice, remember }),
  startWeather: (city: string) => ipcRenderer.invoke('start:weather', city),
  startHotSearch: (force?: boolean) => ipcRenderer.invoke('start:hot', force === true),
  startBingWallpaper: () => ipcRenderer.invoke('start:bing-wallpaper'),
  testFetchPage: (payload: { url: string; platform?: SearchPlatform }) =>
    ipcRenderer.invoke('search:test-fetch', payload) as Promise<
      Result<{ url: string; title: string; chars: number; preview: string }>
    >,
  pickDownloadDir: () =>
    ipcRenderer.invoke('download:pick-dir') as Promise<Result<string | null>>,
  startProbeSite: (url: string) =>
    ipcRenderer.invoke('start:probe-site', url) as Promise<Result<SiteMeta>>,
  chooseSyncFolder: () => ipcRenderer.invoke('sync:choose'),
  syncStatus: (folder: string) => ipcRenderer.invoke('sync:status', folder),
  syncPush: (folder: string) => ipcRenderer.invoke('sync:push', folder),
  syncPull: (folder: string) => ipcRenderer.invoke('sync:pull', folder),
  exportSettings: () =>
    ipcRenderer.invoke('settings:export') as Promise<Result<{ canceled: boolean; path?: string }>>,
  importSettings: () =>
    ipcRenderer.invoke('settings:import') as Promise<
      Result<{ canceled: boolean; snapshot?: SettingsSnapshot }>
    >,
  onSettingsChanged: (cb: (snapshot: SettingsSnapshot) => void) =>
    on<SettingsSnapshot>('settings:changed', cb),
  onTrayAction: (cb: (action: string) => void) => on<string>('tray:action', cb),
  onRadialOpen: (cb: () => void) => on<unknown>('radial:open', () => cb()),
  onWebContextAction: (
    cb: (event: { action: string; text: string; url: string }) => void
  ) => on<{ action: string; text: string; url: string }>('web:context-action', cb),
  testSearch: (query: string, override?: unknown) =>
    ipcRenderer.invoke('search:test', query, override) as Promise<Result<WebReference[]>>,
  exportRuleGroup: (group: CorrectionRuleGroup) =>
    ipcRenderer.invoke('rules:export', group) as Promise<
      Result<{ canceled: boolean; path?: string }>
    >,
  importRuleGroups: () =>
    ipcRenderer.invoke('rules:import') as Promise<Result<CorrectionRuleGroup[]>>,
  previewCorrection: (text: string, settings?: AppSettings) =>
    ipcRenderer.invoke('correction:preview', text, settings) as Promise<Result<string>>,
  probePlatformModels: (kind: 'ai' | 'asr', platform: AiPlatform | AsrPlatform) =>
    ipcRenderer.invoke('platform:models', { kind, platform }) as Promise<
      Result<{ models: string[]; url: string }>
    >,
  testPlatform: (
    kind: 'ai' | 'asr' | 'search',
    platform: AiPlatform | AsrPlatform | SearchPlatform
  ) =>
    ipcRenderer.invoke('platform:test', { kind, platform }) as Promise<
      Result<{ ok: boolean; ms: number; sample: string }>
    >,
  openDataDir: () => ipcRenderer.invoke('settings:open-data') as Promise<void>,
  pickFile: (options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }) =>
    ipcRenderer.invoke('dialog:pick-file', options) as Promise<Result<string | null>>,
  openExternal: (url: string) => ipcRenderer.invoke('system:open-external', url) as Promise<void>,
  backupData: () =>
    ipcRenderer.invoke('data:backup') as Promise<
      Result<{ canceled: boolean; path?: string }>
    >,
  restoreData: () =>
    ipcRenderer.invoke('data:restore') as Promise<
      Result<{ canceled: boolean; restored?: boolean }>
    >,
  changeDataDir: () =>
    ipcRenderer.invoke('data:change-dir') as Promise<
      Result<{ canceled: boolean; target?: string; failed?: number }>
    >,
  getBridgeStatus: () =>
    ipcRenderer.invoke('bridge:status') as Promise<Result<BridgeStatus>>,
  installExtension: () =>
    ipcRenderer.invoke('bridge:install-extension') as Promise<
      Result<{ path: string; browser: string; opened: boolean }>
    >,
  writeClipboard: (text: string) =>
    ipcRenderer.invoke('clipboard:write', text) as Promise<void>,

  getUpdateStatus: () =>
    ipcRenderer.invoke('update:status') as Promise<Result<UpdateStatus>>,
  checkForUpdates: () =>
    ipcRenderer.invoke('update:check') as Promise<Result<UpdateStatus>>,
  downloadUpdate: () =>
    ipcRenderer.invoke('update:download') as Promise<Result<UpdateStatus>>,
  installUpdate: () => ipcRenderer.invoke('update:install') as Promise<void>,
  skipUpdate: (version: string) =>
    ipcRenderer.invoke('update:skip', version) as Promise<Result<UpdateStatus>>,
  openReleasesPage: () => ipcRenderer.invoke('update:open-releases') as Promise<void>,
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => on<UpdateStatus>('update:status', cb),

  summarize: (payload: SummarizeRequest) =>
    ipcRenderer.invoke('ai:summarize', payload) as Promise<Result<{ requestId: string }>>,
  cancelSummary: (requestId: string) =>
    ipcRenderer.invoke('ai:cancel', requestId) as Promise<void>,
  getSummary: (ref: SummaryRef) =>
    ipcRenderer.invoke('library:get-summary', ref) as Promise<Result<StoredSummary | null>>,
  getSummaryVersions: (videoId: number) =>
    ipcRenderer.invoke('library:summary-versions', videoId) as Promise<
      Result<SummaryVersionMeta[]>
    >,
  getSummaryVersion: (id: number) =>
    ipcRenderer.invoke('library:summary-version', id) as Promise<Result<SummaryVersion | null>>,
  restoreSummaryVersion: (id: number) =>
    ipcRenderer.invoke('library:restore-version', id) as Promise<Result<StoredSummary>>,
  onAiDelta: (cb: (event: AiDeltaEvent) => void) => on<AiDeltaEvent>('ai:delta', cb),
  onAiDone: (cb: (event: AiDoneEvent) => void) => on<AiDoneEvent>('ai:done', cb),
  onAiError: (cb: (event: AiErrorEvent) => void) => on<AiErrorEvent>('ai:error', cb),
  onAiStatus: (cb: (event: AiStatusEvent) => void) => on<AiStatusEvent>('ai:status', cb),
  onAiReasoning: (cb: (event: AiReasoningEvent) => void) =>
    on<AiReasoningEvent>('ai:reasoning', cb),

  chat: (payload: ChatRequest) =>
    ipcRenderer.invoke('chat:send', payload) as Promise<Result<{ requestId: string }>>,
  chatCompare: (payload: {
    info: PageInfo;
    lines: SubtitleLine[];
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    platformIds: string[];
    includePage?: boolean;
  }) =>
    ipcRenderer.invoke('chat:compare', payload) as Promise<Result<ChatCompareResult[]>>,
  cancelChat: (requestId: string) =>
    ipcRenderer.invoke('chat:cancel', requestId) as Promise<void>,
  onChatDelta: (cb: (event: ChatDeltaEvent) => void) => on<ChatDeltaEvent>('chat:delta', cb),
  onChatDone: (cb: (event: ChatDoneEvent) => void) => on<ChatDoneEvent>('chat:done', cb),
  onChatError: (cb: (event: ChatErrorEvent) => void) => on<ChatErrorEvent>('chat:error', cb),
  onChatStatus: (cb: (event: ChatStatusEvent) => void) => on<ChatStatusEvent>('chat:status', cb),
  onChatTool: (cb: (event: ChatToolEvent) => void) => on<ChatToolEvent>('chat:tool', cb),
  onChatApproval: (cb: (event: ChatApprovalEvent) => void) =>
    on<ChatApprovalEvent>('chat:approval', cb),
  chatApprove: (approvalId: string, allow: boolean) =>
    ipcRenderer.invoke('chat:approve', { approvalId, allow }) as Promise<Result<boolean>>,
  chatHistoryList: (limit?: number) =>
    ipcRenderer.invoke('chat:history-list', limit) as Promise<Result<ChatConversation[]>>,
  chatHistoryLatest: (videoKey: string) =>
    ipcRenderer.invoke('chat:history-latest', videoKey) as Promise<Result<ChatConversation | null>>,
  chatHistoryCreate: (input: {
    title?: string;
    videoKey?: string;
    videoTitle?: string;
    profileId?: string;
  }) => ipcRenderer.invoke('chat:history-create', input) as Promise<Result<ChatConversation>>,
  chatHistoryMessages: (id: number) =>
    ipcRenderer.invoke('chat:history-messages', id) as Promise<Result<StoredChatMessage[]>>,
  chatHistoryAppend: (
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
      tools?: ChatToolRecord[];
      attachments?: ChatAttachment[];
    }
  ) =>
    ipcRenderer.invoke('chat:history-append', { conversationId, message }) as Promise<
      Result<StoredChatMessage>
    >,
  chatHistoryRename: (id: number, title: string) =>
    ipcRenderer.invoke('chat:history-rename', { id, title }) as Promise<Result<boolean>>,
  chatHistoryProfile: (conversationId: number, profileId: string) =>
    ipcRenderer.invoke('chat:history-profile', { conversationId, profileId }) as Promise<
      Result<boolean>
    >,
  chatHistoryBranch: (conversationId: number, keep: number) =>
    ipcRenderer.invoke('chat:history-branch', { conversationId, keep }) as Promise<
      Result<ChatConversation | null>
    >,
  chatHistoryTruncate: (conversationId: number, keep: number) =>
    ipcRenderer.invoke('chat:history-truncate', { conversationId, keep }) as Promise<
      Result<boolean>
    >,
  chatHistoryDelete: (id: number) =>
    ipcRenderer.invoke('chat:history-delete', id) as Promise<Result<boolean>>,
  chatHistoryExport: (id: number) =>
    ipcRenderer.invoke('chat:history-export', id) as Promise<
      Result<{ canceled: boolean; path?: string }>
    >,

  transcribe: (requestId: string) =>
    ipcRenderer.invoke('asr:transcribe', { requestId }) as Promise<Result<{ requestId: string }>>,
  cancelTranscribe: (requestId: string) =>
    ipcRenderer.invoke('asr:cancel', requestId) as Promise<void>,
  onAsrProgress: (cb: (event: AsrProgressEvent) => void) => on<AsrProgressEvent>('asr:progress', cb),
  onAsrDone: (cb: (event: AsrDoneEvent) => void) => on<AsrDoneEvent>('asr:done', cb),
  onAsrError: (cb: (event: AsrErrorEvent) => void) => on<AsrErrorEvent>('asr:error', cb),
  localAsrStatus: () =>
    ipcRenderer.invoke('asr:local-status') as Promise<Result<AsrLocalStatus>>,
  downloadAsrModel: (id: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3-turbo') =>
    ipcRenderer.invoke('asr:download-model', id) as Promise<Result<{ path: string }>>,
  downloadAsrBinary: (variant: 'cpu' | 'vulkan' | 'cuda118' | 'cuda124' = 'cpu') =>
    ipcRenderer.invoke('asr:download-binary', variant) as Promise<Result<{ path: string }>>,
  detectGpu: () =>
    ipcRenderer.invoke('asr:gpu-info') as Promise<Result<{ names: string[] }>>,
  cancelAsrDownload: (key: string) => ipcRenderer.send('asr:cancel-download', key),
  deleteAsrModel: (id: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3-turbo') =>
    ipcRenderer.invoke('asr:delete-model', id) as Promise<
      Result<{ removed: boolean; status: AsrLocalStatus }>
    >,
  deleteAsrBinary: (variant: 'cpu' | 'vulkan' | 'cuda118' | 'cuda124') =>
    ipcRenderer.invoke('asr:delete-binary', variant) as Promise<
      Result<{ removed: boolean; status: AsrLocalStatus }>
    >,
  onAsrDownloadProgress: (cb: (event: AsrDownloadProgress) => void) =>
    on<AsrDownloadProgress>('asr:download-progress', cb),
  pickSubtitleFile: () =>
    ipcRenderer.invoke('subtitle:pick-file') as Promise<
      Result<{ name: string; text: string } | null>
    >,
  resegmentSubtitles: (payload: {
    requestId?: string;
    lines: SubtitleLine[];
    options: { maxChars: number; minDuration: number; useAi: boolean };
  }) =>
    ipcRenderer.invoke('subtitle:resegment', payload) as Promise<
      Result<{ lines: SubtitleLine[]; mode: string; note: string }>
    >,

  translate: (payload: TranslateRequest) =>
    ipcRenderer.invoke('translate:start', payload) as Promise<Result<{ requestId: string }>>,
  cancelTranslate: (requestId: string) =>
    ipcRenderer.invoke('translate:cancel', requestId) as Promise<void>,
  onTranslateProgress: (cb: (event: TranslateProgressEvent) => void) =>
    on<TranslateProgressEvent>('translate:progress', cb),
  onTranslateDone: (cb: (event: TranslateDoneEvent) => void) =>
    on<TranslateDoneEvent>('translate:done', cb),
  onTranslateError: (cb: (event: TranslateErrorEvent) => void) =>
    on<TranslateErrorEvent>('translate:error', cb),

  optimize: (payload: { requestId: string; lines: SubtitleLine[] }) =>
    ipcRenderer.invoke('optimize:start', payload) as Promise<Result<{ requestId: string }>>,
  cancelOptimize: (requestId: string) =>
    ipcRenderer.invoke('optimize:cancel', requestId) as Promise<void>,
  onOptimizeProgress: (cb: (event: OptimizeProgressEvent) => void) =>
    on<OptimizeProgressEvent>('optimize:progress', cb),
  onOptimizeDone: (cb: (event: OptimizeDoneEvent) => void) =>
    on<OptimizeDoneEvent>('optimize:done', cb),
  onOptimizeError: (cb: (event: OptimizeErrorEvent) => void) =>
    on<OptimizeErrorEvent>('optimize:error', cb),

  batchSummarize: (videoIds: number[], concurrency?: number) =>
    ipcRenderer.invoke('batch:summarize', { videoIds, concurrency }) as Promise<
      Result<{ requestId: string }>
    >,
  cancelBatch: (requestId: string) =>
    ipcRenderer.invoke('batch:cancel', requestId) as Promise<void>,
  pauseBatch: (requestId: string) =>
    ipcRenderer.invoke('batch:pause', requestId) as Promise<void>,
  resumeBatch: (requestId: string) =>
    ipcRenderer.invoke('batch:resume', requestId) as Promise<void>,
  removeBatchItem: (requestId: string, videoId: number) =>
    ipcRenderer.invoke('batch:remove', { requestId, videoId }) as Promise<void>,
  onBatchProgress: (cb: (event: BatchProgressEvent) => void) =>
    on<BatchProgressEvent>('batch:progress', cb),
  onBatchDone: (cb: (event: BatchDoneEvent) => void) => on<BatchDoneEvent>('batch:done', cb),
  onBatchError: (cb: (event: BatchErrorEvent) => void) => on<BatchErrorEvent>('batch:error', cb),

  batchUrls: (urls: string[], summarize: boolean) =>
    ipcRenderer.invoke('urlbatch:start', { urls, summarize }) as Promise<
      Result<{ requestId: string }>
    >,
  cancelUrlBatch: (requestId: string) =>
    ipcRenderer.invoke('urlbatch:cancel', requestId) as Promise<void>,
  onUrlBatchProgress: (cb: (event: UrlBatchProgressEvent) => void) =>
    on<UrlBatchProgressEvent>('urlbatch:progress', cb),
  onUrlBatchDone: (cb: (event: UrlBatchDoneEvent) => void) =>
    on<UrlBatchDoneEvent>('urlbatch:done', cb),
  onUrlBatchError: (cb: (event: UrlBatchErrorEvent) => void) =>
    on<UrlBatchErrorEvent>('urlbatch:error', cb),

  getHistory: () => ipcRenderer.invoke('history:list') as Promise<Result<LibraryHistoryItem[]>>,
  getTranscriptions: () =>
    ipcRenderer.invoke('history:transcriptions') as Promise<Result<LibraryTranscriptionItem[]>>,
  deleteHistory: (id: number) =>
    ipcRenderer.invoke('history:delete', id) as Promise<Result<{ removed: boolean }>>,
  clearHistory: () =>
    ipcRenderer.invoke('history:clear') as Promise<Result<{ removed: number }>>,
  listExports: () => ipcRenderer.invoke('exports:list') as Promise<Result<ExportRecord[]>>,
  clearExports: () =>
    ipcRenderer.invoke('exports:clear') as Promise<Result<{ removed: number }>>,
  deleteExport: (id: number) =>
    ipcRenderer.invoke('exports:delete', id) as Promise<Result<{ removed: boolean }>>,
  openExport: (filePath: string) =>
    ipcRenderer.invoke('exports:open', filePath) as Promise<Result<boolean>>,
  revealExport: (filePath: string) =>
    ipcRenderer.invoke('exports:reveal', filePath) as Promise<Result<boolean>>,

  listJobs: () => ipcRenderer.invoke('jobs:list') as Promise<Result<JobRecord[]>>,
  getJob: (id: string) => ipcRenderer.invoke('jobs:get', id) as Promise<Result<JobRecord | null>>,
  cancelJob: (id: string) => ipcRenderer.invoke('jobs:cancel', id) as Promise<void>,
  retryJob: (id: string) =>
    ipcRenderer.invoke('jobs:retry', id) as Promise<Result<{ requestId: string }>>,
  clearFinishedJobs: () =>
    ipcRenderer.invoke('jobs:clear-finished') as Promise<Result<{ removed: number }>>,
  onJobsChanged: (cb: (jobs: JobRecord[]) => void) => on<JobRecord[]>('jobs:changed', cb),

  checkQuality: (info: PageInfo, lines: SubtitleLine[]) =>
    ipcRenderer.invoke('quality:check', { info, lines }) as Promise<Result<QualityReport>>,
  generateChapters: (info: PageInfo, lines: SubtitleLine[]) =>
    ipcRenderer.invoke('chapters:generate', { info, lines }) as Promise<Result<Chapter[]>>,

  testMcp: (server: McpServer) =>
    ipcRenderer.invoke('mcp:test', server) as Promise<Result<McpTool[]>>,
  callMcp: (server: McpServer, name: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke('mcp:call', { server, name, args }) as Promise<Result<string>>,
  mcpResources: (server: McpServer) =>
    ipcRenderer.invoke('mcp:resources', server) as Promise<Result<McpResource[]>>,
  mcpReadResource: (server: McpServer, uri: string) =>
    ipcRenderer.invoke('mcp:read-resource', { server, uri }) as Promise<Result<string>>,
  mcpPrompts: (server: McpServer) =>
    ipcRenderer.invoke('mcp:prompts', server) as Promise<Result<McpPrompt[]>>,
  mcpAllTools: () =>
    ipcRenderer.invoke('mcp:all-tools') as Promise<Result<McpToolOption[]>>,
  mcpPrompt: (server: McpServer, name: string, args: Record<string, string>) =>
    ipcRenderer.invoke('mcp:prompt', { server, name, args }) as Promise<Result<string>>,
  importSkill: () =>
    ipcRenderer.invoke('skills:import') as Promise<Result<SkillItem | null>>,
  importSkillUrl: (url: string) =>
    ipcRenderer.invoke('skills:import-url', url) as Promise<Result<SkillItem>>,
  importSkillFolder: () =>
    ipcRenderer.invoke('skills:import-folder') as Promise<Result<SkillItem[]>>,

  exportBatch: (payload: { ids: number[]; kind: 'subtitles' | 'summary' }) =>
    ipcRenderer.invoke('export:batch', payload) as Promise<
      Result<{ canceled: true } | { dir: string; exported: number; skipped: string[] }>
    >,
  exportVideo: (payload: ExportPayload) =>
    ipcRenderer.invoke('export:save', payload) as Promise<
      Result<{ path: string } | { canceled: true }>
    >,
  synthesizeVideo: (payload: SynthesizeRequest) =>
    ipcRenderer.invoke('video:synthesize', payload) as Promise<
      Result<{ requestId: string; path: string } | { canceled: true }>
    >,
  cancelSynthesize: (requestId: string) => ipcRenderer.send('video:synthesize-cancel', requestId),
  batchSynthesize: (payload: {
    ids: number[];
    mode?: 'hard' | 'soft';
    style?: SynthesizeRequest['style'];
  }) =>
    ipcRenderer.invoke('video:batch-synthesize', payload) as Promise<
      Result<{ requestId: string; dir: string; total: number } | { canceled: true }>
    >,
  probeOnlineVideo: (url: string) =>
    ipcRenderer.invoke('video:download-probe', { url }) as Promise<Result<DownloadProbeResult>>,
  downloadOnlineVideo: (
    payload: string | { url: string; options?: OnlineDownloadOptions; title?: string }
  ) =>
    ipcRenderer.invoke('video:download', payload) as Promise<Result<{ requestId: string }>>,
  cancelOnlineDownload: (requestId: string) =>
    ipcRenderer.send('video:download-cancel', requestId),
  onDownloadProgress: (cb: (event: DownloadProgressEvent) => void) =>
    on<DownloadProgressEvent>('download:progress', cb),
  onDownloadDone: (cb: (event: { requestId: string; path: string }) => void) =>
    on<{ requestId: string; path: string }>('download:done', cb),
  onDownloadError: (cb: (event: { requestId: string; error: string }) => void) =>
    on<{ requestId: string; error: string }>('download:error', cb),
  listTtsVoices: () =>
    ipcRenderer.invoke('video:tts-voices') as Promise<Result<{ voices: string[] }>>,
  dubVideo: (payload: {
    videoPath: string;
    title: string;
    lines: SubtitleLine[];
    voice?: string;
    mode: 'audio' | 'video';
  }) =>
    ipcRenderer.invoke('video:dub', payload) as Promise<
      Result<{ requestId: string; path: string } | { canceled: true }>
    >,
  cancelDub: (requestId: string) => ipcRenderer.send('video:dub-cancel', requestId),
  onDubDone: (cb: (event: { requestId: string; path: string }) => void) =>
    on<{ requestId: string; path: string }>('dub:done', cb),
  onDubError: (cb: (event: { requestId: string; error: string }) => void) =>
    on<{ requestId: string; error: string }>('dub:error', cb),
  pickLocalMedia: () =>
    ipcRenderer.invoke('video:pick-local') as Promise<
      Result<{ path: string; name: string; duration: number } | { canceled: true }>
    >,
  transcribeLocalVideo: (path: string, language?: string) =>
    ipcRenderer.invoke('video:transcribe-local', { path, language }) as Promise<
      Result<{ requestId: string }>
    >,
  cancelLocalTranscribe: (requestId: string) =>
    ipcRenderer.send('video:transcribe-cancel', requestId),
  onLocalTransProgress: (
    cb: (event: { requestId: string; percent: number; message: string }) => void
  ) => on<{ requestId: string; percent: number; message: string }>('localtrans:progress', cb),
  onLocalTransDone: (
    cb: (event: {
      requestId: string;
      lines: SubtitleLine[];
      name: string;
      duration: number;
      path: string;
    }) => void
  ) =>
    on<{
      requestId: string;
      lines: SubtitleLine[];
      name: string;
      duration: number;
      path: string;
    }>('localtrans:done', cb),
  onLocalTransError: (cb: (event: { requestId: string; error: string }) => void) =>
    on<{ requestId: string; error: string }>('localtrans:error', cb),
  saveLocalTranscript: (payload: {
    path: string;
    name: string;
    duration: number;
    lines: SubtitleLine[];
  }) =>
    ipcRenderer.invoke('video:save-local', payload) as Promise<Result<{ videoId: number }>>,
  onSynthesizeProgress: (cb: (event: SynthesizeProgressEvent) => void) =>
    on<SynthesizeProgressEvent>('synthesize:progress', cb),
  onSynthesizeDone: (cb: (event: SynthesizeDoneEvent) => void) =>
    on<SynthesizeDoneEvent>('synthesize:done', cb),
  onSynthesizeError: (cb: (event: { requestId: string; error: string }) => void) =>
    on<{ requestId: string; error: string }>('synthesize:error', cb),
  saveTextFile: (payload: SaveTextPayload) =>
    ipcRenderer.invoke('file:save-text', payload) as Promise<Result<SaveTextResult>>
};

contextBridge.exposeInMainWorld('bsub', api);
