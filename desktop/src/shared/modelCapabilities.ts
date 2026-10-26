/** 模型能力推断与用户覆盖：只做保守判断，允许用户在设置里纠正。 */
export type ModelCapability = 'text' | 'vision' | 'audio';

export interface ModelCapabilityState {
  text: true;
  vision: boolean;
  audio: boolean;
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
  return { text: true, vision, audio };
}

export function effectiveModelCapabilities(
  platformKind: string | undefined,
  model: string,
  override?: { vision?: boolean; audio?: boolean }
): ModelCapabilityState {
  const inferred = inferModelCapabilities(platformKind, model);
  return {
    text: true,
    vision: override?.vision ?? inferred.vision,
    audio: override?.audio ?? inferred.audio
  };
}

export function capabilityLabel(capability: ModelCapability): string {
  if (capability === 'vision') return '图片';
  if (capability === 'audio') return '音频';
  return '文本';
}
