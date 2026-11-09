import { useEffect, useRef } from 'react';
import type { SidebarPage } from '../../../shared/types';

/**
 * 侧栏网页的原生视图占位：位置由这里量出来报给主进程。
 * 组件只在当前 section 就是这个网页时挂载；卸载时让主进程保留视图并计时休眠。
 */
export function SidebarWebStage({
  page,
  layoutKey
}: {
  page: SidebarPage;
  layoutKey: string;
}) {
  const { id, title, url } = page;
  const ref = useRef<HTMLDivElement>(null);
  const reportRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    void window.bsub.sidebarWebActivate({ id, title, url });
    const report = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      window.bsub.sidebarWebBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      });
    };
    reportRef.current = report;
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    window.addEventListener('resize', report);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
      window.bsub.sidebarWebDeactivate();
    };
  }, [id, title, url]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => reportRef.current());
    return () => cancelAnimationFrame(frame);
  }, [layoutKey]);

  return <div className="sidebar-web-stage" ref={ref} />;
}
