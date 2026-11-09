import type { PromptTemplate } from './types';

/** 默认总结提示词：桌面端设置页、主进程与插件默认值共用这一句。 */
export const DEFAULT_SUMMARY_PROMPT =
  '按顺序完整梳理整理这期视频的内容（不要为了整理而简洁以至于忽略了很多核心之外的内容），最后形成详细的笔记。（输出时可以用表格、代码块、高亮块、超链接、公式等markdown格式进行输出，适当添加一些图标增加可读性）';

/** 内置总结模板（设置页可直接恢复默认）。 */
export const DEFAULT_SUMMARY_TEMPLATES: PromptTemplate[] = [
  { id: 'default', name: '默认（视频整理）', text: DEFAULT_SUMMARY_PROMPT },
  {
    id: 'brief',
    name: '精简',
    text: '用 Markdown 输出简洁总结，先给结论再列要点；保留关键数字、结论与步骤，不要为了短而删信息，也不要重复灌水。只依据字幕，不要编造；不确定的地方标注「不确定」。'
  },
  {
    id: 'detailed',
    name: '详细',
    text: `输出一份详细学习笔记，Markdown 格式，包含：
## 一句话总结
## 核心观点（3-8 条）
## 章节脉络（带 [mm:ss] 时间戳）
## 关键细节与数据
## 术语解释
## 可行动建议
只依据字幕，不要编造；不确定的地方标注「不确定」。`
  }
];

/** 按 id 取内置模板；自定义模板返回 undefined。 */
export function builtinSummaryTemplate(id: string): PromptTemplate | undefined {
  return DEFAULT_SUMMARY_TEMPLATES.find((template) => template.id === id);
}
