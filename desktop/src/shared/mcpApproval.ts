import type { McpApprovalMode } from './types';

/** 名字/描述里出现这些动作时，按「可能写入或产生副作用」处理。 */
const WRITE_PATTERN =
  /(write|create|update|delete|remove|edit|insert|save|send|post|put|patch|exec|run|shell|command|upload|publish|install|uninstall|kill|drop|truncate|move|copy|rename|mkdir|chmod|set_|set[A-Z]|写入|删除|创建|修改|更新|发送|执行|运行|上传|发布|安装|卸载|移动|复制|重命名|保存|提交)/i;

export function toolNeedsApproval(
  name: string,
  description: string,
  mode: McpApprovalMode | string | undefined
): boolean {
  if (mode === 'off' || mode === undefined || mode === null) return false;
  if (mode === 'all') return true;
  return WRITE_PATTERN.test(`${name} ${description || ''}`);
}
