/** 对话联网模式：关闭 / 自动判断 / 强制联网。 */
export type ChatWebMode = 'off' | 'auto' | 'force';

const MODES: ChatWebMode[] = ['off', 'auto', 'force'];

export function normalizeChatWebMode(value: unknown): ChatWebMode {
  return MODES.includes(value as ChatWebMode) ? (value as ChatWebMode) : 'auto';
}

export function chatWebModeLabel(mode: ChatWebMode): string {
  if (mode === 'off') return '关闭';
  if (mode === 'force') return '强制';
  return '自动';
}

export function chatWebModeHint(mode: ChatWebMode): string {
  if (mode === 'off') return '本轮不联网，只按模型自身知识回答';
  if (mode === 'force') return '本轮强制联网检索，再由模型决定搜什么';
  return '需要外部事实时才联网（默认）';
}

/** 点击 chip 时循环：自动 → 强制 → 关闭 → 自动。 */
export function nextChatWebMode(mode: ChatWebMode): ChatWebMode {
  if (mode === 'auto') return 'force';
  if (mode === 'force') return 'off';
  return 'auto';
}
