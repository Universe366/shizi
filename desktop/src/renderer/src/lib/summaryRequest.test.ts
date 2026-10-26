// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  consumeSummaryPanelRequest,
  requestSummaryPanel
} from './summaryRequest';

describe('总结/章节请求握手', () => {
  it('lazy 面板挂载前先请求，挂载后仍能消费', () => {
    requestSummaryPanel('summary');
    expect(consumeSummaryPanelRequest('summary')).toBe(true);
    expect(consumeSummaryPanelRequest('summary')).toBe(false);
  });

  it('summary 与 chapters 互不干扰', () => {
    requestSummaryPanel('chapters');
    expect(consumeSummaryPanelRequest('summary')).toBe(false);
    expect(consumeSummaryPanelRequest('chapters')).toBe(true);
  });

  it('请求会派发同名 DOM 事件', () => {
    let fired = 0;
    const handler = () => {
      fired += 1;
    };
    window.addEventListener('bsub:summary-request', handler);
    requestSummaryPanel('summary');
    window.removeEventListener('bsub:summary-request', handler);
    expect(fired).toBe(1);
    consumeSummaryPanelRequest('summary');
  });
});
