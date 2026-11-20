import { useSyncExternalStore } from 'react';

/**
 * 原生网页被 DOM 浮层挡住时的页面快照。
 * 只存一张 dataURL，浮层显示时垫在 BrowserStage 下面，避免白底/闪烁。
 */
let current: string | null = null;
const listeners = new Set<() => void>();

export function setOverlaySnapshot(dataUrl: string | null): void {
  if (current === dataUrl) return;
  current = dataUrl;
  for (const listener of listeners) listener();
}

export function getOverlaySnapshot(): string | null {
  return current;
}

export function useOverlaySnapshot(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getOverlaySnapshot,
    getOverlaySnapshot
  );
}
