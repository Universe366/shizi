/** 最近获得焦点的网页类型：主标签页还是侧栏网页。缩放快捷键据此路由。 */
export type ZoomTarget = 'tab' | 'sidebar';

let current: ZoomTarget = 'tab';

export function setZoomTarget(target: ZoomTarget): void {
  current = target;
}

export function getZoomTarget(): ZoomTarget {
  return current;
}
