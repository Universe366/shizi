import { describe, expect, it } from 'vitest';
import { normalizeSelectionAction } from './selectionAction';

describe('selection action', () => {
  it('保留工具条的全部动作', () => {
    for (const action of ['explain', 'translate', 'summarize', 'ask', 'speak', 'search', 'copy']) {
      expect(normalizeSelectionAction(action)).toBe(action);
    }
  });

  it('未知动作回退为解释', () => {
    expect(normalizeSelectionAction('delete')).toBe('explain');
    expect(normalizeSelectionAction('')).toBe('explain');
    expect(normalizeSelectionAction(null)).toBe('explain');
  });
});
