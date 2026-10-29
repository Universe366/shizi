// 共享设置映射：桌面端与插件端字段一一对应。
// 只处理两端都有意义的字段；插件面板/桌面浏览器等专属配置不参与。

const TEMPLATE_TO_DESKTOP = {
  plain: 'plain',
  timed: 'timestamped',
  timestamped: 'timestamped',
  study: 'notes',
  notes: 'notes',
  meeting: 'meeting'
};

const TEMPLATE_FROM_DESKTOP = {
  plain: 'plain',
  timestamped: 'timed',
  notes: 'study',
  meeting: 'meeting'
};

function strip(platform, includeSecrets) {
  const next = { ...platform, hasKey: Boolean(platform && platform.apiKey) };
  if (!includeSecrets) next.apiKey = '';
  return next;
}

export function exportSharedSettings(settings, includeSecrets = false) {
  const s = settings || {};
  return {
    version: 1,
    ai: {
      activeId: s.ai?.activeId || '',
      temperature: s.ai?.temperature ?? 0.3,
      maxTokens: s.ai?.maxTokens ?? 8192,
      platforms: (s.ai?.platforms || []).map((platform) => strip(platform, includeSecrets))
    },
    search: {
      activeId: s.search?.activeId || '',
      maxResults: s.search?.maxResults ?? 6,
      keylessFallback: s.search?.keylessFallback !== false,
      autoSearchOnChat: s.search?.autoSearchOnChat === true,
      alwaysSearchOnChat: s.search?.alwaysSearchOnChat === true,
      fetchPageContent: s.search?.fetchPageContent !== false,
      timeRange: s.search?.timeRange || '',
      cacheMinutes: s.search?.cacheMinutes ?? 5,
      platforms: (s.search?.platforms || []).map((platform) => strip(platform, includeSecrets))
    },
    asr: {
      activeId: s.asr?.activeId || '',
      language: s.asr?.language || 'auto',
      concurrency: s.asr?.concurrency ?? 4,
      timeoutSeconds: s.asr?.timeoutSeconds ?? 180,
      platforms: (s.asr?.platforms || []).map((platform) => strip(platform, includeSecrets))
    },
    prompt: {
      activeId: s.prompt?.activeId || 'default',
      summaryFormatRules: s.prompt?.summaryFormatRules || '',
      templates: (s.prompt?.templates || []).map((template) => ({
        id: template.id,
        name: template.name,
        text: template.text
      }))
    },
    glossary: (s.optimize?.glossary || []).map((item) => ({
      from: String(item.term || ''),
      to: String(item.term || ''),
      note: String(item.note || '')
    })),
    export: {
      format: s.exportCfg?.format || 'srt',
      template: TEMPLATE_TO_DESKTOP[s.exportCfg?.template] || 'timestamped',
      includeTimestamps: s.exportCfg?.includeTimestamps !== false,
      filenamePattern: s.exportCfg?.filenamePattern || '{title}',
      assFontSize: s.exportCfg?.assFontSize ?? 42,
      estimateTimestamps: s.exportCfg?.estimateTimestamps !== false
    }
  };
}

function mergePlatforms(current, incoming) {
  const next = (current || []).map((item) => ({ ...item }));
  for (const row of incoming || []) {
    const id = String(row.id || '').trim();
    if (!id) continue;
    const index = next.findIndex((item) => item.id === id);
    if (index < 0) {
      next.push({ ...row, apiKey: String(row.apiKey || '') });
      continue;
    }
    const merged = { ...next[index], ...row };
    if (!row.apiKey && next[index].apiKey) merged.apiKey = next[index].apiKey;
    next[index] = merged;
  }
  return next;
}

export function importSharedSettings(settings, payload) {
  const s = settings || {};
  const next = {
    ...s,
    ai: { ...(s.ai || {}) },
    search: { ...(s.search || {}) },
    asr: { ...(s.asr || {}) },
    prompt: { ...(s.prompt || {}) },
    optimize: { ...(s.optimize || {}) },
    exportCfg: { ...(s.exportCfg || {}) }
  };
  if (!payload || payload.version !== 1) throw new Error('不支持的共享设置版本');

  if (Array.isArray(payload.ai?.platforms) && payload.ai.platforms.length) {
    next.ai.platforms = mergePlatforms(next.ai.platforms, payload.ai.platforms);
    if (next.ai.platforms.some((item) => item.id === payload.ai.activeId)) {
      next.ai.activeId = payload.ai.activeId;
    }
  }
  if (Number.isFinite(payload.ai?.temperature)) next.ai.temperature = payload.ai.temperature;
  if (Number.isFinite(payload.ai?.maxTokens)) next.ai.maxTokens = payload.ai.maxTokens;

  if (Array.isArray(payload.search?.platforms) && payload.search.platforms.length) {
    next.search.platforms = mergePlatforms(next.search.platforms, payload.search.platforms);
    if (next.search.platforms.some((item) => item.id === payload.search.activeId)) {
      next.search.activeId = payload.search.activeId;
    }
  }
  next.search.maxResults = Number(payload.search?.maxResults) || next.search.maxResults || 6;
  next.search.keylessFallback = payload.search?.keylessFallback !== false;
  next.search.autoSearchOnChat = payload.search?.autoSearchOnChat === true;
  next.search.alwaysSearchOnChat = payload.search?.alwaysSearchOnChat === true;
  next.search.fetchPageContent = payload.search?.fetchPageContent !== false;
  next.search.timeRange = String(payload.search?.timeRange || '');
  next.search.cacheMinutes = Number(payload.search?.cacheMinutes) || 0;

  if (Array.isArray(payload.asr?.platforms) && payload.asr.platforms.length) {
    next.asr.platforms = mergePlatforms(next.asr.platforms, payload.asr.platforms);
    if (next.asr.platforms.some((item) => item.id === payload.asr.activeId)) {
      next.asr.activeId = payload.asr.activeId;
    }
  }
  if (payload.asr?.language) next.asr.language = String(payload.asr.language);
  if (Number.isFinite(payload.asr?.concurrency)) next.asr.concurrency = payload.asr.concurrency;
  if (Number.isFinite(payload.asr?.timeoutSeconds)) next.asr.timeoutSeconds = payload.asr.timeoutSeconds;

  if (Array.isArray(payload.prompt?.templates) && payload.prompt.templates.length) {
    next.prompt.templates = payload.prompt.templates
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
    next.prompt.summaryFormatRules = payload.prompt.summaryFormatRules;
  }

  if (Array.isArray(payload.glossary)) {
    next.optimize.glossary = payload.glossary
      .map((item) => {
        const from = String(item.from || '').trim();
        if (!from) return null;
        const to = String(item.to || '').trim();
        const note = String(item.note || '').trim();
        return {
          term: from,
          note: to && to !== from ? `${to}${note ? ` ${note}` : ''}` : note
        };
      })
      .filter(Boolean);
  }

  if (payload.export) {
    const format = String(payload.export.format || 'srt');
    if (['srt', 'vtt', 'ass', 'txt', 'md', 'json'].includes(format)) {
      next.exportCfg.format = format;
    }
    next.exportCfg.template = TEMPLATE_FROM_DESKTOP[String(payload.export.template || '')] || 'timed';
    next.exportCfg.includeTimestamps = payload.export.includeTimestamps !== false;
    next.exportCfg.filenamePattern = String(payload.export.filenamePattern || '{title}');
    next.exportCfg.assFontSize = Math.min(96, Math.max(12, Number(payload.export.assFontSize) || 42));
    next.exportCfg.estimateTimestamps = payload.export.estimateTimestamps !== false;
  }
  return next;
}
