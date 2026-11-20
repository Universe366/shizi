import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, Minus, Plus, RotateCw, Search, X } from 'lucide-react';
import type { SidebarPage } from '../../../shared/types';

interface BrowserState {
  id: string;
  url: string;
  title: string;
  zoom: number;
  canBack: boolean;
  canForward: boolean;
  loading: boolean;
}

/**
 * 侧栏网页的原生视图占位：位置由这里量出来报给主进程。
 * 组件只在当前 section 就是这个网页时挂载；卸载时让主进程保留视图并计时休眠。
 */
export function SidebarWebStage({
  page,
  layoutKey,
  side = 'left'
}: {
  page: SidebarPage;
  layoutKey: string;
  side?: 'left' | 'right';
}) {
  // 给侧栏边缘的拖拽条留出命中区域：原生视图盖在上面时，DOM 的 6–10px 边缘拖不动。
  const EDGE_GUTTER = 10;
  const { id, url } = page;
  const pageRef = useRef(page);
  pageRef.current = page;
  const ref = useRef<HTMLDivElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const reportRef = useRef<() => void>(() => undefined);
  const [state, setState] = useState<BrowserState>({
    id,
    url,
    title: page.title,
    zoom: 1,
    canBack: false,
    canForward: false,
    loading: false
  });
  const [address, setAddress] = useState(url);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findResult, setFindResult] = useState<{ matches: number; active: number } | null>(null);
  const findRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setState((current) => ({ ...current, id, url, title: page.title }));
    setAddress(url);
  }, [id, url, page.title]);

  useEffect(() => {
    return window.bsub.onSidebarWebFindResult?.((result) => setFindResult(result));
  }, []);

  useEffect(() => {
    if (findOpen) window.setTimeout(() => findRef.current?.focus(), 20);
    else {
      setFindResult(null);
      window.bsub.sidebarWebStopFind?.();
    }
  }, [findOpen]);

  useEffect(() => {
    return window.bsub.onSidebarWebState?.((next) => {
      if (next.id !== id) return;
      setState(next);
      if (document.activeElement !== addressRef.current) setAddress(next.url);
    });
  }, [id]);

  useEffect(() => {
    void window.bsub.sidebarWebState?.().then((result) => {
      if (!result?.ok || !result.data || result.data.id !== id) return;
      setState(result.data);
      setAddress(result.data.url);
    });
  }, [id]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const current = pageRef.current;
    void window.bsub.sidebarWebActivate({
      id: current.id,
      title: current.title,
      url: current.url
    });
    const report = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const x = side === 'right' ? rect.left + EDGE_GUTTER : rect.left;
      const width = Math.max(0, rect.width - EDGE_GUTTER);
      if (width <= 0) return;
      window.bsub.sidebarWebBounds({
        x: Math.round(x),
        y: Math.round(rect.top),
        width: Math.round(width),
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
  }, [id, url, side]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => reportRef.current());
    return () => cancelAnimationFrame(frame);
  }, [layoutKey]);

  const navigate = () => {
    const value = address.trim();
    if (!value) return;
    const next = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    setAddress(next);
    void window.bsub.sidebarWebNavigate(next);
    addressRef.current?.blur();
  };

  const updateZoom = async (action: 'in' | 'out' | 'reset') => {
    const result =
      action === 'in'
        ? await window.bsub.sidebarWebZoomIn?.()
        : action === 'out'
          ? await window.bsub.sidebarWebZoomOut?.()
          : await window.bsub.sidebarWebZoomReset?.();
    if (result?.ok) setState((current) => ({ ...current, zoom: result.data }));
  };

  return (
    <div className="sidebar-web-browser">
      <div className="sidebar-web-toolbar">
        <button
          type="button"
          title="后退"
          aria-label="后退"
          disabled={!state.canBack}
          onClick={() => window.bsub.sidebarWebBack?.()}
        >
          <ArrowLeft size={13} />
        </button>
        <button
          type="button"
          title="前进"
          aria-label="前进"
          disabled={!state.canForward}
          onClick={() => window.bsub.sidebarWebForward?.()}
        >
          <ArrowRight size={13} />
        </button>
        <button
          type="button"
          title={state.loading ? '加载中…' : '刷新'}
          aria-label="刷新"
          onClick={() => window.bsub.sidebarWebReload()}
        >
          <RotateCw size={12} className={state.loading ? 'is-spinning' : ''} />
        </button>
        <button
          type="button"
          title="在侧栏查找"
          aria-label="在侧栏查找"
          className={findOpen ? 'is-active' : ''}
          onClick={() => setFindOpen((value) => !value)}
        >
          <Search size={12} />
        </button>
        <button
          type="button"
          title="在标签页打开"
          aria-label="在标签页打开"
          onClick={() => void window.bsub.newTab(state.url)}
        >
          <ExternalLink size={12} />
        </button>
        <input
          ref={addressRef}
          className="sidebar-web-address"
          value={address}
          spellCheck={false}
          aria-label="侧栏网页地址"
          onChange={(event) => setAddress(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              navigate();
            } else if (event.key === 'Escape') {
              setAddress(state.url);
              addressRef.current?.blur();
            }
          }}
        />
        <button
          type="button"
          className="sidebar-web-zoom"
          title="缩小"
          aria-label="缩小"
          onClick={() => void updateZoom('out')}
        >
          <Minus size={11} />
        </button>
        <button
          type="button"
          className="sidebar-web-zoom-value"
          title="重置缩放"
          onClick={() => void updateZoom('reset')}
        >
          {Math.round(state.zoom * 100)}%
        </button>
        <button
          type="button"
          className="sidebar-web-zoom"
          title="放大"
          aria-label="放大"
          onClick={() => void updateZoom('in')}
        >
          <Plus size={11} />
        </button>
      </div>
      {findOpen && (
        <div className="sidebar-web-findbar">
          <input
            ref={findRef}
            value={findQuery}
            placeholder="在页面中查找"
            onChange={(event) => {
              const value = event.target.value;
              setFindQuery(value);
              if (value.trim()) void window.bsub.sidebarWebFind?.(value, true);
              else {
                setFindResult(null);
                window.bsub.sidebarWebStopFind?.();
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (findQuery.trim()) {
                  void window.bsub.sidebarWebFind?.(findQuery, !event.shiftKey);
                }
              } else if (event.key === 'Escape') {
                setFindOpen(false);
              }
            }}
          />
          <span className="sidebar-web-findcount">
            {findResult && findResult.matches > 0
              ? `${findResult.active}/${findResult.matches}`
              : '无结果'}
          </span>
          <button
            type="button"
            title="上一个"
            aria-label="上一个"
            onClick={() => void window.bsub.sidebarWebFind?.(findQuery, false)}
          >
            <ArrowLeft size={12} />
          </button>
          <button
            type="button"
            title="下一个"
            aria-label="下一个"
            onClick={() => void window.bsub.sidebarWebFind?.(findQuery, true)}
          >
            <ArrowRight size={12} />
          </button>
          <button
            type="button"
            title="关闭查找"
            aria-label="关闭查找"
            onClick={() => setFindOpen(false)}
          >
            <X size={12} />
          </button>
        </div>
      )}
      <div className="sidebar-web-stage" ref={ref} />
    </div>
  );
}
