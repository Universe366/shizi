/**
 * 「总结 / 章节」请求的跨组件握手。
 *
 * SummaryPanel 是 lazy 加载的：第一次点侧栏按钮时，事件可能比组件挂载更早。
 * 所以请求同时写一个 pending 标记，面板挂载后主动消费；已经挂载时由事件消费。
 */
export type SummaryPanelRequest = 'summary' | 'chapters';

const pending = new Set<SummaryPanelRequest>();

export function requestSummaryPanel(kind: SummaryPanelRequest): void {
  pending.add(kind);
  window.dispatchEvent(new Event(`bsub:${kind}-request`));
}

export function consumeSummaryPanelRequest(kind: SummaryPanelRequest): boolean {
  const has = pending.has(kind);
  if (has) pending.delete(kind);
  return has;
}
