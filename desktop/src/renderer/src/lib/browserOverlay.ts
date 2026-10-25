import { useEffect } from 'react';

/**
 * 内置浏览器是原生 WebContentsView，永远盖在 renderer 上面。
 * 任何 renderer 浮层（设置/起始页/弹窗/下拉/命令面板）出现时，
 * 都要临时隐藏网页视图，否则浮层会被网页挡住。
 */
const OVERLAY_SELECTORS = [
  '.page-host',
  '.confirm-backdrop',
  '.reader-overlay',
  '.palette-backdrop',
  '.export-menu',
  '.address-suggest',
  '.address-engine-menu',
  '.start-modal-backdrop',
  '.start-shortcut-menu',
  '.wizard-overlay',
  '[role="dialog"]'
];

function overlayVisible(): boolean {
  return OVERLAY_SELECTORS.some((selector) =>
    Array.from(document.querySelectorAll<HTMLElement>(selector)).some(
      (element) => element.getClientRects().length > 0
    )
  );
}

/** 监听 DOM 里是否出现浮层，自动切换网页视图可见性。 */
export function useBrowserOverlayAuto(): void {
  useEffect(() => {
    let frame = 0;
    let last: boolean | null = null;

    const apply = () => {
      frame = 0;
      const visible = !overlayVisible();
      if (visible === last) return;
      last = visible;
      void window.bsub.setBrowserVisible(visible);
    };

    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(apply);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'open', 'hidden']
    });
    schedule();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      void window.bsub.setBrowserVisible(true);
    };
  }, []);
}
