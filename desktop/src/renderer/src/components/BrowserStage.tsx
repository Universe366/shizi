import { useEffect, useRef } from 'react';
import { MonitorPlay } from 'lucide-react';

/** 与 CSS 里的卡片边框对齐：页面让出 1px，圆角由主进程设置为 13px。 */
const PAGE_INSET = 1;

export function BrowserStage({
  hasTab,
  sidebarPosition = 'left',
  sidebarCollapsed = false,
  sidebarWidth = 320,
  snapshot = null
}: {
  hasTab: boolean;
  sidebarPosition?: 'left' | 'right';
  sidebarCollapsed?: boolean;
  sidebarWidth?: number;
  snapshot?: string | null;
}) {
  const ref = useRef<HTMLElement>(null);
  const reportRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const report = () => {
      const rect = element.getBoundingClientRect();
      window.bsub.setLayout({
        x: Math.round(rect.left) + PAGE_INSET,
        y: Math.round(rect.top) + PAGE_INSET,
        width: Math.max(0, Math.round(rect.width) - PAGE_INSET * 2),
        height: Math.max(0, Math.round(rect.height) - PAGE_INSET * 2)
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
    };
  }, []);

  // 侧栏换边只改变位置、不改变尺寸，ResizeObserver 不会触发；
  // 这里在位置/折叠/宽度变化后强制重报一次，避免 WebContentsView 留在旧坐标。
  useEffect(() => {
    const frame = requestAnimationFrame(() => reportRef.current());
    return () => cancelAnimationFrame(frame);
  }, [sidebarPosition, sidebarCollapsed, sidebarWidth]);

  return (
    <section ref={ref} className="browser-stage">
      {snapshot && <img className="stage-snapshot" src={snapshot} alt="" />}
      {!hasTab && (
        <div className="stage-empty">
          <div className="stage-empty-icon">
            <MonitorPlay size={26} />
          </div>
          <div className="stage-empty-title">还没有打开的页面</div>
          <div className="stage-empty-desc">
            在地址栏输入 BV 号、链接或搜索词，或者点上面的 + 新建标签页。
          </div>
          <button
            className="primary-btn"
            onClick={() => void window.bsub.newTab('https://www.bilibili.com/')}
          >
            打开 B 站
          </button>
        </div>
      )}
    </section>
  );
}
