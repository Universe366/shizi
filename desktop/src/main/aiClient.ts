import { session } from 'electron';
import type { AiPlatform, AiTask, AiUsage } from '../shared/types';
import { needsApiKey } from './platformKey';
import { recordUsage } from './usage';

// ---------------------------------------------------------------------------
// AI 请求的公共层。
//
// 插件里 AI 平台既支持 OpenAI 兼容协议，也支持 Anthropic 原生协议
// （`/v1/messages` + `x-api-key`）。桌面端原来只有 OpenAI 兼容一条路径，
// 于是 Claude 只能靠第三方转发。这里把两种协议收进同一组函数，
// 上层（总结/对话/翻译/优化/章节/核对/测试连接）只关心「发消息、拿文本」。
// ---------------------------------------------------------------------------

export type AiRole = 'system' | 'user' | 'assistant';

export interface AiTextPart {
  type: 'text';
  text: string;
}

export interface AiImagePart {
  type: 'image';
  /** image/png、image/jpeg 等 */
  mime: string;
  /** base64，不含 data: 前缀 */
  data: string;
}

export type AiPart = AiTextPart | AiImagePart;

export interface AiMessage {
  role: AiRole;
  content: string | AiPart[];
}

export interface AiToolDef {
  name: string;
  description?: string;
  parameters?: unknown;
}

export interface AiToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface AiChatOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** 任务类型，用于按任务选模型与用量统计；不传则不记用量。 */
  task?: AiTask;
}

export interface AiChatResult {
  text: string;
  reasoning: string;
  usage?: AiUsage;
}

export const DEFAULT_AI_TIMEOUT_MS = 300000;

export function isAnthropicPlatform(platform: Pick<AiPlatform, 'baseUrl' | 'kind'>): boolean {
  return platform.kind === 'anthropic' || /anthropic\.com/i.test(platform.baseUrl || '');
}

/** Gemini 原生协议（generateContent / streamGenerateContent）。 */
export function isGeminiPlatform(platform: Pick<AiPlatform, 'kind'>): boolean {
  return platform.kind === 'gemini';
}

/** Azure OpenAI：部署名在路径里，鉴权用 api-key。 */
export function isAzurePlatform(platform: Pick<AiPlatform, 'kind'>): boolean {
  return platform.kind === 'azure';
}

export function errorForStatus(status: number, body: string): string {
  if (status === 401 || status === 403) return 'API Key 无效或没有权限（401/403）';
  if (status === 404) return '地址或模型不存在（404）';
  if (status === 429) return '请求过于频繁或额度不足（429）';
  if (status >= 500) return `服务端错误（${status}）`;
  return `请求失败（HTTP ${status}）：${body.slice(0, 200)}`;
}

export function aiBaseUrl(platform: Pick<AiPlatform, 'baseUrl'>): string {
  return platform.baseUrl.replace(/\/+$/, '');
}

export function aiHeaders(platform: AiPlatform, keyOverride?: string): Record<string, string> {
  const key = String(keyOverride ?? platform.apiKey).trim();
  if (isGeminiPlatform(platform)) {
    return {
      'content-type': 'application/json',
      ...(key ? { 'x-goog-api-key': key } : {})
    };
  }
  if (isAzurePlatform(platform)) {
    return {
      'content-type': 'application/json',
      ...(key ? { 'api-key': key } : {})
    };
  }
  if (isAnthropicPlatform(platform)) {
    return {
      'content-type': 'application/json',
      ...(key ? { 'x-api-key': key } : {}),
      'anthropic-version': '2023-06-01',
      // 浏览器/渲染进程里直连 Anthropic 需要这个头；主进程 fetch 不发也无害。
      'anthropic-dangerous-direct-browser-access': 'true'
    };
  }
  return {
    'content-type': 'application/json',
    ...(key ? { authorization: `Bearer ${key}` } : {})
  };
}

/** 主 Key + 额外 Key：按顺序轮换，触发限流/额度/鉴权失败时换下一个。 */
function platformKeys(platform: AiPlatform): string[] {
  const keys = [platform.apiKey, ...(platform.extraKeys || [])]
    .map((key) => String(key || '').trim())
    .filter(Boolean);
  return Array.from(new Set(keys));
}

function textOf(content: string | AiPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((part): part is AiTextPart => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

interface OpenAiContentPart {
  type?: string;
  text?: string;
  content?: string;
  image_url?: { url?: string };
}

interface OpenAiMessagePayload {
  role: string;
  content: string | OpenAiContentPart[];
}

interface OpenAiChoicePayload {
  message?: {
    content?: string | OpenAiContentPart[];
    reasoning_content?: string;
    reasoning?: string;
    tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
  };
  delta?: { content?: string; reasoning_content?: string };
  text?: string;
}

interface OpenAiUsagePayload {
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  cache_read_input_tokens?: number;
}

interface OpenAiResponsePayload {
  choices?: OpenAiChoicePayload[];
  data?: unknown[];
  models?: unknown[];
  result?: unknown[];
  usage?: OpenAiUsagePayload;
}

interface AnthropicBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface AnthropicResponsePayload {
  type?: string;
  content?: AnthropicBlock[];
  delta?: { type?: string; text?: string; thinking?: string };
  content_block?: AnthropicBlock;
  usage?: OpenAiUsagePayload;
  message?: { usage?: OpenAiUsagePayload };
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  functionCall?: { name?: string; args?: unknown };
  functionResponse?: { name?: string; response?: unknown };
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[]; role?: string };
  finishReason?: string;
}

interface GeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  cachedContentTokenCount?: number;
}

interface GeminiResponsePayload {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsage;
  models?: Array<{ name?: string }>;
  error?: { message?: string };
}

type AiPayload = OpenAiResponsePayload & AnthropicResponsePayload & GeminiResponsePayload;

function splitDataUrl(url: string): { mime: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (!match) return null;
  return { mime: match[1], data: match[2] };
}

function imagePart(src: string): AiImagePart | null {
  const parsed = splitDataUrl(src);
  if (parsed) return { type: 'image', mime: parsed.mime, data: parsed.data };
  return null;
}

function toOpenAiMessages(messages: AiMessage[]): OpenAiMessagePayload[] {
  return messages.map((message) => {
    if (typeof message.content === 'string') {
      return { role: message.role, content: message.content };
    }
    const content: OpenAiContentPart[] = [];
    for (const part of message.content) {
      if (part.type === 'text') {
        content.push({ type: 'text', text: part.text });
        continue;
      }
      const image = imagePart(part.data ? `data:${part.mime};base64,${part.data}` : '');
      if (!image) continue;
      content.push({
        type: 'image_url',
        image_url: { url: `data:${image.mime};base64,${image.data}` }
      });
    }
    return { role: message.role, content };
  });
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: Array<AnthropicBlock | Record<string, unknown>>;
}

function toAnthropicPayload(messages: AiMessage[]): {
  system: string;
  messages: AnthropicMessage[];
} {
  const system: string[] = [];
  const rows: AnthropicMessage[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      const text = textOf(message.content).trim();
      if (text) system.push(text);
      continue;
    }
    const content: Array<AnthropicBlock | Record<string, unknown>> = [];
    if (typeof message.content === 'string') {
      if (message.content.trim()) content.push({ type: 'text', text: message.content });
    } else {
      for (const part of message.content) {
        if (part.type === 'text') {
          if (part.text.trim()) content.push({ type: 'text', text: part.text });
        } else {
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: part.mime || 'image/png',
              data: part.data
            }
          });
        }
      }
    }
    if (!content.length) continue;
    rows.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content });
  }
  return { system: system.join('\n\n'), messages: rows };
}

function toAnthropicTools(tools: AiToolDef[]): Array<{
  name: string;
  description: string;
  input_schema: unknown;
}> {
  return tools.map((tool) => ({
    name: tool.name,
    description: (tool.description || '').slice(0, 1024),
    input_schema: (tool.parameters as Record<string, unknown>) || {
      type: 'object',
      properties: {}
    }
  }));
}

function toOpenAiTools(tools: AiToolDef[]): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}> {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: (tool.description || '').slice(0, 1024),
      parameters: (tool.parameters as Record<string, unknown>) || {
        type: 'object',
        properties: {}
      }
    }
  }));
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<Record<string, unknown>>;
}

function toGeminiPayload(messages: AiMessage[]): { system: string; contents: GeminiContent[] } {
  const system: string[] = [];
  const contents: GeminiContent[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      const text = textOf(message.content).trim();
      if (text) system.push(text);
      continue;
    }
    const parts: Array<Record<string, unknown>> = [];
    if (typeof message.content === 'string') {
      if (message.content.trim()) parts.push({ text: message.content });
    } else {
      for (const part of message.content) {
        if (part.type === 'text') {
          if (part.text.trim()) parts.push({ text: part.text });
        } else {
          parts.push({
            inlineData: { mimeType: part.mime || 'image/png', data: part.data }
          });
        }
      }
    }
    if (!parts.length) continue;
    contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts });
  }
  return { system: system.join('\n\n'), contents };
}

function toGeminiTools(tools: AiToolDef[]): Array<{
  name: string;
  description: string;
  parameters: unknown;
}> {
  return tools.map((tool) => ({
    name: tool.name,
    description: (tool.description || '').slice(0, 1024),
    parameters: (tool.parameters as Record<string, unknown>) || {
      type: 'object',
      properties: {}
    }
  }));
}

function buildBody(
  platform: AiPlatform,
  messages: AiMessage[],
  options: AiChatOptions & { stream?: boolean; tools?: AiToolDef[] }
): Record<string, unknown> {
  const maxTokens = Math.max(1, options.maxTokens || 8192);
  if (isGeminiPlatform(platform)) {
    const payload = toGeminiPayload(messages);
    return {
      contents: payload.contents,
      ...(payload.system ? { systemInstruction: { parts: [{ text: payload.system }] } } : {}),
      generationConfig: {
        temperature: options.temperature,
        maxOutputTokens: maxTokens
      },
      ...(options.tools && options.tools.length
        ? { tools: [{ functionDeclarations: toGeminiTools(options.tools) }] }
        : {})
    };
  }
  if (isAnthropicPlatform(platform)) {
    const payload = toAnthropicPayload(messages);
    return {
      model: platform.model.trim(),
      max_tokens: maxTokens,
      temperature: options.temperature,
      stream: options.stream === true,
      ...(payload.system ? { system: payload.system } : {}),
      messages: payload.messages,
      ...(options.tools && options.tools.length
        ? { tools: toAnthropicTools(options.tools), tool_choice: { type: 'auto' } }
        : {})
    };
  }
  return {
    model: platform.model.trim(),
    max_tokens: maxTokens,
    temperature: options.temperature,
    stream: options.stream === true,
    // 让 OpenAI 兼容服务在流式末尾带上 usage；不支持的平台会在 postJson 里回退。
    ...(options.stream === true ? { stream_options: { include_usage: true } } : {}),
    messages: toOpenAiMessages(messages),
    ...(options.tools && options.tools.length
      ? { tools: toOpenAiTools(options.tools), tool_choice: 'auto' }
      : {})
  };
}

function endpoints(platform: AiPlatform, stream = false): string[] {
  if (isGeminiPlatform(platform)) {
    const model = encodeURIComponent(platform.model.trim());
    return [
      `${aiBaseUrl(platform)}/models/${model}:${
        stream ? 'streamGenerateContent?alt=sse' : 'generateContent'
      }`
    ];
  }
  if (isAzurePlatform(platform)) {
    const model = encodeURIComponent(platform.model.trim());
    const version = (platform.apiVersion || '2024-10-21').trim();
    return [
      `${aiBaseUrl(platform)}/openai/deployments/${model}/chat/completions?api-version=${encodeURIComponent(version)}`
    ];
  }
  return isAnthropicPlatform(platform)
    ? [`${aiBaseUrl(platform)}/messages`]
    : [`${aiBaseUrl(platform)}/chat/completions`];
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  options: AiChatOptions
): Promise<Response> {
  if (options.signal?.aborted) throw new Error('已终止');
  const controller = new AbortController();
  const timeoutMs = Math.max(5000, options.timeoutMs || DEFAULT_AI_TIMEOUT_MS);
  const timer = setTimeout(
    () => controller.abort(new Error(`AI 请求超时（${Math.round(timeoutMs / 1000)} 秒）`)),
    timeoutMs
  );
  const forward = () => controller.abort();
  options.signal?.addEventListener('abort', forward, { once: true });
  // 监听器注册前可能已经被取消；addEventListener 不会补发 abort 事件。
  if (options.signal?.aborted) forward();
  try {
    return await session.defaultSession.fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', forward);
  }
}

function parseOpenAiText(json: OpenAiResponsePayload): AiChatResult {
  const message = json?.choices?.[0]?.message;
  const raw = message?.content;
  const text =
    typeof raw === 'string'
      ? raw
      : Array.isArray(raw)
        ? raw.map((part) => String(part?.text ?? part?.content ?? '')).join('')
        : '';
  const reasoning = String(message?.reasoning_content ?? message?.reasoning ?? '');
  return { text, reasoning, usage: usageFromPayload(json?.usage) };
}

function parseAnthropicText(json: AnthropicResponsePayload): AiChatResult {
  const blocks = Array.isArray(json?.content) ? json.content : [];
  const text = blocks
    .filter((block) => block?.type === 'text')
    .map((block) => String(block.text || ''))
    .join('');
  const reasoning = blocks
    .filter((block) => block?.type === 'thinking')
    .map((block) => String(block.thinking || ''))
    .join('');
  return { text, reasoning, usage: usageFromPayload(json.usage) };
}

function usageFromPayload(usage: OpenAiUsagePayload | undefined): AiUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const input = Number(usage.input_tokens ?? usage.prompt_tokens) || 0;
  const output = Number(usage.output_tokens ?? usage.completion_tokens) || 0;
  const cached =
    Number(usage.cache_read_input_tokens ?? usage.prompt_tokens_details?.cached_tokens) || 0;
  if (!input && !output) return undefined;
  return {
    inputTokens: Math.max(0, Math.round(input)),
    outputTokens: Math.max(0, Math.round(output)),
    ...(cached > 0 ? { cacheReadTokens: Math.max(0, Math.round(cached)) } : {})
  };
}

function usageFromGemini(usage: GeminiUsage | undefined): AiUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const input = Number(usage.promptTokenCount) || 0;
  const output = Number(usage.candidatesTokenCount) || 0;
  const cached = Number(usage.cachedContentTokenCount) || 0;
  if (!input && !output) return undefined;
  return {
    inputTokens: Math.max(0, Math.round(input)),
    outputTokens: Math.max(0, Math.round(output)),
    ...(cached > 0 ? { cacheReadTokens: Math.max(0, Math.round(cached)) } : {})
  };
}

function parseGeminiText(json: GeminiResponsePayload): AiChatResult {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .map((part) => String(part?.text || ''))
    .join('');
  return { text, reasoning: '', usage: usageFromGemini(json?.usageMetadata) };
}

/** 按平台协议解析非流式响应。 */
function parsePayloadText(platform: AiPlatform, json: AiPayload): AiChatResult {
  if (isGeminiPlatform(platform)) return parseGeminiText(json);
  return isAnthropicPlatform(platform) ? parseAnthropicText(json) : parseOpenAiText(json);
}

/** 记录一次请求的用量；没有任务标记或服务端没返回 usage 时静默跳过。 */
function trackUsage(
  platform: AiPlatform,
  task: AiTask | undefined,
  usage: AiUsage | undefined
): void {
  if (!task || !usage) return;
  try {
    recordUsage({
      task,
      platformId: platform.id,
      platformName: platform.name,
      model: platform.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens
    });
  } catch {
    // 统计失败不影响主流程
  }
}

function parseChunk(
  platform: AiPlatform,
  data: AiPayload
): { text: string; reasoning: string; usage?: AiUsage } {
  if (isGeminiPlatform(platform)) {
    const parts = data?.candidates?.[0]?.content?.parts || [];
    return {
      text: parts.map((part) => String(part?.text || '')).join(''),
      reasoning: '',
      usage: usageFromGemini(data?.usageMetadata)
    };
  }
  if (isAnthropicPlatform(platform)) {
    const type = String(data?.type || '');
    if (type === 'message_start') {
      return { text: '', reasoning: '', usage: usageFromPayload(data.message?.usage) };
    }
    if (type === 'message_delta') {
      return { text: '', reasoning: '', usage: usageFromPayload(data.usage) };
    }
    if (type === 'content_block_delta') {
      const delta = data?.delta || {};
      if (delta.type === 'text_delta') return { text: String(delta.text || ''), reasoning: '' };
      if (delta.type === 'thinking_delta') {
        return { text: '', reasoning: String(delta.thinking || '') };
      }
      return { text: '', reasoning: '' };
    }
    if (type === 'content_block_start') {
      const block = data?.content_block || {};
      if (block.type === 'text') return { text: String(block.text || ''), reasoning: '' };
      if (block.type === 'thinking') {
        return { text: '', reasoning: String(block.thinking || '') };
      }
    }
    return { text: '', reasoning: '' };
  }
  const choice = data?.choices?.[0];
  const delta = choice?.delta?.content ?? choice?.text ?? '';
  const think = choice?.delta?.reasoning_content ?? '';
  return {
    text: typeof delta === 'string' ? delta : '',
    reasoning: typeof think === 'string' ? think : '',
    usage: usageFromPayload(data.usage)
  };
}

/** 流式分片的 usage 是「绝对值 + 增量」混合，按字段覆盖合并。 */
function mergeUsage(total: AiUsage | undefined, part: AiUsage | undefined): AiUsage | undefined {
  if (!part) return total;
  const next: AiUsage = {
    inputTokens: part.inputTokens || total?.inputTokens || 0,
    outputTokens: part.outputTokens || total?.outputTokens || 0
  };
  const cache = part.cacheReadTokens || total?.cacheReadTokens || 0;
  if (cache > 0) next.cacheReadTokens = cache;
  return next;
}

/** 工具循环里每轮是独立请求，用量要累加。 */
function addUsage(total: AiUsage | undefined, part: AiUsage | undefined): AiUsage | undefined {
  if (!part) return total;
  return {
    inputTokens: (total?.inputTokens || 0) + part.inputTokens,
    outputTokens: (total?.outputTokens || 0) + part.outputTokens,
    cacheReadTokens: (total?.cacheReadTokens || 0) + (part.cacheReadTokens || 0)
  };
}

async function postJson(
  platform: AiPlatform,
  body: Record<string, unknown>,
  options: AiChatOptions
): Promise<Response> {
  const url = endpoints(platform, body.stream === true)[0];
  const keys = platformKeys(platform);
  const keyCount = Math.max(1, keys.length);

  const send = async (payload: Record<string, unknown>): Promise<Response> => {
    let last: Response | null = null;
    for (let attempt = 0; attempt < keyCount; attempt += 1) {
      const key = keys[attempt] ?? '';
      last = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: aiHeaders(platform, key),
          body: JSON.stringify(payload)
        },
        options
      );
      const retryable =
        last.status === 401 || last.status === 403 || last.status === 429 || last.status >= 500;
      if (!retryable || attempt === keyCount - 1) return last;
    }
    return last as Response;
  };

  const response = await send(body);
  if (response.ok || response.status !== 400) return response;

  const probe = await response
    .clone()
    .text()
    .catch(() => '');

  // Gemini 的 maxOutputTokens 也有上限（Flash 系列 8192），按报错回退一次。
  if (isGeminiPlatform(platform) && /maxOutputTokens|max_output_tokens/i.test(probe)) {
    const generationConfig = {
      ...(body.generationConfig as Record<string, unknown> | undefined),
      maxOutputTokens: 8192
    };
    return send({ ...body, generationConfig });
  }

  // Anthropic 的 max_tokens 是硬上限：桌面端默认 64000，某些 Claude 型号
  // （如 3.5 Haiku）只接受 8192。这里按服务端报错回退一次，而不是让用户手改。
  const maxTokens = Number(body.max_tokens) || 0;
  if (/max_tokens/i.test(probe) && maxTokens > 8192) {
    return send({ ...body, max_tokens: 8192 });
  }

  // 部分 OpenAI 兼容服务不认 stream_options：去掉后重试一次。
  if ('stream_options' in body && /stream_options|unknown|unrecognized|unexpected/i.test(probe)) {
    const rest = { ...body };
    delete (rest as Record<string, unknown>).stream_options;
    return send(rest);
  }
  return response;
}

/** 非流式调用：返回完整文本。用于 JSON 类任务（翻译/优化/章节/核对/测试）。 */
export async function chatOnce(
  platform: AiPlatform,
  messages: AiMessage[],
  options: AiChatOptions = {}
): Promise<AiChatResult> {
  const response = await postJson(
    platform,
    buildBody(platform, messages, { ...options, stream: false }),
    options
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(errorForStatus(response.status, body));
  }
  const json = (await response.json()) as AiPayload;
  const result = parsePayloadText(platform, json);
  trackUsage(platform, options.task, result.usage);
  return result;
}

/** 流式调用：边读边回调；不支持的平台/协议回落到一次性返回。 */
export async function chatStream(
  platform: AiPlatform,
  messages: AiMessage[],
  options: AiChatOptions & {
    onDelta?: (delta: string) => void;
    onReasoning?: (delta: string) => void;
  } = {}
): Promise<AiChatResult> {
  const response = await postJson(
    platform,
    buildBody(platform, messages, { ...options, stream: true }),
    options
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(errorForStatus(response.status, body));
  }

  const contentType = response.headers.get('content-type') || '';
  if (!response.body || !contentType.includes('text/event-stream')) {
    const json = (await response.json()) as AiPayload;
    const result = parsePayloadText(platform, json);
    if (result.text) options.onDelta?.(result.text);
    if (result.reasoning) options.onReasoning?.(result.reasoning);
    trackUsage(platform, options.task, result.usage);
    return result;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let reasoning = '';
  let usage: AiUsage | undefined;
  let finished = false;

  const handleLine = (line: string): boolean => {
    const trimmed = line.replace(/\r$/, '');
    if (!trimmed.startsWith('data:')) return false;
    const data = trimmed.slice(5).trim();
    if (!data) return false;
    if (data === '[DONE]') return true;
    try {
      const json = JSON.parse(data);
      const delta = parseChunk(platform, json);
      if (delta.text) {
        text += delta.text;
        options.onDelta?.(delta.text);
      }
      if (delta.reasoning) {
        reasoning += delta.reasoning;
        options.onReasoning?.(delta.reasoning);
      }
      usage = mergeUsage(usage, delta.usage);
    } catch {
      // 忽略非 JSON 的 data 行
    }
    return false;
  };

  while (!finished) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (handleLine(line)) {
        finished = true;
        break;
      }
    }
  }
  if (!finished && buffer.trim() && handleLine(buffer)) finished = true;
  if (!text.trim()) throw new Error('AI 返回为空');
  trackUsage(platform, options.task, usage);
  return { text, reasoning, usage };
}

// ---------------------------------------------------------------------------
// 工具循环（MCP）：OpenAI 的 tool_calls 与 Anthropic 的 tool_use 结构完全不同，
// 上层只提供一个「执行工具」的回调。
// ---------------------------------------------------------------------------

export interface AiToolResult {
  id: string;
  name: string;
  content: string;
}

async function readSseEvents(
  response: Response,
  onEvent: (json: Record<string, unknown>) => void
): Promise<boolean> {
  const contentType = response.headers.get('content-type') || '';
  if (!response.body || !contentType.includes('text/event-stream')) return false;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  while (!finished) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      if (data === '[DONE]') {
        finished = true;
        break;
      }
      try {
        onEvent(JSON.parse(data) as Record<string, unknown>);
      } catch {
        // 忽略非 JSON 事件
      }
    }
  }
  return true;
}

function safeJson(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text || '{}');
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Anthropic Messages 的流式工具循环。 */
async function chatAnthropicToolLoopStream(
  platform: AiPlatform,
  messages: AiMessage[],
  tools: AiToolDef[],
  options: AiChatOptions & {
    maxRounds?: number;
    onDelta?: (delta: string) => void;
    onReasoning?: (delta: string) => void;
  },
  runTool: (call: AiToolCall) => Promise<string>
): Promise<AiChatResult> {
  const maxRounds = Math.max(1, options.maxRounds || 6);
  const payload = toAnthropicPayload(messages);
  const convo = payload.messages as unknown as Array<Record<string, unknown>>;
  let text = '';
  let reasoning = '';
  let usage: AiUsage | undefined;
  const finish = (): AiChatResult => {
    if (!text.trim()) throw new Error('AI 返回为空');
    trackUsage(platform, options.task, usage);
    return { text, reasoning, usage };
  };
  for (let round = 0; round < maxRounds; round += 1) {
    if (options.signal?.aborted) throw new Error('已终止');
    const body: Record<string, unknown> = {
      model: platform.model.trim(),
      max_tokens: Math.max(1, options.maxTokens || 8192),
      temperature: options.temperature,
      stream: true,
      messages: convo,
      tools: toAnthropicTools(tools),
      tool_choice: { type: 'auto' },
      ...(payload.system ? { system: payload.system } : {})
    };
    const response = await postJson(platform, body, options);
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(errorForStatus(response.status, detail));
    }
    let roundText = '';
    const calls = new Map<number, { id: string; name: string; json: string }>();
    const ok = await readSseEvents(response, (json) => {
      const type = String(json.type || '');
      if (type === 'message_start') {
        usage = mergeUsage(usage, usageFromPayload((json.message as Record<string, unknown>)?.usage as Record<string, unknown>));
      } else if (type === 'message_delta') {
        usage = mergeUsage(usage, usageFromPayload(json.usage as Record<string, unknown>));
      } else if (type === 'content_block_start') {
        const block = (json.content_block || {}) as Record<string, unknown>;
        const index = Number(json.index ?? 0) || 0;
        if (block.type === 'tool_use') {
          calls.set(index, { id: String(block.id || ''), name: String(block.name || ''), json: '' });
        } else if (block.type === 'text' && block.text) {
          roundText += String(block.text);
          text += String(block.text);
          options.onDelta?.(String(block.text));
        }
      } else if (type === 'content_block_delta') {
        const delta = (json.delta || {}) as Record<string, unknown>;
        const index = Number(json.index ?? 0) || 0;
        if (delta.type === 'text_delta') {
          roundText += String(delta.text || '');
          text += String(delta.text || '');
          options.onDelta?.(String(delta.text || ''));
        } else if (delta.type === 'thinking_delta') {
          reasoning += String(delta.thinking || '');
          options.onReasoning?.(String(delta.thinking || ''));
        } else if (delta.type === 'input_json_delta') {
          const call = calls.get(index);
          if (call) call.json += String(delta.partial_json || '');
        }
      }
    });
    if (!ok) return chatToolLoop(platform, messages, tools, options, runTool);
    if (!calls.size) return finish();
    const ordered = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, call]) => call);
    const content: Array<Record<string, unknown>> = [];
    if (roundText) content.push({ type: 'text', text: roundText });
    for (const call of ordered) {
      content.push({ type: 'tool_use', id: call.id, name: call.name, input: safeJson(call.json) });
    }
    convo.push({ role: 'assistant', content });
    const results: Array<Record<string, unknown>> = [];
    for (const call of ordered) {
      let output = '';
      try {
        output = await runTool({ id: call.id, name: call.name, arguments: call.json || '{}' });
      } catch (error) {
        output = '工具调用失败：' + (error as Error).message;
      }
      results.push({ type: 'tool_result', tool_use_id: call.id, content: String(output || '').slice(0, 4000) });
    }
    convo.push({ role: 'user', content: results });
  }
  throw new Error('工具调用轮次过多');
}

/** Gemini 的流式工具循环。 */
async function chatGeminiToolLoopStream(
  platform: AiPlatform,
  messages: AiMessage[],
  tools: AiToolDef[],
  options: AiChatOptions & {
    maxRounds?: number;
    onDelta?: (delta: string) => void;
    onReasoning?: (delta: string) => void;
  },
  runTool: (call: AiToolCall) => Promise<string>
): Promise<AiChatResult> {
  const maxRounds = Math.max(1, options.maxRounds || 6);
  const payload = toGeminiPayload(messages);
  const contents: Array<Record<string, unknown>> = payload.contents.map((row) => ({
    role: row.role,
    parts: row.parts
  }));
  let text = '';
  let usage: AiUsage | undefined;
  const finish = (): AiChatResult => {
    if (!text.trim()) throw new Error('AI 返回为空');
    trackUsage(platform, options.task, usage);
    return { text, reasoning: '', usage };
  };
  for (let round = 0; round < maxRounds; round += 1) {
    if (options.signal?.aborted) throw new Error('已终止');
    const body: Record<string, unknown> = {
      contents,
      ...(payload.system ? { systemInstruction: { parts: [{ text: payload.system }] } } : {}),
      generationConfig: {
        temperature: options.temperature,
        maxOutputTokens: Math.max(1, options.maxTokens || 8192)
      },
      tools: [{ functionDeclarations: toGeminiTools(tools) }]
    };
    const response = await postJson(platform, body, options);
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(errorForStatus(response.status, detail));
    }
    let roundText = '';
    const calls: Array<Record<string, unknown>> = [];
    const ok = await readSseEvents(response, (json) => {
      usage = mergeUsage(usage, usageFromGemini(json.usageMetadata as Record<string, unknown>));
      const parts = ((json.candidates as Array<Record<string, unknown>> | undefined)?.[0]?.content as Record<string, unknown> | undefined)?.parts as Array<Record<string, unknown>> | undefined;
      for (const part of Array.isArray(parts) ? parts : []) {
        if (part.text) {
          roundText += String(part.text);
          text += String(part.text);
          options.onDelta?.(String(part.text));
        }
        if (part.functionCall) calls.push(part);
      }
    });
    if (!ok) return chatToolLoop(platform, messages, tools, options, runTool);
    if (!calls.length) return finish();
    const modelParts: Array<Record<string, unknown>> = [];
    if (roundText) modelParts.push({ text: roundText });
    modelParts.push(...calls);
    contents.push({ role: 'model', parts: modelParts });
    const responses: Array<Record<string, unknown>> = [];
    for (const part of calls) {
      const fn = (part.functionCall || {}) as Record<string, unknown>;
      const name = String(fn.name || '');
      let output = '';
      try {
        output = await runTool({ id: '', name, arguments: JSON.stringify(fn.args ?? {}) });
      } catch (error) {
        output = '工具调用失败：' + (error as Error).message;
      }
      responses.push({
        functionResponse: { name, response: { result: String(output || '').slice(0, 4000) } }
      });
    }
    contents.push({ role: 'user', parts: responses });
  }
  throw new Error('工具调用轮次过多');
}

/** OpenAI 兼容平台的流式工具循环：工具轮与最终回答都在同一个流里推进。 */
export async function chatToolLoopStream(
  platform: AiPlatform,
  messages: AiMessage[],
  tools: AiToolDef[],
  options: AiChatOptions & {
    maxRounds?: number;
    onDelta?: (delta: string) => void;
    onReasoning?: (delta: string) => void;
  },
  runTool: (call: AiToolCall) => Promise<string>
): Promise<AiChatResult> {
  if (isGeminiPlatform(platform)) {
    return chatGeminiToolLoopStream(platform, messages, tools, options, runTool);
  }
  if (isAnthropicPlatform(platform)) {
    return chatAnthropicToolLoopStream(platform, messages, tools, options, runTool);
  }
  const maxRounds = Math.max(1, options.maxRounds || 6);
  const convo = toOpenAiMessages(messages) as unknown as Array<Record<string, unknown>>;
  let text = '';
  let reasoning = '';
  let usage: AiUsage | undefined;

  const finish = (): AiChatResult => {
    if (!text.trim()) throw new Error('AI 返回为空');
    trackUsage(platform, options.task, usage);
    return { text, reasoning, usage };
  };

  for (let round = 0; round < maxRounds; round += 1) {
    if (options.signal?.aborted) throw new Error('已终止');
    const body: Record<string, unknown> = {
      model: platform.model.trim(),
      max_tokens: Math.max(1, options.maxTokens || 8192),
      temperature: options.temperature,
      stream: true,
      stream_options: { include_usage: true },
      messages: convo,
      tools: toOpenAiTools(tools),
      tool_choice: 'auto'
    };
    const response = await postJson(platform, body, options);
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(errorForStatus(response.status, detail));
    }
    const contentType = response.headers.get('content-type') || '';
    if (!response.body || !contentType.includes('text/event-stream')) {
      // 少数兼容服务会忽略 stream，退回一次性 JSON 解析。
      const json = (await response.json()) as AiPayload;
      usage = mergeUsage(usage, usageFromPayload(json?.usage));
      const message = json?.choices?.[0]?.message;
      const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
      const roundText = String(message?.content || '');
      if (roundText) {
        text += roundText;
        options.onDelta?.(roundText);
      }
      if (!calls.length) return finish();
      convo.push({
        role: 'assistant',
        content: roundText || null,
        tool_calls: calls.map((call: Record<string, unknown>, index: number) => ({
          id: String(call.id || 'call_' + index),
          type: 'function',
          function: {
            name: String((call.function as Record<string, unknown>)?.name || ''),
            arguments: String((call.function as Record<string, unknown>)?.arguments || '{}')
          }
        }))
      });
      for (const call of calls) {
        const fnPart = (call.function || {}) as Record<string, unknown>;
        let output = '';
        try {
          output = await runTool({
            id: String(call.id || ''),
            name: String(fnPart.name || ''),
            arguments: String(fnPart.arguments || '{}')
          });
        } catch (error) {
          output = '工具调用失败：' + (error as Error).message;
        }
        convo.push({
          role: 'tool',
          tool_call_id: String(call.id || ''),
          content: String(output || '').slice(0, 4000)
        });
      }
      continue;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let roundText = '';
    const calls = new Map<number, { id: string; name: string; args: string }>();
    let done = false;
    while (!done) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === '[DONE]') {
          done = true;
          break;
        }
        let json: Record<string, unknown>;
        try {
          json = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }
        usage = mergeUsage(usage, usageFromPayload(json.usage as Record<string, unknown>));
        const choice = (json.choices as Array<Record<string, unknown>> | undefined)?.[0];
        const delta = (choice?.delta || {}) as Record<string, unknown>;
        const content = String(delta.content || '');
        if (content) {
          roundText += content;
          text += content;
          options.onDelta?.(content);
        }
        const think = String(delta.reasoning_content || '');
        if (think) {
          reasoning += think;
          options.onReasoning?.(think);
        }
        const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
        for (const raw of toolCalls) {
          const item = raw as Record<string, unknown>;
          const index = Number(item.index ?? 0) || 0;
          const current = calls.get(index) || { id: '', name: '', args: '' };
          if (item.id) current.id = String(item.id);
          const fnPart = (item.function || {}) as Record<string, unknown>;
          if (fnPart.name) current.name += String(fnPart.name);
          if (fnPart.arguments) current.args += String(fnPart.arguments);
          calls.set(index, current);
        }
      }
    }

    if (!calls.size) return finish();
    const ordered = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, call], index) => ({
      id: call.id || 'call_' + index,
      name: call.name,
      arguments: call.args || '{}'
    }));
    convo.push({
      role: 'assistant',
      content: roundText || null,
      tool_calls: ordered.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments }
      }))
    });
    for (const call of ordered) {
      let output = '';
      try {
        output = await runTool(call);
      } catch (error) {
        output = '工具调用失败：' + (error as Error).message;
      }
      convo.push({
        role: 'tool',
        tool_call_id: call.id,
        content: String(output || '').slice(0, 4000)
      });
    }
  }
  throw new Error('工具调用轮次过多');
}

export async function chatToolLoop(
  platform: AiPlatform,
  messages: AiMessage[],
  tools: AiToolDef[],
  options: AiChatOptions & { maxRounds?: number },
  runTool: (call: AiToolCall) => Promise<string>
): Promise<AiChatResult> {
  if (isGeminiPlatform(platform)) {
    return chatGeminiToolLoop(platform, messages, tools, options, runTool);
  }
  const anthropic = isAnthropicPlatform(platform);
  const maxRounds = Math.max(1, options.maxRounds || 6);
  const convo: Array<OpenAiMessagePayload | AnthropicMessage | Record<string, unknown>> = anthropic
    ? toAnthropicPayload(messages).messages
    : toOpenAiMessages(messages);
  const system = anthropic ? toAnthropicPayload(messages).system : '';
  let totalUsage: AiUsage | undefined;

  for (let round = 0; round < maxRounds; round += 1) {
    if (options.signal?.aborted) throw new Error('已终止');
    const body: Record<string, unknown> = anthropic
      ? {
          model: platform.model.trim(),
          max_tokens: Math.max(1, options.maxTokens || 8192),
          temperature: options.temperature,
          stream: false,
          messages: convo,
          tools: toAnthropicTools(tools),
          ...(system ? { system } : {})
        }
      : {
          model: platform.model.trim(),
          max_tokens: Math.max(1, options.maxTokens || 8192),
          temperature: options.temperature,
          stream: false,
          messages: convo,
          tools: toOpenAiTools(tools),
          tool_choice: 'auto'
        };

    const response = await postJson(platform, body, options);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(errorForStatus(response.status, text));
    }
    const json = (await response.json()) as AiPayload;
    totalUsage = addUsage(totalUsage, usageFromPayload(json?.usage));

    if (anthropic) {
      const blocks = Array.isArray(json?.content) ? json.content : [];
      const toolUses = blocks.filter((block) => block?.type === 'tool_use');
      if (!toolUses.length) {
        const result = parseAnthropicText(json);
        if (!result.text.trim()) throw new Error('AI 返回为空');
        trackUsage(platform, options.task, totalUsage);
        return { ...result, usage: totalUsage };
      }
      convo.push({ role: 'assistant', content: blocks });
      const results: Array<Record<string, unknown>> = [];
      for (const block of toolUses) {
        let content = '';
        try {
          content = await runTool({
            id: String(block.id || ''),
            name: String(block.name || ''),
            arguments: JSON.stringify(block.input ?? {})
          });
        } catch (error) {
          content = `工具调用失败：${(error as Error).message}`;
        }
        results.push({
          type: 'tool_result',
          tool_use_id: String(block.id || ''),
          content: String(content || '').slice(0, 4000)
        });
      }
      convo.push({ role: 'user', content: results });
      continue;
    }

    const message = json?.choices?.[0]?.message;
    const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    if (calls.length) {
      convo.push({
        role: 'assistant',
        content: message?.content ?? null,
        tool_calls: calls
      });
      for (const call of calls) {
        let content = '';
        try {
          content = await runTool({
            id: String(call?.id || ''),
            name: String(call?.function?.name || ''),
            arguments: String(call?.function?.arguments || '{}')
          });
        } catch (error) {
          content = `工具调用失败：${(error as Error).message}`;
        }
        convo.push({
          role: 'tool',
          tool_call_id: String(call?.id || ''),
          name: String(call?.function?.name || ''),
          content: String(content || '').slice(0, 4000)
        });
      }
      continue;
    }

    const result = parseOpenAiText(json);
    if (!result.text.trim()) throw new Error('AI 返回为空');
    trackUsage(platform, options.task, totalUsage);
    return { ...result, usage: totalUsage };
  }

  throw new Error(`工具调用轮数过多（超过 ${maxRounds} 轮）`);
}

/** Gemini 原生的函数调用循环：functionCall / functionResponse。 */
async function chatGeminiToolLoop(
  platform: AiPlatform,
  messages: AiMessage[],
  tools: AiToolDef[],
  options: AiChatOptions & { maxRounds?: number },
  runTool: (call: AiToolCall) => Promise<string>
): Promise<AiChatResult> {
  const maxRounds = Math.max(1, options.maxRounds || 6);
  const payload = toGeminiPayload(messages);
  const contents: Array<Record<string, unknown>> = payload.contents.map((row) => ({
    role: row.role,
    parts: row.parts
  }));
  let totalUsage: AiUsage | undefined;

  for (let round = 0; round < maxRounds; round += 1) {
    if (options.signal?.aborted) throw new Error('已终止');
    const body: Record<string, unknown> = {
      contents,
      ...(payload.system ? { systemInstruction: { parts: [{ text: payload.system }] } } : {}),
      generationConfig: {
        temperature: options.temperature,
        maxOutputTokens: Math.max(1, options.maxTokens || 8192)
      },
      tools: [{ functionDeclarations: toGeminiTools(tools) }]
    };

    const response = await postJson(platform, body, options);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(errorForStatus(response.status, text));
    }
    const json = (await response.json()) as GeminiResponsePayload;
    totalUsage = addUsage(totalUsage, usageFromGemini(json.usageMetadata));

    const parts = json?.candidates?.[0]?.content?.parts || [];
    const calls = parts.filter((part) => part?.functionCall?.name);
    if (!calls.length) {
      const text = parts.map((part) => String(part?.text || '')).join('');
      if (!text.trim()) throw new Error('AI 返回为空');
      trackUsage(platform, options.task, totalUsage);
      return { text, reasoning: '', usage: totalUsage };
    }

    contents.push({ role: 'model', parts });
    const responses: Array<Record<string, unknown>> = [];
    for (const part of calls) {
      const name = String(part.functionCall?.name || '');
      let content = '';
      try {
        content = await runTool({
          id: '',
          name,
          arguments: JSON.stringify(part.functionCall?.args ?? {})
        });
      } catch (error) {
        content = `工具调用失败：${(error as Error).message}`;
      }
      responses.push({
        functionResponse: {
          name,
          response: { result: String(content || '').slice(0, 4000) }
        }
      });
    }
    contents.push({ role: 'user', parts: responses });
  }

  throw new Error(`工具调用轮数过多（超过 ${maxRounds} 轮）`);
}

export async function listAiModels(
  platform: AiPlatform
): Promise<{ models: string[]; url: string }> {
  if (isAzurePlatform(platform)) {
    throw new Error('Azure OpenAI 需要填写「部署名」而不是模型列表，请手动填写模型名');
  }
  if (isGeminiPlatform(platform)) {
    const url = `${aiBaseUrl(platform)}/models`;
    const headers = aiHeaders(platform);
    delete headers['content-type'];
    const response = await fetchWithTimeout(url, { method: 'GET', headers }, { timeoutMs: 30000 });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`模型列表 HTTP ${response.status}：${text.slice(0, 160)}`);
    }
    let json: GeminiResponsePayload | null = null;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('模型列表不是 JSON');
    }
    const models = (json?.models || [])
      .map((row) => String(row?.name || '').replace(/^models\//, ''))
      .filter(Boolean);
    return { models, url };
  }
  const url = `${aiBaseUrl(platform)}/models`;
  const headers = aiHeaders(platform);
  delete headers['content-type'];
  const response = await fetchWithTimeout(url, { method: 'GET', headers }, { timeoutMs: 30000 });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`模型列表 HTTP ${response.status}：${text.slice(0, 160)}`);
  }
  let json: OpenAiResponsePayload | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('模型列表不是 JSON');
  }
  const rows = Array.isArray(json?.data)
    ? json.data
    : Array.isArray(json?.models)
      ? json.models
      : Array.isArray(json?.result)
        ? json.result
        : [];
  const models = rows
    .map((item) => {
      const row = item as { id?: string; name?: string };
      return String(row?.id || row?.name || item);
    })
    .filter(Boolean);
  return { models, url };
}

export async function testAiConnection(
  platform: AiPlatform
): Promise<{ latencyMs: number; message: string }> {
  if (!platform.baseUrl.trim()) throw new Error('请填写 Base URL');
  if (!platform.model.trim()) throw new Error('请填写模型名');
  if (needsApiKey(platform) && !platform.apiKey.trim()) throw new Error('请填写 API Key');
  const started = Date.now();
  await chatOnce(platform, [{ role: 'user', content: 'ping' }], {
    maxTokens: 4,
    temperature: 0,
    timeoutMs: 30000
  });
  return { latencyMs: Date.now() - started, message: '连接成功' };
}