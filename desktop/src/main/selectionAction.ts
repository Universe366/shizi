/** 网页划词工具条允许的动作；未知动作一律按“解释”处理。 */
export const SELECTION_ACTIONS = [
  'explain',
  'translate',
  'summarize',
  'ask',
  'speak',
  'search',
  'copy'
] as const;

export type SelectionAction = (typeof SELECTION_ACTIONS)[number];

export function normalizeSelectionAction(value: unknown): SelectionAction {
  const action = String(value || '');
  return (SELECTION_ACTIONS as readonly string[]).includes(action)
    ? (action as SelectionAction)
    : 'explain';
}
