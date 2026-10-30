import type { AiTask, ModelPrice } from './types';

export interface AiTaskDef {
  id: AiTask;
  label: string;
  desc: string;
}

/** 任务槽位：每个任务可以单独选平台/模型，没配就跟随「当前平台」。 */
export const AI_TASKS: AiTaskDef[] = [
  { id: 'chat', label: '对话', desc: '侧栏/桌宠里的问答' },
  { id: 'summary', label: '总结', desc: '视频总结、长视频分段、合集对比' },
  { id: 'translate', label: '翻译', desc: '字幕翻译与译文反思' },
  { id: 'proofread', label: '校对', desc: '错别字与术语修正' },
  { id: 'chapters', label: '章节与断句', desc: '章节划分、断句重组' },
  { id: 'verify', label: '联网核对', desc: '检索词生成、证据判定、补充资料' },
  { id: 'quick', label: '快速判断', desc: '是否需要联网、标题等小请求' },
  { id: 'ocr', label: '文字识别', desc: '截图取字；需要选择支持图片输入的视觉模型' },
  { id: 'tts', label: '语音朗读', desc: '文字转语音；选择支持 TTS 的平台/模型' },
  { id: 'image', label: '图片生成', desc: '文生图；选择图片生成平台或本地服务' }
];

export const AI_TASK_LABELS: Record<AiTask, string> = Object.fromEntries(
  AI_TASKS.map((task) => [task.id, task.label])
) as Record<AiTask, string>;

/**
 * 常见模型的**参考价**（每 100 万 token，人民币），按官方公开价折算。
 * 价格会变，这里只用于估算；用户可在「设置 → 用量」里覆盖任意模型。
 */
export const REFERENCE_PRICES: Record<string, ModelPrice> = {
  'deepseek-chat': { input: 2, output: 8 },
  'deepseek-reasoner': { input: 4, output: 16 },
  'gpt-4o': { input: 18, output: 72 },
  'gpt-4o-mini': { input: 1.1, output: 4.4 },
  'gpt-4.1-mini': { input: 2.9, output: 11.5 },
  'claude-sonnet-4-5': { input: 21.6, output: 108 },
  'claude-opus-4-1': { input: 108, output: 540 },
  'claude-3-5-haiku-latest': { input: 5.8, output: 29 },
  'gemini-2.5-pro': { input: 9, output: 72 },
  'gemini-2.5-flash': { input: 2.2, output: 18 },
  'qwen-plus': { input: 0.8, output: 2 },
  'qwen-turbo': { input: 0.3, output: 0.6 },
  'glm-4.5': { input: 4, output: 16 },
  'moonshot-v1-8k': { input: 12, output: 12 }
};

/** 取模型价格：用户覆盖优先，其次参考价；都没有返回 null。 */
export function priceFor(
  model: string,
  overrides: Record<string, ModelPrice>
): ModelPrice | null {
  const key = String(model || '').trim();
  if (!key) return null;
  const exact = overrides[key] || REFERENCE_PRICES[key];
  if (exact) return exact;
  // 型号带日期后缀（如 gpt-4o-2024-08-06）时按前缀匹配，长前缀优先。
  const prefix = Object.keys({ ...REFERENCE_PRICES, ...overrides })
    .filter((candidate) => key.startsWith(candidate) && candidate.length >= 4)
    .sort((a, b) => b.length - a.length)[0];
  if (!prefix) return null;
  return overrides[prefix] || REFERENCE_PRICES[prefix] || null;
}

/** 估算一次请求的成本（人民币）。input 里的缓存命中按输入价的一半计。 */
export function estimateCost(
  model: string,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number },
  overrides: Record<string, ModelPrice>
): number | null {
  const price = priceFor(model, overrides);
  if (!price) return null;
  const cached = Math.min(usage.inputTokens, Math.max(0, usage.cacheReadTokens || 0));
  const fresh = Math.max(0, usage.inputTokens - cached);
  const inputCost = (fresh * price.input + cached * price.input * 0.5) / 1_000_000;
  const outputCost = (Math.max(0, usage.outputTokens) * price.output) / 1_000_000;
  return inputCost + outputCost;
}
