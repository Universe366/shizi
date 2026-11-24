/** 统一的 AI 动作定义：所有入口（命令面板 / 右键 / 列表行）都从这里取，避免各写一套提示词。 */
export type AiActionScope = 'selection' | 'page';

export interface AiActionContext {
  pageUrl?: string;
  pageTitle?: string;
  selection?: string;
}

export interface AiAction {
  id: string;
  label: string;
  scope: AiActionScope;
  /** 生成发给对话的问题；上下文（页面/选中）由调用方补齐 */
  prompt: (context: AiActionContext) => string;
}

export const AI_ACTIONS: AiAction[] = [
  {
    id: 'summarize-page',
    label: '总结当前页面',
    scope: 'page',
    prompt: () => '用 5 条要点总结当前页面，先给结论，再列依据。'
  },
  {
    id: 'extract-actions',
    label: '提取可执行事项',
    scope: 'page',
    prompt: () => '从当前页面提取可以直接执行的待办事项，按优先级排序，每条一句话。'
  },
  {
    id: 'explain-selection',
    label: '解释选中内容',
    scope: 'selection',
    prompt: ({ selection }) => `解释下面这段内容，先说结论，再补背景：\n"""\n${selection || ''}\n"""`
  },
  {
    id: 'translate-selection',
    label: '翻译选中内容',
    scope: 'selection',
    prompt: ({ selection }) =>
      `把下面这段内容翻译成中文（原文是中文就翻译成英文），保留结构：\n"""\n${selection || ''}\n"""`
  },
  {
    id: 'ask-selection',
    label: '追问选中内容',
    scope: 'selection',
    prompt: ({ selection }) =>
      `关于下面这段内容，请给出你的分析，以及可能被忽略的点：\n"""\n${selection || ''}\n"""`
  }
];

export function aiAction(id: string): AiAction | null {
  return AI_ACTIONS.find((action) => action.id === id) || null;
}

export function aiActionsFor(scope: AiActionScope): AiAction[] {
  return AI_ACTIONS.filter((action) => action.scope === scope);
}
