import type { PageInfo, SubtitleLine } from '../shared/types';
import { chat } from './chat';
import { summarizeChat } from './summaryChat';
import { localAsrReadiness } from './asr';
import { synthesizeSpeech } from './tts';
import { buildExport } from './exporters';
import { translateLines } from './translate';
import { optimizeLines } from './optimize';
import type { ExportFormat, ExportPayload, ExportTemplate } from '../shared/types';
import { loadSettings, platformForTask } from './settings';
import { normalizeLines, normalizeVideo } from './bridgeProtocol';

/**
 * 插件 → 桌面能力调用（/v1/rpc）。
 *
 * 只暴露白名单方法；返回统一用事件流，方便插件边收边渲染：
 *   { type: 'delta', text }
 *   { type: 'reasoning', text }
 *   { type: 'status', text }
 *   { type: 'tool', event }
 *   { type: 'done', text, model, references?, usage? }
 *   { type: 'error', error }
 */

export type RpcEmit = (event: Record<string, unknown>) => void;

export interface RpcOptions {
  /** 危险 MCP 工具执行前询问插件；不传则一律拒绝。 */
  onApproval?: (request: { name: string; detail: string }) => Promise<boolean>;
}

const LOCAL_BASE = /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)([:/]|$)/i;

function isLocalBase(baseUrl: string): boolean {
  return LOCAL_BASE.test(String(baseUrl || '').trim());
}

function fallbackInfo(params: Record<string, unknown>): PageInfo {
  return {
    ok: true,
    kind: 'page',
    bvid: null,
    aid: null,
    cid: null,
    epId: null,
    seasonId: null,
    page: 1,
    partTitle: '',
    parts: [],
    title: String(params.title || ''),
    owner: '',
    desc: '',
    duration: 0,
    url: String(params.url || ''),
    signature: ''
  };
}

function infoFrom(params: Record<string, unknown>): PageInfo {
  const video = params.video;
  if (video && typeof video === 'object') {
    return normalizeVideo(video as Record<string, unknown>);
  }
  return fallbackInfo(params);
}

function linesFrom(params: Record<string, unknown>): SubtitleLine[] {
  return normalizeLines(params.lines);
}

/** 给插件看的脱敏 AI 状态：只告诉「能不能用 / 哪些平台」，不返回 Key。 */
export function publicAiSettings(): Record<string, unknown> {
  const settings = loadSettings();
  const platform = platformForTask('chat', settings);
  const hasKey = Boolean(platform && (platform.apiKey || isLocalBase(platform.baseUrl)));
  const ready = Boolean(platform && platform.model && hasKey);
  const reason = !platform
    ? '桌面端没有可用的 AI 平台'
    : !platform.model
      ? '桌面端 AI 平台没有选择模型'
      : !hasKey
        ? '桌面端 AI 平台缺少 API Key'
        : '';
  return {
    ready,
    reason,
    asr: localAsrReadiness(settings),
    platform: platform
      ? {
          id: platform.id,
          name: platform.name,
          model: platform.model,
          local: isLocalBase(platform.baseUrl)
        }
      : null,
    platforms: settings.ai.platforms
      .filter((item) => item.enabled !== false)
      .map((item) => ({ id: item.id, name: item.name, model: item.model }))
  };
}

function sanitizeMessages(raw: unknown): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const row = item as Record<string, unknown>;
      const role = row && row.role === 'assistant' ? 'assistant' : 'user';
      const content = typeof row?.content === 'string' ? row.content : '';
      return { role, content } as const;
    })
    .filter((message) => message.content.trim().length > 0)
    .slice(-40);
}

export async function runRpc(
  method: string,
  params: Record<string, unknown>,
  signal: AbortSignal,
  emit: RpcEmit,
  options: RpcOptions = {}
): Promise<void> {
  if (method === 'ping') {
    emit({ type: 'done', text: '', data: { pong: true } });
    return;
  }
  if (method === 'settings.read') {
    emit({ type: 'done', text: '', data: { ai: publicAiSettings() } });
    return;
  }

  if (method === 'optimize.lines') {
    const lines = linesFrom(params);
    if (!lines.length) throw new Error('没有可优化的字幕');
    const suggestions = await optimizeLines(lines, () => {}, signal);
    emit({ type: 'done', text: '', data: { suggestions } });
    return;
  }

  if (method === 'translate.lines') {
    const lines = linesFrom(params);
    const target = String(params.target || '').trim();
    if (!lines.length) throw new Error('没有可翻译的字幕');
    if (!target) throw new Error('缺少目标语言');
    const result = await translateLines(lines, target, () => {}, signal);
    emit({
      type: 'done',
      text: '',
      data: { lines: result.lines, language: result.language }
    });
    return;
  }

  if (method === 'export.build') {
    const info = infoFrom(params);
    const lines = linesFrom(params);
    if (!lines.length) throw new Error('没有字幕可导出');
    const format = String(params.format || 'srt') as ExportFormat;
    if (!['md', 'srt', 'vtt', 'ass', 'txt', 'json'].includes(format)) {
      throw new Error(`不支持的导出格式：${format}`);
    }
    const template = String(params.template || 'timestamped') as ExportTemplate;
    const rawTrack = params.track && typeof params.track === 'object'
      ? (params.track as Record<string, unknown>)
      : null;
    const track = rawTrack
      ? {
          lan: String(rawTrack.lan || ''),
          lanDoc: String(rawTrack.lanDoc || ''),
          url: String(rawTrack.url || ''),
          isAi: Boolean(rawTrack.isAi),
          aiStatus: null,
          source: String(rawTrack.source || '')
        }
      : null;
    const translated = Array.isArray(params.translatedLines)
      ? normalizeLines(params.translatedLines)
      : undefined;
    const payload: ExportPayload = {
      format,
      info,
      track,
      lines,
      summary: String(params.summary || ''),
      includeTimestamps: params.includeTimestamps !== false,
      filenamePattern: String(params.filenamePattern || '{title}'),
      translatedLines: translated,
      translationLanguage: params.translationLanguage
        ? String(params.translationLanguage)
        : undefined,
      template,
      assFontSize: Number(params.assFontSize) || 28,
      estimateTimestamps: params.estimateTimestamps !== false
    };
    const built = buildExport(payload);
    emit({ type: 'done', text: '', data: built });
    return;
  }

  if (method === 'tts.speak') {
    const text = String(params.text || '').slice(0, 5000);
    if (!text.trim()) throw new Error('没有可朗读的文字');
    const result = await synthesizeSpeech(text, loadSettings());
    emit({ type: 'done', text: '', data: result });
    return;
  }

  if (method === 'ai.summarize') {
    const info = infoFrom(params);
    const lines = linesFrom(params);
    if (!lines.length) throw new Error('没有字幕，无法生成总结');
    const result = await summarizeChat({
      info,
      lines,
      web: params.web !== false,
      signal,
      onDelta: (text) => emit({ type: 'delta', text }),
      onReasoning: (text) => emit({ type: 'reasoning', text }),
      onStatus: (text) => emit({ type: 'status', text }),
      onTool: (event) => emit({ type: 'tool', event })
    });
    emit({
      type: 'done',
      text: result.text,
      model: result.model,
      references: result.verification?.sources || []
    });
    return;
  }

  if (method === 'ai.chat') {
    const info = infoFrom(params);
    const lines = linesFrom(params);
    const messages = sanitizeMessages(params.messages);
    if (!messages.length) throw new Error('messages 为空');
    const result = await chat({
      info,
      lines,
      messages,
      page: null,
      includeTranscript: params.includeTranscript !== false && lines.length > 0,
      web: params.web === true,
      surface: 'main',
      // 需要审批的危险工具走 onApproval；没有回调时拒绝，避免远端静默执行。
      mcpToolIds: params.useMcp === false ? [] : undefined,
      onApproval: options.onApproval || (async () => false),
      signal,
      onDelta: (text) => emit({ type: 'delta', text }),
      onReasoning: (text) => emit({ type: 'reasoning', text }),
      onStatus: (text) => emit({ type: 'status', text }),
      onTool: (event) => emit({ type: 'tool', event })
    });
    emit({
      type: 'done',
      text: result.text,
      model: result.model,
      references: result.references || [],
      webEngine: result.webEngine || '',
      webError: result.webError || '',
      usage: result.usage || null
    });
    return;
  }

  throw new Error(`不支持的 RPC 方法：${method}`);
}
