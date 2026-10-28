/** 模型能力推断与用户覆盖：只做保守判断，允许用户在设置里纠正。 */
export type ModelCapability = 'text' | 'vision' | 'audio' | 'web';

export interface ModelCapabilityState {
  text: true;
  vision: boolean;
  audio: boolean;
  /** 模型/平台是否支持内置联网（Gemini google_search / Claude web_search） */
  web: boolean;
}

const VISION_PATTERN =
  /(gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-5|o3|o4-mini|claude-3|claude-4|claude-sonnet|claude-opus|gemini|qwen.*(vl|vision)|qwen2\.5-vl|qwen3-vl|glm-4v|glm-4\.1v|llava|pixtral|internvl|minicpm-v|yi-vl|vision|multimodal|omni|grok.*vision)/i;
const AUDIO_PATTERN = /(audio|realtime|omni|qwen-audio|gpt-4o-audio)/i;

export function capabilityKey(platformId: string, model: string): string {
  return `${platformId}::${String(model || '').trim().toLowerCase()}`;
}

/** 自动识别：文本始终可用；图片/音频按模型名与平台类型推断。 */
export function inferModelCapabilities(
  platformKind: string | undefined,
  model: string
): ModelCapabilityState {
  const name = String(model || '');
  const kind = String(platformKind || '').toLowerCase();
  const vision =
    VISION_PATTERN.test(name) ||
    // Gemini 全系支持图片；本地视觉模型常见命名也覆盖
    (kind === 'gemini' && Boolean(name.trim()));
  const audio = AUDIO_PATTERN.test(name) || (kind === 'gemini' && /live|audio/i.test(name));
  const web =
    kind === 'gemini' ||
    kind === 'anthropic' ||
    /(claude|gemini|web_search|sonar)/i.test(name);
  return { text: true, vision, audio, web };
}

export function effectiveModelCapabilities(
  platformKind: string | undefined,
  model: string,
  override?: { vision?: boolean; audio?: boolean; web?: boolean }
): ModelCapabilityState {
  const inferred = inferModelCapabilities(platformKind, model);
  return {
    text: true,
    vision: override?.vision ?? inferred.vision,
    audio: override?.audio ?? inferred.audio,
    web: override?.web ?? inferred.web
  };
}

/** 按模型名推断上下文窗口（token）；未知返回 0。 */
export function inferContextWindow(model: string): number {
  const name = String(model || '').toLowerCase();
  if (/gemini/.test(name)) return 1_000_000;
  if (/claude/.test(name)) return 200_000;
  if (/gpt-4\.1|gpt-5/.test(name)) return 1_000_000;
  if (/gpt-4o|o3|o4/.test(name)) return 128_000;
  if (/deepseek/.test(name)) return 64_000;
  if (/qwen/.test(name)) return 32_768;
  if (/glm-4/.test(name)) return 128_000;
  return 0;
}

export function effectiveContextWindow(model: string, override?: number): number {
  if (Number.isFinite(override) && Number(override) > 0) return Number(override);
  return inferContextWindow(model);
}

export function formatContextWindow(tokens: number): string {
  if (!tokens) return '';
  if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`;
  return `${Math.round(tokens / 1000)}k`;
}

export function capabilityLabel(capability: ModelCapability): string {
  if (capability === 'vision') return '图片';
  if (capability === 'audio') return '音频';
  if (capability === 'web') return '联网';
  return '文本';
}
/** 把列表里的 from 移到 to，返回新数组；越界时原样返回。 */
export function moveListItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items;
  }
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

