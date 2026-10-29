import type { AiPlatform, AsrPlatform, ExportFormat, ExportTemplate } from '../shared/types';
import { loadSettings, saveSettings } from './settings';

/**
 * 共享设置快照：只包含两端都有意义的字段。
 * 不包含浏览器/起始页/桌宠/数据目录等桌面专属，也不包含插件面板布局。
 */
export interface SharedSettingsPayload {
  version: 1;
  ai: {
    activeId: string;
    temperature: number;
    maxTokens: number;
    platforms: Array<Partial<AiPlatform> & { hasKey?: boolean }>;
  };
  search: {
    activeId: string;
    maxResults: number;
    keylessFallback: boolean;
    autoSearchOnChat: boolean;
    alwaysSearchOnChat: boolean;
    fetchPageContent: boolean;
    timeRange: string;
    cacheMinutes: number;
    platforms: Array<Record<string, unknown> & { hasKey?: boolean }>;
  };
  asr: {
    activeId: string;
    language: string;
    concurrency: number;
    timeoutSeconds: number;
    platforms: Array<Partial<AsrPlatform> & { hasKey?: boolean }>;
  };
  prompt: {
    activeId: string;
    summaryFormatRules: string;
    templates: Array<{ id: string; name: string; text: string }>;
  };
  glossary: Array<{ from: string; to: string; note: string }>;
  export: {
    format: ExportFormat;
    template: ExportTemplate;
    includeTimestamps: boolean;
    filenamePattern: string;
    assFontSize: number;
    estimateTimestamps: boolean;
  };
}

function stripPlatform<T extends Record<string, unknown>>(
  platform: T,
  includeSecrets: boolean
): T & { hasKey: boolean } {
  const next = { ...platform, hasKey: Boolean(platform.apiKey) } as T & {
    hasKey: boolean;
    apiKey?: string;
    extraKeys?: string[];
  };
  if (!includeSecrets) next.apiKey = '';
  if (Array.isArray(next.extraKeys)) next.extraKeys = includeSecrets ? next.extraKeys : [];
  return next;
}

export function exportSharedSettings(includeSecrets: boolean): SharedSettingsPayload {
  const settings = loadSettings();
  return {
    version: 1,
    ai: {
      activeId: settings.ai.activeId,
      temperature: settings.ai.temperature,
      maxTokens: settings.ai.maxTokens,
      platforms: settings.ai.platforms.map((platform) =>
        stripPlatform(platform as unknown as Record<string, unknown>, includeSecrets)
      ) as SharedSettingsPayload['ai']['platforms']
    },
    search: {
      activeId: settings.search.activeId,
      maxResults: settings.search.maxResults,
      keylessFallback: settings.search.keylessFallback,
      autoSearchOnChat: settings.search.autoSearchOnChat,
      alwaysSearchOnChat: settings.search.alwaysSearchOnChat,
      fetchPageContent: settings.search.includeContent,
      timeRange: settings.search.timeRange,
      cacheMinutes: settings.search.cacheMinutes,
      platforms: settings.search.platforms.map((platform) =>
        stripPlatform(platform as unknown as Record<string, unknown>, includeSecrets)
      )
    },
    asr: {
      activeId: settings.asr.activeId,
      language: settings.asr.language,
      concurrency: settings.asr.concurrency,
      timeoutSeconds: settings.asr.timeoutSeconds,
      platforms: settings.asr.platforms.map((platform) =>
        stripPlatform(platform as unknown as Record<string, unknown>, includeSecrets)
      ) as SharedSettingsPayload['asr']['platforms']
    },
    prompt: {
      activeId: settings.prompt.activeId,
      summaryFormatRules: settings.prompt.summaryFormatRules || '',
      templates: settings.prompt.templates.map((template) => ({
        id: template.id,
        name: template.name,
        text: template.text
      }))
    },
    glossary: settings.correction.glossary.terms.map((term) => ({
      from: term.from,
      to: term.to,
      note: term.note
    })),
    export: {
      format: settings.export.format,
      template: settings.export.template,
      includeTimestamps: settings.export.includeTimestamps,
      filenamePattern: settings.export.filenamePattern,
      assFontSize: settings.export.assFontSize,
      estimateTimestamps: settings.export.estimateTimestamps
    }
  };
}

function mergePlatformList<T extends { id: string }>(
  current: T[],
  incoming: Array<Partial<T> & { apiKey?: string }>
): T[] {
  const next = current.map((item) => ({ ...item }));
  for (const row of incoming) {
    const id = String(row.id || '').trim();
    if (!id) continue;
    const index = next.findIndex((item) => item.id === id);
    if (index < 0) {
      next.push({ ...(row as T), apiKey: String(row.apiKey || '') });
      continue;
    }
    const merged = { ...next[index], ...row } as T & { apiKey?: string };
    // 导出时若要求不含 Key，空 Key 不能把已有 Key 擦掉。
    if (!row.apiKey && (next[index] as { apiKey?: string }).apiKey) {
      merged.apiKey = (next[index] as { apiKey?: string }).apiKey;
    }
    next[index] = merged;
  }
  return next;
}

const TEMPLATE_IN: Record<string, ExportTemplate> = {
  plain: 'plain',
  timed: 'timestamped',
  timestamped: 'timestamped',
  study: 'notes',
  notes: 'notes',
  meeting: 'meeting'
};

export function importSharedSettings(payload: SharedSettingsPayload): { ok: true } {
  if (!payload || payload.version !== 1) throw new Error('不支持的共享设置版本');
  const next = loadSettings();
  const aiPlatforms = Array.isArray(payload.ai?.platforms) ? payload.ai.platforms : [];
  if (aiPlatforms.length) {
    next.ai.platforms = mergePlatformList(next.ai.platforms, aiPlatforms);
    if (next.ai.platforms.some((item) => item.id === payload.ai.activeId)) {
      next.ai.activeId = payload.ai.activeId;
    }
  }
  if (Number.isFinite(payload.ai?.temperature)) {
    next.ai.temperature = Math.min(2, Math.max(0, Number(payload.ai.temperature)));
  }
  if (Number.isFinite(payload.ai?.maxTokens)) {
    next.ai.maxTokens = Math.min(128000, Math.max(256, Math.round(Number(payload.ai.maxTokens))));
  }

  const searchPlatforms = Array.isArray(payload.search?.platforms) ? payload.search.platforms : [];
  if (searchPlatforms.length) {
    next.search.platforms = mergePlatformList(
      next.search.platforms as unknown as Array<{ id: string }>,
      searchPlatforms as Array<{ id: string; apiKey?: string }>
    ) as unknown as typeof next.search.platforms;
    if (next.search.platforms.some((item) => item.id === payload.search.activeId)) {
      next.search.activeId = payload.search.activeId;
    }
  }
  if (Number.isFinite(payload.search?.maxResults)) {
    next.search.maxResults = Math.min(20, Math.max(1, Math.round(Number(payload.search.maxResults))));
  }
  next.search.keylessFallback = payload.search?.keylessFallback !== false;
  next.search.autoSearchOnChat = payload.search?.autoSearchOnChat === true;
  next.search.alwaysSearchOnChat = payload.search?.alwaysSearchOnChat === true;
  next.search.includeContent = payload.search?.fetchPageContent !== false;
  next.search.timeRange = String(payload.search?.timeRange || '') as typeof next.search.timeRange;
  if (Number.isFinite(payload.search?.cacheMinutes)) {
    next.search.cacheMinutes = Math.max(0, Math.round(Number(payload.search.cacheMinutes)));
  }

  const asrPlatforms = Array.isArray(payload.asr?.platforms) ? payload.asr.platforms : [];
  if (asrPlatforms.length) {
    next.asr.platforms = mergePlatformList(next.asr.platforms, asrPlatforms);
    if (next.asr.platforms.some((item) => item.id === payload.asr.activeId)) {
      next.asr.activeId = payload.asr.activeId;
    }
  }
  if (payload.asr?.language) next.asr.language = String(payload.asr.language);
  if (Number.isFinite(payload.asr?.concurrency)) {
    next.asr.concurrency = Math.min(8, Math.max(1, Math.round(Number(payload.asr.concurrency))));
  }
  if (Number.isFinite(payload.asr?.timeoutSeconds)) {
    next.asr.timeoutSeconds = Math.min(1800, Math.max(30, Math.round(Number(payload.asr.timeoutSeconds))));
  }

  const templates = Array.isArray(payload.prompt?.templates) ? payload.prompt.templates : [];
  if (templates.length) {
    next.prompt.templates = templates
      .filter((item) => item && String(item.text || '').trim())
      .map((item, index) => ({
        id: String(item.id || `shared_${index}`),
        name: String(item.name || '导入模板').slice(0, 40),
        text: String(item.text).slice(0, 20000)
      }));
    if (next.prompt.templates.some((item) => item.id === payload.prompt.activeId)) {
      next.prompt.activeId = payload.prompt.activeId;
    }
  }
  if (typeof payload.prompt?.summaryFormatRules === 'string') {
    next.prompt.summaryFormatRules = payload.prompt.summaryFormatRules.slice(0, 20000);
  }

  if (Array.isArray(payload.glossary)) {
    next.correction.glossary.terms = payload.glossary
      .map((term, index) => ({
        id: `shared_glossary_${index}`,
        from: String(term.from || '').slice(0, 80),
        to: String(term.to || '').slice(0, 80),
        note: String(term.note || '').slice(0, 120)
      }))
      .filter((term) => term.from);
  }

  if (payload.export) {
    const format = String(payload.export.format || 'md') as ExportFormat;
    if (['md', 'srt', 'vtt', 'ass', 'txt', 'json'].includes(format)) {
      next.export.format = format;
    }
    next.export.template = TEMPLATE_IN[String(payload.export.template || '')] || 'timestamped';
    next.export.includeTimestamps = payload.export.includeTimestamps !== false;
    next.export.filenamePattern = String(payload.export.filenamePattern || '{title}').slice(0, 120);
    next.export.assFontSize = Math.min(96, Math.max(12, Math.round(Number(payload.export.assFontSize) || 28)));
    next.export.estimateTimestamps = payload.export.estimateTimestamps !== false;
  }

  saveSettings(next);
  return { ok: true };
}
